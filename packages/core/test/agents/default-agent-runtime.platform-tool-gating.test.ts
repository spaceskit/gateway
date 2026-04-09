import { describe, expect, test } from "bun:test";
import { DefaultAgentRuntime } from "../../src/agents/default-agent-runtime.js";
import type {
  AgentConfig,
  TurnContext,
  TurnEvent,
} from "../../src/agents/agent-runtime.js";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelProvider,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../../src/agents/model-provider.js";
import type {
  ToolAvailabilityOptions,
  ToolExecutionContext,
  ToolExecutor,
  ToolPermission,
} from "../../src/agents/tool-executor.js";
import { EventBus } from "../../src/events/event-bus.js";

class GatingToolExecutor implements ToolExecutor {
  readonly availabilityRequests: ToolAvailabilityOptions[] = [];

  async getAvailableTools(
    _spaceId: string,
    _agentId: string,
    options?: ToolAvailabilityOptions,
  ): Promise<ToolDefinition[]> {
    this.availabilityRequests.push(options ?? {});
    const tools: ToolDefinition[] = [{
      name: "files.read",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    }];
    if (!options?.suppressInjectedTools) {
      tools.push({
        name: "platform.listSpaces",
        description: "List spaces",
        inputSchema: { type: "object", properties: {} },
      });
    }
    return tools;
  }

  async checkPermission(_toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolPermission> {
    return { toolName: "noop", allowed: true };
  }

  async execute(_toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolResult> {
    return {
      toolCallId: "tool-1",
      result: { ok: true },
      isError: false,
    };
  }
}

class CapturingModelProvider implements ModelProvider {
  readonly name = "Capturing";
  readonly isLocal = true;
  readonly calls: GenerateOptions[] = [];

  constructor(private readonly responseText: string) {}

  readonly id = "stub";

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return { available: true, latencyMs: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "stub/test-model", name: "Test", provider: "stub", isLocal: true }];
  }

  async generate(_model: string, options: GenerateOptions): Promise<GenerateResult> {
    this.calls.push(options);
    return {
      message: { role: "assistant", content: this.responseText },
      finishReason: "stop",
      usage: { promptTokens: 5, completionTokens: 4, totalTokens: 9 },
    };
  }

  async *stream(_model: string, _options: GenerateOptions): AsyncIterable<StreamChunk> {}
}

function buildRuntime(
  modelProvider: ModelProvider,
  toolExecutor: ToolExecutor,
): DefaultAgentRuntime {
  const config: AgentConfig = {
    id: "agent-1",
    profileId: "profile-1",
    systemPrompt: "You are helpful.",
    modelProvider: modelProvider.id,
    modelId: "stub/test-model",
    tools: ["files.read", "platform.listSpaces"],
    maxSteps: 3,
  };

  return new DefaultAgentRuntime({
    config,
    modelProvider,
    toolExecutor,
    eventBus: new EventBus(),
  });
}

function makeTurnContext(content: string): TurnContext {
  return {
    spaceId: "space-1",
    turnId: "turn-1",
    messages: [{ role: "user", content }],
    lineageId: "lineage-1",
    hopCount: 0,
    maxHops: 5,
  };
}

async function collectEvents(runtime: DefaultAgentRuntime, context: TurnContext): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runtime.executeTurn(context)) {
    events.push(event);
  }
  return events;
}

describe("DefaultAgentRuntime platform tool gating", () => {
  test("suppresses injected platform tools for greeting-only turns", async () => {
    const toolExecutor = new GatingToolExecutor();
    const provider = new CapturingModelProvider("hello back");
    const runtime = buildRuntime(provider, toolExecutor);

    const events = await collectEvents(runtime, makeTurnContext("hey there"));
    const completion = events.find((event) => event.type === "turn_completed");

    expect(toolExecutor.availabilityRequests).toHaveLength(1);
    expect(toolExecutor.availabilityRequests[0]?.suppressInjectedTools).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.tools?.map((tool) => tool.name)).toEqual(["files.read"]);
    expect(completion?.type).toBe("turn_completed");
  });

  test("keeps injected platform tools available for explicit platform questions", async () => {
    const toolExecutor = new GatingToolExecutor();
    const provider = new CapturingModelProvider("Here are the spaces.");
    const runtime = buildRuntime(provider, toolExecutor);

    const events = await collectEvents(runtime, makeTurnContext("list spaces"));
    const completion = events.find((event) => event.type === "turn_completed");

    expect(toolExecutor.availabilityRequests).toHaveLength(1);
    expect(toolExecutor.availabilityRequests[0]?.suppressInjectedTools).toBeFalsy();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.tools?.map((tool) => tool.name)).toEqual([
      "files.read",
      "platform.listSpaces",
    ]);
    expect(completion?.type).toBe("turn_completed");
  });
});
