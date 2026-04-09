import { describe, expect, test } from "bun:test";
import { DefaultAgentRuntime } from "../../src/agents/default-agent-runtime.js";
import type { AgentConfig, TurnContext, TurnEvent } from "../../src/agents/agent-runtime.js";
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
import type { ToolExecutionContext, ToolExecutor, ToolPermission } from "../../src/agents/tool-executor.js";
import { EventBus } from "../../src/events/event-bus.js";

class FailingAppleProvider implements ModelProvider {
  readonly id = "apple";
  readonly name = "Apple";
  readonly isLocal = true;
  generateCalls = 0;

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return { available: true, latencyMs: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{
      id: "apple/apple-on-device",
      name: "apple-on-device",
      provider: "apple",
      isLocal: true,
      supportsTools: true,
    }];
  }

  async generate(_model: string, _options: GenerateOptions): Promise<GenerateResult> {
    this.generateCalls += 1;
    throw new Error("LLM should not be called for tool inventory questions");
  }

  async *stream(_model: string, _options: GenerateOptions): AsyncIterable<StreamChunk> {}
}

class InventoryToolExecutor implements ToolExecutor {
  async getAvailableTools(): Promise<ToolDefinition[]> {
    return [
      {
        name: "lists.listLists",
        description: "List lists.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "shell.jira.me",
        description: "Verify Jira connectivity.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "shell.jira.issue.list",
        description: "List Jira issues.",
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }

  async checkPermission(toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolPermission> {
    return { toolName: toolCall.name, allowed: true };
  }

  async execute(_toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolResult> {
    throw new Error("Tools should not execute for inventory questions");
  }
}

function buildRuntime(provider: ModelProvider, toolExecutor: ToolExecutor): DefaultAgentRuntime {
  const config: AgentConfig = {
    id: "agent-1",
    profileId: "profile-1",
    systemPrompt: "You are helpful.",
    modelProvider: provider.id,
    modelId: "apple/apple-on-device",
    tools: ["lists.listLists", "shell.jira.me", "shell.jira.issue.list"],
    maxSteps: 4,
  };

  return new DefaultAgentRuntime({
    config,
    modelProvider: provider,
    toolExecutor,
    eventBus: new EventBus(),
  });
}

function makeTurnContext(): TurnContext {
  return {
    spaceId: "space-1",
    turnId: "turn-1",
    messages: [{ role: "user", content: "Which tools are available to you?" }],
    lineageId: "lineage-1",
    hopCount: 0,
    maxHops: 5,
    accessMode: "full_access",
  };
}

async function collectEvents(runtime: DefaultAgentRuntime): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runtime.executeTurn(makeTurnContext())) {
    events.push(event);
  }
  return events;
}

describe("DefaultAgentRuntime tool inventory shortcuts", () => {
  test("answers direct tool inventory questions from resolved tool definitions without calling the model", async () => {
    const provider = new FailingAppleProvider();
    const runtime = buildRuntime(provider, new InventoryToolExecutor());

    const events = await collectEvents(runtime);
    const completed = events.find((event): event is Extract<TurnEvent, { type: "turn_completed" }> => event.type === "turn_completed");

    expect(provider.generateCalls).toBe(0);
    expect(completed?.result.finalMessage.content).toContain("Available tools in this space:");
    expect(completed?.result.finalMessage.content).toContain("lists.listLists");
    expect(completed?.result.finalMessage.content).toContain("shell.jira.me");
  });
});
