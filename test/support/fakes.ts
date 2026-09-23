/**
 * Minimal hand-written fakes for the two `@earendil-works/pi-coding-agent`
 * surfaces RabbitMode touches in Phase 1-2: the event bus and the command
 * context. No test-utility package for Pi extensions exists in this
 * ecosystem yet, so these fakes are intentionally small and local to this
 * repo rather than a shared dependency.
 */

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

type LifecycleHandler = (event: unknown, ctx: unknown) => unknown;

export interface FakeExtensionApi {
  readonly events: FakeEventBus;
  readonly commands: Map<string, RegisteredCommand>;
  registerCommand(name: string, options: RegisteredCommand): void;
  on(event: string, handler: LifecycleHandler): void;
  fireLifecycleEvent(event: string): Promise<void>;
}

export function createFakeExtensionApi(): FakeExtensionApi {
  const events = createFakeEventBus();
  const commands = new Map<string, RegisteredCommand>();
  const lifecycleHandlers = new Map<string, LifecycleHandler[]>();

  return {
    events,
    commands,
    registerCommand(name, options) {
      commands.set(name, options);
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
  };
}

export interface RecordedNotify {
  message: string;
  type?: "info" | "warning" | "error";
}

export interface FakeCommandContextUi {
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface FakeCommandContext {
  ui: FakeCommandContextUi;
}

export function createFakeCommandContext(): {
  ctx: FakeCommandContext;
  notifications: RecordedNotify[];
} {
  const notifications: RecordedNotify[] = [];
  const ctx: FakeCommandContext = {
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  };
  return { ctx, notifications };
}
