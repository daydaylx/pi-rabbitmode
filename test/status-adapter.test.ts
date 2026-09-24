import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretStatusReply, pollStepUntilTerminal } from "../src/orchestration/status-adapter.ts";

test("interpretStatusReply treats an RPC-level error as terminal and failed", () => {
  const outcome = interpretStatusReply({
    version: 1,
    requestId: "x",
    success: false,
    error: { code: "not_found", message: "run not found" },
  });
  assert.deepEqual(outcome, { terminal: true, failed: true, text: "run not found" });
});

test('interpretStatusReply treats a "Status file not found." RPC error as not yet terminal, not a failure', () => {
  // Verified live against a real pi-subagents run: a status poll issued
  // immediately after spawn — before the async run's status file exists
  // on disk — comes back exactly like this, not as an empty-results
  // success reply. See status-adapter.ts's module doc comment.
  const outcome = interpretStatusReply({
    version: 1,
    requestId: "x",
    success: false,
    error: { code: "execution_failed", message: "Status file not found." },
  });
  assert.deepEqual(outcome, { terminal: false, failed: false });
});

test('interpretStatusReply still treats a different RPC-level error message as terminal and failed (only the exact "Status file not found." text is special-cased)', () => {
  const outcome = interpretStatusReply({
    version: 1,
    requestId: "x",
    success: false,
    error: { code: "execution_failed", message: "Status file not found for some other reason." },
  });
  assert.deepEqual(outcome, {
    terminal: true,
    failed: true,
    text: "Status file not found for some other reason.",
  });
});

test("interpretStatusReply treats an empty/missing results array as not yet terminal", () => {
  assert.deepEqual(
    interpretStatusReply({ version: 1, requestId: "x", success: true, data: {} }),
    { terminal: false, failed: false },
  );
  assert.deepEqual(
    interpretStatusReply({
      version: 1,
      requestId: "x",
      success: true,
      data: { details: { results: [] } },
    }),
    { terminal: false, failed: false },
  );
});

test("interpretStatusReply treats a results entry with exitCode 0 as completed", () => {
  const outcome = interpretStatusReply({
    version: 1,
    requestId: "x",
    success: true,
    data: { text: "done", details: { results: [{ exitCode: 0 }] } },
  });
  assert.deepEqual(outcome, { terminal: true, failed: false, text: "done" });
});

test("interpretStatusReply treats a results entry with a nonzero exitCode as failed", () => {
  const outcome = interpretStatusReply({
    version: 1,
    requestId: "x",
    success: true,
    data: { details: { results: [{ exitCode: 1 }] } },
  });
  assert.equal(outcome.terminal, true);
  assert.equal(outcome.failed, true);
});

test("interpretStatusReply treats a results entry with an error field as failed", () => {
  const outcome = interpretStatusReply({
    version: 1,
    requestId: "x",
    success: true,
    data: { details: { results: [{ exitCode: 0, error: "boom" }] } },
  });
  assert.equal(outcome.terminal, true);
  assert.equal(outcome.failed, true);
});

test("interpretStatusReply reads the last results entry when several are present", () => {
  const outcome = interpretStatusReply({
    version: 1,
    requestId: "x",
    success: true,
    data: { details: { results: [{ exitCode: 1 }, { exitCode: 0 }] } },
  });
  assert.equal(outcome.failed, false);
});

// --- pollStepUntilTerminal ---

function fakeRpc(handler: (method: string, params: unknown) => unknown) {
  return {
    call: async (method: string, params?: unknown) => handler(method, params),
    ping: async () => handler("ping", undefined),
  };
}

const instantSleep = () => Promise.resolve();

test("pollStepUntilTerminal resolves immediately when the first poll is already terminal", async () => {
  const rpc = fakeRpc(() => ({
    version: 1,
    requestId: "x",
    success: true,
    data: { text: "done", details: { results: [{ exitCode: 0 }] } },
  }));

  const outcome = await pollStepUntilTerminal(rpc as never, "run-1", { sleep: instantSleep });
  assert.deepEqual(outcome, { terminal: true, failed: false, text: "done" });
});

test("pollStepUntilTerminal polls again while the run is still active", async () => {
  let calls = 0;
  const rpc = fakeRpc(() => {
    calls += 1;
    if (calls < 3) return { version: 1, requestId: "x", success: true, data: {} };
    return {
      version: 1,
      requestId: "x",
      success: true,
      data: { text: "finished", details: { results: [{ exitCode: 0 }] } },
    };
  });

  const outcome = await pollStepUntilTerminal(rpc as never, "run-1", { sleep: instantSleep });
  assert.equal(calls, 3);
  assert.deepEqual(outcome, { terminal: true, failed: false, text: "finished" });
});

test('pollStepUntilTerminal polls past an initial "Status file not found." race instead of failing the step within one poll', async () => {
  // Reproduces the real bug this session's live smoke test found: the
  // first status poll right after spawn genuinely gets this reply from
  // pi-subagents before completing normally.
  let calls = 0;
  const rpc = fakeRpc(() => {
    calls += 1;
    if (calls === 1) {
      return {
        version: 1,
        requestId: "x",
        success: false,
        error: { code: "execution_failed", message: "Status file not found." },
      };
    }
    return {
      version: 1,
      requestId: "x",
      success: true,
      data: { text: "real work done", details: { results: [{ exitCode: 0 }] } },
    };
  });

  const outcome = await pollStepUntilTerminal(rpc as never, "run-1", { sleep: instantSleep });
  assert.equal(calls, 2);
  assert.deepEqual(outcome, { terminal: true, failed: false, text: "real work done" });
});

test("pollStepUntilTerminal passes {id: runId} as the status params", async () => {
  let capturedParams: unknown;
  const rpc = fakeRpc((_method, params) => {
    capturedParams = params;
    return {
      version: 1,
      requestId: "x",
      success: true,
      data: { details: { results: [{ exitCode: 0 }] } },
    };
  });

  await pollStepUntilTerminal(rpc as never, "run-42", { sleep: instantSleep });
  assert.deepEqual(capturedParams, { id: "run-42" });
});

test("pollStepUntilTerminal gives up after the deadline and reports a failed timeout", async () => {
  const rpc = fakeRpc(() => ({ version: 1, requestId: "x", success: true, data: {} }));

  let clock = 0;
  const outcome = await pollStepUntilTerminal(rpc as never, "run-1", {
    sleep: instantSleep,
    now: () => clock++,
    timeoutMs: 3,
  });

  assert.equal(outcome.terminal, true);
  assert.equal(outcome.failed, true);
  assert.match(outcome.text ?? "", /Timeout/);
});

test("pollStepUntilTerminal treats a thrown RPC call as a terminal failure, not an infinite loop", async () => {
  const rpc = {
    call: async () => {
      throw new Error("network exploded");
    },
    ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
  };

  const outcome = await pollStepUntilTerminal(rpc as never, "run-1", { sleep: instantSleep });
  assert.deepEqual(outcome, { terminal: true, failed: true, text: "network exploded" });
});
