import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RabbitStateApi } from "./state.ts";

/** TUI rendering is a read-only projection of Rabbit's published runtime state. */
export const RABBIT_WIDGET_KEY = "rabbit-mode/status";

type RabbitWidgetState = Pick<RabbitStateApi, "mode" | "runtimeSnapshot" | "observedWorkflowPhase">;

export function renderRabbitWidgetLines(state: RabbitWidgetState): string[] | undefined {
  if (state.mode() === "off") return undefined;
  const runtime = state.runtimeSnapshot();
  if (runtime.phase === "idle") {
    const observed = state.observedWorkflowPhase();
    return [`◆ RABBIT · MAX${observed ? ` · ${observed}` : ""}`];
  }
  const active = runtime.activeStepRunIds.length > 0
    ? ` · ${runtime.activeStepRunIds.length} ACTIVE`
    : "";
  return [`◆ RABBIT · MAX · ${runtime.phase.toUpperCase()}${active}`];
}

export function updateRabbitWidget(ctx: Pick<ExtensionContext, "ui">, state: RabbitWidgetState): void {
  ctx.ui.setWidget(RABBIT_WIDGET_KEY, renderRabbitWidgetLines(state));
}
