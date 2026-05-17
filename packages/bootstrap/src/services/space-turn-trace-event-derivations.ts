import type { EventLogRow } from "@spaceskit/persistence";
import type {
  SpaceTurnTraceEvent,
  SpaceTurnTraceExecutionRun,
  SpaceTurnTraceToolCall,
} from "./space-turn-trace-types.js";
import {
  asRecord,
  normalizeKey,
  parseJsonRecord,
  readBoolean,
  readExecutionStatus,
  readNumber,
  readString,
} from "./space-turn-trace-read-values.js";

export function mapRow(row: EventLogRow): SpaceTurnTraceEvent {
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

export function deriveToolCalls(events: SpaceTurnTraceEvent[]): SpaceTurnTraceToolCall[] {
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

export function deriveExecutionRuns(events: SpaceTurnTraceEvent[]): SpaceTurnTraceExecutionRun[] {
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

export function deriveArtifactIds(events: SpaceTurnTraceEvent[]): string[] {
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
