import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { RabbitStateApi } from "./state.ts";
import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";

/**
 * A short ping, not a hard dependency: `/rabbit status` should stay fast
 * and usable even when `pi-subagents` isn't installed at all — it just
 * reports that instead of hanging on the client's default timeout.
 */
const STATUS_PING_TIMEOUT_MS = 400;

async function describeSubagentsRuntime(rpc: SubagentRpcClient): Promise<string> {
  try {
    const reply = await rpc.ping(STATUS_PING_TIMEOUT_MS);
    if (!reply.success) return `pi-subagents: Fehler (${reply.error.code})`;
    return `pi-subagents: verfügbar (RPC v${reply.data.version})`;
  } catch {
    return "pi-subagents: nicht erreichbar (nicht installiert oder nicht geladen)";
  }
}

async function formatStatus(
  state: RabbitStateApi,
  rpc: SubagentRpcClient,
): Promise<string> {
  const lines = [`RabbitMode: ${state.mode()}`, await describeSubagentsRuntime(rpc)];
  const permissionLevel = state.observedPermissionLevel();
  const workflowPhase = state.observedWorkflowPhase();
  if (permissionLevel !== undefined) {
    lines.push(`Permission (nur Anzeige, keine Wirkung): ${permissionLevel}`);
  }
  if (workflowPhase !== undefined) {
    lines.push(`Workflow (nur Anzeige, keine Wirkung): ${workflowPhase}`);
  }
  return lines.join("\n");
}

/**
 * `/rabbit on|off|status|stop`, plus a bare/`toggle` alias.
 *
 * The bare-argument toggle is a deliberate head start on Phase 3: the spec
 * describes the future `Super+Alt+R` shortcut as routing to
 * `/rabbit toggle` (`docs/spec/02_CONTRACTS.md`), and the test matrix
 * requires the shortcut and the command to share one code path
 * (`docs/spec/06_TEST_MATRIX.md`, section A). Adding the alias now avoids
 * touching this file again just for that wiring.
 */
export function registerRabbitCommand(
  pi: ExtensionAPI,
  state: RabbitStateApi,
  rpc: SubagentRpcClient,
): void {
  pi.registerCommand("rabbit", {
    description:
      "RabbitMode (Phase 1-6 Grundgerüst): on|off|status|stop — noch keine Orchestrierung",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const sub = args.trim().toLowerCase();
      switch (sub) {
        case "":
        case "toggle":
          state.toggle(ctx);
          return;
        case "on":
          state.activate(ctx);
          return;
        case "off":
          state.deactivate(ctx);
          return;
        case "status":
          ctx.ui.notify(await formatStatus(state, rpc), "info");
          return;
        case "stop":
          ctx.ui.notify(
            state.hasActiveRun()
              ? "Rabbit-Run wird gestoppt …"
              : "Kein aktiver Rabbit-Run.",
            "info",
          );
          return;
        default:
          ctx.ui.notify("Nutzung: /rabbit on|off|status|stop", "info");
      }
    },
  });
}
