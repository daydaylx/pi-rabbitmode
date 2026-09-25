import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASELINE_ROLES,
  RABBIT_BUNDLED_ROLES,
  isBaselineRole,
  isRabbitBundledRole,
  rabbitBundledRoleRuntimeName,
  spawnBaselineRole,
  spawnDynamicRole,
  spawnRabbitBundledRole,
} from "../src/orchestration/agent-factory.ts";
import { createFakeDynamicRoleRegistry } from "./support/fakes.ts";

function fakeRpc(
  handler: (method: string, params: unknown) => unknown,
) {
  return {
    call: async (method: string, params?: unknown) => handler(method, params),
    ping: async () => handler("ping", undefined),
  };
}

test("BASELINE_ROLES is exactly the verifier technical profile", () => {
  assert.deepEqual(BASELINE_ROLES, ["verifier"]);
});

test("isBaselineRole accepts only the verifier profile", () => {
  assert.equal(isBaselineRole("investigator"), false);
  assert.equal(isBaselineRole("debugger"), false);
  assert.equal(isBaselineRole("verifier"), true);
  assert.equal(isBaselineRole("architect"), false);
  assert.equal(isBaselineRole(""), false);
});

test("RABBIT_BUNDLED_ROLES matches the shipped agents/*.md files", () => {
  assert.deepEqual(RABBIT_BUNDLED_ROLES, [
    "permission-auditor",
    "recovery-auditor",
    "architecture-auditor",
  ]);
});

test("isRabbitBundledRole accepts only the three bundled roles", () => {
  assert.equal(isRabbitBundledRole("permission-auditor"), true);
  assert.equal(isRabbitBundledRole("recovery-auditor"), true);
  assert.equal(isRabbitBundledRole("architecture-auditor"), true);
  assert.equal(isRabbitBundledRole("investigator"), false);
  assert.equal(isRabbitBundledRole(""), false);
});

test("rabbitBundledRoleRuntimeName namespaces under rabbitmode.", () => {
  assert.equal(rabbitBundledRoleRuntimeName("permission-auditor"), "rabbitmode.permission-auditor");
});

test("spawnRabbitBundledRole spawns by the namespaced runtime name, not the local name", () => {
  const captured: unknown[] = [];
  const rpc = fakeRpc((method, params) => {
    captured.push(params);
    return { version: 1, requestId: "x", method, success: true, data: { text: "started" } };
  });

  return spawnRabbitBundledRole(rpc as never, "recovery-auditor", "audit recovery paths").then((result) => {
    assert.equal(result.ok, true);
    assert.deepEqual(captured, [{ agent: "rabbitmode.recovery-auditor", task: "audit recovery paths" }]);
  });
});

test("spawnBaselineRole calls spawn with agent+task, no ad-hoc definition fields", async () => {
  let capturedParams: unknown;
  const rpc = fakeRpc((method, params) => {
    capturedParams = params;
    return { version: 1, requestId: "x", method, success: true, data: { text: "started" } };
  });

  const result = await spawnBaselineRole(rpc as never, "verifier", "find the bug");

  assert.equal(result.ok, true);
  assert.deepEqual(capturedParams, { agent: "verifier", task: "find the bug" });
});

test("spawnBaselineRole surfaces the server's text on success", async () => {
  const rpc = fakeRpc(() => ({
    version: 1,
    requestId: "x",
    success: true,
    data: { text: "verifier run rabbit-abc123 started (async)." },
  }));

  const result = await spawnBaselineRole(rpc as never, "verifier", "find the bug");

  assert.equal(result.ok, true);
  assert.equal(result.message, "verifier run rabbit-abc123 started (async).");
});

test("spawnBaselineRole falls back to a generic message when the server sends no text", async () => {
  const rpc = fakeRpc(() => ({ version: 1, requestId: "x", success: true, data: {} }));

  const result = await spawnBaselineRole(rpc as never, "verifier", "reproduce the crash");

  assert.equal(result.ok, true);
  assert.equal(result.message, "verifier gestartet.");
});

test("spawnBaselineRole surfaces a server error without pretending success", async () => {
  const rpc = fakeRpc(() => ({
    version: 1,
    requestId: "x",
    success: false,
    error: { code: "not_found", message: 'Agent "verifier" not found in this project.' },
  }));

  const result = await spawnBaselineRole(rpc as never, "verifier", "check the diff");

  assert.equal(result.ok, false);
  assert.match(result.message, /not_found/);
  assert.match(result.message, /not found in this project/);
});

test("spawnBaselineRole surfaces a client-side rejection (e.g. RPC timeout)", async () => {
  const rpc = {
    call: async () => {
      throw new Error('RabbitMode: subagents RPC "spawn" timed out after 800ms');
    },
    ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
  };

  const result = await spawnBaselineRole(rpc as never, "verifier", "find the bug");

  assert.equal(result.ok, false);
  assert.match(result.message, /timed out/);
});

test("spawnDynamicRole defines then spawns with the runtime name and task from define()", async () => {
  const registry = createFakeDynamicRoleRegistry();
  let capturedParams: unknown;
  const rpc = fakeRpc((method, params) => {
    capturedParams = params;
    return { version: 1, requestId: "x", method, success: true, data: { text: "started" } };
  });

  const request = { id: "api-checker", purpose: "p", instructions: "i", tools: ["read"], task: "check it" };
  const result = await spawnDynamicRole(rpc as never, registry as never, "/scratch", request);

  assert.equal(result.ok, true);
  assert.deepEqual(registry.defineCalls, [{ cwd: "/scratch", raw: request }]);
  assert.deepEqual(capturedParams, { agent: "rabbit-dynamic.api-checker", task: "check it" });
});

test("spawnDynamicRole never calls spawn when define() rejects the request", async () => {
  const registry = createFakeDynamicRoleRegistry({ defineBehavior: "error", defineError: "tools not allowed" });
  let spawnCalled = false;
  const rpc = fakeRpc(() => {
    spawnCalled = true;
    return { version: 1, requestId: "x", success: true, data: {} };
  });

  const result = await spawnDynamicRole(rpc as never, registry as never, "/scratch", {
    id: "x",
    tools: ["bash"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, "tools not allowed");
  assert.equal(spawnCalled, false);
});

test("spawnDynamicRole cleans up the written file when the spawn RPC call fails", async () => {
  const registry = createFakeDynamicRoleRegistry();
  const rpc = fakeRpc(() => ({
    version: 1,
    requestId: "x",
    success: false,
    error: { code: "invalid_params", message: "bad params" },
  }));

  const result = await spawnDynamicRole(rpc as never, registry as never, "/scratch", {
    id: "api-checker",
    task: "check it",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(registry.cleanupCalls, ["api-checker"]);
});

test("spawnDynamicRole cleans up the written file when the RPC call throws (e.g. timeout)", async () => {
  const registry = createFakeDynamicRoleRegistry();
  const rpc = {
    call: async () => {
      throw new Error('RabbitMode: subagents RPC "spawn" timed out');
    },
    ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
  };

  const result = await spawnDynamicRole(rpc as never, registry as never, "/scratch", {
    id: "api-checker",
    task: "check it",
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /timed out/);
  assert.deepEqual(registry.cleanupCalls, ["api-checker"]);
});
