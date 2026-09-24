import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { RabbitStateApi } from "../rabbit/state.ts";
import { rabbitMaxChildModel } from "../rabbit/effort.ts";
import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";
import type { DynamicRoleRegistry } from "./dynamic-role.ts";
import { validateWorkflowGraph, type WorkflowStepDefinition } from "./graph.ts";
import { stopRabbitRun, type RabbitRunController } from "./run-controller.ts";
import type { WorkflowSessionHolder } from "./workflow-session-holder.ts";

const MAX_SUPERVISOR_OUTPUT_BYTES = 64 * 1024;
const SUPERVISOR_GUIDANCE = `

RabbitMode supervisor contract (active only while RabbitMode is on):
- You are the Root Supervisor; RabbitMode's tools execute only the DAG you submit and enforce role, size, dependency, concurrency, MAX-thinking, and lifecycle rules.
- First classify the task. Solve small/simple tasks yourself; do not delegate without a meaningful independent branch.
- For independent analysis branches prefer temporary agents: a step with role="temporary" and a spec (objective, profile analyse|research, delegationReason, optional context/scope/expectedOutput). They are stateless, read-only and get only the context you put in the spec; they cannot depend on other steps, but other steps may depend on them. Installed roles remain available for the rest: investigator, debugger, verifier, rabbitmode.permission-auditor, rabbitmode.recovery-auditor, rabbitmode.architecture-auditor. Use rabbit_define_role only for a genuine missing specialty; generated roles are read-only.
- Subagents deliver bounded work results; you decide. If results contradict, compare their evidence, re-check yourself or run a targeted verification — never decide by majority, completion order or model strength.
- Build a bounded DAG with explicit dependsOn. Mark the final child synthesis step with kind="synthesis" and make it a terminal sink that consumes the relevant branch outputs.
- After rabbit_workflow returns, inspect actual child outputs, distinguish complete/incomplete/failed/cancelled, and synthesize only from those outputs. If there is a concrete new finding that needs more work, call rabbit_replan with a reason and a new synthesis step; at most three revisions are allowed.
- Never claim verification ran unless the real project_check was invoked. FAIL remains FAIL; INCOMPLETE is not PASS. RabbitMode does not write files or change permissions.
`;

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function truncateUtf8(text: string, maxBytes: number): string {
  let output = "";
  let size = 0;
  for (const character of text) {
    const next = byteLength(character);
    if (size + next > maxBytes) break;
    output += character;
    size += next;
  }
  return output;
}

function formatRunResult(result: {
  ok: boolean;
  outcome: string;
  steps: Array<{ id: string; status: string; message?: string }>;
  error?: string;
}): string {
  const body = [
    `Rabbit workflow outcome: ${result.outcome}${result.error ? ` — ${result.error}` : ""}`,
    ...result.steps.map((step) =>
      `\n[${step.id} · ${step.status}]\n${step.message ?? "(No textual output returned.)"}`,
    ),
  ].join("\n");
  if (byteLength(body) <= MAX_SUPERVISOR_OUTPUT_BYTES) return body;
  const marker = `\n\n[Supervisor result truncated: ${byteLength(body) - MAX_SUPERVISOR_OUTPUT_BYTES} UTF-8 bytes omitted; complete per-step results remain in the workflow history.]`;
  const head = truncateUtf8(body, MAX_SUPERVISOR_OUTPUT_BYTES - byteLength(marker));
  const omittedBytes = byteLength(body.slice(head.length));
  const finalMarker = `\n\n[Supervisor result truncated: ${omittedBytes} UTF-8 bytes omitted; complete per-step results remain in the workflow history.]`;
  return `${truncateUtf8(body, MAX_SUPERVISOR_OUTPUT_BYTES - byteLength(finalMarker))}${finalMarker}`;
}

function bindAbortStop(
  signal: AbortSignal | undefined,
  rpc: SubagentRpcClient,
  controller: RabbitRunController,
): () => void {
  const stop = () => { void stopRabbitRun(rpc, controller); };
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  return () => signal?.removeEventListener("abort", stop);
}

function dynamicRoleValidator(dynamicRoles: DynamicRoleRegistry) {
  return (role: string) => dynamicRoles.resolveRuntimeName(role) !== undefined;
}

function validateSupervisorPlan(
  steps: WorkflowStepDefinition[],
  dynamicRoles: DynamicRoleRegistry,
  newRevisionSteps?: readonly WorkflowStepDefinition[],
): string | undefined {
  const graph = validateWorkflowGraph(steps, { isDynamicRole: dynamicRoleValidator(dynamicRoles) });
  if (!graph.valid) return graph.error;
  const candidateSteps = newRevisionSteps ?? steps;
  const syntheses = candidateSteps.filter((step) => step.kind === "synthesis");
  if (syntheses.length !== 1) return "Orchestrierter Workflow braucht genau einen neuen kind=\"synthesis\"-Step.";
  const synthesis = syntheses[0]!;
  const hasDependent = steps.some((step) => step.dependsOn?.includes(synthesis.id));
  if (hasDependent) return `Synthese-Step "${synthesis.id}" muss ein terminaler Step sein.`;
  if (synthesis.dependsOn?.length === 0) {
    return `Synthese-Step "${synthesis.id}" muss tatsächliche Dependency-Ergebnisse konsumieren.`;
  }
  return undefined;
}

export interface RabbitSupervisorToolDependencies {
  state: RabbitStateApi;
  rpc: SubagentRpcClient;
  dynamicRoles: DynamicRoleRegistry;
  workflowSessions: WorkflowSessionHolder;
  runController: RabbitRunController;
}

export function registerRabbitSupervisorTools(
  pi: ExtensionAPI,
  dependencies: RabbitSupervisorToolDependencies,
): void {
  const { state, rpc, dynamicRoles, workflowSessions, runController } = dependencies;

  pi.on("before_agent_start", (event) => {
    if (state.mode() !== "active") return;
    return { systemPrompt: `${event.systemPrompt}${SUPERVISOR_GUIDANCE}` };
  });

  pi.registerTool({
    name: "rabbit_define_role",
    label: "Rabbit Define Role",
    description: "Create a session-local, read-only Rabbit specialist for a genuine missing skill.",
    promptSnippet: "Create an ephemeral read-only specialist only when installed roles do not fit",
    promptGuidelines: [
      "Use rabbit_define_role only for a real missing specialty; tools are hard-limited to read, grep, find, and ls.",
      "Define the role without a task, then reference its rabbit-dynamic.<id> runtime name in rabbit_workflow.",
    ],
    parameters: Type.Object({
      id: Type.String({ minLength: 2, maxLength: 41 }),
      purpose: Type.String({ minLength: 1, maxLength: 300 }),
      instructions: Type.String({ minLength: 1, maxLength: 4000 }),
      tools: Type.Array(Type.String(), { minItems: 1, maxItems: 4 }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (state.mode() !== "active") throw new Error("RabbitMode ist aus — erst /rabbit on.");
      if (signal?.aborted) throw new Error("Rabbit role definition cancelled.");
      state.bindContext(ctx);
      const defined = await dynamicRoles.define(ctx.cwd, params);
      if (!defined.ok) throw new Error(defined.error);
      if (signal?.aborted) {
        await dynamicRoles.cleanup(defined.role.id);
        throw new Error("Rabbit role definition cancelled.");
      }
      return {
        content: [{ type: "text", text: `Ephemere read-only Rolle verfügbar: ${defined.role.runtimeName}` }],
        details: { id: defined.role.id, runtimeName: defined.role.runtimeName },
      };
    },
  });

  const stepSchema = Type.Object({
    id: Type.String({ minLength: 1, maxLength: 80 }),
    role: Type.String({ minLength: 1, maxLength: 100 }),
    task: Type.String({ minLength: 1, maxLength: 4000 }),
    spec: Type.Optional(Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description: "Temporary agent contract for role=\"temporary\": {objective, profile: analyse|research, delegationReason, context?, scope?, expectedOutput?, requestedCapabilities?: read|search, modelPreference?, constraints?}. task is then only a short label.",
    })),
    dependsOn: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 12 })),
    kind: Type.Optional(StringEnum(["analysis", "synthesis", "verification"] as const)),
  });

  pi.registerTool({
    name: "rabbit_workflow",
    label: "Rabbit Workflow",
    description: "Validate and execute a bounded Rabbit DAG; dependent steps receive only their declared dependencies' outputs.",
    promptSnippet: "Execute a validated Rabbit analysis DAG with bounded parallelism and result dataflow",
    promptGuidelines: [
      "Call only for meaningful multi-step work; Rabbit validates every graph and role before spawning.",
      "Orchestrated graphs require exactly one terminal kind=synthesis step with dependencies.",
    ],
    parameters: Type.Object({
      steps: Type.Array(stepSchema, { minItems: 1, maxItems: 12 }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (state.mode() !== "active") throw new Error("RabbitMode ist aus — erst /rabbit on.");
      if (signal?.aborted) throw new Error("Rabbit workflow cancelled before start.");
      state.bindContext(ctx);
      const current = runController.snapshot();
      if (runController.isActive() && current.phase !== "planning") {
        throw new Error("Ein Rabbit-Run ist bereits aktiv.");
      }
      const childModel = rabbitMaxChildModel(ctx);
      if (!childModel.supported) throw new Error(childModel.reason);
      const error = validateSupervisorPlan(params.steps, dynamicRoles);
      if (error) throw new Error(error);
      const session = workflowSessions.startNew();
      const unbindAbort = bindAbortStop(signal, rpc, runController);
      try {
        const result = await session.start(rpc, params.steps, {
          runController,
          dynamicRoles,
          childModel: childModel.model,
        });
        return {
          content: [{ type: "text", text: formatRunResult(result) }],
          details: result,
        };
      } finally {
        unbindAbort();
      }
    },
  });

  pi.registerTool({
    name: "rabbit_replan",
    label: "Rabbit Replan",
    description: "Append a justified, bounded workflow revision and execute only newly-added steps.",
    promptSnippet: "Append a reasoned Rabbit workflow revision when a concrete new finding warrants more investigation",
    promptGuidelines: [
      "A replan must cite a concrete new finding and include a new synthesis step that depends on the new work.",
      "The runtime caps history at three revisions and never widens concurrency or permissions.",
    ],
    parameters: Type.Object({
      reason: Type.String({ minLength: 1, maxLength: 2000 }),
      steps: Type.Array(stepSchema, { minItems: 1, maxItems: 12 }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (state.mode() !== "active") throw new Error("RabbitMode ist aus — erst /rabbit on.");
      if (signal?.aborted) throw new Error("Rabbit replan cancelled before start.");
      state.bindContext(ctx);
      const session = workflowSessions.current();
      if (!session || session.currentRevision() === 0) throw new Error("Kein Rabbit-Workflow vorhanden, der replanned werden kann.");
      const previous = session.revisions()[session.revisions().length - 1];
      const combined = [...(previous?.steps ?? []), ...params.steps];
      const error = validateSupervisorPlan(combined, dynamicRoles, params.steps);
      if (error) throw new Error(error);
      const unbindAbort = bindAbortStop(signal, rpc, runController);
      try {
        const result = await session.replan(rpc, params.reason, params.steps);
        return {
          content: [{ type: "text", text: formatRunResult(result) }],
          details: result,
        };
      } finally {
        unbindAbort();
      }
    },
  });
}
