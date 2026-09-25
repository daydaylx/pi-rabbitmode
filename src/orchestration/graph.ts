import { isBaselineRole } from "./agent-factory.ts";
import { rabbitLimitsFromEnv, TEMPORARY_ROLE, validateRabbitSpec } from "./temporary-agent.ts";

/**
 * Declarative DAG for Phase 8 — `docs/spec/01_ARCHITECTURE.md` §5's
 * example fan-out (permission-/recovery-/architecture-auditor →
 * synthesis) made real. Deliberately not a generic workflow scripting
 * language (`docs/spec/02_CONTRACTS.md`: "Keine beliebige Script-Sprache
 * für Workflowsteuerung") — a fixed JSON shape of steps with
 * dependencies, nothing programmable.
 *
 * Scope for this round: steps reference an already-installed baseline or
 * `pi-rabbitmode`-bundled role by name (`docs/spec/01_ARCHITECTURE.md`
 * §6's priority order — prefer an existing role first). Inline dynamic
 * role definitions (`/rabbit define`'s JSON shape) inside a workflow step
 * are a deliberate follow-up, not built here — combining the two adds a
 * second axis of complexity (per-step ephemeral file lifecycle nested
 * inside the graph's own lifecycle) this round keeps out.
 */
// Defaults (docs/spec/01_ARCHITECTURE.md §7). The effective limits come from
// `rabbitLimitsFromEnv()`, capped by hard ceilings, so they are configurable.
export const MAX_WORKFLOW_STEPS = 12;
export const MAX_PARALLEL_AGENTS_DEFAULT = 3;

export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "stopped";

export type WorkflowStepKind = "analysis" | "synthesis" | "verification";

export interface WorkflowStepDefinition {
  id: string;
  role: string;
  task: string;
  dependsOn?: string[];
  /** Supervisor hint for actual runtime-phase reporting; not a permission. */
  kind?: WorkflowStepKind;
  /**
   * Inline temporary-agent contract for `role: "temporary"` (daydaylx/pi ADR 031).
   * `task` stays a short label for such a step; the spec is the contract. A spec
   * step cannot depend on other steps yet (no context transport for their
   * outputs), but other steps may depend on it.
   */
  spec?: unknown;
}

export type GraphValidation = { valid: true } | { valid: false; error: string };

function isSpawnableRole(role: string): boolean {
  return isBaselineRole(role);
}

/**
 * Kahn's algorithm: repeatedly remove nodes with no remaining incoming
 * edge. Anything left over once no more nodes can be removed is part of a
 * cycle.
 */
function hasCycle(steps: readonly WorkflowStepDefinition[]): boolean {
  const inDegree = new Map<string, number>(steps.map((s) => [s.id, 0]));
  const dependents = new Map<string, string[]>(steps.map((s) => [s.id, []]));
  for (const step of steps) {
    for (const depId of step.dependsOn ?? []) {
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
      dependents.get(depId)?.push(step.id);
    }
  }
  const queue = steps.filter((s) => (inDegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const dependentId of dependents.get(id) ?? []) {
      const next = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, next);
      if (next === 0) queue.push(dependentId);
    }
  }
  return visited !== steps.length;
}

export function validateWorkflowGraph(
  steps: WorkflowStepDefinition[],
): GraphValidation {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { valid: false, error: "Workflow braucht mindestens einen Step." };
  }
  const maxSteps = rabbitLimitsFromEnv().maxSteps;
  if (steps.length > maxSteps) {
    return { valid: false, error: `Zu viele Steps (${steps.length}), Limit ist ${maxSteps}.` };
  }

  const seenIds = new Set<string>();
  for (const step of steps) {
    if (!step.id || typeof step.id !== "string") {
      return { valid: false, error: "Jeder Step braucht eine nicht-leere id." };
    }
    if (seenIds.has(step.id)) {
      return { valid: false, error: `Doppelte Step-id "${step.id}".` };
    }
    seenIds.add(step.id);
    if (!step.task || typeof step.task !== "string") {
      return { valid: false, error: `Step "${step.id}" braucht eine nicht-leere task.` };
    }
    if (step.spec !== undefined && step.role !== TEMPORARY_ROLE) {
      return { valid: false, error: `Step "${step.id}" hat ein spec, aber die Rolle ist nicht "${TEMPORARY_ROLE}".` };
    }
    if (step.role === TEMPORARY_ROLE) {
      const spec = validateRabbitSpec(step.spec);
      if (!spec.ok) {
        return { valid: false, error: `Step "${step.id}": ${spec.error}` };
      }
      if ((step.dependsOn ?? []).length > 0) {
        return {
          valid: false,
          error: `Step "${step.id}": temporäre Agenten können noch nicht von anderen Steps abhängen (kein Kontexttransport); andere Steps dürfen von ihnen abhängen.`,
        };
      }
    } else if (!step.role || !isSpawnableRole(step.role)) {
      return { valid: false, error: `Step "${step.id}" hat eine unbekannte Rolle "${step.role}".` };
    }
    if (step.kind !== undefined && !["analysis", "synthesis", "verification"].includes(step.kind)) {
      return { valid: false, error: `Step "${step.id}" hat einen unbekannten Typ "${step.kind}".` };
    }
  }
  for (const step of steps) {
    for (const depId of step.dependsOn ?? []) {
      if (!seenIds.has(depId)) {
        return { valid: false, error: `Step "${step.id}" hängt von unbekanntem Step "${depId}" ab.` };
      }
      if (depId === step.id) {
        return { valid: false, error: `Step "${step.id}" kann nicht von sich selbst abhängen.` };
      }
    }
  }
  if (hasCycle(steps)) {
    return { valid: false, error: "Abhängigkeiten enthalten einen Zyklus." };
  }
  return { valid: true };
}

/** Steps whose dependencies are all `completed` and are themselves still `pending`, in declaration order, capped at `availableSlots`. */
export function selectReadySteps(
  steps: readonly WorkflowStepDefinition[],
  statusById: ReadonlyMap<string, WorkflowStepStatus>,
  availableSlots: number,
): string[] {
  if (availableSlots <= 0) return [];
  const ready: string[] = [];
  for (const step of steps) {
    if (ready.length >= availableSlots) break;
    if (statusById.get(step.id) !== "pending") continue;
    const deps = step.dependsOn ?? [];
    if (deps.every((depId) => statusById.get(depId) === "completed")) {
      ready.push(step.id);
    }
  }
  return ready;
}

/**
 * Marks every still-`pending` step with a `failed`/`skipped` dependency as
 * `skipped`. Returns whether anything changed, so a caller can re-run it
 * until stable and correctly cascade multi-level chains (A fails → B
 * skipped → C, which depends on B, skipped too) regardless of the
 * declaration order of steps in the input array.
 */
export function propagateSkips(
  steps: readonly WorkflowStepDefinition[],
  statusById: Map<string, WorkflowStepStatus>,
): boolean {
  let changed = false;
  for (const step of steps) {
    if (statusById.get(step.id) !== "pending") continue;
    const deps = step.dependsOn ?? [];
    const blocked = deps.some((depId) => {
      const status = statusById.get(depId);
      return status === "failed" || status === "skipped" || status === "stopped";
    });
    if (blocked) {
      statusById.set(step.id, "skipped");
      changed = true;
    }
  }
  return changed;
}
