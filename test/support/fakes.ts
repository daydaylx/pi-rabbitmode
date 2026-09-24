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

export interface RecordedSendUserMessage {
  content: string | unknown[];
  options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean };
}

export interface FakeExtensionApi {
  readonly events: FakeEventBus;
  readonly commands: Map<string, RegisteredCommand>;
  readonly shortcuts: Map<string, RegisteredShortcut>;
  readonly thinkingLevelHistory: ThinkingLevel[];
  readonly sentUserMessages: RecordedSendUserMessage[];
  registerCommand(name: string, options: RegisteredCommand): void;
  registerShortcut(shortcut: string, options: RegisteredShortcut): void;
  sendUserMessage(
    content: string | unknown[],
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ): void;
  on(event: string, handler: LifecycleHandler): void;
  /**
   * `ctx` defaults to `undefined`, matching real lifecycle events like
   * `session_shutdown` whose handler treats a missing/best-effort
   * context as optional (`ExtensionContext | undefined`) rather than an
   * empty object — `{}` would crash a handler that reaches for
   * `ctx.ui.*` without checking first.
   */
  fireLifecycleEvent(event: string, ctx?: unknown): Promise<void>;
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
  const sentUserMessages: RecordedSendUserMessage[] = [];
  let thinkingLevel: ThinkingLevel = initialThinkingLevel;

  return {
    events,
    commands,
    shortcuts,
    thinkingLevelHistory,
    sentUserMessages,
    registerCommand(name, options) {
      commands.set(name, options);
    },
    registerShortcut(shortcut, options) {
      shortcuts.set(shortcut, options);
    },
    sendUserMessage(content, options) {
      sentUserMessages.push({ content, options });
    },
    on(event, handler) {
      const list = lifecycleHandlers.get(event) ?? [];
      list.push(handler);
      lifecycleHandlers.set(event, list);
    },
    async fireLifecycleEvent(event, ctx) {
      for (const handler of lifecycleHandlers.get(event) ?? []) {
        await handler({ type: event }, ctx);
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
 * A fast, no-filesystem stand-in for `DynamicRoleRegistry`
 * (`src/orchestration/dynamic-role.ts`) so `commands.ts` unit tests don't
 * touch disk. `test/dynamic-role.test.ts` exercises the real
 * validation/file-write/cleanup implementation separately.
 */
export function createFakeDynamicRoleRegistry(options?: {
  defineBehavior?: "success" | "error";
  defineError?: string;
}) {
  const behavior = options?.defineBehavior ?? "success";
  const defineCalls: { cwd: string; raw: unknown }[] = [];
  const cleanupCalls: string[] = [];
  let cleanupAllCalls = 0;

  return {
    size: () => 0,
    defineCalls,
    cleanupCalls,
    cleanupAllCallCount: () => cleanupAllCalls,
    define: async (cwd: string, raw: unknown) => {
      defineCalls.push({ cwd, raw });
      if (behavior === "error") {
        return { ok: false as const, error: options?.defineError ?? "fake define error" };
      }
      const id = typeof raw === "object" && raw !== null && "id" in raw ? String((raw as { id: unknown }).id) : "fake-id";
      const task = typeof raw === "object" && raw !== null && "task" in raw ? String((raw as { task: unknown }).task) : "";
      return {
        ok: true as const,
        role: { id, runtimeName: `rabbit-dynamic.${id}`, filePath: `/fake/.pi/agents/rabbit-dynamic/${id}.md` },
        task,
      };
    },
    cleanup: async (id: string) => {
      cleanupCalls.push(id);
    },
    cleanupAll: async () => {
      cleanupAllCalls += 1;
    },
  };
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
  spawnBehavior?: "success" | "error" | "timeout";
  spawnText?: string;
  statusBehavior?: "completed" | "failed";
}) {
  const behavior = options?.pingBehavior ?? "success";
  const version = options?.pingVersion ?? 1;
  const spawnBehavior = options?.spawnBehavior ?? "success";
  const statusBehavior = options?.statusBehavior ?? "completed";
  let pingCalls = 0;
  const spawnCalls: unknown[] = [];

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

  async function spawn(params?: unknown) {
    spawnCalls.push(params);
    if (spawnBehavior === "timeout") {
      throw new Error('RabbitMode: subagents RPC "spawn" timed out (fake)');
    }
    if (spawnBehavior === "error") {
      return {
        version: 1,
        requestId: "fake",
        method: "spawn",
        success: false,
        error: { code: "not_found", message: "fake spawn error" },
      };
    }
    return {
      version: 1,
      requestId: "fake",
      method: "spawn",
      success: true,
      data: {
        text: options?.spawnText ?? "fake spawn started.",
        details: { runId: "fake-run" },
      },
    };
  }

  async function status() {
    const failed = statusBehavior === "failed";
    return {
      version: 1,
      requestId: "fake",
      method: "status",
      success: true,
      data: {
        text: failed ? "fake run failed." : "fake run completed.",
        details: { results: [{ exitCode: failed ? 1 : 0 }] },
      },
    };
  }

  return {
    call: async (method: string, params?: unknown) => {
      if (method === "ping") return ping();
      if (method === "spawn") return spawn(params);
      if (method === "status") return status();
      throw new Error(`fake subagents RPC client: unsupported method "${method}" in test`);
    },
    ping,
    pingCallCount: () => pingCalls,
    spawnCalls,
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
  isIdle(): boolean;
}

export function createFakeCommandContext(options?: {
  model?: unknown;
  /** Theme name `ctx.ui.theme.name` starts as. Default: "aurora-forge". */
  initialThemeName?: string;
  /** `ctx.ui.setTheme(name)` fails (success: false) for names in this list. */
  failThemeNames?: string[];
  /** `ctx.isIdle()` return value. Default: true (matches a real idle session). */
  idle?: boolean;
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
    isIdle: () => options?.idle ?? true,
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
