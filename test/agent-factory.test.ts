import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASELINE_ROLES,
  isBaselineRole,
  spawnBaselineRole,
} from "../src/orchestration/agent-factory.ts";

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

