import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRabbitCommand } from "../rabbit/commands.ts";
import { registerRabbitShortcut } from "../rabbit/shortcut.ts";
import { createRabbitState } from "../rabbit/state.ts";
import { RABBIT_MODE_CHANGED_EVENT, isRabbitModeChangedEvent } from "../rabbit/events.ts";
import { createDynamicRoleRegistry } from "../orchestration/dynamic-role.ts";
import { createWorkflowSessionHolder } from "../orchestration/workflow-session-holder.ts";
import { createRabbitRunController, stopRabbitRun } from "../orchestration/run-controller.ts";
import { saveWorkflowSnapshot } from "../orchestration/workflow-persistence.ts";
import { createSubagentRpcClient } from "../runtime/subagents-rpc.ts";
import { registerRabbitSupervisorTools } from "../orchestration/supervisor-tools.ts";

/**
 * RabbitMode extension entrypoint — Phase 1-10 (session state, /rabbit
 * command, Super+Alt+R shortcut, forced MAX thinking, Blue Shift theme +
 * status widget, pi-subagents v1 RPC client, baseline/bundled/dynamic-role
 * spawning, declarative workflow DAG with bounded replanning, nested-
 * delegation depth cap). See README.md and docs/spec/
 * 05_IMPLEMENTATION_PHASES.md for the full roadmap.
 *
 * The extension factory runs once per Pi process (state below is a module
 * closure, not global module state), but a single process can host several
 * sessions in sequence — state is therefore reset on `session_start` and
 * torn down on `session_shutdown`, not initialized only once at module load.
 */
export default function rabbitModeExtension(pi: ExtensionAPI): void {
  const runController = createRabbitRunController(pi);
  const state = createRabbitState(pi, runController);
  const rpc = createSubagentRpcClient(pi);
  const dynamicRoles = createDynamicRoleRegistry();
  const workflowSessions = createWorkflowSessionHolder();
  registerRabbitSupervisorTools(pi, { state, rpc, dynamicRoles, workflowSessions, runController });
  registerRabbitCommand(pi, state, rpc, dynamicRoles, workflowSessions, saveWorkflowSnapshot, runController);
  registerRabbitShortcut(pi, state);

  // A dynamic role file must never outlive an active RabbitMode window —
  // it stays discoverable/spawnable by anything (not just RabbitMode) for
  // as long as it sits under .pi/agents/rabbit-dynamic/. Cleaning up only
  // at session_shutdown left a gap: turning RabbitMode off (/rabbit off,
  // toggle, or the shortcut) did not, by itself, remove roles a still-open
  // session had defined. Listening on the same rabbit:mode-changed event
  // every deactivation path already emits closes that gap in one place.
  // `EventBus.on`'s handler type is `(data) => void` — `emit()` has no
  // way to await it, so this is deliberately fire-and-forget: cleanup is
  // triggered immediately but completes asynchronously, not necessarily
  // before the command that turned RabbitMode off has already returned.
  pi.events.on(RABBIT_MODE_CHANGED_EVENT, (value) => {
    if (isRabbitModeChangedEvent(value) && value.mode === "off") {
      void dynamicRoles.cleanupAll();
    }
  });

  pi.on("session_start", () => {
    state.reset();
    workflowSessions.reset();
  });

  // The regular Pi Main Agent stays the Rabbit supervisor. Rabbit only
  // adds a per-request orchestration contract and callable runtime tools.
  pi.on("before_agent_start", (_event, ctx) => {
    if (state.mode() !== "active") return;
    state.bindContext(ctx);
    runController.setPlanning();
  });

  pi.on("agent_settled", (_event, ctx) => {
    state.bindContext(ctx);
    if (runController.snapshot().phase === "planning") runController.reset();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (runController.isActive()) {
      await stopRabbitRun(rpc, runController);
      await runController.waitForSettled();
    }
    state.dispose(ctx);
    // Fallback net: the mode-changed listener above only fires on an
    // explicit deactivation. If the session ends while RabbitMode is
    // still active (no /rabbit off first), this is what actually removes
    // any dynamic role files instead of leaving them for the next
    // session/process lifetime (reload/resume/new/fork keep this
    // extension instance running). Awaited (unlike the EventBus listener
    // above, whose `(data) => void` contract has no way to signal
    // completion back to `emit()`) — `ExtensionHandler` is Promise-aware,
    // so the harness actually waits for this before treating shutdown as
    // complete.
    await dynamicRoles.cleanupAll();
  });
}
