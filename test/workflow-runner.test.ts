import assert from "node:assert/strict";
import { test } from "node:test";
import { runWorkflow, type WorkflowStepResult } from "../src/orchestration/workflow-runner.ts";
import type { WorkflowStepDefinition } from "../src/orchestration/graph.ts";

/**
 * A fake `pi-subagents` server: every spawned step gets a runId derived
 * from its agent name, and completes after `completeAfterPolls` status
 * polls (0 = already done on the first poll). `failAgents` makes a
 * step's terminal result a failure (nonzero exitCode) instead.
 */
function fakeSchedulerRpc(options?: {
  completeAfterPolls?: number;
  failAgents?: string[];
  spawnErrorAgents?: string[];
}) {
  const completeAfterPolls = options?.completeAfterPolls ?? 0;
  const failAgents = new Set(options?.failAgents ?? []);
  const spawnErrorAgents = new Set(options?.spawnErrorAgents ?? []);
  const pollCounts = new Map<string, number>();
  const spawnOrder: string[] = [];
  let concurrentSpawns = 0;
  let maxConcurrentSpawns = 0;

  const rpc = {
    call: async (method: string, params?: unknown) => {
      if (method === "spawn") {
        const { agent } = params as { agent: string; task: string };
        spawnOrder.push(agent);
        concurrentSpawns += 1;
        maxConcurrentSpawns = Math.max(maxConcurrentSpawns, concurrentSpawns);
        // Simulate a real async round trip so concurrency is observable.
        await Promise.resolve();
        concurrentSpawns -= 1;

        if (spawnErrorAgents.has(agent)) {
          return {
            version: 1,
            requestId: agent,
            success: false,
            error: { code: "invalid_params", message: `${agent} rejected` },
          };
        }
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
        const polls = (pollCounts.get(id) ?? 0) + 1;
        pollCounts.set(id, polls);
        if (polls <= completeAfterPolls) {
          return { version: 1, requestId: id, success: true, data: {} };
        }
        const failed = failAgents.has(agent);
        return {
          version: 1,
          requestId: id,
          success: true,
          data: {
            text: failed ? `${agent} failed` : `${agent} done`,
            details: { results: [{ exitCode: failed ? 1 : 0 }] },
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    },
    ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
  };

  return { rpc, spawnOrder, maxConcurrentSpawns: () => maxConcurrentSpawns };
}

const instantPoll = { pollOptions: { sleep: () => Promise.resolve() } };

test("a single valid step completes and reports ok:true", async () => {
  const { rpc } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [{ id: "a", role: "investigator", task: "look" }];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, true);
  assert.deepEqual(result.steps, [{ id: "a", status: "completed", message: "investigator done" }]);
});

test("an invalid graph never spawns anything and reports the validation error", async () => {
  const { rpc, spawnOrder } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [{ id: "a", role: "not-a-real-role", task: "x" }];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 0);
  assert.ok(!result.ok && result.error);
  assert.deepEqual(spawnOrder, []);
});

test("the example fan-out DAG: three auditors run, then synthesis waits for all three", async () => {
  const { rpc, spawnOrder } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [
    { id: "permissions", role: "permission-auditor", task: "audit permissions" },
    { id: "recovery", role: "recovery-auditor", task: "audit recovery" },
    { id: "architecture", role: "architecture-auditor", task: "audit architecture" },
    {
      id: "synthesis",
      role: "investigator",
      task: "combine findings",
      dependsOn: ["permissions", "recovery", "architecture"],
    },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 4);
  for (const id of ["permissions", "recovery", "architecture", "synthesis"]) {
    const found: WorkflowStepResult | undefined = result.steps.find(
      (entry: WorkflowStepResult) => entry.id === id,
    );
    assert.equal(found?.status, "completed", `${id} should have completed`);
  }
  // synthesis must be spawned only after all three auditors were spawned.
  const synthesisIndex = spawnOrder.indexOf("investigator");
  assert.ok(synthesisIndex >= 3, `synthesis spawned too early: ${spawnOrder.join(",")}`);
});

test("a failed step skips its dependents and the run reports ok:false", async () => {
  const { rpc } = fakeSchedulerRpc({ failAgents: ["debugger"] });
  const steps: WorkflowStepDefinition[] = [
    { id: "reproduce", role: "debugger", task: "reproduce the bug" },
    { id: "fix", role: "investigator", task: "propose a fix", dependsOn: ["reproduce"] },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, false);
  assert.equal(result.steps.find((s) => s.id === "reproduce")?.status, "failed");
  assert.equal(result.steps.find((s) => s.id === "fix")?.status, "skipped");
});

test("an independent step still completes even when an unrelated branch fails", async () => {
  const { rpc } = fakeSchedulerRpc({ failAgents: ["debugger"] });
  const steps: WorkflowStepDefinition[] = [
    { id: "broken", role: "debugger", task: "x" },
    { id: "fine", role: "investigator", task: "y" },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.steps.find((s) => s.id === "broken")?.status, "failed");
  assert.equal(result.steps.find((s) => s.id === "fine")?.status, "completed");
});

test("maxParallel is respected: three independent steps with maxParallel=1 never overlap", async () => {
  const { rpc, maxConcurrentSpawns } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [
    { id: "a", role: "investigator", task: "x" },
    { id: "b", role: "debugger", task: "y" },
    { id: "c", role: "verifier", task: "z" },
  ];

  const result = await runWorkflow(rpc as never, steps, {
    maxParallel: 1,
    ...instantPoll,
  });

  assert.equal(result.ok, true);
  assert.equal(maxConcurrentSpawns(), 1);
});

test("a spawn-level rejection fails just that step, not the whole run for independent steps", async () => {
  const { rpc } = fakeSchedulerRpc({ spawnErrorAgents: ["debugger"] });
  const steps: WorkflowStepDefinition[] = [
    { id: "broken", role: "debugger", task: "x" },
    { id: "fine", role: "investigator", task: "y" },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, false);
  const broken = result.steps.find((s) => s.id === "broken");
  assert.equal(broken?.status, "failed");
  assert.match(broken?.message ?? "", /rejected/);
  assert.equal(result.steps.find((s) => s.id === "fine")?.status, "completed");
});

test("a step that stays running through several polls eventually completes", async () => {
  const { rpc } = fakeSchedulerRpc({ completeAfterPolls: 2 });
  const steps: WorkflowStepDefinition[] = [{ id: "a", role: "investigator", task: "x" }];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, true);
  assert.equal(result.steps[0]?.status, "completed");
});
