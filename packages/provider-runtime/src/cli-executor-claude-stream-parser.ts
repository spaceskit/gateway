import type { StreamChunk } from "@spaceskit/core";
import { asArray, asRecord, asNumber, asString } from "./cli-executor-json-helpers.js";
import type { JsonLineParserState } from "./cli-executor-stream-parser-types.js";
import {
  isApprovalEventType,
  maybeEmitToolCallStart,
  normalizeAgentStateValue,
  parseAnthropicUsage,
} from "./cli-executor-stream-helpers.js";

export function parseClaudeStreamRecord(record: Record<string, unknown>, state: JsonLineParserState): StreamChunk[] {
  const type = asString(record.type);
  if (type === "state_changed") {
    const normalized = normalizeAgentStateValue(record.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(type)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (type === "stream_event") {
    return parseClaudeStreamEvent(asRecord(record.event), state);
  }

  if (type === "assistant") {
    return parseClaudeAssistantMessage(asRecord(record.message) ?? record, state);
  }

  if (type === "result") {
    const usage = parseAnthropicUsage(asRecord(record.usage) ?? record);
    return [{
      type: "finish",
      finishReason: "stop",
      ...(usage ? { usage } : {}),
    }];
  }

  if (type === "rate_limit_event") {
    const retryAfterMs = Math.max(
      1,
      asNumber(record.retry_after_ms)
        ?? Math.round((asNumber(record.retry_after_seconds) ?? 1) * 1000),
    );
    return [{
      type: "rate_limited",
      retryAfterMs,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      attempt: 1,
      maxAttempts: 1,
      providerId: "claude",
      retryAt: new Date(Date.now() + retryAfterMs).toISOString(),
    }];
  }

  return [];
}

function parseClaudeStreamEvent(
  event: Record<string, unknown> | undefined,
  state: JsonLineParserState,
): StreamChunk[] {
  if (!event) return [];
  const eventType = asString(event.type);
  if (eventType === "state_changed") {
    const normalized = normalizeAgentStateValue(event.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(eventType)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (eventType === "content_block_start") {
    const block = asRecord(event.content_block) ?? asRecord(event.contentBlock);
    const blockType = asString(block?.type);
    // Track thinking blocks so we can tag deltas correctly
    if (blockType === "thinking") {
      return [{ type: "state_changed", state: "thinking" }];
    }
    return maybeEmitToolCallStart(block, state);
  }
  if (eventType === "content_block_delta") {
    const delta = asRecord(event.delta);
    const deltaType = asString(delta?.type);
    if (deltaType === "text_delta") {
      const text = asString(delta?.text)?.trimEnd();
      return text ? [{ type: "text_delta", text }] : [];
    }
    if (deltaType === "thinking_delta") {
      const text = asString(delta?.thinking) ?? asString(delta?.text);
      return text ? [{ type: "reasoning_delta", text }] : [];
    }
  }
  return [];
}

function parseClaudeAssistantMessage(
  message: Record<string, unknown>,
  state: JsonLineParserState,
): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  for (const block of asArray(message.content)) {
    const record = asRecord(block);
    if (!record) continue;
    const blockType = asString(record.type);
    if (blockType === "tool_use") {
      chunks.push(...maybeEmitToolCallStart(record, state));
      continue;
    }
    if (blockType === "thinking") {
      const text = asString(record.thinking) ?? asString(record.text);
      if (text) chunks.push({ type: "reasoning_delta", text });
    }
  }
  return chunks;
}
