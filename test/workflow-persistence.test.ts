import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { createWorkflowSession } from "../src/orchestration/workflow-session.ts";
import type { WorkflowStepDefinition } from "../src/orchestration/graph.ts";
import {
  WORKFLOW_SNAPSHOT_DIR,
  isValidWorkflowSnapshotName,
  saveWorkflowSnapshot,
} from "../src/orchestration/workflow-persistence.ts";

function fakeRpc(handler: (method: string, params: unknown) => unknown) {
  return {
    call: async (method: string, params?: unknown) => handler(method, params),
    ping: async () => handler("ping", undefined),
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
      return {
        version: 1,
        requestId: agent,
        success: true,
        data: {
          text: `${agent} done`,
          details: { runId: `run-${agent}`, results: [{ exitCode: 0 }] },
        },
      };
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

let scratchCwd: string;

before(async () => {
  scratchCwd = await mkdtemp(path.join(tmpdir(), "rabbitmode-workflow-persistence-"));
});

after(async () => {
  await rm(scratchCwd, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(path.join(scratchCwd, ".pi"), { recursive: true, force: true });
});

test("isValidWorkflowSnapshotName enforces the naming pattern", () => {
  for (const bad of ["Auth-Refactor", "1audit", "a b", "", "a".repeat(70)]) {
    assert.equal(isValidWorkflowSnapshotName(bad), false, `expected "${bad}" to be rejected`);
  }
  assert.equal(isValidWorkflowSnapshotName("auth-refactor-audit"), true);
});

test("saveWorkflowSnapshot rejects an invalid name without writing anything", async () => {
  const rpc = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);

  const result = await saveWorkflowSnapshot(scratchCwd, "Not Valid", session);
  assert.equal(result.ok, false);
});

test("saveWorkflowSnapshot rejects a session with no revision yet", async () => {
  const session = createWorkflowSession();
  const result = await saveWorkflowSnapshot(scratchCwd, "too-early", session);
  assert.equal(result.ok, false);
});

test("saveWorkflowSnapshot writes a JSON file under .pi/rabbit-workflows/", async () => {
  const rpc = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);

  const fixedNow = () => "2026-09-24T00:00:00.000Z";
  const result = await saveWorkflowSnapshot(scratchCwd, "auth-refactor-audit", session, fixedNow);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.filePath,
    path.join(scratchCwd, ".pi", WORKFLOW_SNAPSHOT_DIR, "auth-refactor-audit.json"),
  );

  const content = JSON.parse(await readFile(result.filePath, "utf8"));
  assert.equal(content.name, "auth-refactor-audit");
  assert.equal(content.savedAt, "2026-09-24T00:00:00.000Z");
  assert.equal(content.revisions.length, 1);
  assert.equal(content.revisions[0].revision, 1);
  assert.equal(content.revisions[0].reason, undefined);
  assert.deepEqual(content.revisions[0].steps, [{ id: "a", role: "investigator", task: "task for a" }]);
  assert.equal(content.revisions[0].outcomes[0].id, "a");
  assert.equal(content.revisions[0].outcomes[0].status, "completed");
});

test("saveWorkflowSnapshot captures the full append-only revision history, including replan reasons", async () => {
  const rpc = instantSuccessRpc();
  const session = createWorkflowSession();
  await session.start(rpc as never, [step("a")], instantPoll);
  await session.replan(rpc as never, "found a gap", [step("b")], instantPoll);

  const result = await saveWorkflowSnapshot(scratchCwd, "two-revisions", session);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const content = JSON.parse(await readFile(result.filePath, "utf8"));
  assert.equal(content.revisions.length, 2);
  assert.equal(content.revisions[1].revision, 2);
  assert.equal(content.revisions[1].reason, "found a gap");
  assert.deepEqual(
    content.revisions[1].steps.map((s: { id: string }) => s.id),
    ["a", "b"],
  );
});
