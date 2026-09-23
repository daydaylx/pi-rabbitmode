import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  checkMaxThinkingSupported,
  createEffortController,
} from "../src/rabbit/effort.ts";
import {
  createFakeExtensionApi,
  fakeModelSupportingMax,
  fakeModelWithoutMax,
  fakeModelWithoutReasoning,
} from "./support/fakes.ts";

test("checkMaxThinkingSupported accepts a model with max in its thinkingLevelMap", () => {
  const result = checkMaxThinkingSupported({ model: fakeModelSupportingMax() as never });
  assert.equal(result.supported, true);
});

test("checkMaxThinkingSupported rejects a model without max", () => {
  const result = checkMaxThinkingSupported({ model: fakeModelWithoutMax() as never });
  assert.equal(result.supported, false);
  if (!result.supported) assert.match(result.reason, /RABBIT_MODEL_INCOMPATIBLE/);
});

test("checkMaxThinkingSupported rejects a non-reasoning model", () => {
  const result = checkMaxThinkingSupported({
    model: fakeModelWithoutReasoning() as never,
  });
  assert.equal(result.supported, false);
});

test("checkMaxThinkingSupported rejects when no model is selected", () => {
  const result = checkMaxThinkingSupported({ model: undefined });
  assert.equal(result.supported, false);
  if (!result.supported) assert.match(result.reason, /kein Modell ausgewählt/);
});

test("applyMax sets max and remembers the prior level, only on a capable model", () => {
  const api = createFakeExtensionApi("high");
  const effort = createEffortController(api as unknown as ExtensionAPI);

  const result = effort.applyMax({ model: fakeModelSupportingMax() } as never);

  assert.equal(result.supported, true);
  assert.equal(api.getThinkingLevel(), "max");
});

test("applyMax never calls setThinkingLevel on an incompatible model", () => {
  const api = createFakeExtensionApi("high");
  const effort = createEffortController(api as unknown as ExtensionAPI);

  const result = effort.applyMax({ model: fakeModelWithoutMax() } as never);

  assert.equal(result.supported, false);
  assert.equal(api.thinkingLevelHistory.length, 0);
  assert.equal(api.getThinkingLevel(), "high");
});

test("restore returns to the level captured by the last successful applyMax", () => {
  const api = createFakeExtensionApi("xhigh");
  const effort = createEffortController(api as unknown as ExtensionAPI);

  effort.applyMax({ model: fakeModelSupportingMax() } as never);
  assert.equal(api.getThinkingLevel(), "max");

  effort.restore();
  assert.equal(api.getThinkingLevel(), "xhigh");
});

test("restore without a prior successful applyMax is a no-op", () => {
  const api = createFakeExtensionApi("medium");
  const effort = createEffortController(api as unknown as ExtensionAPI);

  effort.restore();

  assert.equal(api.getThinkingLevel(), "medium");
  assert.equal(api.thinkingLevelHistory.length, 0);
});

test("a failed applyMax leaves nothing for restore to undo", () => {
  const api = createFakeExtensionApi("medium");
  const effort = createEffortController(api as unknown as ExtensionAPI);

  effort.applyMax({ model: fakeModelWithoutMax() } as never);
  effort.restore();

  assert.equal(api.getThinkingLevel(), "medium");
  assert.equal(api.thinkingLevelHistory.length, 0);
});

test("reset() drops a pending restore", () => {
  const api = createFakeExtensionApi("low");
  const effort = createEffortController(api as unknown as ExtensionAPI);

  effort.applyMax({ model: fakeModelSupportingMax() } as never);
  effort.reset();
  effort.restore();

  // restore() after reset() is a no-op: the level stays at "max" because
  // there is nothing remembered to go back to.
  assert.equal(api.getThinkingLevel(), "max");
});
