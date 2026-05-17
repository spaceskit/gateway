import {
  parseFencedToolCalls,
  stripFencedToolCallBlocks,
} from "@spaceskit/core";
import type {
  GenerateOptions,
  GenerateResult,
  FinishReason,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  ToolCall,
  TokenUsage,
} from "@spaceskit/core";
import { ToolsUnsupportedError, UnsupportedProviderError } from "./provider-errors.js";
import { randomUUID } from "node:crypto";
import { injectHelperToolGuidance, injectTextToolGuidance } from "./apple-foundation-tool-guidance.js";

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
  helperExecutablePath?: string;
  runCommand?: (input: {
    executable: string;
    args: string[];
    stdin?: string;
  }) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export class AppleFoundationModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: AppleFoundationProviderConfig;
  private readonly runCommand?: AppleFoundationProviderConfig["runCommand"];

  constructor(config: AppleFoundationProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? true;
    this.config = config;
    this.runCommand = config.runCommand;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    try {
      const availability = await checkAppleFoundationAvailability({
        helperExecutablePath: this.config.helperExecutablePath,
        runCommand: this.runCommand,
      });
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
      contextWindow: 4096,
      supportsTools: true,
      isLocal: true,
    }];
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    if (this.config.helperExecutablePath && this.runCommand) {
      return await this.generateViaHelper(reference, {
        ...options,
        messages: options.tools?.length
          ? injectHelperToolGuidance(options.messages, options.tools)
          : options.messages,
      });
    }

    const messages = options.tools?.length
      ? injectTextToolGuidance(options.messages, options.tools)
      : options.messages;

    const runtime = await loadAppleFoundationRuntime();
    const response = await runtime.chat({
      messages: toAppleMessages(messages),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: false,
    });
    const content = typeof response.text === "string" ? response.text.trim() : "";

    // Parse fenced-JSON tool calls from response when tools are available
    if (options.tools?.length) {
      const toolCalls = parseFencedToolCalls(content, {
        allowedToolNames: options.tools.map((tool) => tool.name),
      });
      if (toolCalls.length > 0) {
        return {
          message: {
            role: "assistant",
            content: stripFencedToolCallBlocks(content),
            toolCalls,
          },
          usage: estimateUsage(messages, content),
          finishReason: "tool_calls",
        };
      }
    }

    return {
      message: {
        role: "assistant",
        content,
      },
      usage: estimateUsage(messages, content),
      finishReason: "stop",
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    // When tools are present, fall back to non-streaming generate() so we can
    // parse fenced-JSON tool calls from the complete response. The on-device
    // model is fast enough that this doesn't impact UX significantly.
    if (options.tools?.length) {
      const result = await this.generate(model, options);
      if (result.message.content) {
        yield { type: "text_delta", text: result.message.content };
      }
      if (result.message.toolCalls) {
        for (const tc of result.message.toolCalls) {
          yield { type: "tool_call_start", toolCall: tc };
        }
      }
      yield {
        type: "finish",
        usage: result.usage,
        finishReason: result.finishReason,
      };
      return;
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

  private async generateViaHelper(
    reference: ModelReference,
    options: GenerateOptions,
  ): Promise<GenerateResult> {
    const result = await this.runCommand!({
      executable: this.config.helperExecutablePath!,
      args: [],
      stdin: JSON.stringify({
        operation: "generate",
        model: reference.fullModelId,
        messages: options.messages,
        tools: options.tools ?? [],
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }),
    });
    if (result.exitCode !== 0) {
      const payload = safeParseHelperPayload(result.stdout);
      const helperReason = typeof payload.reason === "string"
        ? payload.reason.trim()
        : typeof payload.text === "string"
          ? payload.text.trim()
          : "";
      throw new Error(helperReason || result.stderr.trim() || "Apple Foundation helper failed.");
    }

    const payload = safeParseHelperPayload(result.stdout);
    if (payload.toolCall) {
      const toolCall = normalizeToolCall(payload.toolCall);
      const allowedToolNames = new Set((options.tools ?? []).map((tool) => tool.name));
      if (allowedToolNames.size > 0 && !allowedToolNames.has(toolCall.name)) {
        return {
          message: {
            role: "assistant",
            content: typeof payload.text === "string" ? payload.text : "",
          },
          usage: normalizeUsage(payload.usage) ?? estimateUsage(options.messages, typeof payload.text === "string" ? payload.text : ""),
          finishReason: normalizeFinishReason(payload.finishReason),
        };
      }
      return {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [toolCall],
        },
        usage: normalizeUsage(payload.usage) ?? estimateUsage(options.messages, ""),
        finishReason: "tool_calls",
      };
    }

    const content = typeof payload.text === "string" ? payload.text : "";
    return {
      message: {
        role: "assistant",
        content,
      },
      usage: normalizeUsage(payload.usage) ?? estimateUsage(options.messages, content),
      finishReason: normalizeFinishReason(payload.finishReason),
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

export async function checkAppleFoundationAvailability(options?: {
  helperExecutablePath?: string;
  runCommand?: (input: {
    executable: string;
    args: string[];
    stdin?: string;
  }) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}): Promise<{ available: boolean; reason: string }> {
  try {
    if (options?.helperExecutablePath && options.runCommand) {
      const result = await options.runCommand({
        executable: options.helperExecutablePath,
        args: [],
        stdin: JSON.stringify({
          operation: "checkAvailability",
        }),
      });
      if (result.exitCode !== 0) {
        return {
          available: false,
          reason: result.stderr.trim() || "Apple Foundation helper failed.",
        };
      }
      const payload = safeParseHelperPayload(result.stdout);
      return {
        available: payload.available === true,
        reason: typeof payload.reason === "string"
          ? payload.reason
          : payload.available === true
            ? "Apple Foundation available."
            : "Apple Foundation unavailable.",
      };
    }
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

function safeParseHelperPayload(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {};
  }
  return JSON.parse(trimmed) as Record<string, unknown>;
}

function normalizeToolCall(value: unknown): ToolCall {
  const record = asRecord(value);
  const name = typeof record?.name === "string" ? record.name : "unknown";
  return {
    id: randomUUID(),
    name,
    arguments: asRecord(record?.arguments) ?? {},
  };
}

function normalizeFinishReason(value: unknown): FinishReason {
  switch (value) {
    case "tool_calls":
    case "length":
    case "error":
    case "content_filter":
    case "other":
      return value;
    default:
      return "stop";
  }
}

function normalizeUsage(value: unknown): TokenUsage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const promptTokens = asNumber(record.promptTokens);
  const completionTokens = asNumber(record.completionTokens);
  const totalTokens = asNumber(record.totalTokens);
  if (promptTokens == null || completionTokens == null || totalTokens == null) {
    return undefined;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    tokenAccuracy: record.tokenAccuracy === "reported" || record.tokenAccuracy === "mixed"
      ? record.tokenAccuracy
      : "estimated",
    usageSource: record.usageSource === "local_scanner"
      ? record.usageSource
      : "ledger",
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
