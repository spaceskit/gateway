import { randomUUID } from "node:crypto";
import {
  EventLogRepository,
  type EventLogRow,
} from "@spaceskit/persistence";

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

export interface SpaceTurnTrace {
  spaceId: string;
  turnId: string;
  total: number;
  events: SpaceTurnTraceEvent[];
  toolCalls: SpaceTurnTraceToolCall[];
  artifactIds: string[];
}

export interface SpaceTurnTraceServiceOptions {
  eventLog: EventLogRepository;
}

export class SpaceTurnTraceService {
  constructor(private readonly options: SpaceTurnTraceServiceOptions) {}

  recordTurnEvent(input: {
    spaceId: string;
    turnId: string;
    agentId?: string;
    eventType: string;
    payload?: unknown;
    createdAt?: string;
  }): void {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const sanitizedPayload = sanitizeTracePayload(input.payload ?? {});
    const subtype = typeof sanitizedPayload.type === "string" ? sanitizedPayload.type : undefined;
    this.options.eventLog.create({
      eventId: `trace-${randomUUID()}`,
      spaceId: input.spaceId,
      turnId: input.turnId,
      agentId: input.agentId,
      eventType: subtype ?? input.eventType,
      payloadJson: JSON.stringify(sanitizedPayload),
      createdAt,
    });
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
    const artifactIds = deriveArtifactIds(events);

    return {
      spaceId: input.spaceId,
      turnId: input.turnId,
      total,
      events,
      toolCalls,
      artifactIds,
    };
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

function sanitizeTracePayload(value: unknown, keyPath: string[] = []): Record<string, unknown> {
  const sanitized = sanitizeValue(value, keyPath);
  if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return {
    value: sanitized,
  };
}

function sanitizeValue(value: unknown, keyPath: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, keyPath));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (shouldRedactKey(key, keyPath)) {
        const normalized = normalizeKey(key);
        next[key] = normalized === "messages" ? "[REDACTED_MESSAGES]" : "[REDACTED]";
        continue;
      }
      next[key] = sanitizeValue(nested, [...keyPath, key]);
    }
    return next;
  }
  return value;
}

const SAFE_TOKEN_KEYS = new Set([
  "prompttokens",
  "completiontokens",
  "totaltokens",
  "inputtokens",
  "outputtokens",
  "inputnocachetokens",
  "inputcachereadtokens",
  "inputcachewritetokens",
  "outputtexttokens",
  "outputreasoningtokens",
  "cachedinputtokens",
  "tokenspersecond",
]);

function shouldRedactKey(key: string, _keyPath: string[]): boolean {
  const normalized = normalizeKey(key);
  if (SAFE_TOKEN_KEYS.has(normalized)) return false;
  return normalized === "messages"
    || normalized.includes("instruction")
    || normalized.includes("prompt")
    || normalized.includes("planner")
    || normalized.includes("guest")
    || normalized.includes("peerreview")
    || normalized.includes("synthesis")
    || normalized.includes("tooltrace")
    || normalized.includes("rawtrace")
    || normalized.includes("apikey")
    || normalized.includes("secret")
    || normalized.includes("token");
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
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
