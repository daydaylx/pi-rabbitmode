import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RABBIT_LIMIT_CEILINGS,
  RABBIT_LIMIT_DEFAULTS,
  resolveRabbitLimits,
  spawnTemporaryAgent,
  validateRabbitSpec,
} from "../src/orchestration/temporary-agent.ts";

const spec = { objective: "Find the cause", profile: "analyse", delegationReason: "independent analysis" };

function fakeRpc(reply: unknown, calls: Array<{ method: string; params: unknown }> = []) {
  return {
    calls,
    async call(method: string, params?: unknown) {
      calls.push({ method, params });
      if (reply instanceof Error) throw reply;
      return reply as never;
    },
  };
}

test("accepts a minimal analyse/research spec", () => {
  assert.equal(validateRabbitSpec(spec).ok, true);
  assert.equal(validateRabbitSpec({ ...spec, profile: "research" }).ok, true);
});

test("Rabbit adds orchestration, never rights: write/shell/network/spawn are refused", () => {
  for (const cap of ["write", "network", "spawn", "readonly_shell"]) {
    const result = validateRabbitSpec({ ...spec, requestedCapabilities: ["read", cap] });
    assert.equal(result.ok, false, cap);
  }
  assert.equal(validateRabbitSpec({ ...spec, requestedCapabilities: ["read", "search"] }).ok, true);
});

test("verify and implement profiles are refused", () => {
  const verify = validateRabbitSpec({ ...spec, profile: "verify" });
  assert.equal(verify.ok, false);
  if (!verify.ok) assert.match(verify.error, /verify/);
  assert.equal(validateRabbitSpec({ ...spec, profile: "implement" }).ok, false);
});

test("rejects missing objective, missing reason, unknown fields and bad model preference", () => {
  assert.equal(validateRabbitSpec({ ...spec, objective: " " }).ok, false);
  assert.equal(validateRabbitSpec({ ...spec, delegationReason: "" }).ok, false);
  assert.equal(validateRabbitSpec({ ...spec, tools: ["write"] }).ok, false);
  assert.equal(validateRabbitSpec({ ...spec, modelPreference: "gpt" }).ok, false);
  assert.equal(validateRabbitSpec({ ...spec, scope: { include: ["a"], write: ["b"] } }).ok, false);
  assert.equal(validateRabbitSpec("nope").ok, false);
  assert.equal(validateRabbitSpec({ ...spec, modelPreference: "strong" }).ok, true);
});

test("spawn forwards only the validated spec plus Rabbit's own model, over the spawn RPC", async () => {
  const rpc = fakeRpc({ success: true, data: { text: "started", details: { runId: "abc12345" } } });
  const result = await spawnTemporaryAgent(rpc, { ...spec, context: [" a "] }, { model: "prov/m:max" });
  assert.deepEqual(result, { ok: true, message: "started", runId: "abc12345" });
  assert.equal(rpc.calls.length, 1);
  assert.equal(rpc.calls[0].method, "spawn");
  assert.deepEqual(rpc.calls[0].params, {
    spec: { ...spec, context: ["a"] },
    model: "prov/m:max",
  });
});

test("an invalid spec never reaches the RPC", async () => {
  const rpc = fakeRpc({ success: true, data: {} });
  const result = await spawnTemporaryAgent(rpc, { ...spec, profile: "verify" });
  assert.equal(result.ok, false);
  assert.equal(rpc.calls.length, 0);
});

test("RPC failures and timeouts are reported, not swallowed", async () => {
  const failed = await spawnTemporaryAgent(
    fakeRpc({ success: false, error: { code: "invalid_params", message: "nope" } }),
    spec,
  );
  assert.equal(failed.ok, false);
  assert.match(failed.message, /invalid_params/);
  const timeout = await spawnTemporaryAgent(fakeRpc(new Error("no reply")), spec);
  assert.equal(timeout.ok, false);
  assert.match(timeout.message, /no reply/);
});

test("limits fall back to defaults for invalid values and are capped by hard ceilings", () => {
  assert.deepEqual(resolveRabbitLimits(), RABBIT_LIMIT_DEFAULTS);
  assert.deepEqual(resolveRabbitLimits({ maxParallel: -1, maxSteps: "x", maxDepth: 0 }), RABBIT_LIMIT_DEFAULTS);
  assert.deepEqual(resolveRabbitLimits({ maxParallel: 999, maxSteps: 999, maxDepth: 999 }), RABBIT_LIMIT_CEILINGS);
  assert.equal(resolveRabbitLimits({ maxParallel: 4 }).maxParallel, 4);
});

import { rabbitLimitsFromEnv } from "../src/orchestration/temporary-agent.ts";
import { validateWorkflowGraph } from "../src/orchestration/graph.ts";
import { runWorkflow } from "../src/orchestration/workflow-runner.ts";

function withEnv(vars: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    const result = run();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("limits come from the environment, with defaults, validation and ceilings", () => {
  assert.deepEqual(rabbitLimitsFromEnv({}), RABBIT_LIMIT_DEFAULTS);
  assert.deepEqual(
    rabbitLimitsFromEnv({ PI_RABBIT_MAX_STEPS: "16", PI_RABBIT_MAX_PARALLEL: "2", PI_RABBIT_MAX_DEPTH: "1" }),
    { maxSteps: 16, maxParallel: 2, maxDepth: 1 },
  );
  assert.deepEqual(
    rabbitLimitsFromEnv({ PI_RABBIT_MAX_STEPS: "abc", PI_RABBIT_MAX_PARALLEL: "-3", PI_RABBIT_MAX_DEPTH: "" }),
    RABBIT_LIMIT_DEFAULTS,
  );
  assert.deepEqual(
    rabbitLimitsFromEnv({ PI_RABBIT_MAX_STEPS: "9999", PI_RABBIT_MAX_PARALLEL: "9999", PI_RABBIT_MAX_DEPTH: "9999" }),
    RABBIT_LIMIT_CEILINGS,
  );
});

test("the configured step limit is what the graph enforces", () => {
  const steps = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, role: "verifier", task: "x" }));
  withEnv({ PI_RABBIT_MAX_STEPS: undefined }, () => {
    assert.equal(validateWorkflowGraph(steps(13)).valid, false);
    assert.equal(validateWorkflowGraph(steps(12)).valid, true);
  });
  withEnv({ PI_RABBIT_MAX_STEPS: "14" }, () => {
    assert.equal(validateWorkflowGraph(steps(14)).valid, true);
    const over = validateWorkflowGraph(steps(15));
    assert.equal(over.valid, false);
    if (!over.valid) assert.match(over.error, /Limit ist 14/);
  });
  withEnv({ PI_RABBIT_MAX_STEPS: "999" }, () => {
    assert.equal(validateWorkflowGraph(steps(RABBIT_LIMIT_CEILINGS.maxSteps + 1)).valid, false);
  });
});

test("the configured parallelism is what the runner enforces", async () => {
  const measure = async (env: string | undefined) => {
    let active = 0;
    let maxActive = 0;
    let spawned = 0;
    const polls = new Map<string, number>();
    const rpc = {
      call: async (method: string, params?: unknown) => {
        if (method === "spawn") {
          active += 1;
          maxActive = Math.max(maxActive, active);
          void params;
          spawned += 1;
          return { version: 1, requestId: "x", success: true, data: { text: "s", details: { runId: `run-${spawned}` } } };
        }
        const { id } = params as { id: string };
        const n = (polls.get(id) ?? 0) + 1;
        polls.set(id, n);
        if (n < 2) return { version: 1, requestId: "x", success: true, data: {} };
        if (n === 2) active -= 1;
        return { version: 1, requestId: "x", success: true, data: { text: "done", details: { results: [{ exitCode: 0 }] } } };
      },
      ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
    };
    const steps = ["a", "b", "c", "d"].map((id) => ({ id, role: "verifier", task: id }));
    await withEnv({ PI_RABBIT_MAX_PARALLEL: env }, async () => {
      const result = await runWorkflow(rpc as never, steps, { pollOptions: { sleep: () => Promise.resolve() } });
      assert.equal(result.ok, true);
    });
    return maxActive;
  };
  assert.equal(await measure(undefined), 3, "default parallelism");
  assert.equal(await measure("1"), 1, "configured to serial");
});
