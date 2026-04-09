import { randomUUID } from "node:crypto";
import type { ThinkingCapturePolicy } from "@spaceskit/core";
import {
  EventLogRepository,
  OrchestrationJournalRepository,
  TurnRepository,
  type EventLogRow,
  type OrchestrationJournalRow,
  type TurnRow,
} from "@spaceskit/persistence";
import { sanitizeTracePayload } from "./trace-payload-sanitizer.js";

export interface SpaceTurnTraceEvent {
  eventId: string;
  seq: number;
  eventType: string;
  eventSubtype?: string;
  agentId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface SpaceTurnTraceToolCall {
  toolCallId: string;
  toolName?: string;
  status: "started" | "completed" | "error";
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface SpaceTurnTraceActivity {
  activityId: string;
  seq: number;
  eventType: string;
  agentId?: string;
  title: string;
  detail?: string;
  status?: string;
  visibility: string;
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface SpaceTurnTraceExecutionRun {
  executionId: string;
  stepIndex: number;
  agentId?: string;
  providerId?: string;
  modelId?: string;
  status: "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  workingDirectory?: string;
  exitCode?: number;
  commandPreview?: string;
  transcriptArtifactId?: string;
  transcriptTruncated: boolean;
}

export interface SpaceActivityLogEntry {
  entryId: string;
  source: "event_log" | "orchestration_journal" | "turns";
  category: string;
  turnId?: string;
  rootTurnId?: string;
  summaryTurnId?: string;
  agentId?: string;
  actorId?: string;
  eventType: string;
  title: string;
  detail?: string;
  status?: string;
  visibility: string;
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
  seq: number;
  payload: Record<string, unknown>;
}

export interface SpaceListActivityLogResult {
  entries: SpaceActivityLogEntry[];
  total: number;
  nextOffset?: number;
}

export interface SpaceTurnTrace {
  spaceId: string;
  turnId: string;
  total: number;
  events: SpaceTurnTraceEvent[];
  toolCalls: SpaceTurnTraceToolCall[];
  activities: SpaceTurnTraceActivity[];
  executionRuns: SpaceTurnTraceExecutionRun[];
  artifactIds: string[];
}

export interface SpaceTurnTraceServiceOptions {
  eventLog: EventLogRepository;
  orchestrationJournal?: OrchestrationJournalRepository;
  turns?: TurnRepository;
}

interface BufferedReasoningEntry {
  spaceId: string;
  turnId: string;
  agentId?: string;
  textParts: string[];
  lastCreatedAt: string;
}

export class SpaceTurnTraceService {
  private readonly bufferedReasoning = new Map<string, BufferedReasoningEntry>();

  constructor(private readonly options: SpaceTurnTraceServiceOptions) {}

  recordTurnEvent(input: {
    spaceId: string;
    turnId: string;
    agentId?: string;
    eventType: string;
    payload?: unknown;
    createdAt?: string;
    thinkingCapturePolicy?: ThinkingCapturePolicy;
  }): void {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const sanitizedPayload = sanitizeTracePayload(input.payload ?? {});
    const subtype = typeof sanitizedPayload.type === "string" ? sanitizedPayload.type : undefined;
    const normalizedEventType = (subtype ?? input.eventType).trim().toLowerCase();
    if (normalizedEventType === "text_delta") {
      return;
    }
    if (normalizedEventType === "reasoning_delta") {
      const policy = normalizeThinkingCapturePolicy(input.thinkingCapturePolicy);
      if (policy === "OFF") {
        this.clearBufferedReasoning(input.spaceId, input.turnId, input.agentId);
        return;
      }
      if (policy === "SUMMARY") {
        this.bufferReasoning(input.spaceId, input.turnId, input.agentId, sanitizedPayload, createdAt);
        return;
      }
    }
    if (isReasoningFlushEvent(normalizedEventType)) {
      this.flushBufferedReasoning(input.spaceId, input.turnId, input.agentId, createdAt);
    }
    this.persistTurnEvent({
      spaceId: input.spaceId,
      turnId: input.turnId,
      agentId: input.agentId,
      eventType: normalizedEventType,
      payload: sanitizedPayload,
      createdAt,
    });
  }

  private persistTurnEvent(input: {
    spaceId: string;
    turnId: string;
    agentId?: string;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }): void {
    this.options.eventLog.create({
      eventId: `trace-${randomUUID()}`,
      spaceId: input.spaceId,
      turnId: input.turnId,
      agentId: input.agentId,
      eventType: input.eventType,
      payloadJson: JSON.stringify(input.payload),
      createdAt: input.createdAt,
    });
  }

  private bufferReasoning(
    spaceId: string,
    turnId: string,
    agentId: string | undefined,
    payload: Record<string, unknown>,
    createdAt: string,
  ): void {
    const text = readString(payload.text) ?? readString(payload.reasoning);
    if (!text) return;
    const key = reasoningBufferKey(spaceId, turnId, agentId);
    const existing = this.bufferedReasoning.get(key);
    if (existing) {
      existing.textParts.push(text);
      existing.lastCreatedAt = createdAt;
      return;
    }
    this.bufferedReasoning.set(key, {
      spaceId,
      turnId,
      agentId,
      textParts: [text],
      lastCreatedAt: createdAt,
    });
  }

  private flushBufferedReasoning(
    spaceId: string,
    turnId: string,
    agentId: string | undefined,
    createdAt: string,
  ): void {
    for (const [key, entry] of this.bufferedReasoning.entries()) {
      if (entry.spaceId !== spaceId || entry.turnId !== turnId) continue;
      if (agentId && entry.agentId && entry.agentId !== agentId) continue;

      const text = entry.textParts
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .join("\n\n");
      this.bufferedReasoning.delete(key);
      if (!text) continue;

      this.persistTurnEvent({
        spaceId,
        turnId,
        agentId: entry.agentId,
        eventType: "reasoning_delta",
        payload: {
          type: "reasoning_delta",
          text,
          summarized: true,
        },
        createdAt: createdAt || entry.lastCreatedAt,
      });
    }
  }

  private clearBufferedReasoning(
    spaceId: string,
    turnId: string,
    agentId: string | undefined,
  ): void {
    for (const key of this.bufferedReasoning.keys()) {
      const entry = this.bufferedReasoning.get(key);
      if (!entry || entry.spaceId !== spaceId || entry.turnId !== turnId) continue;
      if (agentId && entry.agentId && entry.agentId !== agentId) continue;
      this.bufferedReasoning.delete(key);
    }
  }

  getTurnTrace(input: {
    spaceId: string;
    turnId: string;
    limit?: number;
    offset?: number;
  }): SpaceTurnTrace {
    const rows = this.options.eventLog.list({
      spaceId: input.spaceId,
      turnId: input.turnId,
      limit: input.limit,
      offset: input.offset,
    });
    const total = this.options.eventLog.count(input.spaceId, input.turnId);
    const events = rows.map((row) => mapRow(row));
    const toolCalls = deriveToolCalls(events);
    const executionRuns = deriveExecutionRuns(events);
    const artifactIds = deriveArtifactIds(events);
    const activities = buildTraceActivities({
      eventRows: rows,
      journalRows: this.listJournalRows(input.spaceId, input.turnId),
      turnRows: this.listTurnRows(input.spaceId, input.turnId),
    });

    return {
      spaceId: input.spaceId,
      turnId: input.turnId,
      total,
      events,
      toolCalls,
      activities,
      executionRuns,
      artifactIds,
    };
  }

  listActivityLog(input: {
    spaceId: string;
    turnId?: string;
    limit?: number;
    offset?: number;
    includeSystem?: boolean;
  }): SpaceListActivityLogResult {
    const entries = buildActivityLogEntries({
      eventRows: this.listEventRows(input.spaceId, input.turnId),
      journalRows: this.listJournalRows(input.spaceId, input.turnId),
      turnRows: this.listTurnRows(input.spaceId, input.turnId),
    }).filter((entry) => input.includeSystem !== false || entry.category !== "system");

    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);
    const paged = entries.slice(offset, offset + limit);
    const nextOffset = offset + paged.length < entries.length ? offset + paged.length : undefined;

    return {
      entries: paged,
      total: entries.length,
      ...(nextOffset !== undefined ? { nextOffset } : {}),
    };
  }

  private listEventRows(spaceId: string, turnId?: string): EventLogRow[] {
    const total = this.options.eventLog.count(spaceId, turnId);
    if (total <= 0) return [];
    return this.options.eventLog.list({
      spaceId,
      turnId,
      limit: total,
      offset: 0,
    });
  }

  private listJournalRows(spaceId: string, turnId?: string): OrchestrationJournalRow[] {
    if (!this.options.orchestrationJournal) return [];
    const total = this.options.orchestrationJournal.count(spaceId, turnId);
    if (total <= 0) return [];
    return this.options.orchestrationJournal.list({
      spaceId,
      turnId,
      limit: total,
      offset: 0,
    });
  }

  private listTurnRows(spaceId: string, turnId?: string): TurnRow[] {
    if (!this.options.turns) return [];
    if (turnId) {
      const total = this.options.turns.countByLogicalTurn(spaceId, turnId);
      if (total <= 0) return [];
      return this.options.turns.listByLogicalTurn(spaceId, turnId, total, 0);
    }

    const total = this.options.turns.countBySpace(spaceId);
    if (total <= 0) return [];
    return this.options.turns.listBySpace(spaceId, total, 0);
  }
}

function mapRow(row: EventLogRow): SpaceTurnTraceEvent {
  const payload = parseJsonRecord(row.payload_json);
  const eventSubtype = typeof payload.type === "string" ? payload.type : undefined;
  return {
    eventId: row.event_id,
    seq: row.seq,
    eventType: row.event_type,
    eventSubtype,
    agentId: row.agent_id.trim() || undefined,
    createdAt: row.created_at,
    payload,
  };
}

function buildTraceActivities(input: {
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

function buildActivityLogEntries(input: {
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

  return {
    entryId: row.event_id,
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

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse failures
  }
  return {};
}

function deriveToolCalls(events: SpaceTurnTraceEvent[]): SpaceTurnTraceToolCall[] {
  const byId = new Map<string, SpaceTurnTraceToolCall>();

  for (const event of events) {
    const subtype = event.eventSubtype ?? event.eventType;
    const payload = event.payload;
    const toolCallRecord = asRecord(payload.toolCall) ?? asRecord(payload.result);
    const toolCallId = readString(payload.toolCallId)
      ?? readString(toolCallRecord?.id)
      ?? readString(toolCallRecord?.toolCallId);
    if (!toolCallId) continue;

    const current = byId.get(toolCallId) ?? {
      toolCallId,
      status: "started",
      agentId: event.agentId,
      startedAt: event.createdAt,
    };
    current.agentId = current.agentId ?? event.agentId;
    current.toolName = current.toolName
      ?? readString(toolCallRecord?.name)
      ?? current.toolName;

    if (subtype === "tool_result") {
      const isError = payload.isError === true
        || (asRecord(payload.result)?.isError === true)
        || (asRecord(payload.result)?.error != null);
      current.status = isError ? "error" : "completed";
      current.completedAt = event.createdAt;
    } else if (subtype === "tool_call_start") {
      current.status = "started";
      current.startedAt = current.startedAt ?? event.createdAt;
    }

    byId.set(toolCallId, current);
  }

  return [...byId.values()].sort((lhs, rhs) => {
    const left = lhs.startedAt ?? lhs.completedAt ?? "";
    const right = rhs.startedAt ?? rhs.completedAt ?? "";
    return left.localeCompare(right);
  });
}

function deriveExecutionRuns(events: SpaceTurnTraceEvent[]): SpaceTurnTraceExecutionRun[] {
  const byId = new Map<string, SpaceTurnTraceExecutionRun>();

  for (const event of events) {
    if (event.eventType !== "cli_execution.started" && event.eventType !== "cli_execution.completed") {
      continue;
    }

    const executionId = readString(event.payload.executionId);
    if (!executionId) continue;

    const current = byId.get(executionId) ?? {
      executionId,
      stepIndex: readNumber(event.payload.stepIndex) ?? 0,
      status: event.eventType === "cli_execution.completed" ? "completed" : "running",
      transcriptTruncated: readBoolean(event.payload.transcriptTruncated) ?? false,
    };

    current.stepIndex = readNumber(event.payload.stepIndex) ?? current.stepIndex;
    current.agentId = readString(event.payload.agentId) ?? event.agentId ?? current.agentId;
    current.providerId = readString(event.payload.providerId) ?? current.providerId;
    current.modelId = readString(event.payload.modelId) ?? current.modelId;
    current.startedAt = readString(event.payload.startedAt) ?? current.startedAt;
    current.completedAt = readString(event.payload.completedAt) ?? current.completedAt;
    current.durationMs = readNumber(event.payload.durationMs) ?? current.durationMs;
    current.workingDirectory = readString(event.payload.workingDirectory) ?? current.workingDirectory;
    current.exitCode = readNumber(event.payload.exitCode) ?? current.exitCode;
    current.commandPreview = readString(event.payload.commandPreview) ?? current.commandPreview;
    current.transcriptArtifactId = readString(event.payload.transcriptArtifactId) ?? current.transcriptArtifactId;
    current.transcriptTruncated = readBoolean(event.payload.transcriptTruncated) ?? current.transcriptTruncated;

    if (event.eventType === "cli_execution.completed") {
      current.status = readExecutionStatus(event.payload.status, current.exitCode);
    } else if (current.status !== "completed" && current.status !== "failed") {
      current.status = "running";
    }

    byId.set(executionId, current);
  }

  return [...byId.values()].sort((lhs, rhs) => {
    if (lhs.stepIndex !== rhs.stepIndex) {
      return lhs.stepIndex - rhs.stepIndex;
    }
    const left = lhs.startedAt ?? lhs.completedAt ?? "";
    const right = rhs.startedAt ?? rhs.completedAt ?? "";
    if (left !== right) {
      return left.localeCompare(right);
    }
    return lhs.executionId.localeCompare(rhs.executionId);
  });
}

function deriveArtifactIds(events: SpaceTurnTraceEvent[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    collectArtifactIds(event.payload, ids, 0);
  }
  return [...ids.values()].sort((lhs, rhs) => lhs.localeCompare(rhs));
}

function collectArtifactIds(value: unknown, ids: Set<string>, depth: number): void {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectArtifactIds(entry, ids, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    const normalized = normalizeKey(key);
    if (normalized === "artifactid" && typeof nested === "string" && nested.trim().length > 0) {
      ids.add(nested.trim());
    }
    collectArtifactIds(nested, ids, depth + 1);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readExecutionStatus(value: unknown, exitCode?: number): "running" | "completed" | "failed" {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "running" || normalized === "completed" || normalized === "failed") {
    return normalized;
  }
  if (typeof exitCode === "number") {
    return exitCode === 0 ? "completed" : "failed";
  }
  return "completed";
}

function normalizeThinkingCapturePolicy(value: ThinkingCapturePolicy | undefined): ThinkingCapturePolicy {
  switch (value) {
    case "OFF":
    case "FULL":
      return value;
    default:
      return "SUMMARY";
  }
}

function isReasoningFlushEvent(eventType: string): boolean {
  return eventType === "turn_completed" || eventType === "turn_cancelled" || eventType === "error";
}

function reasoningBufferKey(spaceId: string, turnId: string, agentId: string | undefined): string {
  return `${spaceId}::${turnId}::${agentId ?? ""}`;
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 200;
  }
  return Math.max(1, Math.min(1000, Math.floor(value)));
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
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
