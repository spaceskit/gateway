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
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../../src/agents/model-provider.js";
import type { ToolExecutionContext, ToolExecutor, ToolPermission } from "../../src/agents/tool-executor.js";
import { EventBus } from "../../src/events/event-bus.js";

class MediatedGeminiProvider implements ModelProvider {
  readonly id = "gemini";
  readonly name = "Gemini";
  readonly isLocal = true;
  readonly generateCalls: GenerateOptions[] = [];
  readonly streamCalls: GenerateOptions[] = [];

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return { available: true, latencyMs: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{
      id: "gemini/gemini-2.5-flash",
      name: "gemini-2.5-flash",
      provider: "gemini",
      isLocal: true,
      supportsTools: true,
    }];
  }

  async generate(_model: string, options: GenerateOptions): Promise<GenerateResult> {
    this.generateCalls.push(options);

    if (this.generateCalls.length === 1) {
      return {
        message: {
          role: "assistant",
          content: `I need to verify this with the gateway tool.

\`\`\`tool_call
{"name":"lists.echo","arguments":{"message":"marker-123"}}
\`\`\``,
        },
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
      };
    }

    const toolMessage = [...options.messages]
      .reverse()
      .find((message) => message.role === "tool");
    const parsedResult = toolMessage ? JSON.parse(toolMessage.content) as { echoed?: string } : {};

    return {
      message: {
        role: "assistant",
        content: `Echo confirmed: ${parsedResult.echoed ?? "missing"}`,
      },
      finishReason: "stop",
      usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 },
    };
  }

  async *stream(_model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streamCalls.push(options);
  }
}

class EchoToolExecutor implements ToolExecutor {
  readonly executedToolCalls: ToolCall[] = [];

  async getAvailableTools(): Promise<ToolDefinition[]> {
    return [{
      name: "lists.echo",
      description: "Echo a marker for deterministic tests.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
    }];
  }

  async checkPermission(toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolPermission> {
    return { toolName: toolCall.name, allowed: true };
  }

  async execute(toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolResult> {
    this.executedToolCalls.push(toolCall);
    return {
      toolCallId: toolCall.id,
      result: {
        echoed: typeof toolCall.arguments.message === "string" ? toolCall.arguments.message : null,
      },
      isError: false,
    };
  }
}

function buildRuntime(
  provider: ModelProvider,
  toolExecutor: ToolExecutor,
  configOverrides: Partial<AgentConfig> = {},
): DefaultAgentRuntime {
  const modelId = provider.id === "claude-agent-sdk"
    ? "claude-agent-sdk/claude-sonnet-4-5"
    : provider.id === "codex-app-server"
      ? "codex-app-server/gpt-5.4"
    : "gemini/gemini-2.5-flash";
  const config: AgentConfig = {
    id: "agent-1",
    profileId: "profile-1",
    systemPrompt: "You are helpful.",
    modelProvider: provider.id,
    modelId,
    tools: ["lists.echo"],
    maxSteps: 4,
    ...configOverrides,
  };

  return new DefaultAgentRuntime({
    config,
    modelProvider: provider,
    toolExecutor,
    eventBus: new EventBus(),
  });
}

function makeTurnContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    spaceId: "space-1",
    turnId: "turn-1",
    messages: [{ role: "user", content: "Use the echo tool and confirm the marker." }],
    lineageId: "lineage-1",
    hopCount: 0,
    maxHops: 5,
    accessMode: "default",
    ...overrides,
  };
}

async function collectEvents(runtime: DefaultAgentRuntime): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runtime.executeTurn(makeTurnContext())) {
    events.push(event);
  }
  return events;
}

describe("DefaultAgentRuntime mediated tool fallback", () => {
  test("parses fenced tool calls for gemini default-mode turns and continues the tool loop", async () => {
    const provider = new MediatedGeminiProvider();
    const toolExecutor = new EchoToolExecutor();
    const runtime = buildRuntime(provider, toolExecutor);

    const events = await collectEvents(runtime);
    const completed = events.find((event): event is Extract<TurnEvent, { type: "turn_completed" }> => event.type === "turn_completed");
    const toolStart = events.find((event): event is Extract<TurnEvent, { type: "tool_call_start" }> => event.type === "tool_call_start");
    const toolResult = events.find((event): event is Extract<TurnEvent, { type: "tool_result" }> => event.type === "tool_result");
    const systemMessages = provider.generateCalls[0]?.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content) ?? [];

    expect(provider.generateCalls).toHaveLength(2);
    expect(provider.streamCalls).toHaveLength(0);
    expect(provider.generateCalls[0]?.tools).toBeUndefined();
    expect(provider.generateCalls[0]?.messages.some((message) =>
      message.role === "system" && message.content.includes("```tool_call")
    )).toBe(true);
    expect(systemMessages.some((message) => message.includes("Safe read-only tools are available"))).toBe(false);
    expect(systemMessages.some((message) => message.includes("Native Gemini CLI tools are not available in this turn."))).toBe(true);
    expect(systemMessages.some((message) => message.includes("fenced `tool_call` blocks"))).toBe(true);
    expect(toolExecutor.executedToolCalls).toEqual([{
      id: expect.any(String),
      name: "lists.echo",
      arguments: { message: "marker-123" },
    }]);
    expect(toolStart?.toolCall.name).toBe("lists.echo");
    expect(toolResult?.result.result).toEqual({ echoed: "marker-123" });
    expect(completed?.result.finalMessage.content).toBe("Echo confirmed: marker-123");
    expect(completed?.result.messages.some((message: ModelMessage) =>
      message.role === "assistant" && message.content.includes("```tool_call")
    )).toBe(false);
  });

  test("passes gateway MCP bridge config into claude-agent-sdk mediated turns", async () => {
    class MediatedClaudeAgentSdkProvider implements ModelProvider {
      readonly id = "claude-agent-sdk";
      readonly name = "Claude Agent SDK";
      readonly isLocal = false;
      readonly generateCalls: GenerateOptions[] = [];

      async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
        return { available: true, latencyMs: 1 };
      }

      async listModels(): Promise<ModelInfo[]> {
        return [{
          id: "claude-agent-sdk/claude-sonnet-4-5",
          name: "claude-sonnet-4-5",
          provider: "claude-agent-sdk",
          isLocal: false,
          supportsTools: true,
        }];
      }

      async generate(_model: string, options: GenerateOptions): Promise<GenerateResult> {
        this.generateCalls.push(options);
        return {
          message: {
            role: "assistant",
            content: "Bridge connected.",
          },
          finishReason: "stop",
          usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
        };
      }

      async *stream(_model: string, _options: GenerateOptions): AsyncIterable<StreamChunk> {}
    }

    const provider = new MediatedClaudeAgentSdkProvider();
    const toolExecutor = new EchoToolExecutor();
    const runtime = buildRuntime(provider, toolExecutor);

    const events = await collectEvents(runtime);
    const completed = events.find((event): event is Extract<TurnEvent, { type: "turn_completed" }> => event.type === "turn_completed");

    expect(provider.generateCalls).toHaveLength(1);
    expect(provider.generateCalls[0]?.tools).toBeUndefined();
    expect(provider.generateCalls[0]?.mcpBridgeConfig).toBeDefined();
    expect(provider.generateCalls[0]?.mcpBridgeConfig?.bridgeScriptPath).toContain("gateway-mcp-bridge-stdio.ts");
    expect(provider.generateCalls[0]?.mcpBridgeConfig?.toolDefsJson).toContain("\"lists.echo\"");
    expect(provider.generateCalls[0]?.mcpBridgeConfig?.socketPath).toEqual(expect.any(String));
    expect(completed?.result.finalMessage.content).toBe("Bridge connected.");
  });

  test("passes gateway tool bridge config into codex-app-server mediated turns without MCP discovery fallback", async () => {
    class MediatedCodexAppServerProvider implements ModelProvider {
      readonly id = "codex-app-server";
      readonly name = "Codex App Server";
      readonly isLocal = false;
      readonly generateCalls: GenerateOptions[] = [];

      async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
        return { available: true, latencyMs: 1 };
      }

      async listModels(): Promise<ModelInfo[]> {
        return [{
          id: "codex-app-server/gpt-5.4",
          name: "gpt-5.4",
          provider: "codex-app-server",
          isLocal: false,
          supportsTools: true,
        }];
      }

      async generate(_model: string, options: GenerateOptions): Promise<GenerateResult> {
        this.generateCalls.push(options);
        return {
          message: {
            role: "assistant",
            content: "App server connected.",
          },
          finishReason: "stop",
          usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
        };
      }

      async *stream(_model: string, _options: GenerateOptions): AsyncIterable<StreamChunk> {}
    }

    const provider = new MediatedCodexAppServerProvider();
    const toolExecutor = new EchoToolExecutor();
    const runtime = buildRuntime(provider, toolExecutor);

    const events = await collectEvents(runtime);
    const completed = events.find((event): event is Extract<TurnEvent, { type: "turn_completed" }> => event.type === "turn_completed");

    expect(provider.generateCalls).toHaveLength(1);
    expect(provider.generateCalls[0]?.gatewayToolBridgeConfig).toBeDefined();
    expect(provider.generateCalls[0]?.gatewayToolBridgeConfig?.toolDefsJson).toContain("\"lists.echo\"");
    expect(provider.generateCalls[0]?.mcpBridgeConfig?.socketPath).toEqual(
      provider.generateCalls[0]?.gatewayToolBridgeConfig?.socketPath,
    );
    expect(completed?.result.finalMessage.content).toBe("App server connected.");
  });

  test("keeps gemini full-access turns on native CLI streaming", async () => {
    class NativeGeminiProvider implements ModelProvider {
      readonly id = "gemini";
      readonly name = "Gemini";
      readonly isLocal = true;
      readonly generateCalls: GenerateOptions[] = [];
      readonly streamCalls: GenerateOptions[] = [];

      async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
        return { available: true, latencyMs: 1 };
      }

      async listModels(): Promise<ModelInfo[]> {
        return [{
          id: "gemini/gemini-2.5-flash",
          name: "gemini-2.5-flash",
          provider: "gemini",
          isLocal: true,
          supportsTools: true,
        }];
      }

      async generate(_model: string, options: GenerateOptions): Promise<GenerateResult> {
        this.generateCalls.push(options);
        throw new Error("generate() should not run for Gemini full-access streaming turns");
      }

      async *stream(_model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.streamCalls.push(options);
        yield { type: "text_delta", text: "Native OK" };
        yield {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
        };
      }
    }

    const provider = new NativeGeminiProvider();
    const runtime = buildRuntime(provider, new EchoToolExecutor(), { tools: [] });

    const events: TurnEvent[] = [];
    for await (const event of runtime.executeTurn(makeTurnContext({ accessMode: "full_access" }))) {
      events.push(event);
    }

    const completed = events.find((event): event is Extract<TurnEvent, { type: "turn_completed" }> => event.type === "turn_completed");

    expect(provider.streamCalls).toHaveLength(1);
    expect(provider.streamCalls[0]?.accessMode).toBe("full_access");
    expect(provider.generateCalls).toHaveLength(0);
    expect(completed?.result.finalMessage.content).toBe("Native OK");
  });
});
