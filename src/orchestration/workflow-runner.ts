import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";
import { isBaselineRole, isRabbitBundledRole, spawnBaselineRole, spawnRabbitBundledRole } from "./agent-factory.ts";
import {
  MAX_PARALLEL_AGENTS_DEFAULT,
  propagateSkips,
  selectReadySteps,
  validateWorkflowGraph,
  type WorkflowStepDefinition,
  type WorkflowStepStatus,
} from "./graph.ts";
import { pollStepUntilTerminal, type PollStepOptions } from "./status-adapter.ts";

export interface WorkflowStepResult {
  id: string;
  status: WorkflowStepStatus;
  message?: string;
}

export type WorkflowRunResult =
  | { ok: true; steps: WorkflowStepResult[] }
  | { ok: false; steps: WorkflowStepResult[]; error?: string };

async function spawnStep(rpc: SubagentRpcClient, step: WorkflowStepDefinition) {
  if (isBaselineRole(step.role)) return spawnBaselineRole(rpc, step.role, step.task);
  if (isRabbitBundledRole(step.role)) return spawnRabbitBundledRole(rpc, step.role, step.task);
  // Unreachable once validateWorkflowGraph has run, kept as a fail-closed
  // guard rather than a non-null assertion.
  return { ok: false as const, message: `Unbekannte Rolle "${step.role}".` };
}

export interface RunWorkflowOptions {
  maxParallel?: number;
  pollOptions?: PollStepOptions;
  /**
   * Step results to seed as already-`completed` before scheduling starts
   * — used by `workflow-session.ts` (Phase 9) to re-run a revised graph
   * without re-spawning steps a prior revision already finished. Any id
   * not present in `steps` is ignored.
   */
  seedResults?: WorkflowStepResult[];
}

/**
 * Bounded-parallelism scheduler: repeatedly spawns every currently-ready
 * step (dependencies satisfied, still under `maxParallel` concurrent
 * runs), waits for at least one running step to settle, propagates
 * skips from any newly-failed step, and repeats until nothing is left
 * running or eligible to start.
 */
export async function runWorkflow(
  rpc: SubagentRpcClient,
  steps: WorkflowStepDefinition[],
  options?: RunWorkflowOptions,
): Promise<WorkflowRunResult> {
  const validation = validateWorkflowGraph(steps);
  if (!validation.valid) return { ok: false, steps: [], error: validation.error };

  const maxParallel = options?.maxParallel ?? MAX_PARALLEL_AGENTS_DEFAULT;
  const statusById = new Map<string, WorkflowStepStatus>(steps.map((s) => [s.id, "pending"]));
  const messageById = new Map<string, string | undefined>();
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const active = new Set<Promise<void>>();

  for (const seeded of options?.seedResults ?? []) {
    if (!stepById.has(seeded.id)) continue;
    statusById.set(seeded.id, seeded.status);
    messageById.set(seeded.id, seeded.message);
  }

  async function runStep(step: WorkflowStepDefinition): Promise<void> {
    statusById.set(step.id, "running");
    const spawned = await spawnStep(rpc, step);
    if (!spawned.ok) {
      statusById.set(step.id, "failed");
      messageById.set(step.id, spawned.message);
      return;
    }
    if (!spawned.runId) {
      // No run to poll (unexpected shape) — the spawn reply itself is all
      // we have, so treat it as the terminal result rather than hang.
      statusById.set(step.id, "completed");
      messageById.set(step.id, spawned.message);
      return;
    }
    const outcome = await pollStepUntilTerminal(rpc, spawned.runId, options?.pollOptions);
    statusById.set(step.id, outcome.failed ? "failed" : "completed");
    messageById.set(step.id, outcome.text ?? spawned.message);
  }

  while (true) {
    while (propagateSkips(steps, statusById)) {
      /* cascade multi-level skips regardless of declaration order */
    }
    const availableSlots = maxParallel - active.size;
    const ready = selectReadySteps(steps, statusById, availableSlots);
    for (const id of ready) {
      const step = stepById.get(id);
      if (!step) continue;
      const task: Promise<void> = runStep(step).finally(() => {
        active.delete(task);
      });
      active.add(task);
    }
    if (active.size === 0) break;
    await Promise.race(active);
  }

  const results: WorkflowStepResult[] = steps.map((step) => ({
    id: step.id,
    status: statusById.get(step.id) ?? "pending",
    message: messageById.get(step.id),
  }));
  const ok = results.every((r) => r.status === "completed");
  return { ok, steps: results };
}
