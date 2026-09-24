import type { DynamicRoleRegistry } from "./dynamic-role.ts";
import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";
import {
  isBaselineRole,
  isRabbitBundledRole,
  spawnBaselineRole,
  spawnRabbitBundledRole,
} from "./agent-factory.ts";
import {
  MAX_PARALLEL_AGENTS_DEFAULT,
  propagateSkips,
  selectReadySteps,
  validateWorkflowGraph,
  type WorkflowStepDefinition,
  type WorkflowStepStatus,
} from "./graph.ts";
import { buildStepInput, type DependencyResultInput } from "./step-input.ts";
import type {
  RabbitRunController,
  RabbitRunOutcome,
} from "./run-controller.ts";
import {
  pollStepUntilTerminal,
  type PollStepOptions,
} from "./status-adapter.ts";

export interface WorkflowStepResult {
  id: string;
  status: WorkflowStepStatus;
  message?: string;
}

export type WorkflowRunResult =
  | { ok: true; outcome: "complete"; steps: WorkflowStepResult[] }
  | {
      ok: false;
      outcome: Exclude<RabbitRunOutcome, "complete">;
      steps: WorkflowStepResult[];
      error?: string;
    };

export interface RunWorkflowOptions {
  maxParallel?: number;
  pollOptions?: PollStepOptions;
  /** Step results to seed as already terminal before scheduling starts. */
  seedResults?: WorkflowStepResult[];
  /** Session-owned ephemeral role registry; saved/unregistered roles are rejected. */
  dynamicRoles?: DynamicRoleRegistry;
  /** Enforce MAX on the child through the public v1 spawn model override. */
  childModel?: string;
  runController?: RabbitRunController;
  revision?: number;
}

async function spawnStep(
  rpc: SubagentRpcClient,
  step: WorkflowStepDefinition,
  task: string,
  options?: RunWorkflowOptions,
) {
  const spawnOptions = options?.childModel
    ? { model: options.childModel }
    : undefined;
  if (isBaselineRole(step.role))
    return spawnBaselineRole(rpc, step.role, task, spawnOptions);
  if (isRabbitBundledRole(step.role))
    return spawnRabbitBundledRole(rpc, step.role, task, spawnOptions);

  const dynamicRole = options?.dynamicRoles?.resolveRuntimeName(step.role);
  if (dynamicRole) {
    try {
      const reply = await rpc.call("spawn", {
        agent: dynamicRole.runtimeName,
        task,
        ...(options?.childModel ? { model: options.childModel } : {}),
      });
      if (!reply.success) {
        return {
          ok: false as const,
          message: `Spawn fehlgeschlagen (${reply.error.code}): ${reply.error.message}`,
        };
      }
      const data =
        typeof reply.data === "object" && reply.data !== null
          ? (reply.data as Record<string, unknown>)
          : undefined;
      const details =
        typeof data?.details === "object" && data.details !== null
          ? (data.details as Record<string, unknown>)
          : undefined;
      return {
        ok: true as const,
        message:
          typeof data?.text === "string"
            ? data.text
            : `${dynamicRole.runtimeName} gestartet.`,
        runId: typeof details?.runId === "string" ? details.runId : undefined,
      };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { ok: false as const, message: `Unbekannte Rolle "${step.role}".` };
}

function dependencyInputs(
  step: WorkflowStepDefinition,
  statusById: ReadonlyMap<string, WorkflowStepStatus>,
  messageById: ReadonlyMap<string, string | undefined>,
): DependencyResultInput[] {
  return (step.dependsOn ?? []).map((stepId) => ({
    stepId,
    status: statusById.get(stepId) ?? "pending",
    output: messageById.get(stepId),
  }));
}

function choosePhase(
  step: WorkflowStepDefinition,
): "orchestrating" | "synthesizing" | "verifying" {
  if (step.kind === "synthesis") return "synthesizing";
  if (step.kind === "verification") return "verifying";
  return "orchestrating";
}

async function stopChildBestEffort(
  rpc: SubagentRpcClient,
  runId: string,
): Promise<void> {
  try {
    const stopped = await rpc.call("stop", { id: runId });
    if (
      stopped.success ||
      ["not_found", "invalid_state"].includes(stopped.error.code)
    )
      return;
  } catch {
    // Fall through to the supported soft-interrupt channel.
  }
  try {
    await rpc.call("interrupt", { id: runId });
  } catch {
    // The polling timeout remains the final bound if the runtime is unreachable.
  }
}

/** Bounded-parallelism scheduler with dependency-result dataflow and controlled stop support. */
export async function runWorkflow(
  rpc: SubagentRpcClient,
  steps: WorkflowStepDefinition[],
  options?: RunWorkflowOptions,
): Promise<WorkflowRunResult> {
  const revision = options?.revision ?? 1;
  const controller = options?.runController;
  const begun = controller?.beginRevision(revision);
  if (begun && !begun.ok) {
    return { ok: false, outcome: "blocked", steps: [], error: begun.error };
  }

  const validation = validateWorkflowGraph(steps, {
    isDynamicRole: (role) =>
      options?.dynamicRoles?.resolveRuntimeName(role) !== undefined,
  });
  if (!validation.valid) {
    controller?.finish("blocked");
    return {
      ok: false,
      outcome: "blocked",
      steps: [],
      error: validation.error,
    };
  }

  const maxParallel = options?.maxParallel ?? MAX_PARALLEL_AGENTS_DEFAULT;
  const statusById = new Map<string, WorkflowStepStatus>(
    steps.map((step) => [step.id, "pending"]),
  );
  const messageById = new Map<string, string | undefined>();
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const active = new Set<Promise<void>>();

  for (const seeded of options?.seedResults ?? []) {
    if (!stepById.has(seeded.id)) continue;
    statusById.set(seeded.id, seeded.status);
    messageById.set(seeded.id, seeded.message);
  }

  async function runStep(step: WorkflowStepDefinition): Promise<void> {
    if (controller?.isStopping()) {
      statusById.set(step.id, "stopped");
      return;
    }
    statusById.set(step.id, "running");
    controller?.setPhase(choosePhase(step));

    const input = buildStepInput(
      step.task,
      dependencyInputs(step, statusById, messageById),
    );
    if (!input.ok) {
      statusById.set(step.id, "failed");
      messageById.set(step.id, input.error);
      return;
    }

    const dynamicRole = options?.dynamicRoles?.resolveRuntimeName(step.role);
    if (dynamicRole && !options?.dynamicRoles?.retain(step.role)) {
      statusById.set(step.id, "failed");
      messageById.set(
        step.id,
        `Ephemere Rolle "${step.role}" ist nicht mehr verfügbar.`,
      );
      return;
    }

    controller?.beginStep(step.id);
    let activeRunId: string | undefined;
    let childMayStillRun = false;
    try {
      const spawned = await spawnStep(rpc, step, input.task, options);
      if (!spawned.ok) {
        if (controller?.isStopping()) {
          childMayStillRun = true;
          statusById.set(step.id, "running");
        } else {
          statusById.set(step.id, "failed");
        }
        messageById.set(step.id, spawned.message);
        return;
      }
      if (!spawned.runId) {
        // A successful spawn reply without an ID cannot be checked or stopped.
        // Keep the step and any ephemeral role pinned until its state is known.
        childMayStillRun = true;
        statusById.set(step.id, "running");
        messageById.set(
          step.id,
          `${spawned.message} Terminalstatus unbekannt: Spawn lieferte keine Run-ID.`,
        );
        return;
      }

      activeRunId = spawned.runId;
      controller?.registerChild(step.id, spawned.runId);
      if (controller?.isStopping())
        await stopChildBestEffort(rpc, spawned.runId);
      const outcome = await pollStepUntilTerminal(
        rpc,
        spawned.runId,
        options?.pollOptions,
      );
      if (outcome.timedOut) {
        // A timeout is not proof that the external child stopped. Keep the
        // controller entry and dynamic role alive so /rabbit off and cleanup
        // cannot race a still-running child.
        childMayStillRun = true;
        statusById.set(step.id, "running");
      } else if (outcome.stopped) {
        statusById.set(step.id, "stopped");
      } else {
        statusById.set(step.id, outcome.failed ? "failed" : "completed");
      }
      messageById.set(step.id, outcome.text ?? spawned.message);
    } catch (error) {
      statusById.set(step.id, controller?.isStopping() ? "stopped" : "failed");
      messageById.set(
        step.id,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (!childMayStillRun) {
        if (activeRunId) controller?.completeChild(activeRunId);
        controller?.finishStep(step.id);
        if (dynamicRole) await options?.dynamicRoles?.release(step.role);
      }
    }
  }

  while (true) {
    while (propagateSkips(steps, statusById)) {
      /* cascade failed/stopped prerequisites */
    }
    if (controller?.isStopping()) {
      for (const step of steps) {
        if (statusById.get(step.id) === "pending")
          statusById.set(step.id, "stopped");
      }
    } else {
      const availableSlots = maxParallel - active.size;
      const ready = selectReadySteps(steps, statusById, availableSlots);
      if (ready.length > 1 || active.size > 1)
        controller?.setPhase("branching");
      for (const id of ready) {
        const step = stepById.get(id);
        if (!step) continue;
        const task: Promise<void> = runStep(step).finally(() => {
          active.delete(task);
        });
        active.add(task);
      }
    }
    if (active.size === 0) break;
    await Promise.race(active);
  }

  const results: WorkflowStepResult[] = steps.map((step) => ({
    id: step.id,
    status: statusById.get(step.id) ?? "pending",
    message: messageById.get(step.id),
  }));
  let outcome: RabbitRunOutcome;
  if (
    controller?.isStopping() ||
    results.some((result) => result.status === "stopped")
  ) {
    outcome = "cancelled";
  } else if (results.some((result) => result.status === "failed")) {
    outcome = "failed";
  } else if (
    results.some(
      (result) =>
        result.status === "skipped" ||
        result.status === "pending" ||
        result.status === "running",
    )
  ) {
    outcome = "incomplete";
  } else {
    outcome = "complete";
  }
  const controllerSnapshot = controller?.snapshot();
  const unresolvedChildren = Boolean(
    controllerSnapshot &&
    (controllerSnapshot.activeStepRunIds.length > 0 ||
      controllerSnapshot.activeSteps.length > 0),
  );
  if (!unresolvedChildren) controller?.finish(outcome);
  if (outcome === "complete") return { ok: true, outcome, steps: results };
  return { ok: false, outcome, steps: results };
}
