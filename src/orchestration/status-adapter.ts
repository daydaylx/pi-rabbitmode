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
 * 2. NOT anticipated by that static reading: a `status` poll issued
 *    immediately after `spawn` returns — before `pi-subagents` has
 *    finished writing the new async run's status file to disk — comes
 *    back as `reply.success === false`, `error.code: "execution_failed"`,
 *    `error.message: "Status file not found."` (the literal text from
 *    `run-status.ts`'s fallback branch in the pinned `pi-subagents`
 *    clone). The original code treated *any* `!reply.success` as an
 *    immediate terminal failure, so a workflow step failed within
 *    ~1 second, before the spawned agent had done any real work, every
 *    single time. This is a race, not a real failure — it is the exact
 *    same "not yet terminal" state as an empty `results` array, just
 *    reported through the RPC's error channel instead of a success
 *    envelope with empty `results`. Treated identically now: not
 *    terminal, keep polling. A run that never writes a status file at
 *    all (genuinely broken) still surfaces as a failure once this
 *    function's caller's own poll `timeoutMs` (10 minutes by default)
 *    elapses — this change does not weaken that bound.
 */
export interface StepStatusOutcome {
  terminal: boolean;
  failed: boolean;
  text?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The literal text `run-status.ts`'s fallback branch returns in the
 * pinned `pi-subagents` clone when a `status` poll lands before the
 * async run's status file has been written yet. Matched by exact text
 * (not the `error.code`, which is the generic `"execution_failed"` —
 * pi-subagents does not give this race its own error code).
 */
const STATUS_FILE_NOT_YET_WRITTEN_MESSAGE = "Status file not found.";

export function interpretStatusReply(
  reply: Awaited<ReturnType<SubagentRpcClient["call"]>>,
): StepStatusOutcome {
  if (!reply.success) {
    if (reply.error.message === STATUS_FILE_NOT_YET_WRITTEN_MESSAGE) {
      return { terminal: false, failed: false };
    }
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
