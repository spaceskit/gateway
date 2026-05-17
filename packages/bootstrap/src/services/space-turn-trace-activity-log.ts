import type {
  EventLogRow,
  OrchestrationJournalRow,
  TurnRow,
} from "@spaceskit/persistence";
import type {
  SpaceActivityLogEntry,
  SpaceTurnTraceActivity,
} from "./space-turn-trace-types.js";
import {
  asRecord,
  parseJsonRecord,
  readBoolean,
  readExecutionStatus,
  readNumber,
  readString,
} from "./space-turn-trace-read-values.js";

export function buildTraceActivities(input: {
  eventRows: EventLogRow[];
  journalRows: OrchestrationJournalRow[];
  turnRows: TurnRow[];
}): SpaceTurnTraceActivity[] {
  return buildActivityLogEntries(input).map((entry) => ({
    activityId: entry.entryId,
    seq: entry.seq,
    eventType: entry.eventType,
    agentId: entry.agentId,
    title: entry.title,
    detail: entry.detail,
    status: entry.status,
    visibility: entry.visibility,
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    createdAt: entry.createdAt,
    payload: entry.payload,
  }));
}

export function buildActivityLogEntries(input: {
  eventRows: EventLogRow[];
  journalRows: OrchestrationJournalRow[];
  turnRows: TurnRow[];
}): SpaceActivityLogEntry[] {
  const entries = [
    ...input.eventRows.map(mapEventRowToActivityEntry),
    ...input.journalRows.map(mapJournalRowToActivityEntry),
    ...input.turnRows.map(mapTurnRowToActivityEntry),
  ].filter((entry) => entry.eventType !== "text_delta");

  entries.sort((lhs, rhs) => {
    if (lhs.createdAt !== rhs.createdAt) {
      return lhs.createdAt.localeCompare(rhs.createdAt);
    }
    if (lhs.seq !== rhs.seq) {
      return lhs.seq - rhs.seq;
    }
    const sourceOrder = sourceRank(lhs.source) - sourceRank(rhs.source);
    if (sourceOrder !== 0) {
      return sourceOrder;
    }
    return lhs.entryId.localeCompare(rhs.entryId);
  });

  return entries;
}

function mapEventRowToActivityEntry(row: EventLogRow): SpaceActivityLogEntry {
  const payload = parseJsonRecord(row.payload_json);
  const eventType = normalizedEventType(payload, row.event_type);
  const toolCallRecord = asRecord(payload.toolCall)
    ?? asRecord(payload.result)
    ?? asRecord(payload.tool_call);
  const toolCallId = readString(payload.toolCallId)
    ?? readString(payload.tool_call_id)
    ?? readString(toolCallRecord?.id)
    ?? readString(toolCallRecord?.toolCallId)
    ?? readString(toolCallRecord?.tool_call_id);
  const toolName = readString(toolCallRecord?.name) ?? readString(payload.toolName);
  const agentId = readString(payload.agentId)
    ?? readString(asRecord(payload.result)?.agentId)
    ?? readString(row.agent_id);
  const turnId = readString(row.turn_id);
  const rootTurnId = readString(payload.rootTurnId)
    ?? readString(payload.root_turn_id)
    ?? turnId;
  const summaryTurnId = readString(payload.summaryTurnId)
    ?? readString(payload.summary_turn_id);
  const clientEntryId = eventType === "client_delta"
    ? buildClientActivityId(turnId, agentId)
    : undefined;

  return {
    entryId: clientEntryId ?? row.event_id,
    source: "event_log",
    category: categorizeEventType(eventType, visibilityForEventType(eventType)),
    turnId,
    rootTurnId,
    summaryTurnId,
    agentId,
    actorId: agentId,
    eventType,
    title: titleForEventType(eventType, toolName, payload),
    detail: detailForEventType(eventType, payload),
    status: statusForEventType(eventType, payload),
    visibility: visibilityForEventType(eventType),
    toolCallId,
    toolName,
    createdAt: row.created_at,
    seq: row.seq,
    payload,
  };
}

function mapJournalRowToActivityEntry(row: OrchestrationJournalRow): SpaceActivityLogEntry {
  const payload = parseJsonRecord(row.payload_json);
  const actorId = readString(row.actor_id);
  const turnId = readString(row.turn_id);
  const eventType = normalizedEventType(payload, row.event_type);
  const visibility = eventType.includes("reasoning") ? "reasoning" : "observable";
  return {
    entryId: row.event_id,
    source: "orchestration_journal",
    category: categorizeJournalEventType(eventType),
    turnId,
    rootTurnId: turnId,
    agentId: readString(payload.agentId) ?? actorId,
    actorId,
    eventType,
    title: humanizeEventType(eventType),
    detail: previewValue(payload),
    status: statusForJournalEventType(eventType),
    visibility,
    createdAt: row.created_at,
    seq: row.seq,
    payload,
  };
}

function mapTurnRowToActivityEntry(row: TurnRow): SpaceActivityLogEntry {
  const output = parseJsonRecord(row.output_json ?? "{}");
  const input = parseJsonRecord(row.input_json ?? "{}");
  const rootTurnId = readString(row.user_turn_id) ?? readString(row.turn_id);
  const detail = previewValue(
    readString(output.text)
      ?? readString(output.error)
      ?? readString(input.text),
  );
  const totalTokens = Math.max(0, (row.token_input_count ?? 0) + (row.token_output_count ?? 0));
  const payload: Record<string, unknown> = {
    actorType: row.actor_type,
    actorId: row.actor_id,
    status: row.status,
    promptTokens: row.token_input_count,
    completionTokens: row.token_output_count,
    totalTokens,
    userTurnId: readString(row.user_turn_id),
    replyToTurnId: readString(row.reply_to_turn_id ?? undefined),
  };
  if (detail) {
    payload.outputPreview = detail;
  }

  return {
    entryId: `turn:${row.turn_id}`,
    source: "turns",
    category: "status",
    turnId: readString(row.turn_id),
    rootTurnId,
    agentId: readString(row.actor_id),
    actorId: readString(row.actor_id),
    eventType: `persisted_turn.${row.status}`,
    title: row.status === "failed" ? "Stored failed turn" : "Stored agent turn",
    detail,
    status: row.status === "failed" ? "failed" : "completed",
    visibility: "observable",
    createdAt: row.completed_at ?? row.created_at,
    seq: 10_000_000,
    payload,
  };
}

function buildClientActivityId(turnId: string | undefined, agentId: string | undefined): string | undefined {
  const normalizedTurnId = turnId?.trim();
  if (!normalizedTurnId) return undefined;
  return `client:${normalizedTurnId}:${agentId?.trim() || "agent"}`;
}

function normalizedEventType(payload: Record<string, unknown>, fallback: string): string {
  const payloadType = readString(payload.type);
  return (payloadType ?? fallback).trim().toLowerCase();
}

function visibilityForEventType(eventType: string): string {
  if (eventType.startsWith("cli_execution.")) return "deep_trace";
  return eventType === "reasoning_delta" ? "reasoning" : "observable";
}

function categorizeEventType(eventType: string, visibility: string): string {
  if (visibility === "reasoning") return "thinking";
  if (eventType.startsWith("cli_execution.")) return "system";
  if (
    eventType.startsWith("memory_")
    || eventType.startsWith("experience.")
    || eventType.startsWith("insight.")
    || eventType.startsWith("space_note.")
    || eventType.startsWith("profile.")
  ) {
    return "memory";
  }
  if (eventType.includes("tool")) return "tools";
  if (eventType.includes("feedback") || eventType.includes("approval")) return "approval";
  if (eventType.includes("summar")) return "summary";
  if (eventType.includes("error") || eventType.includes("fail")) return "errors";
  return "status";
}

function categorizeJournalEventType(eventType: string): string {
  if (eventType.includes("failure")) return "errors";
  if (eventType.includes("summary")) return "summary";
  if (
    eventType.startsWith("planner.")
    || eventType.startsWith("guest.")
    || eventType.startsWith("peer_review.")
    || eventType.startsWith("synthesis.")
  ) {
    return "system";
  }
  return "status";
}

function titleForEventType(
  eventType: string,
  toolName: string | undefined,
  payload: Record<string, unknown>,
): string {
  switch (eventType) {
    case "cli_execution.started":
      return "CLI execution started";
    case "cli_execution.completed":
      return readExecutionStatus(payload.status, readNumber(payload.exitCode)) === "failed"
        ? "CLI execution failed"
        : "CLI execution completed";
    case "turn_started":
      return "Turn started";
    case "turn_completed":
      return "Response ready";
    case "turn_cancelled":
      return "Turn cancelled";
    case "state_changed":
      return activityStateTitle(readString(payload.state) ?? "working");
    case "tool_call_start":
      return `Running ${toolName ?? "tool"}`;
    case "tool_result":
      return `${toolName ?? "Tool"} ${statusForEventType(eventType, payload) === "failed" ? "failed" : "completed"}`;
    case "feedback_requested":
      return "Approval requested";
    case "feedback_resolved":
      return "Approval resolved";
    case "context_summarizing":
      return "Summarizing context";
    case "context_summarized":
      return "Context summarized";
    case "reasoning_delta":
      return readBoolean(payload.summarized) ? "Working summary" : "Working";
    case "client_delta":
      return latestClientTitle(readString(payload.text)) ?? "Client";
    case "error":
      return "Error";
    case "rate_limited":
      return "Rate limited";
    default:
      return humanizeEventType(eventType);
  }
}

function detailForEventType(eventType: string, payload: Record<string, unknown>): string | undefined {
  switch (eventType) {
    case "cli_execution.started":
      return joinDetailParts([
        readString(payload.providerId),
        readString(payload.modelId),
        readString(payload.workingDirectory),
      ]);
    case "cli_execution.completed":
      return joinDetailParts([
        readString(payload.providerId),
        readString(payload.modelId),
        suffixDetail(payload.durationMs, "ms"),
        suffixDetail(payload.exitCode, "exit"),
      ]);
    case "tool_call_start": {
      const toolCall = asRecord(payload.toolCall) ?? asRecord(payload.tool_call) ?? {};
      return previewValue(toolCall.arguments ?? toolCall.args ?? payload.arguments);
    }
    case "tool_result":
      return previewValue(payload.result ?? payload.error);
    case "feedback_requested": {
      const request = asRecord(payload.request) ?? payload;
      return readString(request.description) ?? previewValue(request.context);
    }
    case "feedback_resolved":
      return readString(payload.response) ?? previewValue(payload.resolution);
    case "context_summarizing":
      return joinDetailParts([
        suffixDetail(payload.messagesBeforeSummary, "messages"),
        suffixDetail(payload.tokenEstimate, "est tokens"),
      ]);
    case "context_summarized":
      return joinDetailParts([
        suffixDetail(payload.messagesSummarized, "summarized"),
        suffixDetail(payload.droppedRecentMessages, "dropped"),
        readBoolean(payload.summaryTruncated) ? "truncated" : undefined,
      ]);
    case "reasoning_delta":
      return readString(payload.text) ?? readString(payload.reasoning);
    case "client_delta":
      return readString(payload.text);
    case "error":
      return readString(asRecord(payload.error)?.message) ?? readString(payload.message);
    default:
      return previewValue(payload);
  }
}

function statusForEventType(eventType: string, payload: Record<string, unknown>): string | undefined {
  switch (eventType) {
    case "cli_execution.started":
      return "running";
    case "cli_execution.completed":
      return readExecutionStatus(payload.status, readNumber(payload.exitCode));
    case "turn_started":
    case "tool_call_start":
    case "context_summarizing":
      return "running";
    case "state_changed":
      return readString(payload.state) === "needs_feedback" ? "waiting" : "running";
    case "feedback_requested":
    case "rate_limited":
      return "waiting";
    case "turn_completed":
    case "feedback_resolved":
    case "context_summarized":
      return "completed";
    case "turn_cancelled":
      return "cancelled";
    case "reasoning_delta":
      return readBoolean(payload.summarized) ? "completed" : "running";
    case "client_delta":
      return "completed";
    case "tool_result": {
      const result = asRecord(payload.result);
      const isError = payload.isError === true || result?.isError === true || result?.error != null;
      return isError ? "failed" : "completed";
    }
    case "error":
      return "failed";
    default:
      if (eventType.includes("fail") || eventType.includes("error")) return "failed";
      if (eventType.includes("start") || eventType.includes("dispatch")) return "running";
      if (eventType.includes("result") || eventType.includes("completed")) return "completed";
      return "info";
  }
}

function latestClientTitle(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1);
}

function statusForJournalEventType(eventType: string): string {
  if (eventType.includes("failure")) return "failed";
  if (eventType.includes("dispatch") || eventType.includes("assignment")) return "running";
  if (eventType.includes("result") || eventType.includes("output")) return "completed";
  return "info";
}

function activityStateTitle(state: string): string {
  switch (state.trim().toLowerCase()) {
    case "needs_feedback":
      return "Waiting for approval";
    case "streaming":
      return "Streaming response";
    case "acting":
      return "Using tools";
    case "thinking":
      return "Thinking";
    default:
      return "Working";
  }
}

function humanizeEventType(value: string): string {
  return value
    .replace(/[._]/g, " ")
    .split(/\s+/g)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function previewValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return undefined;
    return truncate(normalized, 240);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const stringItems = value
      .map((entry) => previewValue(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (stringItems.length === 0) {
      return `[${value.length} items]`;
    }
    return truncate(stringItems.join(", "), 240);
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const candidate = readString(record.text)
    ?? readString(record.message)
    ?? readString(record.error)
    ?? readString(asRecord(record.error)?.message)
    ?? readString(record.output)
    ?? readString(record.reason)
    ?? readString(record.description);
  if (candidate) {
    return truncate(candidate, 240);
  }
  const rendered = JSON.stringify(record);
  return rendered && rendered !== "{}" ? truncate(rendered, 240) : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function suffixDetail(value: unknown, suffix: string): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.max(0, Math.floor(value))} ${suffix}`;
  }
  const raw = readString(value);
  return raw ? `${raw} ${suffix}` : undefined;
}

function joinDetailParts(parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter((part): part is string => Boolean(part));
  return filtered.length > 0 ? filtered.join(" • ") : undefined;
}

function sourceRank(source: SpaceActivityLogEntry["source"]): number {
  switch (source) {
    case "turns":
      return 0;
    case "event_log":
      return 1;
    case "orchestration_journal":
      return 2;
  }
}
