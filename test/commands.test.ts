import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { registerRabbitCommand } from "../src/rabbit/commands.ts";
import { createRabbitState } from "../src/rabbit/state.ts";
import { createWorkflowSessionHolder } from "../src/orchestration/workflow-session-holder.ts";
import { createRabbitRunController } from "../src/orchestration/run-controller.ts";
import {
  createFakeCommandContext,
  createFakeDynamicRoleRegistry,
  createFakeExtensionApi,
  createFakeSaveWorkflowSnapshot,
  createFakeSubagentRpcClient,
  fakeModelSupportingMax,
} from "./support/fakes.ts";

function setup() {
  const api = createFakeExtensionApi();
  const runController = createRabbitRunController();
  const state = createRabbitState(api as unknown as ExtensionAPI, runController);
  const rpc = createFakeSubagentRpcClient();
  const dynamicRoles = createFakeDynamicRoleRegistry();
  const workflowSessions = createWorkflowSessionHolder();
  const saveWorkflow = createFakeSaveWorkflowSnapshot();
  registerRabbitCommand(
    api as unknown as ExtensionAPI,
    state,
    rpc as never,
    dynamicRoles as never,
    workflowSessions,
    saveWorkflow.fn as never,
    runController,
  );
  const { ctx, notifications } = createFakeCommandContext({
    model: fakeModelSupportingMax(),
  });
  return { api, state, runController, ctx, notifications, rpc, dynamicRoles, workflowSessions, saveWorkflow };
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

test("/rabbit status reports the authoritative Rabbit run phase", async () => {
  const { api, runController, ctx, notifications } = setup();
  runController.setPlanning();
  await run(api, ctx, "status");
  assert.match(notifications[0]?.message ?? "", /Rabbit Run: planning/);
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
    createWorkflowSessionHolder(),
    createFakeSaveWorkflowSnapshot().fn as never,
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
    createWorkflowSessionHolder(),
    createFakeSaveWorkflowSnapshot().fn as never,
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
  await run(api, ctx, "spawn verifier find the bug");

  assert.match(notifications[0]?.message ?? "", /erst \/rabbit on/);
});

test("/rabbit spawn with a baseline role and task spawns via the RPC client with explicit child MAX", async () => {
  const { api, ctx, notifications, rpc } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "spawn verifier find the login bug");

  assert.equal(notifications.length, 2);
  assert.equal(notifications[1]?.type, "info");
  assert.equal((rpc.spawnCalls[0] as { model?: string }).model, "test/supports-max:max");
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
  await run(api, ctx, "spawn verifier");

  assert.match(notifications[1]?.message ?? "", /Nutzung/);
});

const SPEC_JSON = '{"objective":"Find the cause","profile":"analyse","delegationReason":"independent branch"}';

test("/rabbit spawn with a spec JSON spawns a temporary agent through spec, not a role, with explicit child MAX", async () => {
  const { api, ctx, notifications, rpc } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, `spawn ${SPEC_JSON}`);

  assert.equal(notifications.length, 2);
  assert.equal(notifications[1]?.type, "info");
  const call = rpc.spawnCalls[0] as { agent?: string; task?: string; spec?: { objective: string }; model?: string };
  assert.equal(call.agent, undefined);
  assert.equal(call.spec?.objective, "Find the cause");
  assert.equal(call.model, "test/supports-max:max");
});

test("/rabbit spawn with a spec JSON requires RabbitMode to be active first", async () => {
  const { api, ctx, notifications, rpc } = setup();
  await run(api, ctx, `spawn ${SPEC_JSON}`);

  assert.match(notifications[0]?.message ?? "", /erst \/rabbit on/);
  assert.equal(rpc.spawnCalls.length, 0);
});

test("/rabbit spawn with an invalid spec JSON never spawns and shows the reason", async () => {
  const { api, ctx, notifications, rpc } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'spawn {"objective":"x","profile":"verify","delegationReason":"r"}');
  await run(api, ctx, 'spawn {"objective":"x","profile":"analyse","delegationReason":"r","requestedCapabilities":["write"]}');
  await run(api, ctx, "spawn {not json");

  assert.equal(rpc.spawnCalls.length, 0);
  assert.match(notifications[1]?.message ?? "", /verify/);
  assert.match(notifications[2]?.message ?? "", /Orchestrierung erweitert keine Rechte/);
  assert.match(notifications[3]?.message ?? "", /Ungültiges JSON/);
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

test("/rabbit save-agent requires RabbitMode to be active first", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "save-agent api-checker");

  assert.match(notifications[0]?.message ?? "", /erst \/rabbit on/);
});

test("/rabbit save-agent with no argument shows its usage", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "save-agent");

  assert.match(notifications[1]?.message ?? "", /rabbit save-agent/);
});

test("/rabbit save-agent calls the registry and reports the permanent path", async () => {
  const { api, ctx, notifications, dynamicRoles } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "save-agent api-checker");

  assert.equal(dynamicRoles.saveCalls.length, 1);
  assert.equal(dynamicRoles.saveCalls[0]?.id, "api-checker");
  assert.equal(notifications[1]?.type, "info");
  assert.match(notifications[1]?.message ?? "", /rabbit-saved/);
});

test("/rabbit save-agent reports a registry error, not a crash", async () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const dynamicRoles = createFakeDynamicRoleRegistry({ saveBehavior: "error", saveError: "not found" });
  registerRabbitCommand(
    api as unknown as ExtensionAPI,
    state,
    createFakeSubagentRpcClient() as never,
    dynamicRoles as never,
    createWorkflowSessionHolder(),
    createFakeSaveWorkflowSnapshot().fn as never,
  );
  const { ctx, notifications } = createFakeCommandContext({ model: fakeModelSupportingMax() });

  await run(api, ctx, "on");
  await run(api, ctx, "save-agent never-defined");

  assert.equal(notifications[1]?.type, "error");
  assert.match(notifications[1]?.message ?? "", /not found/);
});

test("/rabbit workflow requires RabbitMode to be active first", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"x"}]}');

  assert.match(notifications[0]?.message ?? "", /erst \/rabbit on/);
});

test("/rabbit workflow with no argument shows its usage", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "workflow");

  assert.match(notifications[1]?.message ?? "", /rabbit workflow/);
});

test("/rabbit workflow with invalid JSON reports a JSON error", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "workflow {not json");

  assert.match(notifications[1]?.message ?? "", /Ungültiges JSON/);
});

test('/rabbit workflow without a "steps" array reports a clear error', async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"foo":"bar"}');

  assert.match(notifications[1]?.message ?? "", /steps/);
});

test("/rabbit workflow with an invalid graph reports the validation error, not a crash", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"not-a-role","task":"x"}]}');

  assert.equal(notifications[1]?.type, "error");
  assert.match(notifications[1]?.message ?? "", /Workflow ungültig/);
});

test("/rabbit workflow with a valid single step runs it end to end", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"look around"}]}');

  assert.equal(notifications[1]?.type, "info");
  assert.match(notifications[1]?.message ?? "", /abgeschlossen: 1\/1/);
  assert.match(notifications[1]?.message ?? "", /✓ a/);
});

test("/rabbit replan requires RabbitMode to be active first", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, 'replan {"reason":"r","steps":[{"id":"b","role":"verifier","task":"x"}]}');

  assert.match(notifications[0]?.message ?? "", /erst \/rabbit on/);
});

test("/rabbit replan with no argument shows its usage", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "replan");

  assert.match(notifications[1]?.message ?? "", /rabbit replan/);
});

test("/rabbit replan without a prior /rabbit workflow is rejected", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'replan {"reason":"r","steps":[{"id":"b","role":"verifier","task":"x"}]}');

  assert.match(notifications[1]?.message ?? "", /Kein laufender Workflow/);
});

test("/rabbit replan with invalid JSON reports a JSON error", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"x"}]}');
  await run(api, ctx, "replan {not json");

  assert.match(notifications[2]?.message ?? "", /Ungültiges JSON/);
});

test('/rabbit replan without "reason" or "steps" reports a clear error', async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"x"}]}');
  await run(api, ctx, 'replan {"steps":[{"id":"b","role":"verifier","task":"x"}]}');

  assert.match(notifications[2]?.message ?? "", /Fehlendes "reason" oder "steps"/);
});

test("/rabbit replan with a valid reason and new step adds revision 2", async () => {
  const { api, ctx, notifications, workflowSessions } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"x"}]}');
  await run(
    api,
    ctx,
    'replan {"reason":"found a gap","steps":[{"id":"b","role":"recovery-auditor","task":"y"}]}',
  );

  assert.equal(notifications[2]?.type, "info");
  assert.match(notifications[2]?.message ?? "", /Revision 2\/3/);
  assert.equal(workflowSessions.current()?.currentRevision(), 2);
});

test("/rabbit save-workflow requires RabbitMode to be active first", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "save-workflow audit-1");

  assert.match(notifications[0]?.message ?? "", /erst \/rabbit on/);
});

test("/rabbit save-workflow with no argument shows its usage", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "save-workflow");

  assert.match(notifications[1]?.message ?? "", /rabbit save-workflow/);
});

test("/rabbit save-workflow without a prior /rabbit workflow is rejected", async () => {
  const { api, ctx, notifications } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, "save-workflow audit-1");

  assert.match(notifications[1]?.message ?? "", /Kein laufender Workflow/);
});

test("/rabbit save-workflow surfaces a persistence error as an error notification, not a crash", async () => {
  // Name validation itself lives in saveWorkflowSnapshot
  // (test/workflow-persistence.test.ts) — this only checks that
  // commands.ts passes an error result through correctly.
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  const workflowSessions = createWorkflowSessionHolder();
  const saveWorkflow = createFakeSaveWorkflowSnapshot({ behavior: "error", error: "ungültiger Name" });
  registerRabbitCommand(
    api as unknown as ExtensionAPI,
    state,
    createFakeSubagentRpcClient() as never,
    createFakeDynamicRoleRegistry() as never,
    workflowSessions,
    saveWorkflow.fn as never,
  );
  const { ctx, notifications } = createFakeCommandContext({ model: fakeModelSupportingMax() });

  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"x"}]}');
  await run(api, ctx, "save-workflow Not Valid");

  assert.equal(notifications[2]?.type, "error");
  assert.match(notifications[2]?.message ?? "", /ungültiger Name/);
});

test("/rabbit save-workflow after a completed workflow writes a snapshot", async () => {
  const { api, ctx, notifications, saveWorkflow } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"x"}]}');
  await run(api, ctx, "save-workflow audit-1");

  assert.equal(saveWorkflow.calls.length, 1);
  assert.equal(saveWorkflow.calls[0]?.name, "audit-1");
  assert.equal(notifications[2]?.type, "info");
  assert.match(notifications[2]?.message ?? "", /rabbit-workflows/);
});

test("a second /rabbit workflow call starts a fresh session, not a third revision", async () => {
  const { api, ctx, workflowSessions } = setup();
  await run(api, ctx, "on");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"x"}]}');
  await run(
    api,
    ctx,
    'replan {"reason":"found a gap","steps":[{"id":"b","role":"recovery-auditor","task":"y"}]}',
  );
  const firstSession = workflowSessions.current();
  assert.equal(firstSession?.currentRevision(), 2);

  await run(api, ctx, 'workflow {"steps":[{"id":"c","role":"verifier","task":"z"}]}');

  const secondSession = workflowSessions.current();
  assert.notEqual(secondSession, firstSession);
  assert.equal(secondSession?.currentRevision(), 1);
});

test("spawn/define/workflow never emit on an aurora-ui/* channel", async () => {
  const { api, ctx } = setup();
  await run(api, ctx, "on");
  await run(
    api,
    ctx,
    'define {"id":"api-checker","purpose":"p","instructions":"i","tools":["read"],"task":"t"}',
  );
  await run(api, ctx, "spawn verifier find the bug");
  await run(api, ctx, 'workflow {"steps":[{"id":"a","role":"verifier","task":"x"}]}');
  await run(api, ctx, "off");

  const auroraEmits = api.events.emitted.filter((entry) =>
    entry.channel.startsWith("aurora-ui/"),
  );
  assert.equal(auroraEmits.length, 0);
});

test("/rabbit verify works even when RabbitMode is off (not mutation-gated)", async () => {
  const { api, state, ctx, notifications } = setup();
  await run(api, ctx, "verify");

  assert.equal(state.mode(), "off");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.type, "info");
  assert.equal(api.sentUserMessages.length, 1);
});

test('/rabbit verify with no argument defaults to profile="verify"', async () => {
  const { api, ctx } = setup();
  await run(api, ctx, "verify");

  const sent = api.sentUserMessages[0]?.content;
  assert.match(String(sent), /profile="verify"/);
});

test("/rabbit verify <profile> uses the given profile instead of the default", async () => {
  const { api, ctx } = setup();
  await run(api, ctx, "verify release-check");

  const sent = api.sentUserMessages[0]?.content;
  assert.match(String(sent), /profile="release-check"/);
});

test("/rabbit verify's injected prompt preserves FAIL/INCOMPLETE semantics", async () => {
  const { api, ctx } = setup();
  await run(api, ctx, "verify");

  const sent = String(api.sentUserMessages[0]?.content);
  assert.match(sent, /FAIL bleibt FAIL/);
  assert.match(sent, /INCOMPLETE/);
});

test("/rabbit verify does not send a message while a turn is running", async () => {
  const api = createFakeExtensionApi();
  const state = createRabbitState(api as unknown as ExtensionAPI);
  registerRabbitCommand(
    api as unknown as ExtensionAPI,
    state,
    createFakeSubagentRpcClient() as never,
    createFakeDynamicRoleRegistry() as never,
    createWorkflowSessionHolder(),
    createFakeSaveWorkflowSnapshot().fn as never,
  );
  const { ctx, notifications } = createFakeCommandContext({
    model: fakeModelSupportingMax(),
    idle: false,
  });

  await run(api, ctx, "verify");

  assert.equal(api.sentUserMessages.length, 0);
  assert.equal(notifications[0]?.type, "warning");
});

test("/rabbit verify refuses under --print/--mode json (no UI) instead of corrupting turn state", async () => {
  // Found via a real `pi -p "/rabbit verify"` smoke test: sendUserMessage's
  // forced second turn, issued from a command handler outside the normal
  // interactive turn loop, broke print/json mode's single-shot turn
  // bookkeeping ("turn_end could not resolve the persisted assistant entry
  // ID", plus cascading "stale ctx" errors from unrelated extensions).
  // ctx.hasUI is false exactly in that mode.
  const { api } = setup();
  const { ctx: noUiCtx, notifications: noUiNotifications } = createFakeCommandContext({
    model: fakeModelSupportingMax(),
    hasUI: false,
  });

  await run(api, noUiCtx, "verify");

  assert.equal(api.sentUserMessages.length, 0);
  assert.equal(noUiNotifications[0]?.type, "warning");
  assert.match(noUiNotifications[0]?.message ?? "", /interaktive Session/);
});

test("/rabbit verify never emits on an aurora-ui/* channel", async () => {
  const { api, ctx } = setup();
  await run(api, ctx, "verify");

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
