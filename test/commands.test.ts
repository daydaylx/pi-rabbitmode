import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { registerRabbitCommand } from "../src/rabbit/commands.ts";
import { createRabbitState } from "../src/rabbit/state.ts";
import {
  createFakeCommandContext,
  createFakeDynamicRoleRegistry,
  createFakeExtensionApi,
  createFakeSubagentRpcClient,
  fakeModelSupportingMax,
} from "./support/fakes.ts";

function setup() {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const rpc = createFakeSubagentRpcClient();
  const dynamicRoles = createFakeDynamicRoleRegistry();
  registerRabbitCommand(api as unknown as ExtensionAPI, state, rpc as never, dynamicRoles as never);
  const { ctx, notifications } = createFakeCommandContext({
    model: fakeModelSupportingMax(),
  });
  return { api, state, ctx, notifications, rpc, dynamicRoles };
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

test("/rabbit status reports pi-subagents availability via ping", async () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const rpc = createFakeSubagentRpcClient({ pingBehavior: "success", pingVersion: 1 });
  registerRabbitCommand(
    api as unknown as ExtensionAPI,
    state,
    rpc as never,
    createFakeDynamicRoleRegistry() as never,
  );
  const { ctx, notifications } = createFakeCommandContext({
    model: fakeModelSupportingMax(),
  });

  await run(api, ctx, "status");

  assert.equal(rpc.pingCallCount(), 1);
  assert.match(notifications[0]?.message ?? "", /pi-subagents: verfügbar \(RPC v1\)/);
});

test("/rabbit status reports pi-subagents as unreachable on ping timeout", async () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const rpc = createFakeSubagentRpcClient({ pingBehavior: "timeout" });
  registerRabbitCommand(
    api as unknown as ExtensionAPI,
    state,
    rpc as never,
    createFakeDynamicRoleRegistry() as never,
  );
  const { ctx, notifications } = createFakeCommandContext({
    model: fakeModelSupportingMax(),
  });

  await run(api, ctx, "status");

  assert.match(notifications[0]?.message ?? "", /pi-subagents: nicht erreichbar/);
});

test("/rabbit stop reports no active run in Phase 1-2", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "stop");

  assert.equal(notifications.length, 1);
  assert.match(notifications[0]?.message ?? "", /[Kk]ein aktiver Rabbit-Run/);
});

test("/rabbit spawn requires RabbitMode to be active first", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "spawn investigator find the bug");

  assert.match(notifications[0]?.message ?? "", /erst \/rabbit on/);
});

test("/rabbit spawn with a baseline role and task spawns via the RPC client", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "spawn investigator find the login bug");

  assert.equal(notifications.length, 2);
  assert.equal(notifications[1]?.type, "info");
});

test("/rabbit spawn rejects a role outside the baseline set", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "spawn architect find the bug");

  assert.match(notifications[1]?.message ?? "", /Nutzung/);
});

test("/rabbit spawn without a task shows usage", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "spawn investigator");

  assert.match(notifications[1]?.message ?? "", /Nutzung/);
});

test("/rabbit define requires RabbitMode to be active first", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, 'define {"id":"x","purpose":"p","instructions":"i","tools":["read"],"task":"t"}');

  assert.match(notifications[0]?.message ?? "", /erst \/rabbit on/);
});

test("/rabbit define with no argument shows its usage", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "define");

  assert.match(notifications[1]?.message ?? "", /rabbit define/);
});

test("/rabbit define with invalid JSON reports a JSON error, not a crash", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "define {not json");

  assert.match(notifications[1]?.message ?? "", /Ungültiges JSON/);
});

test("/rabbit define with valid JSON calls the dynamic role registry and reports success", async () => {
  const { api, ctx, notifications, dynamicRoles } = setup();
  await run(api, ctx, "on");
  await run(
    api,
    ctx,
    'define {"id":"api-checker","purpose":"p","instructions":"i","tools":["read"],"task":"check it"}',
  );

  assert.equal(dynamicRoles.defineCalls.length, 1);
  assert.equal(notifications[1]?.type, "info");
});

test("spawn/define never emit on an aurora-ui/* channel", async () => {
  const { api, ctx } = setup();
  await run(api, ctx, "on");
  await run(
    api,
    ctx,
    'define {"id":"api-checker","purpose":"p","instructions":"i","tools":["read"],"task":"t"}',
  );
  await run(api, ctx, "spawn investigator find the bug");
  await run(api, ctx, "off");

  const auroraEmits = api.events.emitted.filter((entry) =>
    entry.channel.startsWith("aurora-ui/"),
  );
  assert.equal(auroraEmits.length, 0);
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
