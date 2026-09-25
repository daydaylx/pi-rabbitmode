import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRabbitCommand } from "../rabbit/commands.ts";
import { registerRabbitShortcut } from "../rabbit/shortcut.ts";
import { createRabbitState } from "../rabbit/state.ts";
import { createWorkflowSessionHolder } from "../orchestration/workflow-session-holder.ts";
import { createRabbitRunController, stopRabbitRun } from "../orchestration/run-controller.ts";
import { saveWorkflowSnapshot } from "../orchestration/workflow-persistence.ts";
import { createSubagentRpcClient } from "../runtime/subagents-rpc.ts";
import { registerRabbitSupervisorTools } from "../orchestration/supervisor-tools.ts";

/**
 * RabbitMode extension entrypoint — Phase 1-10 (session state, /rabbit
 * command, Super+Alt+R shortcut, forced MAX thinking, Blue Shift theme +
 * status widget, pi-subagents v1 RPC client, baseline/temporary-agent
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
  const workflowSessions = createWorkflowSessionHolder();
  registerRabbitSupervisorTools(pi, { state, rpc, workflowSessions, runController });
  registerRabbitCommand(pi, state, rpc, workflowSessions, saveWorkflowSnapshot, runController);
  registerRabbitShortcut(pi, state);

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
  });
}
