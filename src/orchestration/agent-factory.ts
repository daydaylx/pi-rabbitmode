import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";
import { RABBIT_MAX_SUBAGENT_DEPTH, type DynamicRoleRegistry } from "./dynamic-role.ts";

/**
 * Two ways to get a running agent under RabbitMode:
 *
 * 1. `spawnBaselineRole` — an already-installed role by name
 *    (`docs/spec/01_ARCHITECTURE.md` §6's first priority: prefer an
 *    existing role). The three baseline roles this project itself relies
 *    on (`docs/decisions/011-investigator-debugger-verifier.md` in
 *    `daydaylx/pi`), routed through the v1 `spawn` RPC Phase 6 built.
 * 2. `spawnDynamicRole` — a genuinely new, ad-hoc role the Root Supervisor
 *    defines at runtime. `pi-subagents`' spawn RPC itself still only
 *    accepts an `agent` *name* referencing an installed role
 *    (`SubagentParamsSchema` in `~/.pi/agent/git/github.com/daydaylx/
 *    pi-subagents/src/extension/schemas.ts`) — there is no inline
 *    definition field. `dynamic-role.ts` closes that gap the only way
 *    that's actually possible: write the role as a project-local
 *    `.pi/agents/rabbit-dynamic/*.md` file (which `pi-subagents`' own
 *    discovery already reads), spawn it by its generated name, then
 *    delete the file. See that module's docs for the safety envelope
 *    (read-only tool allowlist, frontmatter-injection guards, per-session
 *    cap) — this is a deliberate, explicit exception to the V1 non-goal
 *    "keine automatische persistente Agent-Dateien", not an oversight.
 */
export const BASELINE_ROLES = ["investigator", "debugger", "verifier"] as const;
export type BaselineRole = (typeof BASELINE_ROLES)[number];

export function isBaselineRole(value: string): value is BaselineRole {
  return (BASELINE_ROLES as readonly string[]).includes(value);
}

/**
 * Roles `pi-rabbitmode` ships itself under `agents/` (Phase 7b), matching
 * the example fan-out DAG in `docs/spec/01_ARCHITECTURE.md` §5
 * (permission-/recovery-/architecture-auditor → SYNTHESIS). Discovered by
 * `pi-subagents` via the `pi.subagents.agents` manifest key
 * (`package.json`) and namespaced `rabbitmode.<name>` there
 * (`package: rabbitmode` frontmatter, see `identity.ts`'s
 * `buildRuntimeName` in the pinned `pi-subagents` clone) so they can never
 * collide with a project's own role of the same local name.
 */
export const RABBIT_BUNDLED_ROLES = [
  "permission-auditor",
  "recovery-auditor",
  "architecture-auditor",
] as const;
export type RabbitBundledRole = (typeof RABBIT_BUNDLED_ROLES)[number];

export function isRabbitBundledRole(value: string): value is RabbitBundledRole {
  return (RABBIT_BUNDLED_ROLES as readonly string[]).includes(value);
}

export function rabbitBundledRoleRuntimeName(role: RabbitBundledRole): string {
  return `rabbitmode.${role}`;
}

export { RABBIT_MAX_SUBAGENT_DEPTH };

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

export function spawnRabbitBundledRole(
  rpc: SubagentRpcClient,
  role: RabbitBundledRole,
  task: string,
  options?: { timeoutMs?: number; model?: string },
): Promise<SpawnRoleResult> {
  return spawnByAgentName(rpc, rabbitBundledRoleRuntimeName(role), task, options);
}

/**
 * Validates and writes the role file via `registry.define`, spawns it,
 * and cleans the file back up immediately if either step fails — an
 * ephemeral role that never successfully ran leaves nothing behind.
 */
export async function spawnDynamicRole(
  rpc: SubagentRpcClient,
  registry: DynamicRoleRegistry,
  cwd: string,
  rawRequestJson: unknown,
  options?: { timeoutMs?: number; model?: string },
): Promise<SpawnRoleResult> {
  const defined = await registry.define(cwd, rawRequestJson);
  if (!defined.ok) return { ok: false, message: defined.error };
  const { role, task } = defined;
  if (!task) {
    await registry.cleanup(role.id);
    return { ok: false, message: `Rolle "${role.id}" braucht für /rabbit define einen task.` };
  }

  try {
    const reply = await rpc.call(
      "spawn",
      { agent: role.runtimeName, task, ...(options?.model ? { model: options.model } : {}) },
      options,
    );
    const result = interpretSpawnReply(reply, `${role.runtimeName} gestartet.`);
    if (!result.ok) await registry.cleanup(role.id);
    return result;
  } catch (error) {
    await registry.cleanup(role.id);
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
