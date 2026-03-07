import { describe, expect, test } from "bun:test";
import { DefaultAgentRuntime } from "../../src/agents/default-agent-runtime.js";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelProvider,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../../src/agents/model-provider.js";
import type { ToolExecutionContext, ToolExecutor, ToolPermission } from "../../src/agents/tool-executor.js";
import type { TurnContext, TurnEvent } from "../../src/agents/agent-runtime.js";
import { EventBus } from "../../src/events/event-bus.js";
import { ProviderRateLimitError } from "../../src/errors/runtime-errors.js";

class StubToolExecutor implements ToolExecutor {
  async getAvailableTools(_spaceId: string, _agentId: string): Promise<ToolDefinition[]> {
    return [];
  }

  async checkPermission(_toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolPermission> {
    return {
      toolName: "noop",
      allowed: true,
    };
  }

  async execute(_toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolResult> {
    return {
      toolCallId: "noop",
      result: null,
      isError: false,
    };
  }
}

class StubModelProvider implements ModelProvider {
  readonly id = "stub-provider";
  readonly name = "Stub Provider";
  readonly isLocal = true;
  generateCallCount = 0;

  constructor(private readonly generateImpl: (model: string, options: GenerateOptions) => Promise<GenerateResult>) {}

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return { available: true, latencyMs: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{
      id: "stub-model",
      name: "Stub Model",
      provider: this.id,
      isLocal: true,
    }];
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    this.generateCallCount += 1;
    return this.generateImpl(model, options);
  }

  async *stream(_model: string, _options: GenerateOptions): AsyncIterable<never> {}
}

function createTurnContext(): TurnContext {
  return {
    spaceId: "space-1",
    turnId: "turn-1",
    lineageId: "lineage-1",
    hopCount: 0,
    maxHops: 5,
    messages: [{ role: "user", content: "hello" }],
  };
}

async function collectEvents(runtime: DefaultAgentRuntime, context: TurnContext): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runtime.executeTurn(context)) {
    events.push(event);
  }
  return events;
}

function createRateLimitError(retryAfterHeaderValue = "0.001"): Error & { status: number; headers: Record<string, string> } {
  const err = new Error("429 Too Many Requests") as Error & {
    status: number;
    headers: Record<string, string>;
  };
  err.status = 429;
  err.headers = { "retry-after": retryAfterHeaderValue };
  return err;
}

describe("DefaultAgentRuntime rate-limit auto-retry", () => {
  test("retries provider 429 and emits rate_limited event with wait hint", async () => {
    let invocation = 0;
    const modelProvider = new StubModelProvider(async () => {
      invocation += 1;
      if (invocation === 1) {
        throw createRateLimitError();
      }

      return {
        message: { role: "assistant", content: "retried success" },
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const runtime = new DefaultAgentRuntime({
      config: {
        id: "agent-1",
        profileId: "profile-1",
        systemPrompt: "You are helpful.",
        modelProvider: "stub-provider",
        modelId: "stub-model",
        tools: [],
        maxSteps: 2,
      },
      modelProvider,
      toolExecutor: new StubToolExecutor(),
      eventBus: new EventBus(),
    });

    const events = await collectEvents(runtime, createTurnContext());
    const rateLimitedEvents = events.filter((event) => event.type === "rate_limited");
    const completionEvent = events.find((event) => event.type === "turn_completed");

    expect(modelProvider.generateCallCount).toBe(2);
    expect(rateLimitedEvents).toHaveLength(1);
    expect(rateLimitedEvents[0]?.retryAfterMs).toBe(1);
    expect(rateLimitedEvents[0]?.retryAfterSeconds).toBe(1);
    expect(rateLimitedEvents[0]?.attempt).toBe(1);
    expect(rateLimitedEvents[0]?.maxAttempts).toBe(3);
    expect(rateLimitedEvents[0]?.providerId).toBe("stub-provider");
    expect(rateLimitedEvents[0]?.retryAt.length).toBeGreaterThan(0);
    expect(completionEvent?.type).toBe("turn_completed");
  });

  test("stops after max retry attempts and emits provider rate-limit error", async () => {
    const modelProvider = new StubModelProvider(async () => {
      throw createRateLimitError();
    });

    const runtime = new DefaultAgentRuntime({
      config: {
        id: "agent-1",
        profileId: "profile-1",
        systemPrompt: "You are helpful.",
        modelProvider: "stub-provider",
        modelId: "stub-model",
        tools: [],
        maxSteps: 2,
      },
      modelProvider,
      toolExecutor: new StubToolExecutor(),
      eventBus: new EventBus(),
    });

    const events = await collectEvents(runtime, createTurnContext());
    const rateLimitedEvents = events.filter((event) => event.type === "rate_limited");
    const errorEvent = events.find((event) => event.type === "error");

    expect(modelProvider.generateCallCount).toBe(4);
    expect(rateLimitedEvents).toHaveLength(3);
    expect(errorEvent?.type).toBe("error");
    expect(errorEvent && errorEvent.type === "error" ? errorEvent.error : undefined).toBeInstanceOf(ProviderRateLimitError);
  });
});
