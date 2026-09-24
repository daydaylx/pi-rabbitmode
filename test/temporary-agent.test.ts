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
