import type {
  GenerateResult,
  TokenUsage,
  ToolCall,
  ToolResult,
} from "@spaceskit/core";
import type {
  JsonLineParserState,
  NormalizedAgentState,
} from "./cli-executor-stream-parser-types.js";
import {
  asNumber,
  asRecord,
  asString,
  extractTextPayload,
  safeParseJson,
  safeStringifyJson,
} from "./cli-executor-json-helpers.js";

const RAW_TOOL_ARGUMENTS_KEY = "__rawArguments";

const APPROVAL_EVENT_TYPES = new Set([
  "approval_request",
  "approval_requested",
  "approval_required",
  "permission_request",
  "permission_required",
  "feedback_requested",
]);

export function buildToolCall(record: Record<string, unknown>): ToolCall | null {
  const id = asString(record.id) ?? asString(record.toolCallId) ?? asString(record.call_id);
  const name =
    asString(record.name)
    ?? asString(record.tool_name)
    ?? asString(record.tool)
    ?? asString(record.command)
    ?? asString(record.operation)
    ?? asString(record.title);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    arguments: coerceToolArgumentsRecord(record.arguments)
      ?? coerceToolArgumentsRecord(record.input)
      ?? coerceToolArgumentsRecord(record.parameters)
      ?? coerceToolArgumentsRecord(asRecord(record.function)?.arguments)
      ?? {},
  };
}

export function buildToolResult(record: Record<string, unknown>, state: JsonLineParserState): ToolResult | null {
  const toolCallId =
    asString(record.toolCallId)
    ?? asString(record.id)
    ?? asString(record.call_id);
  if (!toolCallId) {
    return null;
  }
  const knownCall = state.toolCalls.get(toolCallId);
  if (knownCall && !state.emittedToolStarts.has(toolCallId)) {
    state.emittedToolStarts.add(toolCallId);
  }
  return {
    toolCallId,
    result: record.result ?? record.output ?? record.data ?? extractTextPayload(record) ?? {},
    ...(knownCall?.name ? { name: knownCall.name } : {}),
    ...(typeof record.isError === "boolean"
      ? { isError: record.isError }
      : asString(record.status) === "failed" || asString(record.status) === "canceled" || asString(record.status) === "denied"
        ? { isError: true }
        : {}),
  } as ToolResult;
}

export function maybeEmitToolCallStart(
  toolRecord: Record<string, unknown> | undefined,
  state: JsonLineParserState,
): Array<{ type: "tool_call_start"; toolCall: ToolCall }> {
  if (!toolRecord) return [];
  const toolCall = buildToolCall(toolRecord);
  if (!toolCall) return [];
  state.toolCalls.set(toolCall.id, toolCall);
  if (state.emittedToolStarts.has(toolCall.id)) {
    return [];
  }
  state.emittedToolStarts.add(toolCall.id);
  return [{
    type: "tool_call_start",
    toolCall,
  }];
}

export function parseAnthropicUsage(record: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!record) return undefined;
  const promptTokens = asNumber(record.input_tokens) ?? 0;
  const completionTokens = asNumber(record.output_tokens) ?? 0;
  const totalTokens = promptTokens + completionTokens;
  if (totalTokens <= 0) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    tokenAccuracy: "reported",
    usageSource: "ledger",
    usageDetails: {
      inputNoCacheTokens: promptTokens,
      inputCacheWriteTokens: asNumber(record.cache_creation_input_tokens),
      inputCacheReadTokens: asNumber(record.cache_read_input_tokens),
      outputTextTokens: completionTokens,
      raw: record,
    },
  };
}

export function parseCodexUsage(record: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!record) return undefined;
  const promptTokens = asNumber(record.input_tokens) ?? 0;
  const completionTokens = asNumber(record.output_tokens) ?? 0;
  const totalTokens = asNumber(record.total_tokens) ?? (promptTokens + completionTokens);
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens > 0 ? totalTokens : promptTokens + completionTokens,
    tokenAccuracy: "reported",
    usageSource: "ledger",
    usageDetails: {
      inputNoCacheTokens: promptTokens,
      inputCacheReadTokens: asNumber(record.cached_input_tokens),
      outputTextTokens: completionTokens,
      outputReasoningTokens: asNumber(record.reasoning_output_tokens),
      raw: record,
    },
  };
}

export function parseGeminiUsage(record: Record<string, unknown>): TokenUsage | undefined {
  const usage = asRecord(record.usage) ?? asRecord(record.usageMetadata) ?? record;
  const promptTokens = asNumber(usage.prompt_tokens) ?? asNumber(usage.promptTokenCount) ?? asNumber(usage.inputTokens) ?? 0;
  const completionTokens = asNumber(usage.output_tokens) ?? asNumber(usage.candidatesTokenCount) ?? asNumber(usage.outputTokens) ?? 0;
  const totalTokens = asNumber(usage.total_tokens) ?? asNumber(usage.totalTokenCount) ?? (promptTokens + completionTokens);
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens > 0 ? totalTokens : promptTokens + completionTokens,
    tokenAccuracy: "reported",
    usageSource: "ledger",
    usageDetails: {
      inputNoCacheTokens: promptTokens,
      outputTextTokens: completionTokens,
      raw: usage,
    },
  };
}

export function normalizeFinishReason(value?: string): GenerateResult["finishReason"] {
  switch (value?.trim().toLowerCase()) {
    case "tool_calls":
      return "tool_calls";
    case "length":
    case "max_tokens":
      return "length";
    case "content_filter":
      return "content_filter";
    case "error":
      return "error";
    case "stop":
    case "completed":
    case undefined:
      return "stop";
    default:
      return "other";
  }
}

export function normalizeAgentStateValue(value: unknown): NormalizedAgentState | null {
  const normalized = asString(value)?.toLowerCase();
  if (!normalized) return null;
  switch (normalized) {
    case "idle":
    case "done":
    case "completed":
    case "finished":
    case "stopped":
      return "idle";
    case "thinking":
    case "reasoning":
    case "planning":
      return "thinking";
    case "acting":
    case "executing":
    case "running_tools":
    case "running-tools":
      return "acting";
    case "needs_feedback":
    case "needs-feedback":
    case "needsfeedback":
    case "waiting_for_approval":
    case "waiting-for-approval":
    case "awaiting_approval":
      return "needs_feedback";
    case "errored":
    case "error":
    case "failed":
      return "errored";
    default:
      return null;
  }
}

export function isApprovalEventType(value?: string): boolean {
  if (!value) return false;
  return APPROVAL_EVENT_TYPES.has(value.trim().toLowerCase());
}

function coerceToolArgumentsRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (record) {
    return record;
  }

  const stringValue = asString(value);
  if (stringValue) {
    const parsed = safeParseJson(stringValue);
    const parsedRecord = asRecord(parsed);
    if (parsedRecord) {
      return parsedRecord;
    }
    return { [RAW_TOOL_ARGUMENTS_KEY]: stringValue };
  }

  if (Array.isArray(value)) {
    const serialized = safeStringifyJson(value);
    if (serialized) {
      return { [RAW_TOOL_ARGUMENTS_KEY]: serialized };
    }
  }

  return undefined;
}
