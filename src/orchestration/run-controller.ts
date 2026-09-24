import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";

export const RABBIT_RUNTIME_STATE_EVENT = "rabbit:runtime-state" as const;

export type RabbitRuntimePhase =
  | "idle"
  | "planning"
  | "orchestrating"
  | "branching"
  | "synthesizing"
  | "replanning"
  | "verifying"
  | "stopping"
  | "completed"
  | "incomplete"
  | "failed"
  | "cancelled"
  | "blocked";

export type RabbitRunOutcome = "complete" | "incomplete" | "failed" | "cancelled" | "blocked";

export interface RabbitRunSnapshot {
  phase: RabbitRuntimePhase;
  runId?: string;
  activeStepRunIds: string[];
  activeSteps: string[];
  startedAt?: number;
  workflowRevision?: number;
  outcome?: RabbitRunOutcome;
}

export interface RabbitRunController {
  snapshot(): RabbitRunSnapshot;
  isActive(): boolean;
  isStopping(): boolean;
  setPlanning(): void;
  beginRevision(revision: number): { ok: true; runId: string } | { ok: false; error: string };
  setPhase(phase: Exclude<RabbitRuntimePhase, "idle" | "stopping" | "completed" | "incomplete" | "failed" | "cancelled" | "blocked">): void;
  beginStep(stepId: string): void;
  registerChild(stepId: string, runId: string): void;
  finishStep(stepId: string): void;
  completeChild(runId: string): void;
  requestStop(): { runId: string; activeStepRunIds: string[]; activeSteps: string[] } | undefined;
  finish(outcome: RabbitRunOutcome): void;
  waitForSettled(timeoutMs?: number): Promise<boolean>;
  reset(): void;
}

const ACTIVE_PHASES = new Set<RabbitRuntimePhase>([
  "planning",
  "orchestrating",
  "branching",
  "synthesizing",
  "replanning",
  "verifying",
  "stopping",
]);

let runCounter = 0;

function newRunId(): string {
  runCounter += 1;
  return `rabbit-${Date.now().toString(36)}-${runCounter}`;
}

function cloneSnapshot(snapshot: RabbitRunSnapshot): RabbitRunSnapshot {
  return {
    ...snapshot,
    activeStepRunIds: [...snapshot.activeStepRunIds],
    activeSteps: [...snapshot.activeSteps],
  };
}

export function createRabbitRunController(
  events?: Pick<ExtensionAPI, "events">,
): RabbitRunController {
  let state: RabbitRunSnapshot = {
    phase: "idle",
    activeStepRunIds: [],
    activeSteps: [],
  };
  let stopping = false;
  const children = new Map<string, string>();
  const startingSteps = new Set<string>();
  const settleWaiters = new Set<() => void>();

  function notifySettled(): void {
    if (ACTIVE_PHASES.has(state.phase)) return;
    for (const resolve of settleWaiters) resolve();
    settleWaiters.clear();
  }

  function publish(): void {
    events?.events.emit(RABBIT_RUNTIME_STATE_EVENT, cloneSnapshot(state));
  }

  function update(patch: Partial<RabbitRunSnapshot>): void {
    state = { ...state, ...patch };
    publish();
  }

  function syncChildren(): void {
    update({
      activeStepRunIds: [...children.keys()],
      activeSteps: [...new Set([...startingSteps, ...children.values()])],
    });
  }

  return {
    snapshot: () => cloneSnapshot(state),
    isActive: () => ACTIVE_PHASES.has(state.phase),
    isStopping: () => stopping || state.phase === "stopping",

    setPlanning() {
      if (this.isActive()) return;
      stopping = false;
      children.clear();
      startingSteps.clear();
      state = {
        phase: "planning",
        runId: newRunId(),
        activeStepRunIds: [],
        activeSteps: [],
        startedAt: Date.now(),
      };
      publish();
    },

    beginRevision(revision) {
      if (this.isActive() && state.phase !== "planning") {
        return { ok: false, error: "Ein Rabbit-Run ist bereits aktiv." };
      }
      if (!Number.isInteger(revision) || revision < 1) {
        return { ok: false, error: "Ungültige Workflow-Revision." };
      }
      const continueExisting = (revision > 1 || state.phase === "planning") && Boolean(state.runId);
      stopping = false;
      children.clear();
      startingSteps.clear();
      state = {
        phase: revision > 1 ? "replanning" : "orchestrating",
        runId: continueExisting ? state.runId : newRunId(),
        activeStepRunIds: [],
        activeSteps: [],
        startedAt: continueExisting ? state.startedAt : Date.now(),
        workflowRevision: revision,
      };
      publish();
      return { ok: true, runId: state.runId! };
    },

    setPhase(phase) {
      if (!this.isActive() || this.isStopping()) return;
      update({ phase });
    },

    beginStep(stepId) {
      startingSteps.add(stepId);
      syncChildren();
    },

    registerChild(stepId, runId) {
      startingSteps.delete(stepId);
      children.set(runId, stepId);
      syncChildren();
    },

    finishStep(stepId) {
      startingSteps.delete(stepId);
      for (const [runId, activeStep] of children) {
        if (activeStep === stepId) children.delete(runId);
      }
      syncChildren();
    },

    completeChild(runId) {
      if (children.delete(runId)) syncChildren();
    },

    requestStop() {
      if (!this.isActive() || !state.runId) return undefined;
      stopping = true;
      update({ phase: "stopping" });
      return {
        runId: state.runId,
        activeStepRunIds: [...children.keys()],
        activeSteps: [...new Set([...startingSteps, ...children.values()])],
      };
    },

    finish(outcome) {
      stopping = outcome === "cancelled";
      const phase: RabbitRuntimePhase = outcome === "complete"
        ? "completed"
        : outcome === "incomplete"
          ? "incomplete"
          : outcome;
      children.clear();
      startingSteps.clear();
      update({ phase, activeStepRunIds: [], activeSteps: [], outcome });
      notifySettled();
    },

    waitForSettled(timeoutMs = 15_000) {
      if (!this.isActive()) return Promise.resolve(true);
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          settleWaiters.delete(onSettled);
          resolve(value);
        };
        const onSettled = () => finish(true);
        const timer = setTimeout(() => finish(!this.isActive()), timeoutMs);
        settleWaiters.add(onSettled);
      });
    },

    reset() {
      stopping = false;
      children.clear();
      startingSteps.clear();
      state = { phase: "idle", activeStepRunIds: [], activeSteps: [] };
      publish();
      notifySettled();
    },
  };
}

export interface StopRunResult {
  stopped: boolean;
  requested: number;
  pending: number;
  errors: string[];
}

/**
 * Stop top-level async child runs through the public pi-subagents RPC.
 * The RPC's `stop` action is preferred because `interrupt` alone leaves a
 * child paused; interruption is only a fallback when stop itself fails.
 */
export async function stopRabbitRun(
  rpc: SubagentRpcClient,
  controller: RabbitRunController,
): Promise<StopRunResult> {
  const target = controller.requestStop();
  if (!target) return { stopped: false, requested: 0, pending: 0, errors: [] };
  if (target.activeStepRunIds.length === 0 && target.activeSteps.length === 0) {
    controller.finish("cancelled");
  }

  const results = await Promise.all(target.activeStepRunIds.map(async (id) => {
    try {
      const reply = await rpc.call("stop", { id });
      if (reply.success) return undefined;
      if (reply.error.code === "not_found" || reply.error.code === "invalid_state") return undefined;
      const fallback = await rpc.call("interrupt", { id });
      if (fallback.success) {
        return `${id}: stop ${reply.error.code}; interrupt accepted (run may be paused, not terminated)`;
      }
      if (fallback.error.code === "not_found" || fallback.error.code === "invalid_state") return undefined;
      return `${id}: stop ${reply.error.code}; interrupt ${fallback.error.code}`;
    } catch (error) {
      try {
        const fallback = await rpc.call("interrupt", { id });
        if (fallback.success) {
          return `${id}: stop RPC unavailable; interrupt accepted (run may be paused, not terminated)`;
        }
        if (["not_found", "invalid_state"].includes(fallback.error.code)) return undefined;
        return `${id}: ${fallback.error.message}`;
      } catch (fallbackError) {
        return `${id}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
      }
    }
  }));

  return {
    stopped: true,
    requested: target.activeStepRunIds.length,
    pending: Math.max(0, target.activeSteps.length - target.activeStepRunIds.length),
    errors: results.filter((value): value is string => value !== undefined),
  };
}
