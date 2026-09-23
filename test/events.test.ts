import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RABBIT_MODE_CHANGED_EVENT,
  emitRabbitModeChanged,
  isRabbitModeChangedEvent,
} from "../src/rabbit/events.ts";
import { createFakeEventBus } from "./support/fakes.ts";

test("emitRabbitModeChanged emits on the rabbit channel with the mode payload", () => {
  const bus = createFakeEventBus();
  emitRabbitModeChanged({ events: bus }, "active");

  assert.equal(bus.emitted.length, 1);
  assert.equal(bus.emitted[0]?.channel, RABBIT_MODE_CHANGED_EVENT);
  assert.deepEqual(bus.emitted[0]?.data, { mode: "active" });
});

test("isRabbitModeChangedEvent accepts valid payloads", () => {
  assert.equal(isRabbitModeChangedEvent({ mode: "off" }), true);
  assert.equal(isRabbitModeChangedEvent({ mode: "active" }), true);
});

test("isRabbitModeChangedEvent rejects malformed payloads", () => {
  assert.equal(isRabbitModeChangedEvent(undefined), false);
  assert.equal(isRabbitModeChangedEvent(null), false);
  assert.equal(isRabbitModeChangedEvent("active"), false);
  assert.equal(isRabbitModeChangedEvent({}), false);
  assert.equal(isRabbitModeChangedEvent({ mode: "paused" }), false);
});
