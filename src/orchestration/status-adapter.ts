import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";

/**
 * Verified live against a real `pi-subagents` run (a real `pi -e
 * /home/g/Projekte/pi-rabbitmode -p "/rabbit on" "/rabbit workflow
 * {...}"` smoke test, see README.md's Phase-6/8 sections) — this was
 * previously best-effort/unverified; two real findings from that test
 * are folded in here:
 *
 * 1. `Details.results: SingleResult[]` in `~/.pi/agent/git/github.com/
 *    daydaylx/pi-subagents/src/shared/types/results.ts` — absence of any
 *    `results` entry means "not yet terminal" (the safe default for a
 *    poller — never mistake "still running" for "done"); a `results`
 *    entry with a non-zero `exitCode` or an `error` field means failed;
 *    anything else with at least one result means complete. This part
 *    matched the design without changes needed.
 * 2. A `status` RPC error is never proof that a child is terminal: it can
 *    mean the status file has not been written yet, or that the status
 *    service is temporarily unavailable. Keep polling, then report an
 *    unknown terminal state on timeout so callers retain the child handle.
 */
export interface StepStatusOutcome {
  terminal: boolean;
  failed: boolean;
  stopped?: boolean;
  timedOut?: boolean;
  text?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function interpretStatusReply(
  reply: Awaited<ReturnType<SubagentRpcClient["call"]>>,
): StepStatusOutcome {
  if (!reply.success) {
    return { terminal: false, failed: false, text: reply.error.message };
  }
  const data = isRecord(reply.data) ? reply.data : undefined;
  const text = typeof data?.text === "string" ? data.text : undefined;
  const details = isRecord(data?.details) ? data.details : undefined;
  const results = Array.isArray(details?.results) ? details.results : undefined;
  const state = [data?.state, data?.status, details?.state, details?.status]
    .find((candidate): candidate is string => typeof candidate === "string")
    ?.toLowerCase();

  if (["stopped", "cancelled", "canceled"].includes(state ?? "")) {
    return { terminal: true, failed: false, stopped: true, text };
  }
  if (["failed", "error"].includes(state ?? "")) {
    return { terminal: true, failed: true, text };
  }
  if (!results || results.length === 0) {
    return { terminal: false, failed: false };
  }
  const last = results[results.length - 1];
  const stopped = Boolean(
    isRecord(last) && (last.stopped === true || last.interrupted === true),
  );
  if (stopped) return { terminal: true, failed: false, stopped: true, text };
  const failed = Boolean(
    isRecord(last) &&
    (typeof last.error === "string" ||
      (typeof last.exitCode === "number" && last.exitCode !== 0)),
  );
  return { terminal: true, failed, text };
}

export interface PollStepOptions {
  /** Delay between polls. Default 2000ms. */
  intervalMs?: number;
  /** Give up and report as failed after this long. Default 10 minutes. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `status` for `runId` until `interpretStatusReply` reports
 * terminal, or `timeoutMs` elapses (reported as a failed, non-terminal
 * timeout — a step that never finishes must not block the workflow
 * forever).
 */
export async function pollStepUntilTerminal(
  rpc: SubagentRpcClient,
  runId: string,
  options?: PollStepOptions,
): Promise<StepStatusOutcome> {
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const sleep = options?.sleep ?? defaultSleep;
  const now = options?.now ?? Date.now;
  const deadline = now() + timeoutMs;
  let lastStatusError: string | undefined;

  while (true) {
    let reply: Awaited<ReturnType<SubagentRpcClient["call"]>>;
    try {
      reply = await rpc.call("status", { id: runId });
    } catch (error) {
      lastStatusError = error instanceof Error ? error.message : String(error);
      if (now() >= deadline) {
        return {
          terminal: false,
          failed: true,
          timedOut: true,
          text: `Terminalstatus von ${runId} unbekannt: ${lastStatusError}`,
        };
      }
      await sleep(intervalMs);
      continue;
    }
    const outcome = interpretStatusReply(reply);
    if (outcome.terminal) return outcome;
    if (!reply.success) lastStatusError = reply.error.message;
    if (now() >= deadline) {
      const detail = lastStatusError
        ? ` Letzter Statusfehler: ${lastStatusError}`
        : "";
      return {
        terminal: false,
        failed: true,
        timedOut: true,
        text: `Timeout nach ${timeoutMs}ms beim Warten auf ${runId}; Terminalstatus unbekannt.${detail}`,
      };
    }
    await sleep(intervalMs);
  }
}
