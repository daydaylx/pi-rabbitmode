import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createEffortController } from "./effort.ts";
import { emitRabbitModeChanged } from "./events.ts";
import { RABBIT_THEME_NAME, createThemeController } from "./theme.ts";
import { RABBIT_WIDGET_KEY, updateRabbitWidget } from "./widget.ts";

export type RabbitMode = "off" | "active";

/**
 * Read-only mirror of the Aurora state bus, documented in
 * `daydaylx/pi`'s `docs/rabbitmode-status-contract.md`. RabbitMode
 * subscribes to the broadcast channel only — it never emits on
 * `aurora-ui/state/request` (that would steal the shared `sessionEpoch`
 * that Aurora's own provider tags its patches with) and never emits on
 * `aurora-ui/state/patch` or `aurora-ui/state/snapshot` itself.
 */
const AURORA_STATE_PATCH_CHANNEL = "aurora-ui/state/patch";

interface ObservedAuroraPatch {
  permissions?: { level?: string; label?: string };
  workflow?: { phase?: string; label?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/**
 * Deliberately lenient: this only reads the two fields RabbitMode cares
 * about (`permissions`, `workflow`) out of a much larger, versioned
 * payload it does not own. See docs/rabbitmode-status-contract.md.
 */
function readObservedPatch(value: unknown): ObservedAuroraPatch | undefined {
  if (!isRecord(value)) return undefined;
  const patch = value.patch;
  if (!isRecord(patch)) return undefined;

  const result: ObservedAuroraPatch = {};

  const permissions = patch.permissions;
  if (
    isRecord(permissions) &&
    isOptionalString(permissions.level) &&
    isOptionalString(permissions.label)
  ) {
    result.permissions = { level: permissions.level, label: permissions.label };
  }

  const workflow = patch.workflow;
  if (
    isRecord(workflow) &&
    isOptionalString(workflow.phase) &&
    isOptionalString(workflow.label)
  ) {
    result.workflow = { phase: workflow.phase, label: workflow.label };
  }

  return result;
}

export interface RabbitStateApi {
  mode(): RabbitMode;
  /** Last permission level observed on the Aurora bus. Display only. */
  observedPermissionLevel(): string | undefined;
  /** Last workflow phase observed on the Aurora bus. Display only. */
  observedWorkflowPhase(): string | undefined;
  activate(ctx: ExtensionContext): { changed: boolean };
  deactivate(ctx: ExtensionContext): { changed: boolean; blocked: boolean };
  /**
   * Single toggle path shared by `/rabbit` (bare/`toggle`) and the
   * `Super+Alt+R` shortcut (Phase 3) — the contract requires both to use
   * the same code path, not duplicated business logic in the shortcut
   * handler (`docs/spec/02_CONTRACTS.md` §1, `docs/spec/06_TEST_MATRIX.md`
   * §A).
   */
  toggle(ctx: ExtensionContext): { changed: boolean; blocked: boolean };
  /**
   * Phase-2 stub: RabbitMode does not run any agents yet, so there is
   * never an active run to protect. Phase 8+ (workflow graph / nested
   * delegation) replaces this body without changing the signature or any
   * caller.
   */
  hasActiveRun(): boolean;
  /** Bind to `session_start`. */
  reset(): void;
  /**
   * Bind to `session_shutdown`. `ctx` is available there too (unlike
   * `session_start`, where nothing needs restoring yet) — passing it lets a
   * still-active RabbitMode clean up its theme/widget instead of leaking
   * them into whatever comes next (`reload`, `resume`, `new`, `fork` all
   * keep the same process running).
   */
  dispose(ctx?: ExtensionContext): void;
}

export function createRabbitState(pi: ExtensionAPI): RabbitStateApi {
  let mode: RabbitMode = "off";
  let observedPermissionLevel: string | undefined;
  let observedWorkflowPhase: string | undefined;
  let unsubscribe: (() => void) | undefined;
  const effort = createEffortController(pi);
  const theme = createThemeController();

  function subscribeAuroraPatches(): void {
    unsubscribe?.();
    unsubscribe = pi.events.on(AURORA_STATE_PATCH_CHANNEL, (value) => {
      const observed = readObservedPatch(value);
      if (!observed) return;
      if (observed.permissions?.level !== undefined) {
        observedPermissionLevel = observed.permissions.level;
      }
      if (observed.workflow?.phase !== undefined) {
        observedWorkflowPhase = observed.workflow.phase;
      }
    });
  }

  const api: RabbitStateApi = {
    mode: () => mode,
    observedPermissionLevel: () => observedPermissionLevel,
    observedWorkflowPhase: () => observedWorkflowPhase,

    hasActiveRun: () => false,

    activate(ctx) {
      if (mode === "active") {
        ctx.ui.notify("RabbitMode ist bereits aktiv.", "info");
        return { changed: false };
      }
      const effortResult = effort.applyMax(ctx);
      if (!effortResult.supported) {
        ctx.ui.notify(effortResult.reason, "warning");
        return { changed: false };
      }
      mode = "active";
      const themeResult = theme.apply(ctx);
      updateRabbitWidget(ctx, api);
      emitRabbitModeChanged(pi, mode);
      ctx.ui.notify(
        themeResult.switched
          ? "RabbitMode aktiviert (MAX Thinking erzwungen — Grundgerüst, noch keine Orchestrierung)."
          : `RabbitMode aktiviert, aber Theme "${RABBIT_THEME_NAME}" konnte nicht geladen werden (${themeResult.error ?? "unbekannter Fehler"}).`,
        "info",
      );
      return { changed: true };
    },

    deactivate(ctx) {
      if (api.hasActiveRun()) {
        ctx.ui.notify(
          "RabbitMode läuft gerade — erst /rabbit stop verwenden.",
          "warning",
        );
        return { changed: false, blocked: true };
      }
      if (mode === "off") {
        ctx.ui.notify("RabbitMode ist bereits aus.", "info");
        return { changed: false, blocked: false };
      }
      mode = "off";
      effort.restore();
      theme.restore(ctx);
      ctx.ui.setWidget(RABBIT_WIDGET_KEY, undefined);
      emitRabbitModeChanged(pi, mode);
      ctx.ui.notify(
        "RabbitMode deaktiviert (vorherige Thinking-Stufe und Theme wiederhergestellt).",
        "info",
      );
      return { changed: true, blocked: false };
    },

    toggle(ctx) {
      return mode === "off"
        ? { ...api.activate(ctx), blocked: false }
        : api.deactivate(ctx);
    },

    reset() {
      mode = "off";
      observedPermissionLevel = undefined;
      observedWorkflowPhase = undefined;
      effort.reset();
      theme.reset();
      subscribeAuroraPatches();
    },

    dispose(ctx) {
      unsubscribe?.();
      unsubscribe = undefined;
      // `session_shutdown` fires for `reload`/`resume`/`new`/`fork` too, not
      // just `quit` — the process (and this extension instance) keeps
      // running, so a still-forced max level or swapped theme would
      // otherwise leak into whatever session comes next.
      effort.restore();
      if (ctx) {
        theme.restore(ctx);
        ctx.ui.setWidget(RABBIT_WIDGET_KEY, undefined);
      }
      effort.reset();
      theme.reset();
    },
  };

  return api;
}
