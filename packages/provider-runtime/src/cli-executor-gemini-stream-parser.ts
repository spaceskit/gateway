import type { StreamChunk } from "@spaceskit/core";
import { asRecord, asString, extractTextPayload } from "./cli-executor-json-helpers.js";
import type { JsonLineParserState } from "./cli-executor-stream-parser-types.js";
import {
  buildToolResult,
  isApprovalEventType,
  maybeEmitToolCallStart,
  normalizeAgentStateValue,
  normalizeFinishReason,
  parseGeminiUsage,
} from "./cli-executor-stream-helpers.js";

export function parseGeminiStreamRecord(record: Record<string, unknown>, state: JsonLineParserState): StreamChunk[] {
  const type = asString(record.type);
  if (type === "state_changed") {
    const normalized = normalizeAgentStateValue(record.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(type)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (type === "message") {
    const role = asString(record.role);
    if (role !== "assistant") return [];
    const text = extractTextPayload(record);
    return text ? [{ type: "text_delta", text }] : [];
  }
  if (type === "tool_use") {
    return maybeEmitToolCallStart(record, state);
  }
  if (type === "tool_result") {
    const toolResult = buildToolResult(record, state);
    return toolResult ? [{ type: "tool_result", toolResult }] : [];
  }
  if (type === "result") {
    const usage = parseGeminiUsage(record);
    return [{
      type: "finish",
      finishReason: normalizeFinishReason(asString(record.finishReason) ?? asString(record.stopReason)),
      ...(usage ? { usage } : {}),
    }];
  }
  return [];
}
