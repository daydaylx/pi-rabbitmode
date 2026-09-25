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

/** Exercises the real extension entrypoint end to end (no unit-level fakes of state/commands). */

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

