import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRabbitRunController,
  RABBIT_RUNTIME_STATE_EVENT,
  stopRabbitRun,
} from "../src/orchestration/run-controller.ts";
import { createFakeEventBus } from "./support/fakes.ts";

function fakeRpc(options?: { stopError?: string }) {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    rpc: {
      call: async (method: string, params?: unknown) => {
        calls.push({ method, params });
        if (method === "stop" && options?.stopError) {
          return { version: 1, requestId: "x", success: false, error: { code: "execution_failed", message: options.stopError } };
        }
        return { version: 1, requestId: "x", success: true, data: {} };
      },
      ping: async () => ({ version: 1, requestId: "x", success: true, data: {} }),
    },
  };
}

test("publishes lifecycle transitions and refuses to overwrite an active run", () => {
  const events = createFakeEventBus();
  const controller = createRabbitRunController({ events } as never);
  controller.setPlanning();
  assert.equal(controller.snapshot().phase, "planning");
  const begun = controller.beginRevision(1);
  assert.equal(begun.ok, true);
  assert.equal(controller.isActive(), true);
  const duplicate = controller.beginRevision(1);
  assert.equal(duplicate.ok, false);
  controller.setPhase("branching");
  controller.finish("complete");
  assert.equal(controller.snapshot().phase, "completed");
  assert.deepEqual(events.emitted.map((entry) => entry.channel), Array(4).fill(RABBIT_RUNTIME_STATE_EVENT));
});

test("tracks active child run ids and transitions running → stopping → cancelled", async () => {
  const controller = createRabbitRunController();
  controller.beginRevision(1);
  controller.registerChild("a", "run-a");
  controller.registerChild("b", "run-b");
  assert.deepEqual(controller.snapshot().activeStepRunIds.sort(), ["run-a", "run-b"]);
  controller.completeChild("run-a");
  assert.deepEqual(controller.snapshot().activeStepRunIds, ["run-b"]);

  const { rpc, calls } = fakeRpc();
  const stop = await stopRabbitRun(rpc as never, controller);
  assert.equal(stop.stopped, true);
  assert.equal(stop.requested, 1);
  assert.deepEqual(calls, [{ method: "stop", params: { id: "run-b" } }]);
  assert.equal(controller.snapshot().phase, "stopping");
  controller.finish("cancelled");
  assert.equal(controller.snapshot().phase, "cancelled");
  assert.equal(controller.isActive(), false);
});

test("stop during an in-flight spawn remains active until the pending child is registered and settled", async () => {
  const controller = createRabbitRunController();
  controller.beginRevision(1);
  controller.beginStep("slow-spawn");
  const wait = controller.waitForSettled(100);
  const { rpc, calls } = fakeRpc();
  const firstStop = await stopRabbitRun(rpc as never, controller);
  assert.equal(firstStop.stopped, true);
  assert.equal(controller.snapshot().phase, "stopping");
  assert.deepEqual(controller.snapshot().activeSteps, ["slow-spawn"]);

  controller.registerChild("slow-spawn", "run-slow");
  await stopRabbitRun(rpc as never, controller);
  assert.deepEqual(calls, [{ method: "stop", params: { id: "run-slow" } }]);
  controller.finish("cancelled");
  assert.equal(await wait, true);
  assert.equal(controller.isActive(), false);
});

test("stop while only planning cancels immediately", async () => {
  const controller = createRabbitRunController();
  controller.setPlanning();
  const { rpc } = fakeRpc();
  const stopped = await stopRabbitRun(rpc as never, controller);
  assert.equal(stopped.stopped, true);
  assert.equal(controller.snapshot().phase, "cancelled");
});

test("stop with no active workflow is a no-op", async () => {
  const controller = createRabbitRunController();
  const { rpc, calls } = fakeRpc();
  const result = await stopRabbitRun(rpc as never, controller);
  assert.deepEqual(result, { stopped: false, requested: 0, pending: 0, errors: [] });
  assert.deepEqual(calls, []);
});

test("RPC stop errors fall back to the supported interrupt action", async () => {
  const controller = createRabbitRunController();
  controller.beginRevision(1);
  controller.registerChild("a", "run-a");
  const { rpc, calls } = fakeRpc({ stopError: "stop unavailable" });
  const result = await stopRabbitRun(rpc as never, controller);
  assert.deepEqual(calls.map((call) => call.method), ["stop", "interrupt"]);
  assert.match(result.errors[0] ?? "", /stop execution_failed; interrupt/);
});
