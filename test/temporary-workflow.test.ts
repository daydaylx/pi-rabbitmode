import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWorkflowGraph, type WorkflowStepDefinition } from "../src/orchestration/graph.ts";
import { runWorkflow } from "../src/orchestration/workflow-runner.ts";
import { TEMPORARY_ROLE } from "../src/orchestration/temporary-agent.ts";

const spec = { objective: "Find the cause", profile: "analyse", delegationReason: "independent branch" };
const tempStep = (id: string, extra: Partial<WorkflowStepDefinition> = {}): WorkflowStepDefinition => ({
  id,
  role: TEMPORARY_ROLE,
  task: "label",
  spec,
  kind: "analysis",
  ...extra,
});

test("graph accepts temporary steps and lets other steps depend on them", () => {
  const steps: WorkflowStepDefinition[] = [
    tempStep("a"),
    tempStep("b"),
    { id: "synth", role: "investigator", task: "combine", dependsOn: ["a", "b"], kind: "synthesis" },
  ];
  assert.deepEqual(validateWorkflowGraph(steps), { valid: true });
});

test("graph rejects invalid temporary steps", () => {
  const cases: Array<[string, WorkflowStepDefinition]> = [
    ["missing spec", { id: "a", role: TEMPORARY_ROLE, task: "x" }],
    ["verify profile", tempStep("a", { spec: { ...spec, profile: "verify" } })],
    ["write capability", tempStep("a", { spec: { ...spec, requestedCapabilities: ["write"] } })],
    ["spec on a normal role", { id: "a", role: "investigator", task: "x", spec }],
    ["unknown spec field", tempStep("a", { spec: { ...spec, tools: ["write"] } })],
  ];
  for (const [name, step] of cases) {
    assert.equal(validateWorkflowGraph([step]).valid, false, name);
  }
  const dependent = validateWorkflowGraph([
    { id: "root", role: "investigator", task: "x" },
    tempStep("a", { dependsOn: ["root"] }),
  ]);
  assert.equal(dependent.valid, false);
  if (!dependent.valid) assert.match(dependent.error, /nicht von anderen Steps abhängen/);
});

function fakeRpc() {
  const spawns: Array<Record<string, unknown>> = [];
  const rpc = {
    call: async (method: string, params?: unknown) => {
      if (method === "spawn") {
        const p = params as Record<string, unknown>;
        spawns.push(p);
        const label = (p.spec as { objective?: string } | undefined)?.objective ?? String(p.agent);
        return {
          version: 1,
          requestId: "x",
          success: true,
          data: { text: "started", details: { runId: `run-${spawns.length}-${label.length}` } },
        };
      }
      if (method === "status") {
        return {
          version: 1,
          requestId: "x",
          success: true,
          data: { text: "done", details: { results: [{ exitCode: 0 }] } },
        };
      }
      throw new Error(`unexpected ${method}`);
    },
    ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
  };
  return { rpc, spawns };
}

const instantPoll = { pollOptions: { sleep: () => Promise.resolve() } };

test("a temporary step spawns through the spawn RPC with spec and Rabbit's model, not a role", async () => {
  const { rpc, spawns } = fakeRpc();
  const result = await runWorkflow(rpc as never, [tempStep("a")], {
    ...instantPoll,
    childModel: "prov/m:max",
  });
  assert.equal(result.ok, true);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].agent, undefined);
  assert.equal(spawns[0].task, undefined);
  assert.deepEqual(spawns[0].spec, spec);
  assert.equal(spawns[0].model, "prov/m:max");
});

test("temporary branches fan out and a normal synthesis step still receives their outputs", async () => {
  const { rpc, spawns } = fakeRpc();
  const result = await runWorkflow(
    rpc as never,
    [
      tempStep("a"),
      tempStep("b", { spec: { ...spec, objective: "Other branch" } }),
      { id: "synth", role: "investigator", task: "combine", dependsOn: ["a", "b"], kind: "synthesis" },
    ],
    instantPoll,
  );
  assert.equal(result.ok, true);
  assert.equal(spawns.length, 3);
  const synth = spawns[2];
  assert.equal(synth.agent, "investigator");
  assert.match(String(synth.task), /\[Dependency result: a\]/);
  assert.match(String(synth.task), /\[Dependency result: b\]/);
});

test("an invalid temporary step never reaches the RPC", async () => {
  const { rpc, spawns } = fakeRpc();
  const result = await runWorkflow(
    rpc as never,
    [tempStep("a", { spec: { ...spec, profile: "verify" } })],
    instantPoll,
  );
  assert.equal(result.ok, false);
  assert.equal(spawns.length, 0);
});
