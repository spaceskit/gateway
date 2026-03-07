import { describe, expect, test } from "bun:test";
import { DefaultAgentRuntime } from "../../src/agents/default-agent-runtime.js";
import type { AgentConfig, TurnContext, TurnEvent } from "../../src/agents/agent-runtime.js";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  ToolDefinition,
  ToolResult,
} from "../../src/agents/model-provider.js";
import type { ToolExecutor } from "../../src/agents/tool-executor.js";
import { EventBus } from "../../src/events/event-bus.js";

class StubModelProvider implements ModelProvider {
  readonly id = "stub-provider";
  readonly name = "Stub Provider";
  readonly isLocal = true;
  generateCalls = 0;
  streamCalls = 0;

  constructor(
    private readonly handlers: {
      generate: (options: GenerateOptions) => Promise<GenerateResult>;
      stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>;
    },
  ) {}

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return { available: true, latencyMs: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{
      id: "stub/model",
      name: "Stub Model",
      provider: "stub",
      isLocal: true,
    }];
  }

  async generate(_model: string, options: GenerateOptions): Promise<GenerateResult> {
    this.generateCalls += 1;
    return await this.handlers.generate(options);
  }

  async *stream(_model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streamCalls += 1;
    for await (const chunk of this.handlers.stream(options)) {
      yield chunk;
    }
  }
}

function buildToolExecutor(tools: ToolDefinition[]): ToolExecutor {
  return {
    getAvailableTools: async () => tools,
    checkPermission: async (toolCall) => ({
      toolName: toolCall.name,
      allowed: true,
    }),
    execute: async (toolCall): Promise<ToolResult> => ({
      toolCallId: toolCall.id,
      result: { ok: true },
      isError: false,
    }),
  };
}

function buildRuntime(
  provider: ModelProvider,
  tools: ToolDefinition[] = [],
): DefaultAgentRuntime {
  const config: AgentConfig = {
    id: "agent-1",
    profileId: "profile-1",
    systemPrompt: "You are helpful.",
    modelProvider: provider.id,
    modelId: "stub/model",
    tools: tools.map((tool) => tool.name),
    maxSteps: 4,
  };

  return new DefaultAgentRuntime({
    config,
    modelProvider: provider,
    toolExecutor: buildToolExecutor(tools),
    eventBus: new EventBus(),
  });
}

function makeTurnContext(): TurnContext {
  return {
    spaceId: "space-1",
    turnId: "turn-1",
    messages: [{ role: "user", content: "Say hello" }],
    lineageId: "lineage-1",
    hopCount: 0,
    maxHops: 5,
  };
}

async function collectEvents(runtime: DefaultAgentRuntime): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runtime.executeTurn(makeTurnContext())) {
    events.push(event);
  }
  return events;
}

async function* streamChunks(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(5);
  }
  return predicate();
}

function isTurnCompleted(
  event: TurnEvent | undefined,
): event is Extract<TurnEvent, { type: "turn_completed" }> {
  return event?.type === "turn_completed";
}

describe("DefaultAgentRuntime streaming text deltas", () => {
  test("delivers first streamed delta before stream completion", async () => {
    const finishGate = createDeferred();
    const provider = new StubModelProvider({
      generate: async () => {
        throw new Error("generate() should not run when stream succeeds");
      },
      stream: () => ({
        async *[Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
          yield { type: "text_delta", text: "partial" };
          await finishGate.promise;
          yield { type: "finish", finishReason: "stop" };
        },
      }),
    });
    const runtime = buildRuntime(provider);
    const events: TurnEvent[] = [];

    const runPromise = (async () => {
      for await (const event of runtime.executeTurn(makeTurnContext())) {
        events.push(event);
      }
    })();

    const sawPartialDelta = await waitFor(
      () => events.some((event) => event.type === "text_delta" && event.text === "partial"),
      200,
    );
    expect(sawPartialDelta).toBe(true);

    finishGate.resolve();
    await runPromise;
  });

  test("emits real incremental text_delta chunks from provider stream", async () => {
    const provider = new StubModelProvider({
      generate: async () => {
        throw new Error("generate() should not run when stream succeeds");
      },
      stream: () => streamChunks([
        { type: "text_delta", text: "Hel" },
        { type: "text_delta", text: "lo" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        },
      ]),
    });
    const runtime = buildRuntime(provider);

    const events = await collectEvents(runtime);
    const deltas = events
      .filter((event): event is Extract<TurnEvent, { type: "text_delta" }> => event.type === "text_delta")
      .map((event) => event.text);
    const completedIndex = events.findIndex((event) => event.type === "turn_completed");
    const lastDeltaIndex = events.reduce((index, event, current) => (
      event.type === "text_delta" ? current : index
    ), -1);
    const completed = events.find(isTurnCompleted);

    expect(provider.streamCalls).toBe(1);
    expect(provider.generateCalls).toBe(0);
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(completedIndex).toBeGreaterThan(lastDeltaIndex);
    expect(completed).toBeDefined();
    expect(completed?.result.finalMessage.content).toBe("Hello");
    expect(completed?.result.usage.totalTokens).toBe(7);
  });

  test("uses generate() fallback path when tools are available", async () => {
    const provider = new StubModelProvider({
      generate: async () => ({
        message: { role: "assistant", content: "fallback result" },
        finishReason: "stop",
      }),
      stream: () => streamChunks([
        { type: "text_delta", text: "stream should be skipped" },
        { type: "finish", finishReason: "stop" },
      ]),
    });
    const runtime = buildRuntime(provider, [{
      name: "tool.lookup",
      description: "Lookup tool",
      inputSchema: { type: "object" },
    }]);

    const events = await collectEvents(runtime);
    const deltas = events
      .filter((event): event is Extract<TurnEvent, { type: "text_delta" }> => event.type === "text_delta")
      .map((event) => event.text);

    expect(provider.streamCalls).toBe(0);
    expect(provider.generateCalls).toBe(1);
    expect(deltas).toEqual(["fallback result"]);
  });

  test("injects tool-usage guidance when tools are available", async () => {
    let capturedMessages: ModelMessage[] = [];
    const provider = new StubModelProvider({
      generate: async (options) => {
        capturedMessages = options.messages;
        return {
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        };
      },
      stream: () => streamChunks([
        { type: "text_delta", text: "unused" },
        { type: "finish", finishReason: "stop" },
      ]),
    });
    const runtime = buildRuntime(provider, [{
      name: "lists.listItems",
      description: "List reminders",
      inputSchema: { type: "object" },
    }]);

    const reminderContext: TurnContext = {
      spaceId: "space-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "Can you check my reminders?" }],
      lineageId: "lineage-1",
      hopCount: 0,
      maxHops: 5,
    };

    for await (const _event of runtime.executeTurn(reminderContext)) {
      // Drain events.
    }

    const guidanceMessage = capturedMessages.find((message) => (
      message.role == "system" && message.content.includes("[[SPACESKIT_TOOL_GUIDANCE_V1]]")
    ));
    expect(guidanceMessage).toBeDefined();
    expect(guidanceMessage?.content).toContain("lists.listItems");
  });

  test("waits briefly for tools to register before running a turn", async () => {
    let getAvailableToolsCalls = 0;
    let capturedMessages: ModelMessage[] = [];
    const delayedTools: ToolDefinition[] = [{
      name: "lists.listLists",
      description: "List reminder lists",
      inputSchema: { type: "object" },
    }];

    const toolExecutor: ToolExecutor = {
      getAvailableTools: async () => {
        getAvailableToolsCalls += 1;
        return getAvailableToolsCalls >= 2 ? delayedTools : [];
      },
      checkPermission: async (toolCall) => ({
        toolName: toolCall.name,
        allowed: true,
      }),
      execute: async (toolCall): Promise<ToolResult> => ({
        toolCallId: toolCall.id,
        result: { ok: true },
        isError: false,
      }),
    };

    const provider = new StubModelProvider({
      generate: async (options) => {
        capturedMessages = options.messages;
        return {
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        };
      },
      stream: () => streamChunks([
        { type: "text_delta", text: "unused" },
        { type: "finish", finishReason: "stop" },
      ]),
    });

    const runtime = new DefaultAgentRuntime({
      config: {
        id: "agent-1",
        profileId: "profile-1",
        systemPrompt: "You are helpful.",
        modelProvider: provider.id,
        modelId: "stub/model",
        tools: [],
        maxSteps: 4,
      },
      modelProvider: provider,
      toolExecutor,
      eventBus: new EventBus(),
    });

    const reminderContext: TurnContext = {
      spaceId: "space-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "Can you check my reminders?" }],
      lineageId: "lineage-1",
      hopCount: 0,
      maxHops: 5,
    };

    for await (const _event of runtime.executeTurn(reminderContext)) {
      // Drain events.
    }

    const guidanceMessage = capturedMessages.find((message) => (
      message.role === "system" && message.content.includes("[[SPACESKIT_TOOL_GUIDANCE_V1]]")
    ));

    expect(getAvailableToolsCalls).toBeGreaterThanOrEqual(2);
    expect(guidanceMessage).toBeDefined();
    expect(guidanceMessage?.content).toContain("lists.listLists");
  });

  test("continues after permission-denied tool result and forwards linked tool message", async () => {
    let capturedSecondCallMessages: ModelMessage[] = [];
    let generateInvocation = 0;
    const provider = new StubModelProvider({
      generate: async (options) => {
        generateInvocation += 1;
        if (generateInvocation === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              toolCalls: [{
                id: "tc-reminders-1",
                name: "lists.listItems",
                arguments: { targetProvider: "apple" },
              }],
            },
            finishReason: "tool_calls",
          };
        }
        capturedSecondCallMessages = options.messages;
        return {
          message: {
            role: "assistant",
            content: "I cannot access reminders because permission is denied.",
          },
          finishReason: "stop",
        };
      },
      stream: () => streamChunks([
        { type: "text_delta", text: "unused" },
        { type: "finish", finishReason: "stop" },
      ]),
    });

    const toolExecutor: ToolExecutor = {
      getAvailableTools: async () => [{
        name: "lists.listItems",
        description: "List reminders",
        inputSchema: { type: "object" },
      }],
      checkPermission: async () => ({
        toolName: "lists.listItems",
        allowed: false,
        reason: "PERMISSION_DENIED",
      }),
      execute: async () => ({
        toolCallId: "tc-reminders-1",
        result: { ok: true },
        isError: false,
      }),
    };

    const runtime = new DefaultAgentRuntime({
      config: {
        id: "agent-1",
        profileId: "profile-1",
        systemPrompt: "You are helpful.",
        modelProvider: provider.id,
        modelId: "stub/model",
        tools: ["lists.listItems"],
        maxSteps: 4,
      },
      modelProvider: provider,
      toolExecutor,
      eventBus: new EventBus(),
    });

    const events = await collectEvents(runtime);
    const completion = events.find(isTurnCompleted);
    const linkedToolMessage = capturedSecondCallMessages.find((message) => (
      message.role === "tool" && message.toolCallId === "tc-reminders-1"
    ));

    expect(provider.generateCalls).toBe(2);
    expect(linkedToolMessage).toBeDefined();
    expect(linkedToolMessage?.toolName).toBe("lists.listItems");
    expect(completion?.result.finalMessage.content).toContain("permission is denied");
  });

  test("coerces malformed blank toolCallId into assistant fallback note", async () => {
    let capturedSecondCallMessages: ModelMessage[] = [];
    let generateInvocation = 0;
    const provider = new StubModelProvider({
      generate: async (options) => {
        generateInvocation += 1;
        if (generateInvocation === 1) {
          return {
            message: {
              role: "assistant",
              content: "",
              toolCalls: [{
                id: "   ",
                name: "lists.listItems",
                arguments: {},
              }],
            },
            finishReason: "tool_calls",
          };
        }
        capturedSecondCallMessages = options.messages;
        return {
          message: {
            role: "assistant",
            content: "Recovered from malformed tool call id.",
          },
          finishReason: "stop",
        };
      },
      stream: () => streamChunks([
        { type: "text_delta", text: "unused" },
        { type: "finish", finishReason: "stop" },
      ]),
    });

    const toolExecutor: ToolExecutor = {
      getAvailableTools: async () => [{
        name: "lists.listItems",
        description: "List reminders",
        inputSchema: { type: "object" },
      }],
      checkPermission: async () => ({
        toolName: "lists.listItems",
        allowed: false,
        reason: "PERMISSION_DENIED",
      }),
      execute: async () => ({
        toolCallId: "",
        result: { ok: true },
        isError: false,
      }),
    };

    const runtime = new DefaultAgentRuntime({
      config: {
        id: "agent-1",
        profileId: "profile-1",
        systemPrompt: "You are helpful.",
        modelProvider: provider.id,
        modelId: "stub/model",
        tools: ["lists.listItems"],
        maxSteps: 4,
      },
      modelProvider: provider,
      toolExecutor,
      eventBus: new EventBus(),
    });

    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const events = await collectEvents(runtime);
      const completion = events.find(isTurnCompleted);
      const malformedToolMessages = capturedSecondCallMessages.filter((message) => (
        message.role === "tool" && !message.toolCallId?.trim()
      ));
      const fallbackAssistantMessage = capturedSecondCallMessages.find((message) => (
        message.role === "assistant" && message.content.includes("[tool-result-unlinked]")
      ));

      expect(provider.generateCalls).toBe(2);
      expect(malformedToolMessages).toHaveLength(0);
      expect(fallbackAssistantMessage).toBeDefined();
      expect(completion?.result.finalMessage.content).toContain("Recovered from malformed tool call id.");
      expect(
        warnings.some((entry) => (
          JSON.stringify(entry).includes("prompt_bridge_tool_missing_tool_call_id")
        )),
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("falls back to generate() when stream fails before first chunk", async () => {
    const provider = new StubModelProvider({
      generate: async () => ({
        message: { role: "assistant", content: "generated fallback" },
        finishReason: "stop",
      }),
      stream: () => ({
        async *[Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
          throw new Error("stream unavailable");
        },
      }),
    });
    const runtime = buildRuntime(provider);

    const events = await collectEvents(runtime);
    const deltas = events
      .filter((event): event is Extract<TurnEvent, { type: "text_delta" }> => event.type === "text_delta")
      .map((event) => event.text);

    expect(provider.streamCalls).toBe(1);
    expect(provider.generateCalls).toBe(1);
    expect(deltas).toEqual(["generated fallback"]);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });
});
