import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

/**
 * `pi.getThinkingLevel()`/`setThinkingLevel()` type their level with
 * `@earendil-works/pi-agent-core`'s 7-value `ThinkingLevel` (includes
 * `"off"`), not `@earendil-works/pi-ai`'s same-named but narrower
 * 6-value type. Deriving it from the API itself avoids depending on
 * either package's exact type name/shape directly.
 */
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

/**
 * `pi.setThinkingLevel()` is documented to clamp silently to whatever the
 * current model supports — exactly the "silent max -> high fallback" the
 * spec forbids (`docs/spec/02_CONTRACTS.md` §3: "Es gibt keinen stillen
 * Fallback von `max` auf `high`"). RabbitMode therefore checks capability
 * itself, with `getSupportedThinkingLevels` from `@earendil-works/pi-ai`
 * (the same function `extensions/permissions/thinking-control.ts` in
 * `daydaylx/pi` uses, there only to filter a menu), *before* ever calling
 * `setThinkingLevel("max")`, and rejects activation outright if the
 * current model can't do `max` rather than silently asking for less.
 */
export type MaxThinkingCheck =
  | { supported: true }
  | { supported: false; reason: string };

export function checkMaxThinkingSupported(
  ctx: Pick<ExtensionContext, "model">,
): MaxThinkingCheck {
  const model = ctx.model;
  if (!model) {
    return {
      supported: false,
      reason:
        "RABBIT_MODEL_INCOMPATIBLE: kein Modell ausgewählt, requiredThinking: max",
    };
  }
  const supported = getSupportedThinkingLevels(model);
  if (!supported.includes("max")) {
    return {
      supported: false,
      reason: `RABBIT_MODEL_INCOMPATIBLE: Modell "${model.id}" unterstützt kein max-Thinking, requiredThinking: max`,
    };
  }
  return { supported: true };
}

export interface RabbitEffortController {
  /**
   * Checks model capability and, only if it supports `max`, remembers the
   * current thinking level and forces `max`. Never calls
   * `setThinkingLevel` on an incompatible model — there is no level
   * between "forced max" and "reject" for RabbitMode to fall back to.
   */
  applyMax(ctx: ExtensionContext): MaxThinkingCheck;
  /** Restores the level remembered by the last successful `applyMax`, if any. */
  restore(): void;
  /** Bind to `session_start`/`session_shutdown`: drops any pending restore. */
  reset(): void;
}

export function createEffortController(
  pi: ExtensionAPI,
): RabbitEffortController {
  let previousLevel: ThinkingLevel | undefined;

  return {
    applyMax(ctx) {
      const check = checkMaxThinkingSupported(ctx);
      if (!check.supported) return check;
      previousLevel = pi.getThinkingLevel();
      pi.setThinkingLevel("max");
      return { supported: true };
    },

    restore() {
      if (previousLevel === undefined) return;
      pi.setThinkingLevel(previousLevel);
      previousLevel = undefined;
    },

    reset() {
      previousLevel = undefined;
    },
  };
}
