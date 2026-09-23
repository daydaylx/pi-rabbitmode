import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBAGENT_RPC_REQUEST_EVENT,
  SubagentRpcTimeoutError,
  createSubagentRpcClient,
  isSubagentRpcReplyEnvelope,
  subagentRpcReplyEvent,
  type SubagentRpcRequestEnvelope,
} from "../src/runtime/subagents-rpc.ts";
import { createFakeEventBus } from "./support/fakes.ts";

function pingData(overrides: Partial<{ version: number }> = {}) {
  return {
    version: overrides.version ?? 1,
    methods: ["ping", "status", "spawn", "interrupt", "stop"],
    capabilities: { status: true, asyncSpawn: true, interrupt: true, stop: true },
    events: {
      ready: "subagents:rpc:v1:ready",
      request: "subagents:rpc:v1:request",
      replyPrefix: "subagents:rpc:v1:reply:",
    },
    session: {},
  };
}

/** Minimal stand-in for pi-subagents' own rpc.ts request handler. */
function installFakeSubagentsServer(
  bus: ReturnType<typeof createFakeEventBus>,
  respond: (request: SubagentRpcRequestEnvelope) => unknown,
): () => void {
  return bus.on(SUBAGENT_RPC_REQUEST_EVENT, (raw) => {
    const request = raw as SubagentRpcRequestEnvelope;
    bus.emit(subagentRpcReplyEvent(request.requestId), respond(request));
  });
}

test("call() resolves with the reply correlated by requestId", async () => {
  const bus = createFakeEventBus();
  installFakeSubagentsServer(bus, (request) => ({
    version: 1,
    requestId: request.requestId,
    method: request.method,
    success: true,
    data: pingData(),
  }));
  const client = createSubagentRpcClient({ events: bus });

  const reply = await client.call("ping");

  assert.equal(reply.success, true);
  if (reply.success) assert.equal(reply.data && (reply.data as { version: number }).version, 1);
});

test("ping() is typed to the capability payload and resolves version/methods", async () => {
  const bus = createFakeEventBus();
  installFakeSubagentsServer(bus, (request) => ({
    version: 1,
    requestId: request.requestId,
    method: request.method,
    success: true,
    data: pingData({ version: 1 }),
  }));
  const client = createSubagentRpcClient({ events: bus });

  const reply = await client.ping();

  assert.equal(reply.success, true);
  if (reply.success) {
    assert.equal(reply.data.version, 1);
    assert.deepEqual(reply.data.methods, ["ping", "status", "spawn", "interrupt", "stop"]);
  }
});

test("each call() gets its own requestId, even concurrently", async () => {
  const bus = createFakeEventBus();
  const seenRequestIds: string[] = [];
  installFakeSubagentsServer(bus, (request) => {
    seenRequestIds.push(request.requestId);
    return { version: 1, requestId: request.requestId, method: request.method, success: true, data: {} };
  });
  const client = createSubagentRpcClient({ events: bus });

  await Promise.all([client.call("ping"), client.call("ping"), client.call("status")]);

  assert.equal(new Set(seenRequestIds).size, 3);
});

test("requests carry source.extension = pi-rabbitmode", async () => {
  const bus = createFakeEventBus();
  let capturedSource: unknown;
  installFakeSubagentsServer(bus, (request) => {
    capturedSource = request.source;
    return { version: 1, requestId: request.requestId, success: true, data: {} };
  });
  const client = createSubagentRpcClient({ events: bus });

  await client.call("ping");

  assert.deepEqual(capturedSource, { extension: "pi-rabbitmode" });
});

test("rejects with SubagentRpcTimeoutError when nothing replies", async () => {
  const bus = createFakeEventBus(); // no server installed
  const client = createSubagentRpcClient({ events: bus });

  await assert.rejects(
    client.call("ping", undefined, { timeoutMs: 20 }),
    SubagentRpcTimeoutError,
  );
});

test("a malformed reply on the right channel is ignored, not resolved", async () => {
  const bus = createFakeEventBus();
  installFakeSubagentsServer(bus, (request) => ({ nonsense: true, requestId: request.requestId }));
  const client = createSubagentRpcClient({ events: bus });

  await assert.rejects(
    client.call("ping", undefined, { timeoutMs: 20 }),
    SubagentRpcTimeoutError,
  );
});

test("isSubagentRpcReplyEnvelope accepts success and error shapes, rejects garbage", () => {
  assert.equal(
    isSubagentRpcReplyEnvelope({ version: 1, requestId: "a", success: true, data: {} }),
    true,
  );
  assert.equal(
    isSubagentRpcReplyEnvelope({
      version: 1,
      requestId: "a",
      success: false,
      error: { code: "not_found", message: "x" },
    }),
    true,
  );
  assert.equal(isSubagentRpcReplyEnvelope(undefined), false);
  assert.equal(isSubagentRpcReplyEnvelope({}), false);
  assert.equal(isSubagentRpcReplyEnvelope({ version: 2, requestId: "a", success: true, data: {} }), false);
  assert.equal(isSubagentRpcReplyEnvelope({ version: 1, requestId: "a", success: false }), false);
});
