import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";
import type { WorkflowStepDefinition } from "./graph.ts";
import { runWorkflow, type RunWorkflowOptions, type WorkflowRunResult } from "./workflow-runner.ts";

/**
 * Replanning (Phase 9) — `docs/spec/02_CONTRACTS.md` §8: revisions are
 * bounded, numbered, need a concrete new finding, never overwrite history,
 * and can't widen limits/permissions. `docs/spec/01_ARCHITECTURE.md` §7
 * sets the MVP default at 3 revisions; the *adaptive* revision count from
 * `daydaylx/pi-rabbitmode` issue #1 is explicitly Post-MVP — this stays a
 * fixed counter.
 *
 * A revision is additive only: it appends new steps (which may depend on
 * steps from any earlier revision) and re-runs the combined graph, but
 * previously-terminal steps are seeded as already-done
 * (`RunWorkflowOptions.seedResults`) so they are never re-spawned. Earlier
 * revisions' own recorded results are never mutated — `revisions()`
 * returns the full, append-only history.
 */
export const MAX_WORKFLOW_REVISIONS = 3;

export interface WorkflowRevisionRecord {
  revision: number;
  /** The concrete new finding that justified this revision. Absent for revision 1 (the initial plan, not a revision of anything). */
  reason?: string;
  /** The full step set as of this revision (all earlier steps plus this revision's additions). */
  steps: WorkflowStepDefinition[];
  result: WorkflowRunResult;
}

export interface WorkflowSession {
  /** Append-only, oldest first. Never mutated after being pushed. */
  revisions(): readonly WorkflowRevisionRecord[];
  /** 0 before `start()`, then the number of the most recent revision. */
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
  let maxParallel: number | undefined;

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
          steps: [],
          error: "Workflow läuft bereits — für weitere Steps replan() statt start() nutzen.",
        };
      }
      maxParallel = options?.maxParallel;
      const result = await runWorkflow(rpc, steps, options);
      revisions.push({ revision: 1, steps, result });
      return result;
    },

    async replan(rpc, reason, newSteps, options) {
      const previous = latest();
      if (!previous) {
        return { ok: false, steps: [], error: "Noch kein Workflow gestartet — zuerst start() aufrufen." };
      }
      if (!reason || reason.trim().length === 0) {
        return {
          ok: false,
          steps: [],
          error: "Replanning braucht einen konkreten neuen Befund als Begründung.",
        };
      }
      if (revisions.length >= MAX_WORKFLOW_REVISIONS) {
        return {
          ok: false,
          steps: [],
          error: `Limit erreicht: maximal ${MAX_WORKFLOW_REVISIONS} Revisionen pro Workflow.`,
        };
      }
      const previousIds = new Set(previous.steps.map((s) => s.id));
      for (const step of newSteps) {
        if (previousIds.has(step.id)) {
          return {
            ok: false,
            steps: [],
            error: `Step-id "${step.id}" existiert bereits in einer früheren Revision.`,
          };
        }
      }

      const combinedSteps = [...previous.steps, ...newSteps];
      // maxParallel is never taken from `options` here — a revision can
      // never widen the limit the session started with, per the
      // Replanning Contract ("dürfen Limits/Permissions nicht ausweiten").
      const result = await runWorkflow(rpc, combinedSteps, {
        maxParallel,
        pollOptions: options?.pollOptions,
        seedResults: previous.result.steps,
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
