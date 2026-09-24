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
import type { WorkflowRunResult, WorkflowStepResult } from "../orchestration/workflow-runner.ts";
import type { WorkflowStepDefinition, WorkflowStepStatus } from "../orchestration/graph.ts";
import type { WorkflowSessionHolder } from "../orchestration/workflow-session-holder.ts";
import { MAX_WORKFLOW_REVISIONS } from "../orchestration/workflow-session.ts";
import { saveWorkflowSnapshot } from "../orchestration/workflow-persistence.ts";

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
const WORKFLOW_USAGE =
  `/rabbit workflow {"steps":[{"id":"...","role":"<${SPAWNABLE_ROLES.join("|")}>","task":"...","dependsOn":["..."]}]}`;
const REPLAN_USAGE =
  `/rabbit replan {"reason":"<konkreter neuer Befund>","steps":[{"id":"...","role":"<${SPAWNABLE_ROLES.join("|")}>","task":"...","dependsOn":["..."]}]}`;
const USAGE =
  "Nutzung: /rabbit on|off|status|stop|spawn <rolle> <Aufgabe>|define <json>|workflow <json>|replan <json>|verify [profil]|save-agent <id>|save-workflow <name>";

/**
 * Phase 12 of the spec ties verification integration to a Writer/mutation
 * path that was deliberately never built (see dynamic-role.ts and
 * README.md's "Bewusst nicht gebaut: Phase 11") — RabbitMode itself never
 * mutates anything, so there is no real "nach Mutation" trigger point.
 * `/rabbit verify` is the scoped-down form the user chose instead: a plain
 * convenience trigger for the real `project_check` tool, for use after the
 * user has acted on RabbitMode's (read-only) findings themselves.
 *
 * `project_check` is registered via `pi.registerTool` (extensions/setup-
 * core/index.ts in daydaylx/pi) — an LLM-facing tool, not something an
 * extension can call directly without reaching into another repo's
 * internals (forbidden by 03_REPOSITORY_BOUNDARIES.md and the "keine
 * Verification-Logik duplizieren" rule). `pi.sendUserMessage` is the real,
 * already-established mechanism for an extension to hand off to the active
 * agent's own tool-calling turn instead (see extensions/plan-mode/
 * commands.ts's `switchMode`/`sendUserMessage` call in daydaylx/pi) — this
 * command reuses exactly that, it does not re-implement verification.
 */
const DEFAULT_VERIFY_PROFILE = "verify";

function projectCheckPrompt(profile: string): string {
  return `Führe project_check mit profile="${profile}" aus und melde das ` +
    "Ergebnis unverändert weiter: ein FAIL bleibt FAIL, ein INCOMPLETE " +
    "gilt nicht als PASS.";
}

const STEP_STATUS_GLYPH: Record<WorkflowStepStatus, string> = {
  pending: "○",
  running: "●",
  completed: "✓",
  failed: "✗",
  skipped: "⊘",
};
const STEP_MESSAGE_MAX_LENGTH = 300;

function formatWorkflowStep(step: WorkflowStepResult): string {
  const glyph = STEP_STATUS_GLYPH[step.status];
  const message = step.message ?? "";
  const truncated =
    message.length > STEP_MESSAGE_MAX_LENGTH
      ? `${message.slice(0, STEP_MESSAGE_MAX_LENGTH)}…`
      : message;
  return `${glyph} ${step.id}${truncated ? `: ${truncated}` : ""}`;
}

function extractSteps(parsed: unknown): WorkflowStepDefinition[] | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const steps = (parsed as { steps?: unknown }).steps;
  return Array.isArray(steps) ? (steps as WorkflowStepDefinition[]) : undefined;
}

function formatWorkflowResult(result: WorkflowRunResult): string {
  if (!result.ok && result.steps.length === 0) {
    return `Workflow ungültig: ${result.error ?? "unbekannter Fehler"}`;
  }
  const completed = result.steps.filter((s) => s.status === "completed").length;
  const header = result.ok
    ? `Workflow abgeschlossen: ${completed}/${result.steps.length} Steps erfolgreich.`
    : `Workflow fehlgeschlagen: ${completed}/${result.steps.length} Steps erfolgreich.`;
  return [header, ...result.steps.map(formatWorkflowStep)].join("\n");
}

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
  workflowSessions: WorkflowSessionHolder,
  saveWorkflow: typeof saveWorkflowSnapshot,
): void {
  pi.registerCommand("rabbit", {
    description:
      "RabbitMode (Phase 1-10 Grundgerüst): on|off|status|stop|spawn|define|workflow|replan|verify|save-agent|save-workflow",
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
        case "save-agent": {
          if (rest === "") {
            ctx.ui.notify("Nutzung: /rabbit save-agent <id>", "info");
            return;
          }
          if (state.mode() !== "active") {
            ctx.ui.notify("RabbitMode ist aus — erst /rabbit on.", "warning");
            return;
          }
          const saved = await dynamicRoles.save(rest, ctx.cwd);
          ctx.ui.notify(
            saved.ok
              ? `Rolle "${rest}" dauerhaft gespeichert: ${saved.filePath} (überlebt /rabbit off und Session-Ende).`
              : saved.error,
            saved.ok ? "info" : "error",
          );
          return;
        }
        case "workflow": {
          if (rest === "") {
            ctx.ui.notify(WORKFLOW_USAGE, "info");
            return;
          }
          if (state.mode() !== "active") {
            ctx.ui.notify("RabbitMode ist aus — erst /rabbit on.", "warning");
            return;
          }
          let parsedWorkflow: unknown;
          try {
            parsedWorkflow = JSON.parse(rest);
          } catch {
            ctx.ui.notify(`Ungültiges JSON.\n${WORKFLOW_USAGE}`, "error");
            return;
          }
          const steps = extractSteps(parsedWorkflow);
          if (!steps) {
            ctx.ui.notify(`Fehlendes "steps"-Array.\n${WORKFLOW_USAGE}`, "error");
            return;
          }
          const session = workflowSessions.startNew();
          const result = await session.start(rpc, steps);
          ctx.ui.notify(formatWorkflowResult(result), result.ok ? "info" : "error");
          return;
        }
        case "replan": {
          if (rest === "") {
            ctx.ui.notify(REPLAN_USAGE, "info");
            return;
          }
          if (state.mode() !== "active") {
            ctx.ui.notify("RabbitMode ist aus — erst /rabbit on.", "warning");
            return;
          }
          const session = workflowSessions.current();
          if (!session) {
            ctx.ui.notify("Kein laufender Workflow — erst /rabbit workflow starten.", "warning");
            return;
          }
          let parsedReplan: unknown;
          try {
            parsedReplan = JSON.parse(rest);
          } catch {
            ctx.ui.notify(`Ungültiges JSON.\n${REPLAN_USAGE}`, "error");
            return;
          }
          const steps = extractSteps(parsedReplan);
          const reason =
            typeof parsedReplan === "object" &&
            parsedReplan !== null &&
            typeof (parsedReplan as { reason?: unknown }).reason === "string"
              ? (parsedReplan as { reason: string }).reason
              : undefined;
          if (!steps || !reason) {
            ctx.ui.notify(`Fehlendes "reason" oder "steps".\n${REPLAN_USAGE}`, "error");
            return;
          }
          const result = await session.replan(rpc, reason, steps);
          ctx.ui.notify(
            `Revision ${session.currentRevision()}/${MAX_WORKFLOW_REVISIONS}:\n${formatWorkflowResult(result)}`,
            result.ok ? "info" : "error",
          );
          return;
        }
        case "save-workflow": {
          if (rest === "") {
            ctx.ui.notify("Nutzung: /rabbit save-workflow <name>", "info");
            return;
          }
          if (state.mode() !== "active") {
            ctx.ui.notify("RabbitMode ist aus — erst /rabbit on.", "warning");
            return;
          }
          const session = workflowSessions.current();
          if (!session) {
            ctx.ui.notify("Kein laufender Workflow — erst /rabbit workflow starten.", "warning");
            return;
          }
          const saved = await saveWorkflow(ctx.cwd, rest, session);
          ctx.ui.notify(
            saved.ok
              ? `Workflow "${rest}" gespeichert: ${saved.filePath} (Audit-Snapshot, kein Lademechanismus).`
              : saved.error,
            saved.ok ? "info" : "error",
          );
          return;
        }
        case "verify": {
          // Deliberately not gated behind `state.mode() === "active"`: this
          // touches no Rabbit-specific state or RPC, it only hands off to
          // the real project_check tool via the active agent's own turn —
          // see the doc comment on projectCheckPrompt above.
          //
          // `hasUI` gate found via a real `pi -p "/rabbit verify"` smoke
          // test (not a theoretical concern): `sendUserMessage`'s forced
          // second turn, issued from inside a command handler that is
          // itself running outside the normal interactive turn loop,
          // corrupts print/json (single-shot) mode's turn bookkeeping —
          // observed as "turn_end could not resolve the persisted
          // assistant entry ID" plus cascading "stale ctx" errors from
          // unrelated extensions (plan-mode, setup-core). `hasUI` is false
          // exactly in print/json mode and true in tui/rpc
          // (`ExtensionContext.hasUI` doc: "true in TUI and RPC modes") —
          // the same discriminator sendUserMessage's own callers need,
          // used here to refuse before triggering the corruption rather
          // than let it happen.
          if (!ctx.hasUI) {
            ctx.ui.notify(
              "/rabbit verify braucht eine interaktive Session (TUI oder RPC) — im --print/--mode json Einzelschuss-Modus nicht verfügbar.",
              "warning",
            );
            return;
          }
          if (!ctx.isIdle()) {
            ctx.ui.notify(
              "Ein Turn läuft gerade — /rabbit verify danach erneut ausführen.",
              "warning",
            );
            return;
          }
          const profile = rest === "" ? DEFAULT_VERIFY_PROFILE : rest;
          ctx.ui.notify(
            `RabbitMode: fordere project_check(profile="${profile}") beim aktiven Agenten an …`,
            "info",
          );
          pi.sendUserMessage(projectCheckPrompt(profile));
          return;
        }
        default:
          ctx.ui.notify(USAGE, "info");
      }
    },
  });
}
