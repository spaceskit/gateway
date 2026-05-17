import {
  MessageTypes,
  type GatewayMessage,
  type SpaceListOrchestrationJournalPayload,
  type SpaceListOrchestrationJournalResponsePayload,
  type SpaceListTurnsPayload,
  type SpaceListTurnsResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import { normalizeString, parsePaginationInt } from "../message-router-utils.js";
import { normalizeUuid } from "../uuid.js";
import type { SpaceResourceHandlerContext } from "./space-resource-handlers.js";

export async function handleSpaceListTurns(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.turnHistoryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Turn history service unavailable");
  }
  const payload = (msg.payload ?? {}) as SpaceListTurnsPayload;
  const requestedSpaceId = normalizeString(payload?.spaceId);
  const requestedSpaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
  const resolvedSpaceId = requestedSpaceId
    ?? (requestedSpaceUid ? await context.resolveSpaceId(requestedSpaceUid) : null);
  if (!resolvedSpaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId or spaceUid is required");
  }

  const parsedLimit = parsePaginationInt(payload?.limit, {
    field: "limit",
    defaultValue: 100,
    min: 1,
    max: 500,
  });
  if (!parsedLimit.ok) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", parsedLimit.message);
  }

  const lastSeenTurnId = normalizeString(payload?.lastSeenTurnId);
  const parsedOffset = lastSeenTurnId
    ? { ok: true as const, value: 0 }
    : parsePaginationInt(payload?.offset, {
      field: "offset",
      defaultValue: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
  if (!parsedOffset.ok) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", parsedOffset.message);
  }

  const history = await context.turnHistoryService.listSpaceTurns({
    spaceId: resolvedSpaceId,
    limit: parsedLimit.value,
    offset: parsedOffset.value,
    lastSeenTurnId,
  });
  const normalizedTurns = Array.isArray(history.turns) ? history.turns : [];
  const total = Number.isFinite(history.total)
    ? Math.max(0, Math.trunc(history.total))
    : normalizedTurns.length;
  const nextOffset = lastSeenTurnId
    ? undefined
    : (
      parsedOffset.value + normalizedTurns.length < total
        ? parsedOffset.value + normalizedTurns.length
        : undefined
    );

  return context.response(msg.id, MessageTypes.SPACE_LIST_TURNS, {
    spaceId: resolvedSpaceId,
    spaceUid: await context.resolveSpaceUid(resolvedSpaceId),
    turns: normalizedTurns,
    total,
    nextOffset,
  } satisfies SpaceListTurnsResponsePayload);
}

export async function handleSpaceListOrchestrationJournal(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.orchestrationJournalService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Orchestration journal service unavailable");
  }
  const payload = (msg.payload ?? {}) as SpaceListOrchestrationJournalPayload;
  const requestedSpaceId = normalizeString(payload?.spaceId);
  const requestedSpaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
  const resolvedSpaceId = requestedSpaceId
    ?? (requestedSpaceUid ? await context.resolveSpaceId(requestedSpaceUid) : null);
  if (!resolvedSpaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId or spaceUid is required");
  }

  const parsedLimit = parsePaginationInt(payload?.limit, {
    field: "limit",
    defaultValue: 50,
    min: 1,
    max: 500,
  });
  if (!parsedLimit.ok) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", parsedLimit.message);
  }

  const parsedOffset = parsePaginationInt(payload?.offset, {
    field: "offset",
    defaultValue: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
  if (!parsedOffset.ok) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", parsedOffset.message);
  }

  const turnId = normalizeString(payload.turnId);
  const history = await context.orchestrationJournalService.listEntries({
    spaceId: resolvedSpaceId,
    turnId,
    limit: parsedLimit.value,
    offset: parsedOffset.value,
  });
  const normalizedEntries = Array.isArray(history.entries) ? history.entries : [];
  const total = Number.isFinite(history.total)
    ? Math.max(0, Math.trunc(history.total))
    : normalizedEntries.length;
  const nextOffset = parsedOffset.value + normalizedEntries.length < total
    ? parsedOffset.value + normalizedEntries.length
    : undefined;
  const spaceUid = await context.resolveSpaceUid(resolvedSpaceId);

  return context.response(msg.id, MessageTypes.SPACE_LIST_ORCHESTRATION_JOURNAL, {
    spaceId: resolvedSpaceId,
    spaceUid,
    entries: normalizedEntries.map((entry) => ({
      eventId: entry.eventId,
      spaceId: resolvedSpaceId,
      spaceUid,
      turnId: normalizeString(entry.turnId),
      seq: entry.seq,
      eventType: entry.eventType,
      actorId: entry.actorId,
      lineageId: normalizeString(entry.lineageId),
      hopCount: entry.hopCount,
      payload: entry.payload,
      createdAt: entry.createdAt,
    })),
    total,
    nextOffset,
  } satisfies SpaceListOrchestrationJournalResponsePayload);
}
