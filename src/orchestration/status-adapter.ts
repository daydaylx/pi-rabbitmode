import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";

/**
 * ⚠️ BEST-EFFORT, NOT VERIFIED AGAINST A LIVE `pi-subagents` RUN.
 *
 * This interprets the `status` RPC reply's shape from static reading of
 * `Details`/`SingleResult` in
 * `~/.pi/agent/git/github.com/daydaylx/pi-subagents/src/shared/
 * types/results.ts` — `Details.results: SingleResult[]`, each with an
 * `exitCode`/`error`. Tracing the actual `inspectSubagentStatus` /
 * `foregroundStatusResult` code paths in `runs/foreground/
 * subagent-executor.ts` far enough to be certain of the exact reply shape
 * for a still-*running* detached/async job — as opposed to a terminal one
 * — would need a real spawn+poll cycle against a live runtime. That
 * wasn't done in this session (deliberately: the only live clone
 * available is `~/.pi/agent/git/...`, which already has unrelated
 * uncommitted work from another session sitting in it — see the Phase 6
 * commit message and README.md).
 *
 * This function is therefore isolated in its own module so it's the one
 * place to fix once verified against a real run. Its current, documented
 * assumption: absence of any `results` entry means "not yet terminal"
 * (the safe default for a poller — never mistake "still running" for
 * "done"); a `results` entry with a non-zero `exitCode` or an `error`
 * field means failed; anything else with at least one result means
 * complete.
 */
export interface StepStatusOutcome {
  terminal: boolean;
  failed: boolean;
  text?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function interpretStatusReply(
  reply: Awaited<ReturnType<SubagentRpcClient["call"]>>,
): StepStatusOutcome {
  if (!reply.success) {
    return { terminal: true, failed: true, text: reply.error.message };
  }
  const data = isRecord(reply.data) ? reply.data : undefined;
  const text = typeof data?.text === "string" ? data.text : undefined;
  const details = isRecord(data?.details) ? data.details : undefined;
  const results = Array.isArray(details?.results) ? details.results : undefined;

  if (!results || results.length === 0) {
    return { terminal: false, failed: false };
  }
  const last = results[results.length - 1];
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

  while (true) {
    let reply: Awaited<ReturnType<SubagentRpcClient["call"]>>;
    try {
      reply = await rpc.call("status", { id: runId });
    } catch (error) {
      return {
        terminal: true,
        failed: true,
        text: error instanceof Error ? error.message : String(error),
      };
    }
    const outcome = interpretStatusReply(reply);
    if (outcome.terminal) return outcome;
    if (now() >= deadline) {
      return { terminal: true, failed: true, text: `Timeout nach ${timeoutMs}ms beim Warten auf ${runId}.` };
    }
    await sleep(intervalMs);
  }
}
