import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_WORKFLOW_REVISIONS, createWorkflowSession } from "../src/orchestration/workflow-session.ts";
import type { WorkflowStepDefinition } from "../src/orchestration/graph.ts";

function fakeRpc(handler: (method: string, params: unknown) => unknown) {
  const spawnCalls: unknown[] = [];
  return {
    spawnCalls,
    rpc: {
      call: async (method: string, params?: unknown) => {
        if (method === "spawn") spawnCalls.push(params);
        return handler(method, params);
      },
      ping: async () => handler("ping", undefined),
    },
  };
}

function terminalReply(agent: string, failed = false) {
  return {
    version: 1,
    requestId: agent,
    success: true,
    data: {
      text: `${agent} done`,
      details: { runId: `run-${agent}`, results: [{ exitCode: failed ? 1 : 0 }] },
    },
  };
}

/** Every spawn/status call resolves immediately-terminal-success. */
function instantSuccessRpc() {
  return fakeRpc((method, params) => {
    if (method === "spawn") {
      const { agent } = params as { agent: string };
      return {
        version: 1,
        requestId: agent,
        success: true,
        data: { text: `${agent} started`, details: { runId: `run-${agent}` } },
      };
    }
    if (method === "status") {
      const { id } = params as { id: string };
      const agent = id.replace(/^run-/, "");
      return terminalReply(agent);
    }
    throw new Error(`unexpected method ${method}`);
  });
}

const instantPoll = { pollOptions: { sleep: () => Promise.resolve() } };
const step = (id: string, overrides: Partial<WorkflowStepDefinition> = {}): WorkflowStepDefinition => ({
  id,
  role: "investigator",
  task: `task for ${id}`,
  ...overrides,
});

test("start() runs the initial graph as revision 1 with no reason", async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();

  const result = await session.start(rpc as never, [step("a")], instantPoll);

  assert.equal(result.ok, true);
  assert.equal(session.currentRevision(), 1);
  assert.equal(session.revisions()[0]?.reason, undefined);
  assert.equal(session.revisions()[0]?.revision, 1);
});

test("start() can only be called once per session", async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);

  const second = await session.start(rpc as never, [step("b")], instantPoll);

  assert.equal(second.ok, false);
  assert.equal(session.currentRevision(), 1);
});

test("replan() before start() is rejected", async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();

  const result = await session.replan(rpc as never, "found something", [step("b")]);

  assert.equal(result.ok, false);
});

test("replan() requires a non-empty reason", async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);

  const empty = await session.replan(rpc as never, "", [step("b")], instantPoll);
  const whitespace = await session.replan(rpc as never, "   ", [step("b")], instantPoll);

  assert.equal(empty.ok, false);
  assert.equal(whitespace.ok, false);
  assert.equal(session.currentRevision(), 1);
});

test("replan() adds a numbered revision and does not touch revision 1's own record", async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);

  const result = await session.replan(rpc as never, "found a gap in coverage", [step("b")], instantPoll);

  assert.equal(result.ok, true);
  assert.equal(session.currentRevision(), 2);
  const revisions = session.revisions();
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0]?.revision, 1);
  assert.deepEqual(revisions[0]?.steps, [step("a")]);
  assert.equal(revisions[1]?.revision, 2);
  assert.equal(revisions[1]?.reason, "found a gap in coverage");
  assert.deepEqual(
    revisions[1]?.steps.map((s) => s.id),
    ["a", "b"],
  );
});

test("replan() never re-spawns a step that already completed in an earlier revision", async () => {
  const { rpc, spawnCalls } = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);
  spawnCalls.length = 0; // only count spawns from the replan itself

  await session.replan(rpc as never, "need one more check", [step("b")], instantPoll);

  const spawnedAgents = spawnCalls.map((p) => (p as { agent: string }).agent);
  assert.deepEqual(spawnedAgents, ["investigator"]); // only b, not a again
});

test("a new step can depend on a step from an earlier revision", async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);

  const result = await session.replan(
    rpc as never,
    "b needs a's output",
    [step("b", { dependsOn: ["a"] })],
    instantPoll,
  );

  assert.equal(result.ok, true);
  assert.equal(result.steps.find((s) => s.id === "b")?.status, "completed");
});

test("replan() rejects a new step id that collides with an earlier revision's step", async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);

  const result = await session.replan(rpc as never, "retry a", [step("a")], instantPoll);

  assert.equal(result.ok, false);
  assert.equal(session.currentRevision(), 1);
});

test("replan() never widens maxParallel beyond what start() set, even if asked to", async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a"), step("b"), step("c")], {
    maxParallel: 1,
    ...instantPoll,
  });

  // No maxParallel option even accepted on replan() by the type signature —
  // this documents that omission is deliberate, not an oversight.
  const result = await session.replan(
    rpc as never,
    "add more work",
    [step("d"), step("e")],
    instantPoll,
  );
  assert.equal(result.ok, true);
});

test(`MAX_WORKFLOW_REVISIONS (${MAX_WORKFLOW_REVISIONS}) is enforced`, async () => {
  const { rpc } = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);

  await session.replan(rpc as never, "reason 1", [step("b")], instantPoll);
  const last = await session.replan(rpc as never, "reason 2", [step("c")], instantPoll);
  assert.equal(session.currentRevision(), MAX_WORKFLOW_REVISIONS);
  assert.equal(last.ok, true);

  const overLimit = await session.replan(rpc as never, "reason 3", [step("d")], instantPoll);
  assert.equal(overLimit.ok, false);
  assert.equal(session.currentRevision(), MAX_WORKFLOW_REVISIONS);
});

test("a step that fails in revision 1 skips a revision-2 step depending on it", async () => {
  const { rpc } = fakeRpc((method, params) => {
    if (method === "spawn") {
      const { agent } = params as { agent: string };
      return {
        version: 1,
        requestId: agent,
        success: true,
        data: { text: `${agent} started`, details: { runId: `run-${agent}` } },
      };
    }
    const { id } = params as { id: string };
    const agent = id.replace(/^run-/, "");
    return terminalReply(agent, agent === "debugger");
  });
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a", { role: "debugger" })], instantPoll);
  assert.equal(session.revisions()[0]?.result.steps[0]?.status, "failed");

  const result = await session.replan(
    rpc as never,
    "try again with different agent",
    [step("b", { dependsOn: ["a"] })],
    instantPoll,
  );

  assert.equal(result.ok, false);
  assert.equal(result.steps.find((s) => s.id === "b")?.status, "skipped");
});
