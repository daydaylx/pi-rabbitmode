import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRabbitCommand } from "../rabbit/commands.ts";
import { registerRabbitShortcut } from "../rabbit/shortcut.ts";
import { createRabbitState } from "../rabbit/state.ts";

/**
 * RabbitMode extension entrypoint — Phase 1-5 (session state, /rabbit
 * command, Super+Alt+R shortcut, forced MAX thinking, Blue Shift theme +
 * status widget). See README.md and docs/spec/05_IMPLEMENTATION_PHASES.md
 * for the full roadmap.
 *
 * The extension factory runs once per Pi process (state below is a module
 * closure, not global module state), but a single process can host several
 * sessions in sequence — state is therefore reset on `session_start` and
 * torn down on `session_shutdown`, not initialized only once at module load.
 */
export default function rabbitModeExtension(pi: ExtensionAPI): void {
  const state = createRabbitState(pi);
  registerRabbitCommand(pi, state);
  registerRabbitShortcut(pi, state);

  pi.on("session_start", () => {
    state.reset();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    state.dispose(ctx);
  });
}
