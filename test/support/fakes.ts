/**
 * Minimal hand-written fakes for the `@earendil-works/pi-coding-agent`
 * surfaces RabbitMode touches: the event bus, command/shortcut
 * registration, the command context, and (Phase 4) thinking-level
 * control. No test-utility package for Pi extensions exists in this
 * ecosystem yet, so these fakes are intentionally small and local to this
 * repo rather than a shared dependency.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** See src/rabbit/effort.ts for why this is derived, not imported directly. */
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

export interface RecordedEmit {
  channel: string;
  data: unknown;
}

export interface FakeEventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
  readonly emitted: RecordedEmit[];
}

export function createFakeEventBus(): FakeEventBus {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const emitted: RecordedEmit[] = [];
  return {
    emitted,
    emit(channel, data) {
      emitted.push({ channel, data });
      for (const handler of handlers.get(channel) ?? []) handler(data);
    },
    on(channel, handler) {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
      }
      set.add(handler);
      return () => set?.delete(handler);
    },
  };
}

type RegisteredCommandHandler = (args: string, ctx: unknown) => Promise<void>;

interface RegisteredCommand {
  description?: string;
  handler: RegisteredCommandHandler;
}

type RegisteredShortcutHandler = (ctx: unknown) => Promise<void> | void;

interface RegisteredShortcut {
  description?: string;
  handler: RegisteredShortcutHandler;
}

type LifecycleHandler = (event: unknown, ctx: unknown) => unknown;

export interface FakeExtensionApi {
  readonly events: FakeEventBus;
  readonly commands: Map<string, RegisteredCommand>;
  readonly shortcuts: Map<string, RegisteredShortcut>;
  readonly thinkingLevelHistory: ThinkingLevel[];
  registerCommand(name: string, options: RegisteredCommand): void;
  registerShortcut(shortcut: string, options: RegisteredShortcut): void;
  on(event: string, handler: LifecycleHandler): void;
  fireLifecycleEvent(event: string): Promise<void>;
  getThinkingLevel(): ThinkingLevel;
  setThinkingLevel(level: ThinkingLevel): void;
}

export function createFakeExtensionApi(
  initialThinkingLevel: ThinkingLevel = "high",
): FakeExtensionApi {
  const events = createFakeEventBus();
  const commands = new Map<string, RegisteredCommand>();
  const shortcuts = new Map<string, RegisteredShortcut>();
  const lifecycleHandlers = new Map<string, LifecycleHandler[]>();
  const thinkingLevelHistory: ThinkingLevel[] = [];
  let thinkingLevel: ThinkingLevel = initialThinkingLevel;

  return {
    events,
    commands,
    shortcuts,
    thinkingLevelHistory,
    registerCommand(name, options) {
      commands.set(name, options);
    },
    registerShortcut(shortcut, options) {
      shortcuts.set(shortcut, options);
    },
    on(event, handler) {
      const list = lifecycleHandlers.get(event) ?? [];
      list.push(handler);
      lifecycleHandlers.set(event, list);
    },
    async fireLifecycleEvent(event) {
      for (const handler of lifecycleHandlers.get(event) ?? []) {
        await handler({ type: event }, {});
      }
    },
    getThinkingLevel() {
      return thinkingLevel;
    },
    setThinkingLevel(level) {
      thinkingLevel = level;
      thinkingLevelHistory.push(level);
    },
  };
}

/**
 * Minimal fakes matching the two fields `getSupportedThinkingLevels`
 * (`@earendil-works/pi-ai`) actually reads (`reasoning`, `thinkingLevelMap`)
 * — not a full `Model<Api>`, cast at the call site like other fakes here.
 */
export function fakeModelSupportingMax(id = "test/supports-max") {
  return {
    id,
    reasoning: true,
    thinkingLevelMap: { max: "max", xhigh: "xhigh" },
  };
}

export function fakeModelWithoutMax(id = "test/no-max") {
  return {
    id,
    reasoning: true,
    thinkingLevelMap: { high: "high" },
  };
}

export function fakeModelWithoutReasoning(id = "test/no-reasoning") {
  return { id, reasoning: false };
}

/**
 * A fast, deterministic stand-in for `SubagentRpcClient`
 * (`src/runtime/subagents-rpc.ts`) so `commands.ts` unit tests don't pay
 * the real client's timeout delay. `test/subagents-rpc.test.ts` exercises
 * the real implementation's request/reply/timeout behavior separately.
 */
export function createFakeSubagentRpcClient(options?: {
  pingBehavior?: "success" | "error" | "timeout";
  pingVersion?: number;
}) {
  const behavior = options?.pingBehavior ?? "success";
  const version = options?.pingVersion ?? 1;
  let pingCalls = 0;

  async function ping() {
    pingCalls += 1;
    if (behavior === "timeout") {
      throw new Error('RabbitMode: subagents RPC "ping" timed out (fake)');
    }
    if (behavior === "error") {
      return {
        version: 1,
        requestId: "fake",
        method: "ping",
        success: false,
        error: { code: "no_active_session", message: "fake error" },
      };
    }
    return {
      version: 1,
      requestId: "fake",
      method: "ping",
      success: true,
      data: {
        version,
        methods: ["ping", "status", "spawn", "interrupt", "stop"],
        capabilities: { status: true, asyncSpawn: true, interrupt: true, stop: true },
        events: { ready: "", request: "", replyPrefix: "" },
        session: {},
      },
    };
  }

  return {
    call: async (method: string) => {
      if (method === "ping") return ping();
      throw new Error(`fake subagents RPC client: unsupported method "${method}" in test`);
    },
    ping,
    pingCallCount: () => pingCalls,
  };
}

export interface RecordedNotify {
  message: string;
  type?: "info" | "warning" | "error";
}

export interface RecordedSetWidget {
  key: string;
  content: string[] | undefined;
}

export interface FakeCommandContextUi {
  notify(message: string, type?: "info" | "warning" | "error"): void;
  readonly theme: { name: string };
  setTheme(theme: string): { success: boolean; error?: string };
  setWidget(key: string, content: string[] | undefined): void;
}

export interface FakeCommandContext {
  ui: FakeCommandContextUi;
  model?: unknown;
}

export function createFakeCommandContext(options?: {
  model?: unknown;
  /** Theme name `ctx.ui.theme.name` starts as. Default: "aurora-forge". */
  initialThemeName?: string;
  /** `ctx.ui.setTheme(name)` fails (success: false) for names in this list. */
  failThemeNames?: string[];
}): {
  ctx: FakeCommandContext;
  notifications: RecordedNotify[];
  setThemeCalls: string[];
  setWidgetCalls: RecordedSetWidget[];
  currentThemeName(): string;
} {
  const notifications: RecordedNotify[] = [];
  const setThemeCalls: string[] = [];
  const setWidgetCalls: RecordedSetWidget[] = [];
  const failThemeNames = new Set(options?.failThemeNames ?? []);
  let themeName = options?.initialThemeName ?? "aurora-forge";

  const ctx: FakeCommandContext = {
    model: options?.model,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
      get theme() {
        return { name: themeName };
      },
      setTheme(name) {
        setThemeCalls.push(name);
        if (failThemeNames.has(name)) {
          return { success: false, error: `theme "${name}" not found` };
        }
        themeName = name;
        return { success: true };
      },
      setWidget(key, content) {
        setWidgetCalls.push({ key, content });
      },
    },
  };
  return {
    ctx,
    notifications,
    setThemeCalls,
    setWidgetCalls,
    currentThemeName: () => themeName,
  };
}
