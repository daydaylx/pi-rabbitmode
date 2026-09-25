import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RABBIT_SHORTCUT, registerRabbitShortcut } from "../src/rabbit/shortcut.ts";
import { registerRabbitCommand } from "../src/rabbit/commands.ts";
import { createRabbitState } from "../src/rabbit/state.ts";
import { createWorkflowSessionHolder } from "../src/orchestration/workflow-session-holder.ts";
import {
  createFakeCommandContext,
  createFakeExtensionApi,
  createFakeSaveWorkflowSnapshot,
  createFakeSubagentRpcClient,
  fakeModelSupportingMax,
} from "./support/fakes.ts";

test("registers exactly super+alt+r, nothing else", () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  registerRabbitShortcut(api as unknown as ExtensionAPI, state);

  assert.equal(RABBIT_SHORTCUT, "super+alt+r");
  assert.equal(api.shortcuts.size, 1);
  assert.ok(api.shortcuts.has("super+alt+r"));
});

test("shortcut toggles the same state as /rabbit toggle (single code path)", async () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  registerRabbitCommand(
    api as unknown as ExtensionAPI,
    state,
    createFakeSubagentRpcClient() as never,
    createWorkflowSessionHolder(),
    createFakeSaveWorkflowSnapshot().fn as never,
  );
  registerRabbitShortcut(api as unknown as ExtensionAPI, state);
  const { ctx } = createFakeCommandContext({ model: fakeModelSupportingMax() });

  const shortcut = api.shortcuts.get("super+alt+r");
  assert.ok(shortcut);

  await shortcut.handler(ctx);
  assert.equal(state.mode(), "active");

  const command = api.commands.get("rabbit");
  assert.ok(command);
  await command.handler("toggle", ctx as never);
  assert.equal(state.mode(), "off");

  await shortcut.handler(ctx);
  assert.equal(state.mode(), "active");
});

test("shortcut never emits on an aurora-ui/* channel", async () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  registerRabbitShortcut(api as unknown as ExtensionAPI, state);
  const { ctx } = createFakeCommandContext({ model: fakeModelSupportingMax() });

  const shortcut = api.shortcuts.get("super+alt+r");
  assert.ok(shortcut);
  await shortcut.handler(ctx);
  await shortcut.handler(ctx);

  const auroraEmits = api.events.emitted.filter((entry) =>
    entry.channel.startsWith("aurora-ui/"),
  );
  assert.equal(auroraEmits.length, 0);
});
