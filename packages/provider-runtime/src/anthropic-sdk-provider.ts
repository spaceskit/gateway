import Anthropic from "@anthropic-ai/sdk";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  TokenUsage,
  ToolCall,
} from "@spaceskit/core";

export interface AnthropicSdkProviderConfig {
  id: string;
  name: string;
  model: string;
  apiKey?: string;
  isLocal?: boolean;
}

const DEFAULT_MAX_TOKENS = 8_192;

/**
 * ModelProvider backed by the Anthropic Messages API via `@anthropic-ai/sdk`.
 *
 * Key advantages over the CLI executor:
 * - Native function calling (no MCP bridge needed)
 * - Automatic prompt caching via `cache_control` breakpoints
 * - Native extended thinking with `budget_tokens`
 * - Real token usage reporting (not estimates)
 */
export class AnthropicSdkModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: AnthropicSdkProviderConfig;
  private readonly client: Anthropic;

  constructor(config: AnthropicSdkProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? false;
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    try {
      // Minimal API call to verify auth
      await this.client.messages.create({
        model: this.resolveModelId(this.config.model),
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      return { available: true, latencyMs: Date.now() - startedAt };
    } catch {
      return { available: false, latencyMs: Date.now() - startedAt };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const modelId = this.resolveModelId(this.config.model);
    return [{
      id: `anthropic/${modelId}`,
      name: modelId,
      provider: "anthropic",
      supportsTools: true,
      isLocal: false,
    }];
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const modelId = this.resolveModelId(model || this.config.model);
    const { systemPrompt, messages } = this.splitSystemAndMessages(options.messages);
    const params = this.buildParams(modelId, systemPrompt, messages, options);

    const response = await this.client.messages.create({ ...params, stream: false }) as Anthropic.Message;

    const content = this.extractContent(response);
    const toolCalls = this.extractToolCalls(response);

    return {
      message: {
        role: "assistant",
        content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      usage: this.parseUsage(response.usage),
      finishReason: this.mapStopReason(response.stop_reason),
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const modelId = this.resolveModelId(model || this.config.model);
    const { systemPrompt, messages } = this.splitSystemAndMessages(options.messages);
    const params = this.buildParams(modelId, systemPrompt, messages, options);

    const stream = this.client.messages.stream({ ...params });

    let currentToolCall: Partial<ToolCall> | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "thinking") {
          // Thinking block started — will emit reasoning_delta events
        } else if (block.type === "tool_use") {
          currentToolCall = {
            id: block.id,
            name: block.name,
            arguments: {},
          };
          yield { type: "tool_call_start", toolCall: currentToolCall };
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "text_delta", text: delta.text };
        } else if (delta.type === "thinking_delta") {
          yield { type: "reasoning_delta", text: delta.thinking };
        } else if (delta.type === "input_json_delta" && currentToolCall) {
          yield { type: "tool_call_delta", toolCall: currentToolCall, text: delta.partial_json };
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolCall) {
          yield { type: "tool_call_end", toolCall: currentToolCall };
          currentToolCall = null;
        }
      } else if (event.type === "message_delta") {
        const usage = event.usage
          ? {
            promptTokens: 0,
            completionTokens: event.usage.output_tokens ?? 0,
            totalTokens: event.usage.output_tokens ?? 0,
            tokenAccuracy: "reported" as const,
            usageSource: "ledger" as const,
          }
          : undefined;
        yield {
          type: "finish",
          usage,
          finishReason: this.mapStopReason(event.delta.stop_reason),
        };
      }
    }

    // Final usage from the completed message
    const finalMessage = await stream.finalMessage();
    if (finalMessage.usage) {
      yield {
        type: "finish",
        usage: this.parseUsage(finalMessage.usage),
        finishReason: this.mapStopReason(finalMessage.stop_reason),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private resolveModelId(modelIdRaw: string): string {
    const modelId = modelIdRaw.trim();
    // Strip "anthropic/" prefix if present
    if (modelId.startsWith("anthropic/")) {
      return modelId.slice("anthropic/".length);
    }
    return modelId;
  }

  private splitSystemAndMessages(
    messages: ModelMessage[],
  ): { systemPrompt: string | undefined; messages: Anthropic.MessageParam[] } {
    let systemPrompt: string | undefined;
    const apiMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        // Concatenate system messages (last one wins for cache_control placement)
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
        continue;
      }

      if (msg.role === "assistant") {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments ?? {},
            });
          }
        }
        apiMessages.push({ role: "assistant", content });
        continue;
      }

      if (msg.role === "tool") {
        apiMessages.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: msg.toolCallId ?? "",
            content: msg.content,
          }],
        });
        continue;
      }

      // User messages
      apiMessages.push({ role: "user", content: msg.content });
    }

    return { systemPrompt, messages: apiMessages };
  }

  private buildParams(
    modelId: string,
    systemPrompt: string | undefined,
    messages: Anthropic.MessageParam[],
    options: GenerateOptions,
  ): Anthropic.MessageCreateParams {
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

    const params: Anthropic.MessageCreateParams = {
      model: modelId,
      max_tokens: maxTokens,
      messages,
      ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
      ...(options.stopSequences?.length ? { stop_sequences: options.stopSequences } : {}),
    };

    // System prompt with cache_control for prompt caching
    if (systemPrompt) {
      params.system = [{
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      }];
    }

    // Tools with native function calling
    if (options.tools?.length) {
      params.tools = options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
      }));
    }

    // Extended thinking
    if (options.thinkingConfig?.enabled) {
      const budgetTokens = options.thinkingConfig.budgetTokens ?? 4_096;
      params.thinking = {
        type: options.thinkingConfig.enabled === "adaptive" ? "enabled" : "enabled",
        budget_tokens: budgetTokens,
      };
      // When thinking is enabled, max_tokens must be greater than budget_tokens
      if (maxTokens <= budgetTokens) {
        params.max_tokens = budgetTokens + maxTokens;
      }
    }

    return params;
  }

  private extractContent(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  private extractToolCalls(response: Anthropic.Message): ToolCall[] {
    return response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: (block.input ?? {}) as Record<string, unknown>,
      }));
  }

  private parseUsage(usage: Anthropic.Usage): TokenUsage {
    const promptTokens = usage.input_tokens ?? 0;
    const completionTokens = usage.output_tokens ?? 0;
    // Cache token fields exist on the usage object but may not be in the base type
    const raw = usage as unknown as Record<string, unknown>;
    const cacheRead = typeof raw.cache_read_input_tokens === "number" ? raw.cache_read_input_tokens : 0;
    const cacheCreation = typeof raw.cache_creation_input_tokens === "number" ? raw.cache_creation_input_tokens : 0;

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      tokenAccuracy: "reported",
      usageSource: "ledger",
      usageDetails: {
        inputCacheReadTokens: cacheRead,
        inputCacheWriteTokens: cacheCreation,
        inputNoCacheTokens: promptTokens - cacheRead - cacheCreation,
        outputTextTokens: completionTokens,
      },
    };
  }

  private mapStopReason(reason: string | null): GenerateResult["finishReason"] {
    switch (reason) {
      case "end_turn":
        return "stop";
      case "max_tokens":
        return "length";
      case "tool_use":
        return "tool_calls";
      case "stop_sequence":
        return "stop";
      default:
        return "other";
    }
  }
}
