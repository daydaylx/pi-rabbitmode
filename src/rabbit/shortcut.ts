import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RabbitStateApi } from "./state.ts";

/**
 * The only new keybinding RabbitMode introduces. `Super+R` (Resume) and
 * `Shift+Tab` (workflow menu) are pi-core bindings and are never touched
 * here — `docs/spec/02_CONTRACTS.md` §1 and
 * `docs/spec/06_TEST_MATRIX.md` §A require both to stay exactly as they
 * are, and require the shortcut to route through the same command path
 * as `/rabbit toggle` rather than duplicating its logic.
 */
export const RABBIT_SHORTCUT = "super+alt+r" as const;

export function registerRabbitShortcut(
  pi: ExtensionAPI,
  state: RabbitStateApi,
): void {
  pi.registerShortcut(RABBIT_SHORTCUT, {
    description: "RabbitMode umschalten (/rabbit toggle)",
    handler: (ctx) => {
      state.toggle(ctx);
    },
  });
}
