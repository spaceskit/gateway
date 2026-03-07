import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  TokenUsage,
} from "@spaceskit/core";
import { ToolsUnsupportedError, UnsupportedProviderError } from "./provider-errors.js";

interface AppleFoundationRuntimeModule {
  appleAISDK: {
    checkAvailability(): Promise<{ available: boolean; reason: string }>;
  };
  chat(options: {
    messages: AppleChatMessage[] | string;
    temperature?: number;
    maxTokens?: number;
    stream?: false;
  }): Promise<{ text?: string }>;
  chat(options: {
    messages: AppleChatMessage[] | string;
    temperature?: number;
    maxTokens?: number;
    stream: true;
  }): AsyncIterable<string>;
}

interface AppleChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

interface ModelReference {
  providerId: "apple";
  fullModelId: string;
  providerModelId: string;
}

export interface AppleFoundationProviderConfig {
  id: string;
  name: string;
  model: string;
  isLocal?: boolean;
}

export class AppleFoundationModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: AppleFoundationProviderConfig;

  constructor(config: AppleFoundationProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? true;
    this.config = config;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    try {
      const runtime = await loadAppleFoundationRuntime();
      const availability = await runtime.appleAISDK.checkAvailability();
      return {
        available: availability.available,
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
      supportsTools: false,
      isLocal: true,
    }];
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    if (options.tools?.length) {
      throw new ToolsUnsupportedError(reference.providerId, "Apple Foundation gateway tool execution is not wired yet.");
    }

    const runtime = await loadAppleFoundationRuntime();
    const response = await runtime.chat({
      messages: toAppleMessages(options.messages),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: false,
    });
    const content = typeof response.text === "string" ? response.text.trim() : "";
    return {
      message: {
        role: "assistant",
        content,
      },
      usage: estimateUsage(options.messages, content),
      finishReason: "stop",
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    if (options.tools?.length) {
      throw new ToolsUnsupportedError(reference.providerId, "Apple Foundation gateway tool execution is not wired yet.");
    }

    const runtime = await loadAppleFoundationRuntime();
    let fullText = "";
    for await (const chunk of runtime.chat({
      messages: toAppleMessages(options.messages),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: true,
    })) {
      if (!chunk) {
        continue;
      }
      fullText += chunk;
      yield {
        type: "text_delta",
        text: chunk,
      };
    }

    yield {
      type: "finish",
      usage: estimateUsage(options.messages, fullText),
      finishReason: "stop",
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
        throw new UnsupportedProviderError(prefixRaw, "Unsupported Apple Foundation provider.");
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

export async function checkAppleFoundationAvailability(): Promise<{ available: boolean; reason: string }> {
  try {
    const runtime = await loadAppleFoundationRuntime();
    return await runtime.appleAISDK.checkAvailability();
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function loadAppleFoundationRuntime(): Promise<AppleFoundationRuntimeModule> {
  return await import("@meridius-labs/apple-on-device-ai") as AppleFoundationRuntimeModule;
}

function normalizeProviderId(value?: string): "apple" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === "apple" ? "apple" : undefined;
}

function toAppleMessages(messages: ModelMessage[]): AppleChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.role === "tool" && message.toolName ? { name: message.toolName } : {}),
    ...(message.role === "tool" && message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
  }));
}

function estimateUsage(messages: ModelMessage[], output: string): TokenUsage {
  const promptChars = messages.reduce((total, message) => total + message.content.length, 0);
  const promptTokens = Math.ceil(promptChars / 4);
  const completionTokens = Math.ceil(output.length / 4);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    tokenAccuracy: "estimated",
    usageSource: "ledger",
  };
}
