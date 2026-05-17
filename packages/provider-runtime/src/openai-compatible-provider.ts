import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  TokenUsage,
  ToolDefinition,
} from "@spaceskit/core";
import { ToolsUnsupportedError, UnsupportedProviderError } from "./provider-errors.js";
import {
  DEFAULT_BASE_URL_BY_PROVIDER,
  asRecord,
  extractContentText,
  extractSseData,
  firstChoice,
  isOSeriesModel,
  normalizeFinishReason,
  normalizeProviderId,
  normalizeToolSchema,
  parseToolCalls,
  parseUsage,
  resolveApiKey,
  safeParseJson,
  toOpenAIReasoningEffort,
  type ModelReference,
  type SupportedProviderId,
} from "./openai-compatible-helpers.js";

type FetchLike = typeof fetch;

export interface OpenAICompatibleProviderConfig {
  id: string;
  name: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  isLocal?: boolean;
  fetchImpl?: FetchLike;
}


export class OpenAICompatibleModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: OpenAICompatibleProviderConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? false;
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    const providerId = normalizeProviderId(this.id);
    if (!providerId) {
      return {
        available: false,
        latencyMs: Date.now() - startedAt,
      };
    }
    try {
      const response = await this.fetchImpl(this.buildUrl(providerId, "models"), {
        headers: this.buildHeaders(providerId),
      });
      return {
        available: response.ok,
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return {
        available: false,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const reference = this.parseModelReference(this.config.model, this.id);
    return [{
      id: reference.fullModelId,
      name: reference.providerModelId,
      provider: reference.providerId,
      supportsTools: true,
      isLocal: this.isLocal,
    }];
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    const body: Record<string, unknown> = {
      model: reference.providerModelId,
      messages: this.toOpenAIMessages(options.messages),
      stream: false,
      ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
      ...(typeof options.maxTokens === "number" ? { max_tokens: options.maxTokens } : {}),
      ...(options.stopSequences?.length ? { stop: options.stopSequences } : {}),
    };

    if (options.tools?.length) {
      body.tools = this.toOpenAITools(options.tools);
      body.tool_choice = "auto";
    }

    // Wire reasoning_effort for OpenAI o-series models
    if (reference.providerId === "openai" && options.effort && isOSeriesModel(reference.providerModelId)) {
      body.reasoning_effort = toOpenAIReasoningEffort(options.effort);
    }

    const response = await this.fetchImpl(this.buildUrl(reference.providerId, "chat/completions"), {
      method: "POST",
      headers: this.buildHeaders(reference.providerId),
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    const payload = await response.json() as Record<string, unknown>;
    const choice = firstChoice(payload);
    const message = asRecord(choice?.message);
    const finishReason = normalizeFinishReason(choice?.finish_reason);
    const toolCalls = parseToolCalls(message?.tool_calls);
    const assistantMessage: ModelMessage = {
      role: "assistant",
      content: extractContentText(message?.content),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };

    return {
      message: assistantMessage,
      usage: parseUsage(asRecord(payload.usage)),
      finishReason,
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    const body: Record<string, unknown> = {
      model: reference.providerModelId,
      messages: this.toOpenAIMessages(options.messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
      ...(typeof options.maxTokens === "number" ? { max_tokens: options.maxTokens } : {}),
      ...(options.stopSequences?.length ? { stop: options.stopSequences } : {}),
    };

    if (options.tools?.length) {
      throw new ToolsUnsupportedError(reference.providerId, "Streaming with gateway tools is not supported.");
    }

    // Wire reasoning_effort for OpenAI o-series models
    if (reference.providerId === "openai" && options.effort && isOSeriesModel(reference.providerModelId)) {
      body.reasoning_effort = toOpenAIReasoningEffort(options.effort);
    }

    const response = await this.fetchImpl(this.buildUrl(reference.providerId, "chat/completions"), {
      method: "POST",
      headers: this.buildHeaders(reference.providerId),
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      throw await this.toProviderError(response);
    }
    if (!response.body) {
      throw new Error(`Streaming body unavailable for provider ${reference.providerId}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: TokenUsage | undefined;
    let finishReason: GenerateResult["finishReason"] = "stop";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const data = extractSseData(event);
        if (!data) {
          continue;
        }
        if (data === "[DONE]") {
          yield {
            type: "finish",
            usage,
            finishReason,
          };
          return;
        }

        const payload = safeParseJson(data);
        if (!payload) {
          continue;
        }

        const payloadUsage = parseUsage(asRecord(payload.usage));
        if (payloadUsage) {
          usage = payloadUsage;
        }

        const choice = firstChoice(payload);
        const delta = asRecord(choice?.delta);
        const text = extractContentText(delta?.content);
        if (text) {
          yield { type: "text_delta", text };
        }

        const nextFinishReason = normalizeFinishReason(choice?.finish_reason);
        if (nextFinishReason !== "other") {
          finishReason = nextFinishReason;
        }
      }

      if (done) {
        const trailingEvent = buffer.trim();
        if (trailingEvent) {
          const data = extractSseData(trailingEvent);
          if (data && data !== "[DONE]") {
            const payload = safeParseJson(data);
            if (payload) {
              const payloadUsage = parseUsage(asRecord(payload.usage));
              if (payloadUsage) {
                usage = payloadUsage;
              }
              const choice = firstChoice(payload);
              const delta = asRecord(choice?.delta);
              const text = extractContentText(delta?.content);
              if (text) {
                yield { type: "text_delta", text };
              }
              const nextFinishReason = normalizeFinishReason(choice?.finish_reason);
              if (nextFinishReason !== "other") {
                finishReason = nextFinishReason;
              }
            }
          }
        }
        break;
      }
    }

    yield {
      type: "finish",
      usage,
      finishReason,
    };
  }

  private parseModelReference(modelIdRaw: string, providerHintRaw?: string): ModelReference {
    const modelId = modelIdRaw.trim();
    if (!modelId) {
      throw new Error("Model ID is required");
    }

    const [prefixRaw, ...rest] = modelId.split("/");
    if (rest.length > 0) {
      const providerId = normalizeProviderId(prefixRaw);
      if (!providerId) {
        throw new UnsupportedProviderError(prefixRaw, "Unsupported OpenAI-compatible provider.");
      }
      const providerModelId = rest.join("/").trim();
      if (!providerModelId) {
        throw new Error(`Invalid model ID: ${modelId}`);
      }
      const hintedProviderId = normalizeProviderId(providerHintRaw);
      if (hintedProviderId && hintedProviderId !== providerId) {
        throw new UnsupportedProviderError(
          `${hintedProviderId}/${providerModelId}`,
          `Model "${modelId}" does not belong to provider ${hintedProviderId}.`,
        );
      }
      return {
        providerId,
        fullModelId: `${providerId}/${providerModelId}`,
        providerModelId,
      };
    }

    const providerId = normalizeProviderId(providerHintRaw);
    if (!providerId) {
      throw new Error(`Model "${modelId}" is missing a provider prefix.`);
    }
    return {
      providerId,
      fullModelId: `${providerId}/${modelId}`,
      providerModelId: modelId,
    };
  }

  private toOpenAIMessages(messages: ModelMessage[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments ?? {}),
            },
          })),
        };
      }

      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
          ...(message.toolName ? { name: message.toolName } : {}),
        };
      }

      return {
        role: message.role,
        content: message.content,
      };
    });
  }

  private toOpenAITools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: normalizeToolSchema(tool.inputSchema),
      },
    }));
  }

  private buildUrl(providerId: SupportedProviderId, path: string): string {
    const configuredBase = this.config.baseURL?.trim();
    const baseURL = configuredBase || DEFAULT_BASE_URL_BY_PROVIDER[providerId];
    return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  private buildHeaders(providerId?: SupportedProviderId): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    const apiKey = resolveApiKey(this.config.apiKey, providerId ?? normalizeProviderId(this.id));
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    if ((providerId ?? normalizeProviderId(this.id)) === "openrouter") {
      headers["x-title"] = "Spaces";
    }

    return headers;
  }

  private async toProviderError(response: Response): Promise<Error> {
    let payloadText = "";
    try {
      payloadText = await response.text();
    } catch {
      payloadText = "";
    }

    const parsed = safeParseJson(payloadText);
    const errorPayload = asRecord(parsed?.error) ?? parsed;
    const message = typeof errorPayload?.message === "string"
      ? errorPayload.message
      : payloadText || `Request failed with status ${response.status}`;

    if (
      response.status === 400
      && /tool|function/.test(message.toLowerCase())
      && /unsupported|not support|unknown/.test(message.toLowerCase())
    ) {
      const error = new ToolsUnsupportedError(this.id, message);
      (error as Error & { status?: number }).status = response.status;
      return error;
    }

    const error = new Error(message);
    (error as Error & { status?: number }).status = response.status;
    return error;
  }
}
