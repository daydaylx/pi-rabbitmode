import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runWorkflow,
  type WorkflowStepResult,
} from "../src/orchestration/workflow-runner.ts";
import type { WorkflowStepDefinition } from "../src/orchestration/graph.ts";
import { createRabbitRunController } from "../src/orchestration/run-controller.ts";

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
  const spawnedTasks = new Map<string, string>();
  let concurrentSpawns = 0;
  let maxConcurrentSpawns = 0;

  const rpc = {
    call: async (method: string, params?: unknown) => {
      if (method === "spawn") {
        const { task: fullTask } = params as { agent: string; task: string };
        // Only `verifier` is a baseline role, so steps are told apart by
        // the first line of their own task instead of by role name.
        const task = fullTask;
        const agent = fullTask.split("\n")[0] ?? fullTask;
        spawnOrder.push(agent);
        spawnedTasks.set(agent, task);
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
          data: {
            text: `${agent} started`,
            details: { runId: `run-${agent}` },
          },
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

  return {
    rpc,
    spawnOrder,
    spawnedTasks,
    maxConcurrentSpawns: () => maxConcurrentSpawns,
  };
}

const instantPoll = { pollOptions: { sleep: () => Promise.resolve() } };

test("a single valid step completes and reports ok:true", async () => {
  const { rpc } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [
    { id: "a", role: "verifier", task: "look" },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, true);
  assert.deepEqual(result.steps, [
    { id: "a", status: "completed", message: "look done" },
  ]);
});

test("a child timeout stays registered because its terminal state is unknown", async () => {
  const controller = createRabbitRunController();
  const rpc = {
    call: async (method: string) => {
      if (method === "spawn")
        return {
          version: 1,
          requestId: "x",
          success: true,
          data: { details: { runId: "run-child" } },
        };
      if (method === "status")
        return { version: 1, requestId: "x", success: true, data: {} };
      throw new Error(`unexpected ${method}`);
    },
    ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
  };
  let now = 0;
  const result = await runWorkflow(
    rpc as never,
    [{ id: "child", role: "verifier", task: "work" }],
    {
      runController: controller,
      pollOptions: {
        timeoutMs: 1,
        intervalMs: 1,
        now: () => now,
        sleep: async () => {
          now += 1;
        },
      },
    },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(controller.snapshot().activeStepRunIds, ["run-child"]);
  assert.equal(controller.isActive(), true);
});

test("a stop during spawn keeps an unidentifiable child step unresolved", async () => {
  const controller = createRabbitRunController();
  let announceSpawn!: () => void;
  let finishSpawn!: (reply: object) => void;
  const spawnStarted = new Promise<void>((resolve) => {
    announceSpawn = resolve;
  });
  const rpc = {
    call: async (method: string) => {
      if (method === "spawn") {
        announceSpawn();
        return new Promise((resolve) => {
          finishSpawn = resolve;
        });
      }
      throw new Error(`unexpected ${method}`);
    },
    ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
  };
  const run = runWorkflow(
    rpc as never,
    [{ id: "child", role: "verifier", task: "work" }],
    { runController: controller },
  );
  await spawnStarted;
  controller.requestStop();
  finishSpawn({
    version: 1,
    requestId: "x",
    success: true,
    data: { text: "accepted", details: {} },
  });
  const result = await run;
  assert.equal(result.ok, false);
  assert.deepEqual(controller.snapshot().activeSteps, ["child"]);
  assert.equal(controller.isActive(), true);
});

test("an invalid graph never spawns anything and reports the validation error", async () => {
  const { rpc, spawnOrder } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [
    { id: "a", role: "not-a-real-role", task: "x" },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 0);
  assert.ok(!result.ok && result.error);
  assert.deepEqual(spawnOrder, []);
});

test("the example fan-out DAG: three branches run, then synthesis waits for all three", async () => {
  const { rpc, spawnOrder } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [
    {
      id: "permissions",
      role: "verifier",
      task: "audit permissions",
    },
    { id: "recovery", role: "verifier", task: "audit recovery" },
    {
      id: "architecture",
      role: "verifier",
      task: "audit architecture",
    },
    {
      id: "synthesis",
      role: "verifier",
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
  // synthesis must be spawned only after all three branches were spawned.
  const synthesisIndex = spawnOrder.indexOf("combine findings");
  assert.ok(
    synthesisIndex >= 3,
    `synthesis spawned too early: ${spawnOrder.join(",")}`,
  );
});

test("a failed step skips its dependents and the run reports ok:false", async () => {
  const { rpc } = fakeSchedulerRpc({ failAgents: ["reproduce the bug"] });
  const steps: WorkflowStepDefinition[] = [
    { id: "reproduce", role: "verifier", task: "reproduce the bug" },
    {
      id: "fix",
      role: "verifier",
      task: "propose a fix",
      dependsOn: ["reproduce"],
    },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, false);
  assert.equal(
    result.steps.find((s) => s.id === "reproduce")?.status,
    "failed",
  );
  assert.equal(result.steps.find((s) => s.id === "fix")?.status, "skipped");
});

test("an independent step still completes even when an unrelated branch fails", async () => {
  const { rpc } = fakeSchedulerRpc({ failAgents: ["x"] });
  const steps: WorkflowStepDefinition[] = [
    { id: "broken", role: "verifier", task: "x" },
    { id: "fine", role: "verifier", task: "y" },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.steps.find((s) => s.id === "broken")?.status, "failed");
  assert.equal(result.steps.find((s) => s.id === "fine")?.status, "completed");
});

test("maxParallel is respected: three independent steps with maxParallel=1 never overlap", async () => {
  const { rpc, maxConcurrentSpawns } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [
    { id: "a", role: "verifier", task: "x" },
    { id: "b", role: "verifier", task: "y" },
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
  const { rpc } = fakeSchedulerRpc({ spawnErrorAgents: ["x"] });
  const steps: WorkflowStepDefinition[] = [
    { id: "broken", role: "verifier", task: "x" },
    { id: "fine", role: "verifier", task: "y" },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, false);
  const broken = result.steps.find((s) => s.id === "broken");
  assert.equal(broken?.status, "failed");
  assert.match(broken?.message ?? "", /rejected/);
  assert.equal(result.steps.find((s) => s.id === "fine")?.status, "completed");
});

test("a dependent step receives only the output of its direct dependency", async () => {
  const { rpc, spawnedTasks } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [
    { id: "source", role: "verifier", task: "inspect source" },
    {
      id: "consumer",
      role: "verifier",
      task: "synthesize source",
      dependsOn: ["source"],
    },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, true);
  assert.match(
    spawnedTasks.get("synthesize source") ?? "",
    /\[Dependency result: source\]/,
  );
  assert.match(spawnedTasks.get("synthesize source") ?? "", /inspect source done/);
});

test("fan-in receives all declared outputs while independent branches remain isolated", async () => {
  const { rpc, spawnedTasks } = fakeSchedulerRpc();
  const steps: WorkflowStepDefinition[] = [
    { id: "permission", role: "verifier", task: "audit permission" },
    { id: "recovery", role: "verifier", task: "audit recovery" },
    { id: "isolated", role: "verifier", task: "independent task" },
    {
      id: "synthesis",
      role: "verifier",
      task: "combine",
      dependsOn: ["permission", "recovery"],
    },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, true);
  const synthesisTask = spawnedTasks.get("combine") ?? "";
  assert.match(synthesisTask, /\[Dependency result: permission\]/);
  assert.match(synthesisTask, /audit permission done/);
  assert.match(synthesisTask, /\[Dependency result: recovery\]/);
  assert.match(synthesisTask, /audit recovery done/);
  assert.doesNotMatch(
    spawnedTasks.get("independent task") ?? "",
    /permission|audit recovery done/,
  );
});

test("stopped dependency is skipped and cannot feed a dependent step", async () => {
  const { rpc, spawnOrder } = fakeSchedulerRpc({ failAgents: ["fail"] });
  const result = await runWorkflow(
    rpc as never,
    [
      { id: "a", role: "verifier", task: "fail" },
      { id: "b", role: "verifier", task: "must not run", dependsOn: ["a"] },
    ],
    instantPoll,
  );
  assert.equal(result.ok, false);
  assert.equal(
    result.steps.find((entry) => entry.id === "b")?.status,
    "skipped",
  );
  assert.equal(spawnOrder.length, 1);
});

test("a step that stays running through several polls eventually completes", async () => {
  const { rpc } = fakeSchedulerRpc({ completeAfterPolls: 2 });
  const steps: WorkflowStepDefinition[] = [
    { id: "a", role: "verifier", task: "x" },
  ];

  const result = await runWorkflow(rpc as never, steps, instantPoll);

  assert.equal(result.ok, true);
  assert.equal(result.steps[0]?.status, "completed");
});
