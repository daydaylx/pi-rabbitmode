import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { RabbitStateApi } from "./state.ts";
import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";
import {
  BASELINE_ROLES,
  RABBIT_BUNDLED_ROLES,
  isBaselineRole,
  isRabbitBundledRole,
  spawnBaselineRole,
  spawnDynamicRole,
  spawnRabbitBundledRole,
  type RabbitBundledRole,
} from "../orchestration/agent-factory.ts";
import type { DynamicRoleRegistry } from "../orchestration/dynamic-role.ts";

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

function splitFirstWord(text: string): { first: string; rest: string } {
  const spaceIndex = text.indexOf(" ");
  if (spaceIndex === -1) return { first: text, rest: "" };
  return { first: text.slice(0, spaceIndex), rest: text.slice(spaceIndex + 1).trim() };
}

const SPAWNABLE_ROLES = [...BASELINE_ROLES, ...RABBIT_BUNDLED_ROLES];
const DEFINE_USAGE =
  '/rabbit define {"id":"...","purpose":"...","instructions":"...","tools":["read"],"task":"..."}';
const USAGE =
  `Nutzung: /rabbit on|off|status|stop|spawn <${SPAWNABLE_ROLES.join("|")}> <Aufgabe>|define <json>`;

/**
 * `/rabbit on|off|status|stop|spawn|define`, plus a bare/`toggle` alias.
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
  dynamicRoles: DynamicRoleRegistry,
): void {
  pi.registerCommand("rabbit", {
    description:
      "RabbitMode (Phase 1-7 Grundgerüst): on|off|status|stop|spawn|define — kein Workflow-Graph",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();
      const { first, rest } = splitFirstWord(trimmed);
      const sub = first.toLowerCase();
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
        case "spawn": {
          const { first: rawRole, rest: task } = splitFirstWord(rest);
          const role = rawRole.toLowerCase();
          if (task === "" || (!isBaselineRole(role) && !isRabbitBundledRole(role))) {
            ctx.ui.notify(USAGE, "info");
            return;
          }
          if (state.mode() !== "active") {
            ctx.ui.notify("RabbitMode ist aus — erst /rabbit on.", "warning");
            return;
          }
          const result = isBaselineRole(role)
            ? await spawnBaselineRole(rpc, role, task)
            : await spawnRabbitBundledRole(rpc, role as RabbitBundledRole, task);
          ctx.ui.notify(result.message, result.ok ? "info" : "error");
          return;
        }
        case "define": {
          if (rest === "") {
            ctx.ui.notify(DEFINE_USAGE, "info");
            return;
          }
          if (state.mode() !== "active") {
            ctx.ui.notify("RabbitMode ist aus — erst /rabbit on.", "warning");
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(rest);
          } catch {
            ctx.ui.notify(`Ungültiges JSON.\n${DEFINE_USAGE}`, "error");
            return;
          }
          const result = await spawnDynamicRole(rpc, dynamicRoles, ctx.cwd, parsed);
          ctx.ui.notify(result.message, result.ok ? "info" : "error");
          return;
        }
        default:
          ctx.ui.notify(USAGE, "info");
      }
    },
  });
}
