import { randomUUID } from "node:crypto";
import type { ThinkingCapturePolicy } from "@spaceskit/core";
import type { EventLogRow, OrchestrationJournalRow, TurnRow } from "@spaceskit/persistence";
import {
  buildActivityLogEntries,
  buildTraceActivities,
  deriveArtifactIds,
  deriveExecutionRuns,
  deriveToolCalls,
  mapRow,
  readString,
} from "./space-turn-trace-read-model.js";
import { sanitizeTracePayload } from "./trace-payload-sanitizer.js";
import type {
  SpaceListActivityLogResult,
  SpaceTurnTrace,
  SpaceTurnTraceServiceOptions,
} from "./space-turn-trace-types.js";

export type {
  SpaceActivityLogEntry,
  SpaceListActivityLogResult,
  SpaceTurnTrace,
  SpaceTurnTraceActivity,
  SpaceTurnTraceEvent,
  SpaceTurnTraceExecutionRun,
  SpaceTurnTraceServiceOptions,
  SpaceTurnTraceToolCall,
} from "./space-turn-trace-types.js";

interface BufferedReasoningEntry {
  spaceId: string;
  turnId: string;
  agentId?: string;
  textParts: string[];
  lastCreatedAt: string;
}

interface BufferedClientEntry {
  spaceId: string;
  turnId: string;
  agentId?: string;
  textParts: string[];
  lastCreatedAt: string;
}

export class SpaceTurnTraceService {
  private readonly bufferedReasoning = new Map<string, BufferedReasoningEntry>();
  private readonly bufferedClientDeltas = new Map<string, BufferedClientEntry>();

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
      if (shouldBufferClientDelta(sanitizedPayload)) {
        this.bufferClientDelta(input.spaceId, input.turnId, input.agentId, sanitizedPayload, createdAt);
      }
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
      this.flushBufferedClientDelta(input.spaceId, input.turnId, input.agentId, createdAt);
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

  private bufferClientDelta(
    spaceId: string,
    turnId: string,
    agentId: string | undefined,
    payload: Record<string, unknown>,
    createdAt: string,
  ): void {
    const text = readString(payload.text);
    if (!text) return;
    const key = clientBufferKey(spaceId, turnId, agentId);
    const existing = this.bufferedClientDeltas.get(key);
    if (existing) {
      existing.textParts.push(text);
      existing.lastCreatedAt = createdAt;
      return;
    }
    this.bufferedClientDeltas.set(key, {
      spaceId,
      turnId,
      agentId,
      textParts: [text],
      lastCreatedAt: createdAt,
    });
  }

  private flushBufferedClientDelta(
    spaceId: string,
    turnId: string,
    agentId: string | undefined,
    createdAt: string,
  ): void {
    for (const [key, entry] of this.bufferedClientDeltas.entries()) {
      if (entry.spaceId !== spaceId || entry.turnId !== turnId) continue;
      if (agentId && entry.agentId && entry.agentId !== agentId) continue;

      const text = entry.textParts.join("");
      this.bufferedClientDeltas.delete(key);
      if (!text.trim()) continue;

      this.persistTurnEvent({
        spaceId,
        turnId,
        agentId: entry.agentId,
        eventType: "client_delta",
        payload: {
          type: "client_delta",
          text,
          transcriptVisibility: "activity_only",
          streamKind: "provider_client",
        },
        createdAt: createdAt || entry.lastCreatedAt,
      });
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

function clientBufferKey(spaceId: string, turnId: string, agentId: string | undefined): string {
  return `${spaceId}::${turnId}::${agentId ?? ""}`;
}

function shouldBufferClientDelta(payload: Record<string, unknown>): boolean {
  return readString(payload.transcriptVisibility) === "activity_only"
    && readString(payload.streamKind) === "provider_client";
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
