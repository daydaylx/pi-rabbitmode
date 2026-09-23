import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Session-local "Blue Shift" identity, mirroring the exact remember/restore
 * pattern `extensions/aurora-ui/index.ts` in `daydaylx/pi` already uses for
 * its own theme selection at session start/end (see
 * `docs/rabbitmode-status-contract.md` neighbourhood in that repo) — never
 * written to settings.json, always restored to whatever was active before
 * `/rabbit on`.
 *
 * A failed theme switch (package not installed, name typo, stale cache) is
 * treated as a cosmetic-only degradation: it does not block activation,
 * because the theme is decoration, not a safety or functional boundary —
 * unlike the MAX-thinking capability check in effort.ts, which does block.
 */
export const RABBIT_THEME_NAME = "aurora-rabbit";

export interface RabbitThemeController {
  /** Remembers the current theme name and switches to `aurora-rabbit`. */
  apply(ctx: ExtensionContext): { switched: boolean; error?: string };
  /** Restores the theme remembered by the last successful `apply`, if any. */
  restore(ctx: ExtensionContext): void;
  /** Bind to `session_start`/`session_shutdown`: drops any pending restore. */
  reset(): void;
}

export function createThemeController(): RabbitThemeController {
  let previousThemeName: string | undefined;

  return {
    apply(ctx) {
      const current = ctx.ui.theme.name;
      const result = ctx.ui.setTheme(RABBIT_THEME_NAME);
      if (!result.success) {
        return { switched: false, error: result.error };
      }
      previousThemeName = current;
      return { switched: true };
    },

    restore(ctx) {
      if (previousThemeName === undefined) return;
      ctx.ui.setTheme(previousThemeName);
      previousThemeName = undefined;
    },

    reset() {
      previousThemeName = undefined;
    },
  };
}
