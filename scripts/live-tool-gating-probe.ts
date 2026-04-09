import {
  DefaultAgentRuntime,
  EventBus,
  type AgentConfig,
  type GenerateOptions,
  type GenerateResult,
  type ModelInfo,
  type ModelProvider,
  type StreamChunk,
  type ToolAvailabilityOptions,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolExecutor,
  type ToolPermission,
  type ToolResult,
  type TurnContext,
  type TurnEvent,
} from "@spaceskit/core";
import { CliExecutorModelProvider } from "../packages/provider-runtime/src/cli-executor-provider.js";
import { LmStudioModelProvider } from "../packages/provider-runtime/src/lmstudio-provider.js";

type ProbeProviderId = "claude" | "lmstudio";

interface RecordedProviderCall {
  method: "generate" | "stream";
  model: string;
  tools: string[];
  accessMode: GenerateOptions["accessMode"] | null;
  nativeCliToolsEnabled: boolean;
  finishReason?: string;
  error?: string;
  streamTextDeltaCount?: number;
  streamToolCallCount?: number;
}

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
      description: "Read a file from the active workspace",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    }];

    if (!options?.suppressInjectedTools) {
      tools.push({
        name: "platform.listSpaces",
        description: "List spaces from the current gateway",
        inputSchema: {
          type: "object",
          properties: {},
        },
      });
    }

    return tools;
  }

  async checkPermission(toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolPermission> {
    return {
      toolName: toolCall.name,
      allowed: true,
    };
  }

  async execute(toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolResult> {
    if (toolCall.name === "platform.listSpaces") {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: {
          spaces: [
            { id: "main-space", name: "Main Space" },
            { id: "ops-space", name: "Ops Space" },
          ],
        },
        isError: false,
      };
    }

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      result: {
        path: typeof toolCall.arguments.path === "string" ? toolCall.arguments.path : null,
        content: "stub file contents",
      },
      isError: false,
    };
  }
}

class RecordingModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;
  readonly calls: RecordedProviderCall[] = [];

  constructor(private readonly inner: ModelProvider) {
    this.id = inner.id;
    this.name = inner.name;
    this.isLocal = inner.isLocal;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return await this.inner.checkHealth();
  }

  async listModels(): Promise<ModelInfo[]> {
    return await this.inner.listModels();
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const call: RecordedProviderCall = {
      method: "generate",
      model,
      tools: (options.tools ?? []).map((tool) => tool.name),
      accessMode: options.accessMode ?? null,
      nativeCliToolsEnabled: options.nativeCliToolsEnabled === true,
    };
    this.calls.push(call);

    try {
      const result = await this.inner.generate(model, options);
      call.finishReason = result.finishReason;
      return result;
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const call: RecordedProviderCall = {
      method: "stream",
      model,
      tools: (options.tools ?? []).map((tool) => tool.name),
      accessMode: options.accessMode ?? null,
      nativeCliToolsEnabled: options.nativeCliToolsEnabled === true,
      streamTextDeltaCount: 0,
      streamToolCallCount: 0,
    };
    this.calls.push(call);

    try {
      for await (const chunk of this.inner.stream(model, options)) {
        if (chunk.type === "text_delta") {
          call.streamTextDeltaCount = (call.streamTextDeltaCount ?? 0) + 1;
        }
        if (chunk.type === "tool_call_start") {
          call.streamToolCallCount = (call.streamToolCallCount ?? 0) + 1;
        }
        if (chunk.type === "finish") {
          call.finishReason = chunk.finishReason;
        }
        yield chunk;
      }
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}

function buildProvider(providerId: ProbeProviderId): RecordingModelProvider {
  switch (providerId) {
    case "claude":
      return new RecordingModelProvider(new CliExecutorModelProvider({
        id: "claude",
        name: "Claude Code",
        model: "claude/sonnet",
      }));
    case "lmstudio":
      return new RecordingModelProvider(new LmStudioModelProvider({
        id: "lmstudio",
        name: "LM Studio",
        model: "lmstudio/google/gemma-3-4b",
      }));
  }
}

function buildRuntime(modelProvider: ModelProvider, toolExecutor: ToolExecutor): DefaultAgentRuntime {
  const config: AgentConfig = {
    id: "agent-live-probe",
    profileId: "profile-live-probe",
    systemPrompt: "You are helpful. Use tools when they are available and relevant.",
    modelProvider: modelProvider.id,
    modelId: modelProvider.id === "claude" ? "claude/sonnet" : "lmstudio/google/gemma-3-4b",
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

function buildTurnContext(turnId: string, prompt: string): TurnContext {
  return {
    spaceId: "space-live-probe",
    turnId,
    messages: [{ role: "user", content: prompt }],
    lineageId: `lineage-${turnId}`,
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

async function runPromptProbe(providerId: ProbeProviderId, prompt: string, turnId: string) {
  const provider = buildProvider(providerId);
  const toolExecutor = new GatingToolExecutor();
  const runtime = buildRuntime(provider, toolExecutor);
  const events = await collectEvents(runtime, buildTurnContext(turnId, prompt));
  const completion = events.find((event): event is Extract<TurnEvent, { type: "turn_completed" }> => event.type === "turn_completed");

  return {
    prompt,
    availabilityRequests: toolExecutor.availabilityRequests,
    providerCalls: provider.calls,
    toolCallStarts: events
      .filter((event): event is Extract<TurnEvent, { type: "tool_call_start" }> => event.type === "tool_call_start")
      .map((event) => event.toolCall.name),
    toolResults: events
      .filter((event): event is Extract<TurnEvent, { type: "tool_result" }> => event.type === "tool_result")
      .map((event) => ({
        name: event.result.name ?? null,
        isError: event.result.isError === true,
      })),
    finalMessage: completion?.result.finalMessage.content ?? null,
    finishReason: completion?.result.metadata?.finishReason ?? null,
  };
}

function parseRequestedProviders(argv: string[]): ProbeProviderId[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--provider" && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--provider=")) {
      values.push(arg.slice("--provider=".length));
    }
  }

  if (values.length === 0) {
    return ["claude", "lmstudio"];
  }

  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ProbeProviderId => value === "claude" || value === "lmstudio");

  return normalized.length > 0 ? normalized : ["claude", "lmstudio"];
}

async function main(): Promise<void> {
  const providers = parseRequestedProviders(Bun.argv.slice(2));
  const results = [];

  for (const providerId of providers) {
    const provider = buildProvider(providerId);
    const health = await provider.checkHealth();
    const models = await provider.listModels();

    results.push({
      providerId,
      providerName: provider.name,
      health,
      models: models
        .filter((model) => model.id.includes(providerId === "claude" ? "claude/" : "google/gemma-3-4b"))
        .slice(0, 3)
        .map((model) => ({
          id: model.id,
          supportsTools: model.supportsTools === true,
          contextWindow: model.contextWindow ?? null,
        })),
      observations: [
        await runPromptProbe(providerId, "hey there", `${providerId}-greeting`),
        await runPromptProbe(providerId, "list spaces", `${providerId}-spaces`),
      ],
    });
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
}

await main();
