import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { registerRabbitCommand } from "../src/rabbit/commands.ts";
import { createRabbitState } from "../src/rabbit/state.ts";
import { createFakeCommandContext, createFakeExtensionApi } from "./support/fakes.ts";

function setup() {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  registerRabbitCommand(api as unknown as ExtensionAPI, state);
  const { ctx, notifications } = createFakeCommandContext();
  return { api, state, ctx, notifications };
}

async function run(
  api: ReturnType<typeof createFakeExtensionApi>,
  ctx: unknown,
  args: string,
): Promise<void> {
  const command = api.commands.get("rabbit");
  assert.ok(command, "/rabbit must be registered");
  await command.handler(args, ctx as ExtensionCommandContext);
}

test("registers /rabbit with a description", () => {
  const { api } = setup();
  const command = api.commands.get("rabbit");
  assert.ok(command);
  assert.match(command.description ?? "", /RabbitMode/);
});

test("/rabbit on activates and notifies", async () => {
  const { api, state, ctx, notifications } = setup();
  await run(api, ctx, "on");

  assert.equal(state.mode(), "active");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.type, "info");
});

test("/rabbit off deactivates and notifies", async () => {
  const { api, state, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "off");

  assert.equal(state.mode(), "off");
  assert.equal(notifications.length, 2);
});

test("/rabbit (no argument) and /rabbit toggle flip the mode", async () => {
  const { api, state, ctx } = setup();
  await run(api, ctx, "");
  assert.equal(state.mode(), "active");

  await run(api, ctx, "toggle");
  assert.equal(state.mode(), "off");
});

test("/rabbit status reports the mode without changing it", async () => {
  const { api, state, ctx, notifications } = setup();
  await run(api, ctx, "status");

  assert.equal(state.mode(), "off");
  assert.equal(notifications.length, 1);
  assert.match(notifications[0]?.message ?? "", /RabbitMode: off/);
});

test("/rabbit stop reports no active run in Phase 1-2", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "stop");

  assert.equal(notifications.length, 1);
  assert.match(notifications[0]?.message ?? "", /[Kk]ein aktiver Rabbit-Run/);
});

test("unknown subcommand shows usage", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "banana");

  assert.equal(notifications.length, 1);
  assert.match(notifications[0]?.message ?? "", /Nutzung/);
});

test("no subcommand ever emits on an aurora-ui/* channel", async () => {
  const { api, ctx } = setup();
  for (const args of ["on", "off", "status", "stop", "toggle", "unknown"]) {
    await run(api, ctx, args);
  }

  const auroraEmits = api.events.emitted.filter((entry) =>
    entry.channel.startsWith("aurora-ui/"),
  );
  assert.equal(auroraEmits.length, 0);
});
