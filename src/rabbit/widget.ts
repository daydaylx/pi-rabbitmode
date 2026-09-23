import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RabbitStateApi } from "./state.ts";

/**
 * `daydaylx/pi`'s footer (`extensions/aurora-ui/footer.ts`) has a fixed,
 * closed set of segments — there is no generic extension slot for an
 * arbitrary status key, only `ctx.ui.setWidget`, a separate line rendered
 * above the editor by Aurora itself (still Aurora rendering RabbitMode's
 * state, per `docs/spec/04_RABBIT_TUI.md` — RabbitMode builds no rendering
 * engine of its own). See README.md "Phase 5" for why this widget is
 * event-driven only, with no continuous animation: Aurora's shared motion
 * ticker (`AnimationTicker`/`STATE_VISUALS` in `extensions/aurora-ui/
 * index.ts`) has no public hook for an external package to drive frames
 * through, and the spec hard-forbids a second timer/animation engine
 * (`docs/spec/02_CONTRACTS.md`, "Verboten: ungebremste eigene Timer,
 * mehrere konkurrierende Animation Loops"). This widget updates only in
 * direct response to real state changes (activate/deactivate), never on a
 * clock.
 */
export const RABBIT_WIDGET_KEY = "rabbit-mode/status";

export function renderRabbitWidgetLines(
  state: Pick<RabbitStateApi, "mode" | "observedWorkflowPhase">,
): string[] | undefined {
  if (state.mode() === "off") return undefined;
  const workflow = state.observedWorkflowPhase();
  return [`◆ RABBIT · MAX${workflow ? ` · ${workflow}` : ""}`];
}

export function updateRabbitWidget(
  ctx: Pick<ExtensionContext, "ui">,
  state: Pick<RabbitStateApi, "mode" | "observedWorkflowPhase">,
): void {
  ctx.ui.setWidget(RABBIT_WIDGET_KEY, renderRabbitWidgetLines(state));
}
