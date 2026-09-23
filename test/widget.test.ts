import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RABBIT_WIDGET_KEY,
  renderRabbitWidgetLines,
  updateRabbitWidget,
} from "../src/rabbit/widget.ts";
import { createFakeCommandContext } from "./support/fakes.ts";

function fakeState(mode: "off" | "active", workflowPhase?: string) {
  return {
    mode: () => mode,
    observedWorkflowPhase: () => workflowPhase,
  };
}

test("renders nothing while off", () => {
  assert.equal(renderRabbitWidgetLines(fakeState("off")), undefined);
});

test("renders a single RABBIT/MAX line while active", () => {
  const lines = renderRabbitWidgetLines(fakeState("active"));
  assert.deepEqual(lines, ["◆ RABBIT · MAX"]);
});

test("includes the observed workflow phase when known", () => {
  const lines = renderRabbitWidgetLines(fakeState("active", "work"));
  assert.deepEqual(lines, ["◆ RABBIT · MAX · work"]);
});

test("updateRabbitWidget sets the widget under the rabbit key", () => {
  const { ctx, setWidgetCalls } = createFakeCommandContext();

  updateRabbitWidget(ctx as never, fakeState("active"));

  assert.equal(setWidgetCalls.length, 1);
  assert.equal(setWidgetCalls[0]?.key, RABBIT_WIDGET_KEY);
  assert.deepEqual(setWidgetCalls[0]?.content, ["◆ RABBIT · MAX"]);
});

test("updateRabbitWidget clears the widget (undefined content) while off", () => {
  const { ctx, setWidgetCalls } = createFakeCommandContext();

  updateRabbitWidget(ctx as never, fakeState("off"));

  assert.equal(setWidgetCalls.length, 1);
  assert.equal(setWidgetCalls[0]?.content, undefined);
});
