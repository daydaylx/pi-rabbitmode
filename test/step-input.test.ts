import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStepInput, MAX_WORKFLOW_STEP_INPUT_BYTES } from "../src/orchestration/step-input.ts";

test("A → B passes only A's completed output with its step id", () => {
  const result = buildStepInput("Synthesize this.", [
    { stepId: "audit-a", status: "completed", output: "Finding from A." },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.task, /\[Dependency result: audit-a\]/);
  assert.match(result.task, /Finding from A\./);
  assert.match(result.task, /^Synthesize this\./);
});

test("A+B → C includes both outputs in declared dependency order", () => {
  const result = buildStepInput("Combine the audits.", [
    { stepId: "permission", status: "completed", output: "Permission result." },
    { stepId: "recovery", status: "completed", output: "Recovery result." },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.task.indexOf("[Dependency result: permission]") < result.task.indexOf("[Dependency result: recovery]"));
  assert.match(result.task, /Permission result\./);
  assert.match(result.task, /Recovery result\./);
});

test("an independent step gets no unrelated dependency output", () => {
  assert.deepEqual(buildStepInput("Standalone task.", []), { ok: true, task: "Standalone task." });
});

test("failed and skipped dependencies are rejected, never framed as successful inputs", () => {
  for (const status of ["failed", "skipped", "stopped"] as const) {
    const result = buildStepInput("Synthesize.", [{ stepId: "bad", status, output: "not successful" }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /cannot be used as a successful input/);
  }
});

test("parallel branches keep outputs isolated to each step's declared dependencies", () => {
  const permission = buildStepInput("Task P", [{ stepId: "permission", status: "completed", output: "P-only" }]);
  const recovery = buildStepInput("Task R", [{ stepId: "recovery", status: "completed", output: "R-only" }]);
  assert.equal(permission.ok, true);
  assert.equal(recovery.ok, true);
  if (permission.ok && recovery.ok) {
    assert.match(permission.task, /P-only/);
    assert.doesNotMatch(permission.task, /R-only|recovery/);
    assert.match(recovery.task, /R-only/);
    assert.doesNotMatch(recovery.task, /P-only|permission/);
  }
});

test("oversized dependency input is UTF-8 bounded and explicitly marked as truncated", () => {
  const result = buildStepInput("Summarize", [
    { stepId: "large", status: "completed", output: "🙂".repeat(MAX_WORKFLOW_STEP_INPUT_BYTES) },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(Buffer.byteLength(result.task, "utf8") <= MAX_WORKFLOW_STEP_INPUT_BYTES);
  assert.match(result.task, /Dependency output truncated:/);
  assert.match(result.task, /bytes omitted/);
});
