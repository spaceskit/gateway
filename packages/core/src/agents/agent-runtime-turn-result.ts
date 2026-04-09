import type {
  ModelMessage,
  ToolCall,
  ToolResult,
  TokenUsage,
  FinishReason,
  ProviderSessionHandle,
} from "./model-provider.js";
import type { AgentState, TurnContext, TurnResult } from "./agent-runtime.js";

interface AppendToolResultMessageArgs {
  messages: ModelMessage[];
  context: TurnContext;
  toolCall: ToolCall;
  rawResult: unknown;
  agentId: string;
  providerId: string;
  modelId: string;
}

export function appendToolResultMessage({
  messages,
  context,
  toolCall,
  rawResult,
  agentId,
  providerId,
  modelId,
}: AppendToolResultMessageArgs): void {
  const toolCallId = typeof toolCall.id === "string" ? toolCall.id.trim() : "";
  const content = stringifyToolMessageContent(rawResult);
  if (!toolCallId) {
    emitPromptBridgeWarning("prompt_bridge_tool_missing_tool_call_id", context, agentId, providerId, modelId, {
      toolName: toolCall.name,
    });
    messages.push({
      role: "assistant",
      content: `[tool-result-unlinked] ${toolCall.name}: ${content}`,
    });
    return;
  }

  messages.push({
    role: "tool",
    content,
    toolCallId,
    toolName: toolCall.name,
  });
}

function stringifyToolMessageContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") {
      return serialized;
    }
    return String(value);
  } catch {
    return String(value);
  }
}

function emitPromptBridgeWarning(
  code: string,
  context: TurnContext,
  agentId: string,
  providerId: string,
  modelId: string,
  details?: Record<string, unknown>,
): void {
  const payload = {
    code,
    spaceId: context.spaceId,
    agentId,
    turnId: context.turnId,
    providerId,
    modelId,
    ...(details ?? {}),
  };
  console.warn("[spaceskit][default-agent-runtime] prompt bridge warning", payload);
}

interface BuildTurnResultArgs {
  agentId: string;
  providerId: string;
  modelId: string;
  resolvedSafetyProfileId?: string;
  state: AgentState;
  turnId: string;
  messages: ModelMessage[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  usage: TokenUsage;
  finalMessage: ModelMessage;
  startedAt: Date;
  completedAt: Date;
  finishReason?: FinishReason;
  providerSessionHandle?: ProviderSessionHandle;
}

export function buildTurnResult({
  agentId,
  providerId,
  modelId,
  resolvedSafetyProfileId,
  state,
  turnId,
  messages,
  toolCalls,
  toolResults,
  usage,
  finalMessage,
  startedAt,
  completedAt,
  finishReason,
  providerSessionHandle,
}: BuildTurnResultArgs): TurnResult {
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  return {
    agentId,
    turnId,
    messages,
    toolCalls,
    toolResults,
    finalMessage,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      ...(usage.tokenAccuracy ? { tokenAccuracy: usage.tokenAccuracy } : {}),
      ...(usage.usageSource ? { usageSource: usage.usageSource } : {}),
      ...(usage.usageDetails ? { usageDetails: usage.usageDetails } : {}),
    },
    metadata: {
      providerId,
      modelId,
      ...(resolvedSafetyProfileId ? { effectiveSafetyProfileId: resolvedSafetyProfileId } : {}),
      ...(finishReason ? { finishReason } : {}),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        ...(usage.tokenAccuracy ? { tokenAccuracy: usage.tokenAccuracy } : {}),
        ...(usage.usageSource ? { usageSource: usage.usageSource } : {}),
        ...(usage.usageDetails ? { usageDetails: usage.usageDetails } : {}),
      },
      ...(providerSessionHandle ? { providerSessionHandle } : {}),
    },
    state,
  };
}
