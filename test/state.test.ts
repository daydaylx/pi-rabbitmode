import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRabbitState } from "../src/rabbit/state.ts";
import { createRabbitRunController } from "../src/orchestration/run-controller.ts";
import {
  createFakeCommandContext,
  createFakeExtensionApi,
  fakeModelSupportingMax,
  fakeModelWithoutMax,
} from "./support/fakes.ts";

function setup() {
  const api = createFakeExtensionApi();
  const runController = createRabbitRunController();
  const state = createRabbitState(api as unknown as ExtensionAPI, runController);
  // Model supports max by default so existing activate/deactivate tests
  // aren't about capability checking — that has its own tests below.
  const { ctx, notifications } = createFakeCommandContext({
    model: fakeModelSupportingMax(),
  });
  return { api, state, runController, ctx, notifications };
}

test("starts off", () => {
  const { state } = setup();
  assert.equal(state.mode(), "off");
});

test("activate: off -> active, emits once", () => {
  const { api, state, ctx } = setup();
  const result = state.activate(ctx as never);

  assert.equal(result.changed, true);
  assert.equal(state.mode(), "active");
  assert.equal(api.events.emitted.length, 1);
  assert.deepEqual(api.events.emitted[0]?.data, { mode: "active" });
});

test("activate while already active is a no-op, no second event", () => {
  const { api, state, ctx } = setup();
  state.activate(ctx as never);
  const second = state.activate(ctx as never);

  assert.equal(second.changed, false);
  assert.equal(api.events.emitted.length, 1);
});

test("deactivate: active -> off, emits once", () => {
  const { api, state, ctx } = setup();
  state.activate(ctx as never);
  const result = state.deactivate(ctx as never);

  assert.deepEqual(result, { changed: true, blocked: false });
  assert.equal(state.mode(), "off");
  assert.equal(api.events.emitted.length, 2);
  assert.deepEqual(api.events.emitted[1]?.data, { mode: "off" });
});

test("deactivate while already off is a no-op", () => {
  const { api, state, ctx } = setup();
  const result = state.deactivate(ctx as never);

  assert.equal(result.changed, false);
  assert.equal(result.blocked, false);
  assert.equal(api.events.emitted.length, 0);
});

test("toggle flips off -> active -> off via the same path as activate/deactivate", () => {
  const { api, state, ctx } = setup();

  const first = state.toggle(ctx as never);
  assert.deepEqual(first, { changed: true, blocked: false });
  assert.equal(state.mode(), "active");

  const second = state.toggle(ctx as never);
  assert.deepEqual(second, { changed: true, blocked: false });
  assert.equal(state.mode(), "off");

  assert.deepEqual(
    api.events.emitted.map((entry) => entry.data),
    [{ mode: "active" }, { mode: "off" }],
  );
});

test("hasActiveRun delegates to the authoritative run controller and blocks /rabbit off", () => {
  const { state, runController, ctx } = setup();
  state.activate(ctx as never);
  assert.equal(state.hasActiveRun(), false);
  runController.beginRevision(1);
  assert.equal(state.hasActiveRun(), true);
  assert.deepEqual(state.deactivate(ctx as never), { changed: false, blocked: true });
  runController.finish("cancelled");
  assert.equal(state.hasActiveRun(), false);
});

test("two independent instances never share state (no restart leak)", () => {
  const { state: first, ctx } = setup();
  first.activate(ctx as never);
  const { state: second } = setup();

  assert.equal(first.mode(), "active");
  assert.equal(second.mode(), "off");
});

test("reset() returns to off and clears observed bus values", () => {
  const { api, state, ctx } = setup();
  state.reset();
  state.activate(ctx as never);
  api.events.emit("aurora-ui/state/patch", {
    patch: { permissions: { level: "yolo-full", label: "YOLO" } },
  });
  assert.equal(state.observedPermissionLevel(), "yolo-full");

  state.reset();

  assert.equal(state.mode(), "off");
  assert.equal(state.observedPermissionLevel(), undefined);
  assert.equal(state.observedWorkflowPhase(), undefined);
});

test("dispose() unsubscribes from the Aurora bus", () => {
  const { api, state } = setup();
  state.reset();
  state.dispose();

  api.events.emit("aurora-ui/state/patch", {
    patch: { permissions: { level: "yolo-full" } },
  });

  assert.equal(state.observedPermissionLevel(), undefined);
});

test("never emits on an aurora-ui/* channel (RabbitMode never writes Aurora state)", () => {
  const { api, state, ctx } = setup();
  state.reset();
  state.activate(ctx as never);
  state.deactivate(ctx as never);

  const auroraEmits = api.events.emitted.filter((entry) =>
    entry.channel.startsWith("aurora-ui/"),
  );
  assert.equal(auroraEmits.length, 0);
});

test("activate forces max thinking and remembers the previous level", () => {
  const api = createFakeExtensionApi("high");
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const { ctx } = createFakeCommandContext({ model: fakeModelSupportingMax() });

  state.activate(ctx as never);

  assert.equal(api.getThinkingLevel(), "max");
  assert.deepEqual(api.thinkingLevelHistory, ["max"]);
});

test("deactivate restores the thinking level from before activate", () => {
  const api = createFakeExtensionApi("medium");
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const { ctx } = createFakeCommandContext({ model: fakeModelSupportingMax() });

  state.activate(ctx as never);
  assert.equal(api.getThinkingLevel(), "max");

  state.deactivate(ctx as never);
  assert.equal(api.getThinkingLevel(), "medium");
});

test("activate is rejected, not silently downgraded, when the model has no max", () => {
  const api = createFakeExtensionApi("high");
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const { ctx, notifications } = createFakeCommandContext({
    model: fakeModelWithoutMax(),
  });

  const result = state.activate(ctx as never);

  assert.equal(result.changed, false);
  assert.equal(state.mode(), "off");
  // No silent max -> high fallback: setThinkingLevel is never called at all.
  assert.equal(api.thinkingLevelHistory.length, 0);
  assert.equal(api.getThinkingLevel(), "high");
  assert.match(
    notifications[notifications.length - 1]?.message ?? "",
    /RABBIT_MODEL_INCOMPATIBLE/,
  );
});

test("activate is rejected when no model is selected (fail-closed)", () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const { ctx } = createFakeCommandContext({ model: undefined });

  const result = state.activate(ctx as never);

  assert.equal(result.changed, false);
  assert.equal(api.thinkingLevelHistory.length, 0);
});

test("a rejected activate never emits rabbit:mode-changed", () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const { ctx } = createFakeCommandContext({ model: fakeModelWithoutMax() });

  state.activate(ctx as never);

  assert.equal(state.mode(), "off");
  assert.equal(api.events.emitted.length, 0);
});
