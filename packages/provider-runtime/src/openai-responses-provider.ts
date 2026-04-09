import OpenAI from "openai";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  ProviderSessionHandle,
  StreamChunk,
  TokenUsage,
  ToolCall,
  TurnReasoningEffort,
} from "@spaceskit/core";

export interface OpenAIResponsesProviderConfig {
  id: string;
  name: string;
  model: string;
  apiKey?: string;
  isLocal?: boolean;
}

/**
 * ModelProvider backed by the OpenAI Responses API.
 *
 * Key advantages over the Chat Completions API:
 * - Server-side session management via `previous_response_id`
 * - Native `reasoning` parameter for o-series models
 * - No need to resend full history after the first turn
 */
export class OpenAIResponsesModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: OpenAIResponsesProviderConfig;
  private readonly client: OpenAI;

  constructor(config: OpenAIResponsesProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? false;
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
    });
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    try {
      await this.client.models.list();
      return { available: true, latencyMs: Date.now() - startedAt };
    } catch {
      return { available: false, latencyMs: Date.now() - startedAt };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const modelId = this.resolveModelId(this.config.model);
    return [{
      id: `openai/${modelId}`,
      name: modelId,
      provider: "openai",
      supportsTools: true,
      isLocal: false,
    }];
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const modelId = this.resolveModelId(model || this.config.model);
    const previousResponseId = this.extractPreviousResponseId(options.providerSessionHandle);

    const params: OpenAI.Responses.ResponseCreateParams = {
      model: modelId,
      input: this.toResponseInput(options.messages, previousResponseId),
      ...(options.tools?.length ? { tools: this.toResponseTools(options.tools) } : {}),
      ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
      ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
    };

    // Reasoning effort for o-series models
    if (options.effort && isOSeriesModel(modelId)) {
      params.reasoning = {
        effort: toOpenAIReasoningEffort(options.effort),
      };
    }

    // If we have a previous response, only send new messages (server has history)
    if (previousResponseId) {
      params.input = this.toNewMessagesOnly(options.messages);
    }

    const response = await this.client.responses.create(params);

    const content = this.extractContent(response);
    const toolCalls = this.extractToolCalls(response);
    const sessionHandle: ProviderSessionHandle = {
      type: "openai_response",
      previousResponseId: response.id,
    };

    return {
      message: {
        role: "assistant",
        content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      usage: this.parseUsage(response.usage ?? null),
      finishReason: this.mapStatus(response.status ?? "completed"),
      providerSessionHandle: sessionHandle,
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const modelId = this.resolveModelId(model || this.config.model);
    const previousResponseId = this.extractPreviousResponseId(options.providerSessionHandle);

    const params: OpenAI.Responses.ResponseCreateParams = {
      model: modelId,
      input: previousResponseId
        ? this.toNewMessagesOnly(options.messages)
        : this.toResponseInput(options.messages, previousResponseId),
      ...(options.tools?.length ? { tools: this.toResponseTools(options.tools) } : {}),
      ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
      ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
      stream: true,
    };

    if (options.effort && isOSeriesModel(modelId)) {
      params.reasoning = {
        effort: toOpenAIReasoningEffort(options.effort),
      };
    }

    if (previousResponseId) {
      (params as unknown as Record<string, unknown>).previous_response_id = previousResponseId;
    }

    const stream = await this.client.responses.create(params);

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        yield { type: "text_delta", text: (event as { delta: string }).delta };
      } else if (event.type === "response.completed") {
        const resp = (event as { response: OpenAI.Responses.Response }).response;
        yield {
          type: "finish",
          usage: this.parseUsage(resp.usage ?? null),
          finishReason: this.mapStatus(resp.status ?? "completed"),
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private resolveModelId(modelIdRaw: string): string {
    const modelId = modelIdRaw.trim();
    if (modelId.startsWith("openai/")) {
      return modelId.slice("openai/".length);
    }
    return modelId;
  }

  private extractPreviousResponseId(handle?: ProviderSessionHandle): string | undefined {
    if (handle?.type === "openai_response") {
      return handle.previousResponseId;
    }
    return undefined;
  }

  private toResponseInput(
    messages: ModelMessage[],
    previousResponseId?: string,
  ): OpenAI.Responses.ResponseInputItem[] {
    if (previousResponseId) {
      return this.toNewMessagesOnly(messages);
    }

    return messages
      .filter((msg) => msg.role !== "system")
      .map((msg) => {
        if (msg.role === "user") {
          return { role: "user" as const, content: msg.content };
        }
        if (msg.role === "assistant") {
          return { role: "assistant" as const, content: msg.content };
        }
        // Tool results
        return { role: "user" as const, content: `[Tool result for ${msg.toolName ?? msg.toolCallId}]: ${msg.content}` };
      });
  }

  private toNewMessagesOnly(messages: ModelMessage[]): OpenAI.Responses.ResponseInputItem[] {
    // When resuming a session, only send the last user message (server has the rest)
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return [];

    const newMessages = messages.slice(lastUserIdx);
    return newMessages
      .filter((msg) => msg.role !== "system")
      .map((msg) => ({
        role: (msg.role === "tool" ? "user" : msg.role) as "user" | "assistant",
        content: msg.content,
      }));
  }

  private toResponseTools(
    tools: NonNullable<GenerateOptions["tools"]>,
  ): OpenAI.Responses.Tool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    }));
  }

  private extractContent(response: OpenAI.Responses.Response): string {
    return response.output
      .filter((item): item is OpenAI.Responses.ResponseOutputMessage => item.type === "message")
      .flatMap((item) => item.content)
      .filter((block): block is OpenAI.Responses.ResponseOutputText => block.type === "output_text")
      .map((block) => block.text)
      .join("");
  }

  private extractToolCalls(response: OpenAI.Responses.Response): ToolCall[] {
    return response.output
      .filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call")
      .map((item) => ({
        id: item.call_id,
        name: item.name,
        arguments: safeParseJson(item.arguments) ?? {},
      }));
  }

  private parseUsage(usage: OpenAI.Responses.ResponseUsage | null): TokenUsage | undefined {
    if (!usage) return undefined;
    const promptTokens = usage.input_tokens ?? 0;
    const completionTokens = usage.output_tokens ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: usage.total_tokens ?? (promptTokens + completionTokens),
      tokenAccuracy: "reported",
      usageSource: "ledger",
      usageDetails: {
        inputCacheReadTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        outputReasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
      },
    };
  }

  private mapStatus(status: string): GenerateResult["finishReason"] {
    switch (status) {
      case "completed":
        return "stop";
      case "incomplete":
        return "length";
      case "failed":
        return "error";
      default:
        return "other";
    }
  }
}

function isOSeriesModel(modelId: string): boolean {
  return /^o\d/.test(modelId.trim().toLowerCase());
}

function toOpenAIReasoningEffort(effort: TurnReasoningEffort): "low" | "medium" | "high" {
  if (effort === "max") return "high";
  return effort;
}

function safeParseJson(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
