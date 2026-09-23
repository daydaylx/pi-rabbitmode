import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { RabbitStateApi } from "./state.ts";

function formatStatus(state: RabbitStateApi): string {
  const lines = [`RabbitMode: ${state.mode()}`];
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
): void {
  pi.registerCommand("rabbit", {
    description:
      "RabbitMode (Phase 1-2 Grundgerüst): on|off|status|stop — noch keine Orchestrierung",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const sub = args.trim().toLowerCase();
      switch (sub) {
        case "":
        case "toggle":
          if (state.mode() === "off") state.activate(ctx);
          else state.deactivate(ctx);
          return;
        case "on":
          state.activate(ctx);
          return;
        case "off":
          state.deactivate(ctx);
          return;
        case "status":
          ctx.ui.notify(formatStatus(state), "info");
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
