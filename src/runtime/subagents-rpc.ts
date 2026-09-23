import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Client for `pi-subagents`' existing v1 EventBus RPC
 * (`~/.pi/agent/git/github.com/daydaylx/pi-subagents/src/extension/rpc.ts`
 * in the pinned runtime, read there directly — `pi-subagents`' own
 * package.json has no `exports`/`main`/`types` field, so these constants
 * and shapes are hardcoded and documented here, the same pattern already
 * used for `daydaylx/pi`'s Aurora state-bus contract (see
 * `src/rabbit/state.ts` and `daydaylx/pi`'s
 * `docs/rabbitmode-status-contract.md`), never imported across the
 * repository boundary (`docs/spec/03_REPOSITORY_BOUNDARIES.md`: "Keine
 * privaten Imports, wenn öffentliche Extension APIs existieren" — here,
 * the bus *is* the public API; there is no importable module).
 *
 * Phase 6 scope only: `ping` (capability/liveness check) and the generic
 * `call()` primitive `status`/`spawn`/`interrupt`/`stop` will build on in
 * later phases. Nothing here spawns or tracks a real run yet.
 */
export const SUBAGENT_RPC_PROTOCOL_VERSION = 1 as const;
export const SUBAGENT_RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
export const SUBAGENT_RPC_READY_EVENT = "subagents:rpc:v1:ready";
export const SUBAGENT_RPC_REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";

export const SUBAGENT_RPC_METHODS = [
  "ping",
  "status",
  "spawn",
  "interrupt",
  "stop",
] as const;
export type SubagentRpcMethod = (typeof SUBAGENT_RPC_METHODS)[number];

export function subagentRpcReplyEvent(requestId: string): string {
  return `${SUBAGENT_RPC_REPLY_EVENT_PREFIX}${requestId}`;
}

export interface SubagentRpcRequestEnvelope {
  version: typeof SUBAGENT_RPC_PROTOCOL_VERSION;
  requestId: string;
  method: SubagentRpcMethod;
  params?: unknown;
  source?: { extension?: string; [key: string]: unknown };
}

export type SubagentRpcReplyEnvelope<T = unknown> =
  | {
      version: typeof SUBAGENT_RPC_PROTOCOL_VERSION;
      requestId: string;
      method?: SubagentRpcMethod;
      success: true;
      data: T;
    }
  | {
      version: typeof SUBAGENT_RPC_PROTOCOL_VERSION;
      requestId: string;
      method?: SubagentRpcMethod;
      success: false;
      error: { code: string; message: string };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime guard for the untyped shared extension event bus. */
export function isSubagentRpcReplyEnvelope(
  value: unknown,
): value is SubagentRpcReplyEnvelope {
  if (!isRecord(value)) return false;
  if (value.version !== SUBAGENT_RPC_PROTOCOL_VERSION) return false;
  if (typeof value.requestId !== "string") return false;
  if (value.success === true) return "data" in value;
  if (value.success === false) {
    const error = value.error;
    return (
      isRecord(error) &&
      typeof error.code === "string" &&
      typeof error.message === "string"
    );
  }
  return false;
}

/** `pi-subagents`' own capability payload shape, from `pingData()` in rpc.ts. */
export interface SubagentRpcPingData {
  version: number;
  methods: string[];
  capabilities: {
    status: boolean;
    asyncSpawn: boolean;
    interrupt: boolean;
    stop: boolean;
  };
  events: { ready: string; request: string; replyPrefix: string };
  session: { cwd?: string; sessionId?: string; sessionFile?: string | null };
}

export class SubagentRpcTimeoutError extends Error {
  constructor(method: SubagentRpcMethod, timeoutMs: number) {
    super(
      `RabbitMode: subagents RPC "${method}" timed out after ${timeoutMs}ms — ` +
        `pi-subagents is not installed, not loaded, or not responding.`,
    );
    this.name = "SubagentRpcTimeoutError";
  }
}

const DEFAULT_TIMEOUT_MS = 800;
let requestCounter = 0;

function nextRequestId(): string {
  requestCounter += 1;
  return `rabbit-${Date.now().toString(36)}-${requestCounter}`;
}

export interface SubagentRpcClient {
  /**
   * Sends a request and resolves with the correlated reply, or rejects
   * with `SubagentRpcTimeoutError` if nothing replies in time — the only
   * way to detect "pi-subagents isn't there" on a bus with no ACL and no
   * synchronous existence check (`docs/spec/10_INTEGRATION_PLAN.md`,
   * "Capability Handshake").
   */
  call<T = unknown>(
    method: SubagentRpcMethod,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<SubagentRpcReplyEnvelope<T>>;
  /** Convenience wrapper: `call("ping")` typed to the known ping payload. */
  ping(timeoutMs?: number): Promise<SubagentRpcReplyEnvelope<SubagentRpcPingData>>;
}

export function createSubagentRpcClient(
  pi: Pick<ExtensionAPI, "events">,
): SubagentRpcClient {
  function call<T>(
    method: SubagentRpcMethod,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<SubagentRpcReplyEnvelope<T>> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const requestId = nextRequestId();

    return new Promise((resolve, reject) => {
      let settled = false;
      const unsubscribe = pi.events.on(
        subagentRpcReplyEvent(requestId),
        (raw) => {
          if (settled || !isSubagentRpcReplyEnvelope(raw)) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe?.();
          resolve(raw as SubagentRpcReplyEnvelope<T>);
        },
      );
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe?.();
        reject(new SubagentRpcTimeoutError(method, timeoutMs));
      }, timeoutMs);

      const envelope: SubagentRpcRequestEnvelope = {
        version: SUBAGENT_RPC_PROTOCOL_VERSION,
        requestId,
        method,
        ...(params !== undefined ? { params } : {}),
        source: { extension: "pi-rabbitmode" },
      };
      pi.events.emit(SUBAGENT_RPC_REQUEST_EVENT, envelope);
    });
  }

  return {
    call,
    ping: (timeoutMs) => call<SubagentRpcPingData>("ping", undefined, { timeoutMs }),
  };
}
