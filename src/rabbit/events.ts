import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RabbitMode } from "./state.ts";

/**
 * RabbitMode's own event channel. Deliberately not the Aurora state bus
 * (`aurora-ui/state/*`) — RabbitMode never emits there, see
 * `../../docs/spec/02_CONTRACTS.md` and
 * `AGENTS.md` ("Keine Permission-/Verification-/Recovery-Logik duplizieren").
 */
export const RABBIT_MODE_CHANGED_EVENT = "rabbit:mode-changed" as const;

export interface RabbitModeChangedEvent {
  mode: RabbitMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime guard for the untyped shared extension event bus. */
export function isRabbitModeChangedEvent(
  value: unknown,
): value is RabbitModeChangedEvent {
  return (
    isRecord(value) && (value.mode === "off" || value.mode === "active")
  );
}

export function emitRabbitModeChanged(
  pi: Pick<ExtensionAPI, "events">,
  mode: RabbitMode,
): void {
  pi.events.emit(RABBIT_MODE_CHANGED_EVENT, {
    mode,
  } satisfies RabbitModeChangedEvent);
}
