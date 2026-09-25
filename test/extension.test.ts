import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import rabbitModeExtension from "../src/extension/index.ts";
import {
  SUBAGENT_RPC_REQUEST_EVENT,
  subagentRpcReplyEvent,
  type SubagentRpcRequestEnvelope,
} from "../src/runtime/subagents-rpc.ts";
import {
  createFakeCommandContext,
  createFakeExtensionApi,
  fakeModelSupportingMax,
} from "./support/fakes.ts";

/**
 * The extension's real subagents-rpc.ts client emits on the actual
 * `subagents:rpc:v1:request` channel via `api.events` — with no fake
 * `pi-subagents` server listening, a `/rabbit define` spawn call would
 * time out after 800ms and get cleaned up as a failure, defeating what
 * these tests check. This stands in for that server, immediately
 * confirming every spawn request as started.
 */
function installFakeSubagentsServer(api: ReturnType<typeof createFakeExtensionApi>): void {
  api.events.on(SUBAGENT_RPC_REQUEST_EVENT, (raw) => {
    const request = raw as SubagentRpcRequestEnvelope;
    const data = request.method === "spawn"
      ? { text: `${JSON.stringify(request.params)} started`, details: { runId: "test-run" } }
      : request.method === "status"
        ? { text: "finished", details: { results: [{ exitCode: 0 }] } }
        : { text: `${JSON.stringify(request.params)} started` };
    api.events.emit(subagentRpcReplyEvent(request.requestId), {
      version: 1,
      requestId: request.requestId,
      method: request.method,
      success: true,
      data,
    });
  });
}

/**
 * Exercises the real extension entrypoint end to end (not a unit-level
 * fake of state/commands) specifically to verify the fix this test guards:
 * a dynamic role file must never survive RabbitMode being turned off, not
 * just session_shutdown. See extension/index.ts's rabbit:mode-changed
 * listener.
 */

let scratchCwd: string;

before(async () => {
  scratchCwd = await mkdtemp(path.join(tmpdir(), "rabbitmode-extension-"));
});

after(async () => {
  await rm(scratchCwd, { recursive: true, force: true });
});

function fileExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

/**
 * The rabbit:mode-changed listener in extension/index.ts is deliberately
 * fire-and-forget (EventBus handlers are `(data) => void`, `emit()` can't
 * await them) — cleanup is triggered immediately but is only "gone very
 * soon after", not synchronously before the command handler returns. This
 * polls instead of asserting once, matching that real, documented
 * contract rather than an instant guarantee the architecture doesn't make.
 */
async function waitUntilGone(filePath: string, timeoutMs = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await fileExists(filePath))) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return !(await fileExists(filePath));
}

async function runCommand(
  api: ReturnType<typeof createFakeExtensionApi>,
  ctx: ExtensionCommandContext,
  args: string,
): Promise<void> {
  const command = api.commands.get("rabbit");
  assert.ok(command, "/rabbit must be registered");
  await command.handler(args, ctx);
}

test("a dynamic role file is deleted shortly after /rabbit off, not just at session_shutdown", async () => {
  const api = createFakeExtensionApi();
  installFakeSubagentsServer(api);
  rabbitModeExtension(api as unknown as ExtensionAPI);
  await api.fireLifecycleEvent("session_start");

  const { ctx, notifications } = createFakeCommandContext({ model: fakeModelSupportingMax() });
  (ctx as { cwd?: string }).cwd = scratchCwd;

  await runCommand(api, ctx as never, "on");
  await runCommand(
    api,
    ctx as never,
    'define {"id":"api-checker","purpose":"p","instructions":"i","tools":["read"],"task":"t"}',
  );

  const definedMessage = notifications[1]?.message ?? "";
  assert.doesNotMatch(definedMessage, /fehlgeschlagen|Limit erreicht|ungültig/i);
  const filePath = path.join(scratchCwd, ".pi", "agents", "rabbit-dynamic", "api-checker.md");
  assert.equal(await fileExists(filePath), true, "role file should exist right after /rabbit define");

  await runCommand(api, ctx as never, "off");

  assert.equal(
    await waitUntilGone(filePath),
    true,
    "role file must be gone shortly after /rabbit off, without waiting for session_shutdown",
  );
});

test("/rabbit stop cancels the active workflow and then allows /rabbit off", async () => {
  const api = createFakeExtensionApi();
  let spawned = false;
  let stopped = false;
  let notifySpawned!: () => void;
  const spawnReady = new Promise<void>((resolve) => { notifySpawned = resolve; });
  api.events.on(SUBAGENT_RPC_REQUEST_EVENT, (raw) => {
    const request = raw as SubagentRpcRequestEnvelope;
    if (request.method === "spawn") {
      spawned = true;
      notifySpawned();
      api.events.emit(subagentRpcReplyEvent(request.requestId), {
        version: 1,
        requestId: request.requestId,
        method: request.method,
        success: true,
        data: { text: "child started", details: { runId: "live-child" } },
      });
      return;
    }
    if (request.method === "stop") stopped = true;
    const data = request.method === "status" && stopped
      ? { state: "stopped", text: "child stopped" }
      : {};
    api.events.emit(subagentRpcReplyEvent(request.requestId), {
      version: 1,
      requestId: request.requestId,
      method: request.method,
      success: true,
      data,
    });
  });
  rabbitModeExtension(api as unknown as ExtensionAPI);
  await api.fireLifecycleEvent("session_start");
  const { ctx, notifications } = createFakeCommandContext({ model: fakeModelSupportingMax() });
  await runCommand(api, ctx as never, "on");

  const workflow = runCommand(
    api,
    ctx as never,
    'workflow {"steps":[{"id":"inspect","role":"verifier","task":"Inspect the task."}]}',
  );
  await spawnReady;
  assert.equal(spawned, true);
  await runCommand(api, ctx as never, "off");
  assert.match(notifications[1]?.message ?? "", /erst \/rabbit stop/);
  assert.equal(notifications[1]?.type, "warning");
  await runCommand(api, ctx as never, "stop");
  await workflow;

  assert.equal(stopped, true);
  assert.match(notifications[2]?.message ?? "", /Stop .*angefordert/);
  assert.match(notifications[3]?.message ?? "", /Workflow abgebrochen/);
  assert.match(notifications[3]?.message ?? "", /■ inspect/);
  await runCommand(api, ctx as never, "off");
  assert.equal(notifications.at(-1)?.message.includes("deaktiviert"), true);
});

test("session_shutdown still cleans up a role left behind by a still-active RabbitMode", async () => {
  const api = createFakeExtensionApi();
  installFakeSubagentsServer(api);
  rabbitModeExtension(api as unknown as ExtensionAPI);
  await api.fireLifecycleEvent("session_start");

  const { ctx } = createFakeCommandContext({ model: fakeModelSupportingMax() });
  (ctx as { cwd?: string }).cwd = scratchCwd;

  await runCommand(api, ctx as never, "on");
  await runCommand(
    api,
    ctx as never,
    'define {"id":"leftover","purpose":"p","instructions":"i","tools":["read"],"task":"t"}',
  );

  const filePath = path.join(scratchCwd, ".pi", "agents", "rabbit-dynamic", "leftover.md");
  assert.equal(await fileExists(filePath), true);

  // No /rabbit off here — session ends while RabbitMode is still active.
  await api.fireLifecycleEvent("session_shutdown");

  assert.equal(await fileExists(filePath), false);
});
