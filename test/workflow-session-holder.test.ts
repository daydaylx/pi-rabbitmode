import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkflowSessionHolder } from "../src/orchestration/workflow-session-holder.ts";

test("current() is undefined before startNew() is ever called", () => {
  const holder = createWorkflowSessionHolder();
  assert.equal(holder.current(), undefined);
});

test("startNew() returns a session and makes it current()", () => {
  const holder = createWorkflowSessionHolder();
  const session = holder.startNew();
  assert.equal(holder.current(), session);
});

test("startNew() replaces whatever session was current, discarding it", () => {
  const holder = createWorkflowSessionHolder();
  const first = holder.startNew();
  const second = holder.startNew();

  assert.notEqual(first, second);
  assert.equal(holder.current(), second);
});

test("reset() clears current() back to undefined", () => {
  const holder = createWorkflowSessionHolder();
  holder.startNew();
  holder.reset();
  assert.equal(holder.current(), undefined);
});
