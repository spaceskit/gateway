import type {
  ModelProvider,
  ToolCall,
  ToolResult,
  GenerateOptions,
  GenerateResult,
  TokenUsage,
  TokenUsageDetails,
  FinishReason,
} from "./model-provider.js";
import type { AgentState, TurnEvent } from "./agent-runtime.js";
import { decorateNativeCliToolsResult, isNativeCliToolsMode } from "./agent-runtime-access-mode.js";
import {
  buildToolUnsupportedFallbackNotice,
  shouldRetryLlmCallWithoutTools,
  toActionableLmStudioBadRequestError,
} from "./agent-runtime-errors.js";

export type LlmCallResult = {
  result: GenerateResult;
  streamedTextDeltaCount: number;
};

export function mergeUsageDetails(
  base: TokenUsageDetails | undefined,
  incoming: TokenUsageDetails | undefined,
): TokenUsageDetails | undefined {
  if (!base && !incoming) return undefined;
  const merged: TokenUsageDetails = { ...(base ?? {}) };
  if (incoming?.inputNoCacheTokens !== undefined) merged.inputNoCacheTokens = incoming.inputNoCacheTokens;
  if (incoming?.inputCacheReadTokens !== undefined) merged.inputCacheReadTokens = incoming.inputCacheReadTokens;
  if (incoming?.inputCacheWriteTokens !== undefined) merged.inputCacheWriteTokens = incoming.inputCacheWriteTokens;
  if (incoming?.outputTextTokens !== undefined) merged.outputTextTokens = incoming.outputTextTokens;
  if (incoming?.outputReasoningTokens !== undefined) merged.outputReasoningTokens = incoming.outputReasoningTokens;
  if (incoming?.raw) {
    merged.raw = {
      ...((merged.raw ?? {}) as Record<string, unknown>),
      ...(incoming.raw as Record<string, unknown>),
    };
  }
  return merged;
}

export function mergeTokenAccuracy(
  base: TokenUsage["tokenAccuracy"],
  incoming: TokenUsage["tokenAccuracy"],
): NonNullable<TokenUsage["tokenAccuracy"]> | undefined {
  if (!base) return incoming;
  if (!incoming) return base;
  if (base === incoming) return base;
  return "mixed";
}

export function mergeUsageSource(
  base: TokenUsage["usageSource"],
  incoming: TokenUsage["usageSource"],
): NonNullable<TokenUsage["usageSource"]> | undefined {
  if (!base) return incoming;
  if (!incoming) return base;
  if (base === incoming) return base;
  return "ledger";
}

interface RunLlmCallArgs {
  modelProvider: ModelProvider;
  providerId: string;
  modelId: string;
  generateOpts: GenerateOptions;
  emitEvent: (event: TurnEvent) => void;
}

export async function runLlmCall({
  modelProvider,
  providerId,
  modelId,
  generateOpts,
  emitEvent,
}: RunLlmCallArgs): Promise<LlmCallResult> {
  if (isNativeCliToolsMode(providerId, generateOpts.accessMode)) {
    // Attempt streaming first to surface tool progress, approval events, and
    // state changes from the CLI executor. Falls back to generate() if the
    // provider does not support streaming.
    const streamed = await tryStreamLlmCall(modelProvider, modelId, providerId, generateOpts, emitEvent);
    if (streamed) {
      return {
        result: decorateNativeCliToolsResult(streamed.result, providerId, modelId),
        streamedTextDeltaCount: streamed.streamedTextDeltaCount,
      };
    }

    const result = await modelProvider.generate(modelId, generateOpts);
    return {
      result: decorateNativeCliToolsResult(result, providerId, modelId),
      streamedTextDeltaCount: 0,
    };
  }

  if (generateOpts.tools && generateOpts.tools.length > 0) {
    try {
      const result = await modelProvider.generate(modelId, generateOpts);
      return { result, streamedTextDeltaCount: 0 };
    } catch (err) {
      if (!shouldRetryLlmCallWithoutTools(err, providerId, modelId)) {
        throw toActionableLmStudioBadRequestError(err, providerId, modelId) ?? err;
      }
    }

    try {
      const fallbackResult = await modelProvider.generate(modelId, {
        ...generateOpts,
        tools: undefined,
      });
      const fallbackNotice = buildToolUnsupportedFallbackNotice(providerId, modelId);
      const fallbackContent = fallbackResult.message.content.trim();
      fallbackResult.message = {
        ...fallbackResult.message,
        content: fallbackContent.length > 0
          ? `${fallbackNotice}\n\n${fallbackContent}`
          : fallbackNotice,
      };
      return { result: fallbackResult, streamedTextDeltaCount: 0 };
    } catch (err) {
      throw toActionableLmStudioBadRequestError(err, providerId, modelId) ?? err;
    }
  }

  if (shouldBypassStreamingForMediatedCliTurn(providerId, generateOpts)) {
    try {
      const generatedResult = await modelProvider.generate(modelId, generateOpts);
      return { result: generatedResult, streamedTextDeltaCount: 0 };
    } catch (err) {
      throw toActionableLmStudioBadRequestError(err, providerId, modelId) ?? err;
    }
  }

  const streamedResult = await tryStreamLlmCall(modelProvider, modelId, providerId, generateOpts, emitEvent);
  if (streamedResult) {
    return streamedResult;
  }

  try {
    const generatedResult = await modelProvider.generate(modelId, generateOpts);
    return { result: generatedResult, streamedTextDeltaCount: 0 };
  } catch (err) {
    throw toActionableLmStudioBadRequestError(err, providerId, modelId) ?? err;
  }
}

function shouldBypassStreamingForMediatedCliTurn(
  providerId: string,
  generateOpts: GenerateOptions,
): boolean {
  return providerId === "gemini" && generateOpts.accessMode === "default";
}

async function tryStreamLlmCall(
  modelProvider: ModelProvider,
  modelId: string,
  providerId: string,
  generateOpts: GenerateOptions,
  emitEvent: (event: TurnEvent) => void,
): Promise<LlmCallResult | null> {
  const chunks: string[] = [];
  let sawAnyTextDelta = false;
  let finishReason: FinishReason = "stop";
  let usage: TokenUsage | undefined;
  let providerSessionHandle: GenerateResult["providerSessionHandle"] | undefined;
  let feedbackRequest: GenerateResult["feedbackRequest"] | undefined;
  let streamedTextDeltaCount = 0;
  let sawFinish = false;

  try {
    for await (const chunk of modelProvider.stream(modelId, generateOpts)) {
      if (chunk.type === "text_delta") {
        const text = typeof chunk.text === "string" ? chunk.text : "";
        if (!text) continue;
        sawAnyTextDelta = true;
        if (shouldAccumulateTranscriptText(chunk)) {
          chunks.push(text);
        }
        streamedTextDeltaCount += 1;
        emitEvent({
          type: "text_delta",
          text,
          transcriptVisibility: chunk.transcriptVisibility,
          streamKind: chunk.streamKind,
        });
        continue;
      }

      if (chunk.type === "reasoning_delta") {
        const text = typeof chunk.text === "string" ? chunk.text : "";
        if (!text) continue;
        emitEvent({ type: "reasoning_delta", text });
        continue;
      }

      if (chunk.type === "state_changed") {
        const state = normalizeStreamedAgentState(chunk.state);
        if (!state) continue;
        emitEvent({ type: "state_changed", state });
        continue;
      }

      if (chunk.type === "tool_call_start") {
        const toolCall = normalizeStreamedToolCall(chunk.toolCall);
        if (!toolCall) continue;
        emitEvent({ type: "tool_call_start", toolCall });
        continue;
      }

      if (chunk.type === "tool_result") {
        const result = normalizeStreamedToolResult(chunk.toolResult, chunk.toolCall);
        if (!result) continue;
        emitEvent({ type: "tool_result", result });
        continue;
      }

      if (chunk.type === "rate_limited") {
        const retryAfterMs = typeof chunk.retryAfterMs === "number" && Number.isFinite(chunk.retryAfterMs)
          ? Math.max(1, Math.trunc(chunk.retryAfterMs))
          : 1_000;
        // Only surface rate-limit events to the UI when the delay is significant;
        // short 1-2s retries from the Claude CLI are normal API soft-throttles.
        if (retryAfterMs >= 5_000) {
          emitEvent({
            type: "rate_limited",
            retryAfterMs,
            retryAfterSeconds: chunk.retryAfterSeconds ?? Math.max(1, Math.ceil(retryAfterMs / 1000)),
            attempt: chunk.attempt ?? 1,
            maxAttempts: chunk.maxAttempts ?? 1,
            providerId: chunk.providerId ?? providerId,
            retryAt: chunk.retryAt ?? new Date(Date.now() + retryAfterMs).toISOString(),
          });
        }
        continue;
      }

      if (chunk.type === "feedback_request") {
        if (chunk.feedbackRequest) {
          feedbackRequest = chunk.feedbackRequest;
          sawFinish = true;
        }
        continue;
      }

      if (chunk.type === "finish") {
        sawFinish = true;
        finishReason = chunk.finishReason ?? finishReason;
        usage = chunk.usage ?? usage;
        providerSessionHandle = chunk.providerSessionHandle ?? providerSessionHandle;
      }
    }
  } catch (err) {
    if (streamedTextDeltaCount === 0) {
      return null;
    }
    throw err;
  }

  if (!sawFinish && !sawAnyTextDelta) {
    return null;
  }

  return {
    result: {
      message: {
        role: "assistant",
        content: chunks.join(""),
      },
      finishReason,
      ...(usage ? { usage } : {}),
      ...(providerSessionHandle ? { providerSessionHandle } : {}),
      ...(feedbackRequest ? { feedbackRequest } : {}),
    },
    streamedTextDeltaCount,
  };
}

function shouldAccumulateTranscriptText(
  chunk: {
    transcriptVisibility?: "visible" | "activity_only" | "summary";
    streamKind?: "assistant_output" | "provider_client";
  },
): boolean {
  const transcriptVisibility = chunk.transcriptVisibility ?? "visible";
  const streamKind = chunk.streamKind ?? "assistant_output";
  return transcriptVisibility === "visible" && streamKind === "assistant_output";
}

function normalizeStreamedAgentState(state: unknown): AgentState | null {
  if (state === "idle" || state === "thinking" || state === "acting" || state === "needs_feedback" || state === "errored") {
    return state;
  }
  return null;
}

function normalizeStreamedToolCall(toolCall: unknown): ToolCall | null {
  const record = asRecord(toolCall);
  if (!record) return null;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const argumentsRecord = asRecord(record.arguments) ?? {};
  if (!id || !name) return null;
  return { id, name, arguments: argumentsRecord };
}

function normalizeStreamedToolResult(toolResult: unknown, fallbackToolCall?: unknown): ToolResult | null {
  const record = asRecord(toolResult);
  const fallback = asRecord(fallbackToolCall);
  const toolCallId = typeof record?.toolCallId === "string"
    ? record.toolCallId.trim()
    : typeof fallback?.id === "string"
      ? fallback.id.trim()
      : "";
  if (!toolCallId) return null;
  return {
    toolCallId,
    result: record?.result ?? record ?? {},
    ...(typeof record?.name === "string" ? { name: record.name } : {}),
    ...(record && typeof record.isError === "boolean" ? { isError: record.isError } : {}),
  } as ToolResult;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
