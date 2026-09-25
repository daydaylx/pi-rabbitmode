import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";

/**
 * `spawnBaselineRole` starts an already-installed technical profile by name
 * (only `verifier`; `investigator` and `debugger` were retired in
 * `daydaylx/pi` ADR 031). Everything else runs as a temporary task agent
 * (`temporary-agent.ts`): no role files, no role identity.
 */
export const BASELINE_ROLES = ["verifier"] as const;
export type BaselineRole = (typeof BASELINE_ROLES)[number];

export function isBaselineRole(value: string): value is BaselineRole {
  return (BASELINE_ROLES as readonly string[]).includes(value);
}

export interface SpawnRoleResult {
  ok: boolean;
  message: string;
  /**
   * `details.runId` from a successful spawn reply (`Details` in
   * `~/.pi/agent/git/github.com/daydaylx/pi-subagents/src/shared/
   * types/results.ts`), when present. `spawn` always launches detached/
   * async (`spawnParams()` forces it), so this is the only handle
   * `graph.ts`'s scheduler has to later poll `status` for completion.
   */
  runId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function interpretSpawnReply(
  reply: Awaited<ReturnType<SubagentRpcClient["call"]>>,
  fallbackMessage: string,
): SpawnRoleResult {
  if (!reply.success) {
    return {
      ok: false,
      message: `Spawn fehlgeschlagen (${reply.error.code}): ${reply.error.message}`,
    };
  }
  const data = isRecord(reply.data) ? reply.data : undefined;
  const text = typeof data?.text === "string" ? data.text : undefined;
  const details = isRecord(data?.details) ? data.details : undefined;
  const runId = typeof details?.runId === "string" ? details.runId : undefined;
  return { ok: true, message: text && text.length > 0 ? text : fallbackMessage, runId };
}

/**
 * Times out at the RPC client's own default (currently 800ms) unless
 * overridden — a real spawn (even detached/async) can reasonably take a
 * little longer than the 400ms `/rabbit status` ping uses.
 */
async function spawnByAgentName(
  rpc: SubagentRpcClient,
  agentName: string,
  task: string,
  options?: { timeoutMs?: number; model?: string },
): Promise<SpawnRoleResult> {
  try {
    const reply = await rpc.call(
      "spawn",
      { agent: agentName, task, ...(options?.model ? { model: options.model } : {}) },
      options,
    );
    return interpretSpawnReply(reply, `${agentName} gestartet.`);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function spawnBaselineRole(
  rpc: SubagentRpcClient,
  role: BaselineRole,
  task: string,
  options?: { timeoutMs?: number; model?: string },
): Promise<SpawnRoleResult> {
  return spawnByAgentName(rpc, role, task, options);
}
