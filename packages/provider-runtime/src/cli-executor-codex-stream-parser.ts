import type { StreamChunk } from "@spaceskit/core";
import { asRecord, asString, extractTextPayload } from "./cli-executor-json-helpers.js";
import type { JsonLineParserState } from "./cli-executor-stream-parser-types.js";
import {
  buildToolResult,
  isApprovalEventType,
  maybeEmitToolCallStart,
  normalizeAgentStateValue,
  normalizeFinishReason,
  parseCodexUsage,
} from "./cli-executor-stream-helpers.js";

export function parseCodexStreamRecord(record: Record<string, unknown>, state: JsonLineParserState): StreamChunk[] {
  const type = asString(record.type);
  if (type === "state_changed") {
    const normalized = normalizeAgentStateValue(record.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(type)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (type === "event_msg") {
    return parseCodexEventMessage(asRecord(record.msg), state);
  }
  if (type === "item.started" || type === "item.completed") {
    return parseCodexItem(asRecord(record.item), type === "item.completed", state);
  }
  if (type === "response_item") {
    return parseCodexItem(asRecord(record.item) ?? asRecord(record.response_item), false, state);
  }
  if (type === "turn.completed") {
    const chunks: StreamChunk[] = [];
    if (state.latestCompletedAgentMessage && !state.sawVisibleAssistantOutput) {
      chunks.push({
        type: "text_delta",
        text: state.latestCompletedAgentMessage,
        transcriptVisibility: "visible",
        streamKind: "assistant_output",
      });
    }
    const usage = parseCodexUsage(asRecord(record.usage));
    chunks.push({
      type: "finish",
      finishReason: normalizeFinishReason(asString(record.finish_reason) ?? asString(record.stop_reason)),
      ...(usage ? { usage } : {}),
    });
    return chunks;
  }
  return [];
}

function parseCodexEventMessage(
  message: Record<string, unknown> | undefined,
  state: JsonLineParserState,
): StreamChunk[] {
  if (!message) return [];
  const messageType = asString(message.type);
  if (messageType === "state_changed") {
    const normalized = normalizeAgentStateValue(message.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(messageType)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (messageType === "agent_message") {
    const text = extractTextPayload(message);
    return text
      ? [{
        type: "text_delta",
        text,
        transcriptVisibility: "activity_only",
        streamKind: "provider_client",
      }]
      : [];
  }
  if (messageType === "agent_reasoning") {
    const text = extractTextPayload(message);
    return text ? [{ type: "reasoning_delta", text }] : [];
  }
  if (messageType === "tool_call_start" || messageType === "tool_call") {
    return maybeEmitToolCallStart(message, state);
  }
  if (messageType === "tool_result") {
    const toolResult = buildToolResult(message, state);
    return toolResult ? [{ type: "tool_result", toolResult }] : [];
  }
  return [];
}

function parseCodexItem(
  item: Record<string, unknown> | undefined,
  completed: boolean,
  state: JsonLineParserState,
): StreamChunk[] {
  if (!item) return [];
  const itemType = asString(item.type);
  if (itemType === "agent_message" && completed) {
    const text = extractTextPayload(item);
    if (text) {
      state.latestCompletedAgentMessage = text;
    }
    return [];
  }
  if (itemType === "reasoning") {
    const text = extractTextPayload(item);
    return text ? [{ type: "reasoning_delta", text }] : [];
  }
  if (
    itemType === "function_call"
    || itemType === "tool_call"
    || itemType === "tool_use"
    || itemType === "exec_command"
    || itemType === "mcp_tool_call"
  ) {
    if (!completed) {
      return maybeEmitToolCallStart(item, state);
    }
    const toolResult = buildToolResult(item, state);
    return toolResult ? [{ type: "tool_result", toolResult }] : [];
  }
  return [];
}
