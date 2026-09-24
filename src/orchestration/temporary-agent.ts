import type { SubagentRpcClient } from "../runtime/subagents-rpc.ts";

/**
 * Temporary task agents for Rabbit (daydaylx/pi ADR 031).
 *
 * Rabbit uses the same runtime contract as normal Pi: a `spec` handed to the
 * `pi-subagents` v1 `spawn` RPC. The runtime builds an in-memory, stateless
 * agent (no role file, no memory, fresh context, no delegation) and decides the
 * effective tools. Rabbit adds orchestration, never rights:
 *
 * - orchestration capability != permission capability — Rabbit may plan and
 *   fan out more, but a Rabbit spec is still limited to read/search;
 * - `verify` is refused here, the RPC path bypasses the host's verifier chain
 *   (ticket, dedup, commit gate);
 * - only whitelisted spec fields are forwarded, so nothing unvalidated reaches
 *   the runtime.
 */

/** `WorkflowStepDefinition.role` value for a step that carries an inline `spec`. */
export const TEMPORARY_ROLE = "temporary";

export const RABBIT_SPEC_PROFILES = ["analyse", "research"] as const;
export type RabbitSpecProfile = (typeof RABBIT_SPEC_PROFILES)[number];

const RABBIT_SPEC_CAPABILITIES = ["read", "search"] as const;
const MODEL_CLASSES = ["fast", "cheap", "strong", "independent"] as const;
const CONCRETE_MODEL = /^[\w.-]+\/[\w.:@-]+$/;

const LIMITS = { objective: 2000, reason: 500, item: 500, items: 20 } as const;

export interface RabbitTemporarySpec {
  objective: string;
  profile: RabbitSpecProfile;
  delegationReason: string;
  context?: string[];
  scope?: { include?: string[]; exclude?: string[] };
  expectedOutput?: string[];
  requestedCapabilities?: Array<(typeof RABBIT_SPEC_CAPABILITIES)[number]>;
  modelPreference?: string;
  constraints?: string[];
}

export type RabbitSpecValidation =
  | { ok: true; spec: RabbitTemporarySpec }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, field: string): string[] | undefined | Error {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > LIMITS.items) {
    return new Error(`${field} muss ein Array mit höchstens ${LIMITS.items} Einträgen sein.`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "" || item.length > LIMITS.item) {
      return new Error(`${field}: Einträge müssen nicht-leere Strings bis ${LIMITS.item} Zeichen sein.`);
    }
    out.push(item.trim());
  }
  return out;
}

export function validateRabbitSpec(raw: unknown): RabbitSpecValidation {
  if (!isRecord(raw)) return { ok: false, error: "spec muss ein Objekt sein." };
  const known = new Set([
    "objective", "profile", "delegationReason", "context", "scope",
    "expectedOutput", "requestedCapabilities", "modelPreference", "constraints",
  ]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) return { ok: false, error: `Unbekanntes spec-Feld "${key}".` };
  }

  const objective = typeof raw.objective === "string" ? raw.objective.trim() : "";
  if (!objective || objective.length > LIMITS.objective) {
    return { ok: false, error: `spec.objective ist Pflicht (höchstens ${LIMITS.objective} Zeichen).` };
  }
  const reason = typeof raw.delegationReason === "string" ? raw.delegationReason.trim() : "";
  if (!reason || reason.length > LIMITS.reason) {
    return { ok: false, error: `spec.delegationReason ist Pflicht (höchstens ${LIMITS.reason} Zeichen).` };
  }
  if (raw.profile === "verify") {
    return {
      ok: false,
      error: "Profil verify ist für Rabbit-Specs gesperrt (Verifier-Kette läuft nur über den Host-Guard).",
    };
  }
  if (!(RABBIT_SPEC_PROFILES as readonly string[]).includes(raw.profile as string)) {
    return { ok: false, error: `spec.profile muss ${RABBIT_SPEC_PROFILES.join(" oder ")} sein.` };
  }

  const context = stringList(raw.context, "spec.context");
  const expectedOutput = stringList(raw.expectedOutput, "spec.expectedOutput");
  const constraints = stringList(raw.constraints, "spec.constraints");
  for (const value of [context, expectedOutput, constraints]) {
    if (value instanceof Error) return { ok: false, error: value.message };
  }

  let scope: RabbitTemporarySpec["scope"];
  if (raw.scope !== undefined) {
    if (!isRecord(raw.scope)) return { ok: false, error: "spec.scope muss ein Objekt sein." };
    const include = stringList(raw.scope.include, "spec.scope.include");
    const exclude = stringList(raw.scope.exclude, "spec.scope.exclude");
    for (const value of [include, exclude]) {
      if (value instanceof Error) return { ok: false, error: value.message };
    }
    for (const key of Object.keys(raw.scope)) {
      if (key !== "include" && key !== "exclude") {
        return { ok: false, error: `Unbekanntes spec.scope-Feld "${key}".` };
      }
    }
    scope = {
      ...(include ? { include: include as string[] } : {}),
      ...(exclude ? { exclude: exclude as string[] } : {}),
    };
  }

  let requestedCapabilities: RabbitTemporarySpec["requestedCapabilities"];
  if (raw.requestedCapabilities !== undefined) {
    const list = stringList(raw.requestedCapabilities, "spec.requestedCapabilities");
    if (list instanceof Error) return { ok: false, error: list.message };
    const bad = (list ?? []).filter(
      (c) => !(RABBIT_SPEC_CAPABILITIES as readonly string[]).includes(c),
    );
    if (bad.length > 0) {
      return {
        ok: false,
        error: `Rabbit-Specs dürfen nur ${RABBIT_SPEC_CAPABILITIES.join(", ")} anfordern (nicht: ${bad.join(", ")}). Orchestrierung erweitert keine Rechte.`,
      };
    }
    requestedCapabilities = [...new Set(list)] as RabbitTemporarySpec["requestedCapabilities"];
  }

  let modelPreference: string | undefined;
  if (raw.modelPreference !== undefined) {
    const pref = typeof raw.modelPreference === "string" ? raw.modelPreference.trim() : "";
    if (!(MODEL_CLASSES as readonly string[]).includes(pref) && !CONCRETE_MODEL.test(pref)) {
      return {
        ok: false,
        error: `spec.modelPreference muss ${MODEL_CLASSES.join(", ")} oder provider/model sein.`,
      };
    }
    modelPreference = pref;
  }

  return {
    ok: true,
    spec: {
      objective,
      profile: raw.profile as RabbitSpecProfile,
      delegationReason: reason,
      ...(context ? { context: context as string[] } : {}),
      ...(scope ? { scope } : {}),
      ...(expectedOutput ? { expectedOutput: expectedOutput as string[] } : {}),
      ...(requestedCapabilities ? { requestedCapabilities } : {}),
      ...(modelPreference ? { modelPreference } : {}),
      ...(constraints ? { constraints: constraints as string[] } : {}),
    },
  };
}

export interface TemporarySpawnResult {
  ok: boolean;
  message: string;
  runId?: string;
}

/**
 * Spawns one temporary agent through the v1 `spawn` RPC. `options.model` is
 * Rabbit's own orchestration choice (MAX thinking); it is set by Rabbit code,
 * never taken from the spec, and still passes the runtime's model scope.
 */
export async function spawnTemporaryAgent(
  rpc: Pick<SubagentRpcClient, "call">,
  rawSpec: unknown,
  options?: { timeoutMs?: number; model?: string },
): Promise<TemporarySpawnResult> {
  const validated = validateRabbitSpec(rawSpec);
  if (!validated.ok) return { ok: false, message: validated.error };
  try {
    const reply = await rpc.call(
      "spawn",
      { spec: validated.spec, ...(options?.model ? { model: options.model } : {}) },
      options?.timeoutMs === undefined ? undefined : { timeoutMs: options.timeoutMs },
    );
    if (!reply.success) {
      return {
        ok: false,
        message: `Spawn fehlgeschlagen (${reply.error.code}): ${reply.error.message}`,
      };
    }
    const data = isRecord(reply.data) ? reply.data : undefined;
    const details = isRecord(data?.details) ? data.details : undefined;
    const text = typeof data?.text === "string" && data.text.length > 0 ? data.text : undefined;
    return {
      ok: true,
      message: text ?? "Temporärer Agent gestartet.",
      runId: typeof details?.runId === "string" ? details.runId : undefined,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Rabbit orchestration limits. Hard ceilings keep a misconfiguration from becoming a swarm. */
export interface RabbitLimits {
  maxSteps: number;
  maxParallel: number;
  maxDepth: number;
}

export const RABBIT_LIMIT_DEFAULTS: RabbitLimits = { maxSteps: 12, maxParallel: 3, maxDepth: 2 };
export const RABBIT_LIMIT_CEILINGS: RabbitLimits = { maxSteps: 24, maxParallel: 5, maxDepth: 3 };

export function resolveRabbitLimits(raw?: Partial<Record<keyof RabbitLimits, unknown>>): RabbitLimits {
  const pick = (key: keyof RabbitLimits): number => {
    const value = raw?.[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return RABBIT_LIMIT_DEFAULTS[key];
    }
    return Math.min(value, RABBIT_LIMIT_CEILINGS[key]);
  };
  return { maxSteps: pick("maxSteps"), maxParallel: pick("maxParallel"), maxDepth: pick("maxDepth") };
}
