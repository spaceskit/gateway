import { randomUUID } from "node:crypto";
import type { GatewayEvent } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import {
  type GatewayMessage,
  MessageTypes,
  type TurnEventPayload,
} from "./protocol.js";
import {
  buildTurnStreamPayload,
  buildTypedTurnPayload,
  normalizeGatewayEventPayload,
  resolveTurnAgentId as resolveTurnAgentIdFromEvent,
} from "./gateway-turn-event-projection.js";
import { deterministicUuid, normalizeUuid } from "./uuid.js";

export interface GatewayEventBroadcasterOptions {
  logger?: Logger | null;
  resolveSpaceUid?: (spaceId: string) => string | undefined | Promise<string | undefined>;
  publish: (spaceUid: string, msg: GatewayMessage) => void;
}

export class GatewayEventBroadcaster {
  private readonly log: Logger | null;
  private readonly spaceUidBySpaceId = new Map<string, string>();
  private streamSeqCounter = 0;
  private streamTsCache = "";
  private streamTsCacheMs = 0;

  constructor(private readonly options: GatewayEventBroadcasterOptions) {
    this.log = options.logger ?? null;
  }

  /**
   * Synchronous fast-path for resolveSpaceUid: returns cached values without
   * any async resolver work. Returns undefined on cache miss.
   */
  private resolveSpaceUidSync(spaceId: string): string | undefined {
    return this.spaceUidBySpaceId.get(spaceId);
  }

  private nextStreamId(): string {
    return `s-${++this.streamSeqCounter}`;
  }

  private getStreamTimestamp(): string {
    const now = Date.now();
    if (now - this.streamTsCacheMs > 1000) {
      this.streamTsCache = new Date(now).toISOString();
      this.streamTsCacheMs = now;
    }
    return this.streamTsCache;
  }

  private async resolveSpaceUid(spaceIdRaw: string): Promise<string> {
    const spaceId = spaceIdRaw.trim();
    if (!spaceId) return deterministicUuid("unknown-space", "spaceskit.space.uuid");
    const cached = this.spaceUidBySpaceId.get(spaceId);
    if (cached) return cached;
    const fallback = deterministicUuid(spaceId, "spaceskit.space.uuid");

    if (!this.options.resolveSpaceUid) {
      this.spaceUidBySpaceId.set(spaceId, fallback);
      return fallback;
    }
    try {
      const resolved = await this.options.resolveSpaceUid(spaceId);
      const normalized = normalizeUuid(resolved);
      if (normalized) {
        this.spaceUidBySpaceId.set(spaceId, normalized);
        return normalized;
      }
    } catch {
      // UID enrichment is best-effort; emit deterministic UUID if resolution fails.
      return fallback;
    }
    this.spaceUidBySpaceId.set(spaceId, fallback);
    return fallback;
  }

  async broadcastEvent(event: GatewayEvent): Promise<void> {
    // Fast path: text_delta events skip normalizeGatewayEventPayload entirely.
    const rawEvent = event as Record<string, unknown>;
    const innerEvent = rawEvent.event as Record<string, unknown> | undefined;
    if (
      innerEvent
      && typeof innerEvent.type === "string"
      && innerEvent.type === "text_delta"
    ) {
      const spaceId = typeof rawEvent.spaceId === "string" ? rawEvent.spaceId.trim() : "";
      if (!spaceId) return;

      let spaceUid = this.resolveSpaceUidSync(spaceId);
      if (!spaceUid) {
        spaceUid = await this.resolveSpaceUid(spaceId);
      }

      const payload = buildTurnStreamPayload({
        eventRecord: rawEvent,
        turnEvent: innerEvent,
        spaceId,
        spaceUid,
      });

      this.options.publish(spaceUid, {
        type: MessageTypes.TURN_STREAM,
        id: this.nextStreamId(),
        ts: this.getStreamTimestamp(),
        payload,
      });
      return;
    }

    const eventRecord = normalizeGatewayEventPayload(event) as Record<string, unknown>;
    const spaceId = typeof eventRecord.spaceId === "string" ? eventRecord.spaceId.trim() : "";
    if (!spaceId) return;
    const spaceUid = await this.resolveSpaceUid(spaceId);
    const normalizedType = typeof eventRecord.type === "string" ? eventRecord.type : "";

    if (normalizedType === "space.orchestrator_event") {
      const createdAt = typeof eventRecord.createdAt === "string"
        ? eventRecord.createdAt
        : new Date().toISOString();
      const turnId = typeof eventRecord.turnId === "string" ? eventRecord.turnId : "";
      const commandId = typeof eventRecord.commandId === "string"
        ? eventRecord.commandId
        : turnId
          ? `summary-${turnId}`
          : `summary-${randomUUID()}`;
      const correlationId = typeof eventRecord.correlationId === "string"
        ? eventRecord.correlationId
        : turnId || commandId;
      const status = typeof eventRecord.status === "string" ? eventRecord.status : "completed";
      const eventType = typeof eventRecord.eventType === "string"
        ? eventRecord.eventType
        : "summary.completed";
      const eventPayload = eventRecord.event && typeof eventRecord.event === "object"
        ? eventRecord.event as Record<string, unknown>
        : { type: eventType };

      this.options.publish(spaceUid, {
        type: MessageTypes.ORCHESTRATOR_EVENT,
        id: randomUUID(),
        ts: new Date().toISOString(),
        payload: {
          commandId,
          correlationId,
          status,
          event: eventPayload,
          createdAt,
          eventType,
          spaceId,
          spaceUid,
          turnId,
        },
      });
      return;
    }

    const turnId = typeof eventRecord.turnId === "string" ? eventRecord.turnId : "";
    const turnEvent = eventRecord.event as Record<string, unknown> | undefined;
    const eventSubtype = typeof turnEvent?.type === "string" ? turnEvent.type : "";

    if (eventSubtype === "text_delta") {
      const payload = buildTurnStreamPayload({
        eventRecord,
        turnEvent,
        spaceId,
        spaceUid,
      });

      this.options.publish(spaceUid, {
        type: MessageTypes.TURN_STREAM,
        id: this.nextStreamId(),
        ts: this.getStreamTimestamp(),
        payload,
      });
      return;
    }

    const agentId = resolveGatewayTurnAgentId(eventRecord, turnEvent);
    const rootTurnId = typeof eventRecord.rootTurnId === "string" ? eventRecord.rootTurnId : undefined;
    const conversationTopology = typeof eventRecord.conversationTopology === "string"
      ? eventRecord.conversationTopology
      : undefined;
    const transcriptVisibility = typeof eventRecord.transcriptVisibility === "string"
      ? eventRecord.transcriptVisibility
      : undefined;
    const nowIso = new Date().toISOString();
    const typedPayload = buildTypedTurnPayload({
      eventSubtype,
      normalizedType,
      eventRecord: turnEvent ?? eventRecord,
      agentId,
      turnId,
      rootTurnId,
      conversationTopology,
      transcriptVisibility,
    });
    if (!typedPayload) {
      this.log?.warn("Dropping turn event without typed payload", {
        eventSubtype,
        normalizedType,
        spaceId,
        turnId,
      });
      return;
    }
    const payload: TurnEventPayload = {
      spaceId,
      spaceUid,
      turnId,
      rootTurnId,
      agentId,
      conversationTopology,
      transcriptVisibility,
      typedPayload,
      ts: nowIso,
    };

    this.options.publish(spaceUid, {
      type: MessageTypes.TURN_EVENT,
      id: randomUUID(),
      ts: nowIso,
      payload,
    });
  }

}

export function resolveGatewayTurnAgentId(
  eventRecord: Record<string, unknown>,
  turnEvent?: Record<string, unknown>,
): string {
  return resolveTurnAgentIdFromEvent(eventRecord, turnEvent);
}
