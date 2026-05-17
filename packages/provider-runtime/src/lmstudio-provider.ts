import type { FunctionToolCallRequest } from "@lmstudio/sdk";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "@spaceskit/core";
import { ToolsUnsupportedError, UnsupportedProviderError } from "./provider-errors.js";
import {
  asLmStudioTokenUsage,
  buildToolTransportPlan,
  checkLmStudioAvailability,
  createDefaultLmStudioClient,
  createLmStudioSdkLogger,
  describeLmStudioError,
  disposeLmStudioClient,
  estimateUsage,
  listLmStudioLoadedModels,
  mapLmStudioToolCallRequest,
  normalizeLmStudioBaseURL,
  normalizeLmStudioFinishReason,
  normalizeProviderId,
  normalizeTextContent,
  resolveLoadedLmStudioModel,
  toLmStudioChat,
  withLmStudioClient,
  type LmStudioClientFactory,
  type LmStudioLoadedModelInfo,
} from "./lmstudio-provider-helpers.js";

interface ModelReference {
  providerId: "lmstudio";
  fullModelId: string;
  providerModelId: string;
}

export type { LmStudioClientFactory, LmStudioLoadedModelInfo, LmStudioSdkLoggerLike } from "./lmstudio-provider-helpers.js";
export {
  checkLmStudioAvailability,
  createLmStudioSdkLogger,
  describeLmStudioError,
  listLmStudioLoadedModels,
  normalizeLmStudioBaseURL,
} from "./lmstudio-provider-helpers.js";

export interface LmStudioProviderConfig {
  id: string;
  name: string;
  model: string;
  baseURL?: string;
  isLocal?: boolean;
  clientFactory?: LmStudioClientFactory;
}

export class LmStudioModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;
  readonly toolSupportMode = "native" as const;

  private readonly config: LmStudioProviderConfig;
  private readonly clientFactory: LmStudioClientFactory;

  constructor(config: LmStudioProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? true;
    this.config = config;
    this.clientFactory = config.clientFactory ?? createDefaultLmStudioClient;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    const availability = await checkLmStudioAvailability({
      baseURL: this.config.baseURL,
      clientFactory: this.clientFactory,
    });
    return {
      available: availability.available,
      latencyMs: Date.now() - startedAt,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const reference = this.parseModelReference(this.config.model, this.id);
    try {
      const models = await listLmStudioLoadedModels({
        baseURL: this.config.baseURL,
        clientFactory: this.clientFactory,
      });
      if (models.length > 0) {
        return models.map((model) => ({
          id: `lmstudio/${model.id}`,
          name: model.name || model.id,
          provider: "lmstudio",
          ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
          supportsTools: model.supportsTools,
          isLocal: true,
        }));
      }
    } catch {
      // Fall back to the configured model when discovery is unavailable.
    }

    return [{
      id: reference.fullModelId,
      name: reference.providerModelId,
      provider: reference.providerId,
      isLocal: true,
      supportsTools: false,
    }];
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    return withLmStudioClient(
      {
        baseURL: this.config.baseURL,
        clientFactory: this.clientFactory,
      },
      async (client) => {
        const loadedModel = await resolveLoadedLmStudioModel(client, reference.providerModelId);
        if (options.tools?.length && loadedModel.trainedForToolUse === false) {
          throw new ToolsUnsupportedError(
            "lmstudio",
            `Model "${reference.providerModelId}" is not trained for tool use in LM Studio.`,
          );
        }

        const toolPlan = buildToolTransportPlan(options.tools);
        let toolCallFailure: Error | null = null;
        const capturedToolCalls: ToolCall[] = [];
        const prediction = loadedModel.respond(
          toLmStudioChat(options.messages),
          {
            ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
            ...(typeof options.maxTokens === "number" ? { maxTokens: options.maxTokens } : {}),
            ...(options.stopSequences?.length ? { stopStrings: options.stopSequences } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
            ...(toolPlan
              ? {
                rawTools: {
                  type: "toolArray",
                  tools: toolPlan.tools,
                },
                toolNaming: "passThrough",
                onToolCallRequestEnd: (
                  _callId: number,
                  info: { toolCallRequest: FunctionToolCallRequest },
                ) => {
                  capturedToolCalls.push(mapLmStudioToolCallRequest(info.toolCallRequest, toolPlan));
                },
                onToolCallRequestFailure: (_callId: number, error: Error) => {
                  toolCallFailure = error;
                },
              }
              : {}),
          } as Record<string, unknown>,
        );

        const predictionResult = await prediction.result();
        const finishReason = normalizeLmStudioFinishReason(predictionResult.stats?.stopReason);

        if (capturedToolCalls.length > 0) {
          return {
            message: {
              role: "assistant",
              content: normalizeTextContent(predictionResult.content),
              toolCalls: capturedToolCalls,
            },
            usage: asLmStudioTokenUsage(predictionResult.stats)
              ?? estimateUsage(options.messages, JSON.stringify(capturedToolCalls)),
            finishReason: "tool_calls",
          };
        }

        if (finishReason === "tool_calls") {
          if (toolCallFailure) {
            throw toolCallFailure;
          }
          throw new Error(
            `LM Studio reported tool calls for model "${reference.providerModelId}" without a parsed tool request.`,
          );
        }

        const content = normalizeTextContent(predictionResult.content);
        return {
          message: {
            role: "assistant",
            content,
          },
          usage: asLmStudioTokenUsage(predictionResult.stats) ?? estimateUsage(options.messages, content),
          finishReason,
        };
      },
    );
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.tools?.length) {
      throw new ToolsUnsupportedError("lmstudio", "Streaming with gateway tools is not supported.");
    }

    const reference = this.parseModelReference(model || this.config.model, this.id);
    const client = await this.clientFactory(this.config.baseURL);
    try {
      const loadedModel = await resolveLoadedLmStudioModel(client, reference.providerModelId);
      const prediction = loadedModel.respond(
        toLmStudioChat(options.messages),
        {
          ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
          ...(typeof options.maxTokens === "number" ? { maxTokens: options.maxTokens } : {}),
          ...(options.stopSequences?.length ? { stopStrings: options.stopSequences } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        } as Record<string, unknown>,
      );

      for await (const fragment of prediction) {
        const text = normalizeTextContent(fragment.content);
        if (!text) {
          continue;
        }
        yield {
          type: "text_delta",
          text,
        };
      }

      const predictionResult = await prediction.result();
      yield {
        type: "finish",
        usage: asLmStudioTokenUsage(predictionResult.stats)
          ?? estimateUsage(options.messages, normalizeTextContent(predictionResult.content)),
        finishReason: normalizeLmStudioFinishReason(predictionResult.stats?.stopReason),
      };
    } finally {
      await disposeLmStudioClient(client);
    }
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
        throw new UnsupportedProviderError(prefixRaw, "Unsupported LM Studio provider.");
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
}
