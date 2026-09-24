import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";
import type { WorkflowStepDefinition } from "./graph.ts";
import { runWorkflow, type RunWorkflowOptions, type WorkflowRunResult } from "./workflow-runner.ts";

/** Fixed MVP replan cap; adaptive guardrails remain Post-MVP. */
export const MAX_WORKFLOW_REVISIONS = 3;

export interface WorkflowRevisionRecord {
  revision: number;
  reason?: string;
  steps: WorkflowStepDefinition[];
  result: WorkflowRunResult;
}

export interface WorkflowSession {
  revisions(): readonly WorkflowRevisionRecord[];
  currentRevision(): number;
  start(
    rpc: SubagentRpcClient,
    steps: WorkflowStepDefinition[],
    options?: RunWorkflowOptions,
  ): Promise<WorkflowRunResult>;
  replan(
    rpc: SubagentRpcClient,
    reason: string,
    newSteps: WorkflowStepDefinition[],
    options?: Pick<RunWorkflowOptions, "pollOptions">,
  ): Promise<WorkflowRunResult>;
}

export function createWorkflowSession(): WorkflowSession {
  const revisions: WorkflowRevisionRecord[] = [];
  let runOptions: RunWorkflowOptions | undefined;

  function latest(): WorkflowRevisionRecord | undefined {
    return revisions[revisions.length - 1];
  }

  return {
    revisions: () => revisions,
    currentRevision: () => revisions.length,

    async start(rpc, steps, options) {
      if (revisions.length > 0) {
        return {
          ok: false,
          outcome: "blocked",
          steps: [],
          error: "Workflow läuft bereits — für weitere Steps replan() statt start() nutzen.",
        };
      }
      runOptions = options;
      const result = await runWorkflow(rpc, steps, { ...options, revision: 1 });
      revisions.push({ revision: 1, steps, result });
      return result;
    },

    async replan(rpc, reason, newSteps, options) {
      const previous = latest();
      if (!previous) {
        return {
          ok: false,
          outcome: "blocked",
          steps: [],
          error: "Noch kein Workflow gestartet — zuerst start() aufrufen.",
        };
      }
      if (!reason || reason.trim().length === 0) {
        return {
          ok: false,
          outcome: "blocked",
          steps: [],
          error: "Replanning braucht einen konkreten neuen Befund als Begründung.",
        };
      }
      if (revisions.length >= MAX_WORKFLOW_REVISIONS) {
        return {
          ok: false,
          outcome: "blocked",
          steps: [],
          error: `Limit erreicht: maximal ${MAX_WORKFLOW_REVISIONS} Revisionen pro Workflow.`,
        };
      }
      const previousIds = new Set(previous.steps.map((step) => step.id));
      for (const step of newSteps) {
        if (previousIds.has(step.id)) {
          return {
            ok: false,
            outcome: "blocked",
            steps: [],
            error: `Step-id "${step.id}" existiert bereits in einer früheren Revision.`,
          };
        }
      }

      const combinedSteps = [...previous.steps, ...newSteps];
      const result = await runWorkflow(rpc, combinedSteps, {
        ...runOptions,
        pollOptions: options?.pollOptions ?? runOptions?.pollOptions,
        seedResults: previous.result.steps,
        revision: revisions.length + 1,
      });
      revisions.push({
        revision: revisions.length + 1,
        reason: reason.trim(),
        steps: combinedSteps,
        result,
      });
      return result;
    },
  };
}
