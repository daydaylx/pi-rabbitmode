import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_WORKFLOW_STEPS,
  propagateSkips,
  selectReadySteps,
  validateWorkflowGraph,
  type WorkflowStepDefinition,
  type WorkflowStepStatus,
} from "../src/orchestration/graph.ts";

function step(id: string, overrides: Partial<WorkflowStepDefinition> = {}): WorkflowStepDefinition {
  return { id, role: "verifier", task: `task for ${id}`, ...overrides };
}

test("validateWorkflowGraph accepts a single valid step", () => {
  assert.deepEqual(validateWorkflowGraph([step("a")]), { valid: true });
});

test("validateWorkflowGraph accepts the example fan-out DAG", () => {
  const result = validateWorkflowGraph([
    step("permissions", { role: "permission-auditor" }),
    step("recovery", { role: "recovery-auditor" }),
    step("architecture", { role: "architecture-auditor" }),
    step("synthesis", { dependsOn: ["permissions", "recovery", "architecture"] }),
  ]);
  assert.deepEqual(result, { valid: true });
});

test("validateWorkflowGraph rejects an empty step list", () => {
  const result = validateWorkflowGraph([]);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph rejects more than MAX_WORKFLOW_STEPS steps", () => {
  assert.equal(MAX_WORKFLOW_STEPS, 12);
  const steps = Array.from({ length: MAX_WORKFLOW_STEPS + 1 }, (_, i) => step(`s${i}`));
  const result = validateWorkflowGraph(steps);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph accepts exactly MAX_WORKFLOW_STEPS steps", () => {
  const steps = Array.from({ length: MAX_WORKFLOW_STEPS }, (_, i) => step(`s${i}`));
  assert.equal(validateWorkflowGraph(steps).valid, true);
});

test("validateWorkflowGraph rejects a duplicate id", () => {
  const result = validateWorkflowGraph([step("a"), step("a")]);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph rejects an empty task", () => {
  const result = validateWorkflowGraph([step("a", { task: "" })]);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph rejects an unknown role", () => {
  const result = validateWorkflowGraph([step("a", { role: "architect" })]);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph rejects a dependsOn reference to a nonexistent step", () => {
  const result = validateWorkflowGraph([step("a", { dependsOn: ["ghost"] })]);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph rejects a step depending on itself", () => {
  const result = validateWorkflowGraph([step("a", { dependsOn: ["a"] })]);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph rejects a two-step cycle", () => {
  const result = validateWorkflowGraph([
    step("a", { dependsOn: ["b"] }),
    step("b", { dependsOn: ["a"] }),
  ]);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph rejects a longer cycle (a -> b -> c -> a)", () => {
  const result = validateWorkflowGraph([
    step("a", { dependsOn: ["c"] }),
    step("b", { dependsOn: ["a"] }),
    step("c", { dependsOn: ["b"] }),
  ]);
  assert.equal(result.valid, false);
});

test("validateWorkflowGraph accepts a diamond dependency shape (not a cycle)", () => {
  const result = validateWorkflowGraph([
    step("a"),
    step("b", { dependsOn: ["a"] }),
    step("c", { dependsOn: ["a"] }),
    step("d", { dependsOn: ["b", "c"] }),
  ]);
  assert.equal(result.valid, true);
});

// --- selectReadySteps ---

function statusMap(entries: [string, WorkflowStepStatus][]): Map<string, WorkflowStepStatus> {
  return new Map(entries);
}

test("selectReadySteps returns steps with no dependencies when all are pending", () => {
  const steps = [step("a"), step("b")];
  const ready = selectReadySteps(steps, statusMap([["a", "pending"], ["b", "pending"]]), 3);
  assert.deepEqual(ready, ["a", "b"]);
});

test("selectReadySteps respects the available-slots cap", () => {
  const steps = [step("a"), step("b"), step("c")];
  const status = statusMap([["a", "pending"], ["b", "pending"], ["c", "pending"]]);
  assert.deepEqual(selectReadySteps(steps, status, 2), ["a", "b"]);
  assert.deepEqual(selectReadySteps(steps, status, 0), []);
});

test("selectReadySteps only returns a step once every dependency is completed", () => {
  const steps = [step("a"), step("b", { dependsOn: ["a"] })];
  const notYet = selectReadySteps(steps, statusMap([["a", "running"], ["b", "pending"]]), 3);
  assert.deepEqual(notYet, []);

  const nowReady = selectReadySteps(steps, statusMap([["a", "completed"], ["b", "pending"]]), 3);
  assert.deepEqual(nowReady, ["b"]);
});

test("selectReadySteps never re-selects a running/completed/failed/skipped step", () => {
  const steps = [step("a"), step("b"), step("c"), step("d")];
  const status = statusMap([
    ["a", "running"],
    ["b", "completed"],
    ["c", "failed"],
    ["d", "skipped"],
  ]);
  assert.deepEqual(selectReadySteps(steps, status, 10), []);
});

test("selectReadySteps requires ALL dependencies completed, not just one", () => {
  const steps = [step("a"), step("b"), step("c", { dependsOn: ["a", "b"] })];
  const partial = selectReadySteps(
    steps,
    statusMap([["a", "completed"], ["b", "running"], ["c", "pending"]]),
    3,
  );
  assert.deepEqual(partial, []);
});

// --- propagateSkips ---

test("propagateSkips skips a pending step whose dependency failed", () => {
  const steps = [step("a"), step("b", { dependsOn: ["a"] })];
  const status = statusMap([["a", "failed"], ["b", "pending"]]);
  const changed = propagateSkips(steps, status);
  assert.equal(changed, true);
  assert.equal(status.get("b"), "skipped");
});

test("propagateSkips cascades transitively in one pass when steps are topologically ordered", () => {
  const steps = [
    step("a"),
    step("b", { dependsOn: ["a"] }),
    step("c", { dependsOn: ["b"] }),
  ];
  const status = statusMap([["a", "failed"], ["b", "pending"], ["c", "pending"]]);

  // The implementation mutates statusById in place while scanning `steps`
  // in order, so a single pass already sees b's just-written "skipped"
  // when it reaches c — no second call needed for this ordering.
  const changed = propagateSkips(steps, status);
  assert.equal(changed, true);
  assert.equal(status.get("b"), "skipped");
  assert.equal(status.get("c"), "skipped");

  assert.equal(propagateSkips(steps, status), false);
});

test("propagateSkips needs repeated calls to stabilize when steps are declared in reverse order", () => {
  // Runners like workflow-runner.ts loop `while (propagateSkips(...))` —
  // this is the case that actually requires it: c is declared (and thus
  // scanned) before b becomes skipped in the same pass.
  const steps = [
    step("c", { dependsOn: ["b"] }),
    step("b", { dependsOn: ["a"] }),
    step("a"),
  ];
  const status = statusMap([["a", "failed"], ["b", "pending"], ["c", "pending"]]);

  let changed = propagateSkips(steps, status);
  assert.equal(changed, true);
  assert.equal(status.get("b"), "skipped");
  assert.equal(status.get("c"), "pending");

  changed = propagateSkips(steps, status);
  assert.equal(changed, true);
  assert.equal(status.get("c"), "skipped");

  changed = propagateSkips(steps, status);
  assert.equal(changed, false);
});

test("propagateSkips does not touch running/completed/failed/skipped steps", () => {
  const steps = [step("a"), step("b"), step("c"), step("d")];
  const status = statusMap([
    ["a", "running"],
    ["b", "completed"],
    ["c", "failed"],
    ["d", "skipped"],
  ]);
  const changed = propagateSkips(steps, status);
  assert.equal(changed, false);
  assert.deepEqual(Array.from(status.values()), ["running", "completed", "failed", "skipped"]);
});

test("propagateSkips leaves a pending step alone once all its dependencies completed", () => {
  const steps = [step("a"), step("b", { dependsOn: ["a"] })];
  const status = statusMap([["a", "completed"], ["b", "pending"]]);
  const changed = propagateSkips(steps, status);
  assert.equal(changed, false);
  assert.equal(status.get("b"), "pending");
});
