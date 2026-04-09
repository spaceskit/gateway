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
import type { ToolExecutionContext, ToolExecutor, ToolPermission } from "../../src/agents/tool-executor.js";
import { EventBus } from "../../src/events/event-bus.js";

class StubToolExecutor implements ToolExecutor {
  async getAvailableTools(_spaceId: string, _agentId: string): Promise<ToolDefinition[]> {
    return [{
      name: "files.read",
      description: "Read files",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    }];
  }

  async checkPermission(_toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolPermission> {
    return {
      toolName: "files.read",
      allowed: true,
    };
  }

  async execute(_toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolResult> {
    return {
      toolCallId: "tool-1",
      result: { ok: true },
      isError: false,
    };
  }
}

class StubModelProvider implements ModelProvider {
  readonly name = "Stub";
  readonly isLocal = true;
  readonly calls: GenerateOptions[] = [];

  constructor(
    readonly id: string,
    private readonly generateImpl: (options: GenerateOptions, call: number) => Promise<GenerateResult>,
  ) {}

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return { available: true, latencyMs: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: `${this.id}/test-model`, name: "Test", provider: this.id, isLocal: true }];
  }

  async generate(_model: string, options: GenerateOptions): Promise<GenerateResult> {
    this.calls.push(options);
    return this.generateImpl(options, this.calls.length);
  }

  async *stream(_model: string, _options: GenerateOptions): AsyncIterable<StreamChunk> {}
}

function buildRuntime(modelProvider: ModelProvider, modelId: string): DefaultAgentRuntime {
  const config: AgentConfig = {
    id: "agent-1",
    profileId: "profile-1",
    systemPrompt: "You are helpful.",
    modelProvider: modelProvider.id,
    modelId,
    tools: ["files.read"],
    maxSteps: 3,
  };

  return new DefaultAgentRuntime({
    config,
    modelProvider,
    toolExecutor: new StubToolExecutor(),
    eventBus: new EventBus(),
  });
}

function makeTurnContext(): TurnContext {
  return {
    spaceId: "space-1",
    turnId: "turn-1",
    messages: [{ role: "user", content: "hello" }],
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

function lmStudioToolsUnsupportedError(): Error & { status: number; code: string } {
  const err = new Error("Bad Request: This model does not support tools") as Error & {
    status: number;
    code: string;
  };
  err.status = 400;
  err.code = "bad_request";
  return err;
}

function lmStudioModelMissingError(): Error & { status: number; code: string } {
  const err = new Error("Bad Request: model not found for this runtime") as Error & {
    status: number;
    code: string;
  };
  err.status = 400;
  err.code = "bad_request";
  return err;
}

describe("DefaultAgentRuntime LM Studio bad request handling", () => {
  test("retries once without tools for LM Studio tool-unsupported bad requests", async () => {
    const provider = new StubModelProvider("lmstudio", async (options, call) => {
      if (call === 1) {
        expect(options.tools?.length).toBeGreaterThan(0);
        throw lmStudioToolsUnsupportedError();
      }
      expect(options.tools).toBeUndefined();
      return {
        message: { role: "assistant", content: "fallback without tools" },
        finishReason: "stop",
        usage: { promptTokens: 4, completionTokens: 3, totalTokens: 7 },
      };
    });
    const runtime = buildRuntime(provider, "lmstudio/qwen2.5-coder");

    const events = await collectEvents(runtime);
    const completion = events.find((event) => event.type === "turn_completed");

    expect(provider.calls).toHaveLength(2);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(completion?.type).toBe("turn_completed");
    const finalMessage = completion && completion.type === "turn_completed"
      ? completion.result.finalMessage.content
      : "";
    expect(finalMessage).toContain("Tool calling is unavailable for lmstudio");
    expect(finalMessage).toContain("fallback without tools");
  });

  test("retries without tools for other providers when tool-calling is unsupported", async () => {
    const provider = new StubModelProvider("openai", async (options, call) => {
      if (call === 1) {
        expect(options.tools?.length).toBeGreaterThan(0);
        throw lmStudioToolsUnsupportedError();
      }
      expect(options.tools).toBeUndefined();
      return {
        message: { role: "assistant", content: "fallback openai" },
        finishReason: "stop",
      };
    });
    const runtime = buildRuntime(provider, "openai/gpt-4.1");

    const events = await collectEvents(runtime);
    const completion = events.find((event) => event.type === "turn_completed");
    const finalMessage = completion && completion.type === "turn_completed"
      ? completion.result.finalMessage.content
      : "";

    expect(provider.calls).toHaveLength(2);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(finalMessage).toContain("Tool calling is unavailable for openai");
    expect(finalMessage).toContain("fallback openai");
  });

  test("maps LM Studio model-missing bad requests to actionable errors", async () => {
    const provider = new StubModelProvider("lmstudio", async () => {
      throw lmStudioModelMissingError();
    });
    const runtime = buildRuntime(provider, "lmstudio/qwen2.5-coder");

    const events = await collectEvents(runtime);
    const errorEvent = events.find((event) => event.type === "error");

    expect(provider.calls).toHaveLength(1);
    expect(errorEvent?.type).toBe("error");
    expect(errorEvent && errorEvent.type === "error" ? errorEvent.error.message : "").toContain(
      "Load the model in LM Studio or choose an available model in Main Agent settings",
    );
  });

  test("skips gateway tool injection when native CLI tools are enabled", async () => {
    const provider = new StubModelProvider("claude", async (options) => {
      expect(options.tools).toBeUndefined();
      expect(options.nativeCliToolsEnabled).toBe(true);
      expect(options.workingDirectory).toBe("/tmp/native-cli-tools");
      return {
        message: { role: "assistant", content: "native cli response" },
        finishReason: "stop",
        usage: { promptTokens: 4, completionTokens: 3, totalTokens: 7, tokenAccuracy: "estimated" },
      };
    });

    const config: AgentConfig = {
      id: "agent-1",
      profileId: "profile-1",
      systemPrompt: "You are helpful.",
      modelProvider: "claude",
      modelId: "claude/sonnet",
      tools: ["files.read"],
      maxSteps: 3,
      nativeCliToolsEnabled: true,
      workingDirectory: "/tmp/native-cli-tools",
    };

    const runtime = new DefaultAgentRuntime({
      config,
      modelProvider: provider,
      toolExecutor: new StubToolExecutor(),
      eventBus: new EventBus(),
    });

    const events = await collectEvents(runtime);
    const completion = events.find((event) => event.type === "turn_completed");
    const finalMessage = completion && completion.type === "turn_completed"
      ? completion.result.finalMessage.content
      : "";

    expect(provider.calls).toHaveLength(1);
    expect(finalMessage).toContain("native cli response");
    expect(finalMessage).not.toContain("Tool calling is unavailable");
  });
});
