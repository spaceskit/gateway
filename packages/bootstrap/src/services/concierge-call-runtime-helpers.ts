import type { EventBus } from "@spaceskit/core";
import type {
  ConciergeCallEventPayload,
  ConciergeCallMetricsPayload,
} from "@spaceskit/server";

export class ConciergeCallRuntimeError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "PERMISSION_DENIED"
    | "INTERNAL";

  constructor(
    code: ConciergeCallRuntimeError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export interface CallRuntimeRecord {
  callId: string;
  principalId?: string;
  deviceId?: string;
  platform: string;
  displayName: string;
  ttsMode: string;
  targetGatewayId?: string;
  state: "connecting" | "active" | "ended";
  muted: boolean;
  spaceId: string;
  spaceUid: string;
  targetAgentId?: string;
  activeTurnId?: string;
  metrics: ConciergeCallMetricsPayload;
  startedAt: string;
  updatedAt: string;
}

export function normalizeOptional(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeRequired(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new ConciergeCallRuntimeError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

export function nowIso(now: () => Date): string {
  return now().toISOString();
}

export function updateCallRuntimeRecordFromLifecycle(
  record: CallRuntimeRecord,
  event: ConciergeCallEventPayload,
): void {
  record.platform = event.platform;
  record.displayName = event.displayName;
  record.ttsMode = event.ttsMode;
  record.targetGatewayId = event.targetGatewayId;
  record.state = event.state;
  record.muted = event.muted;
  record.deviceId = event.deviceId ?? record.deviceId;
  record.updatedAt = event.ts;
}

export function decorateConciergeCallEvent(
  record: CallRuntimeRecord,
  event: ConciergeCallEventPayload,
): ConciergeCallEventPayload {
  updateCallRuntimeRecordFromLifecycle(record, event);
  return {
    ...event,
    metrics: {
      ...record.metrics,
      ...event.metrics,
    },
    activeTurnId: event.activeTurnId ?? record.activeTurnId,
  };
}

export function buildConciergeBaseEvent(
  record: CallRuntimeRecord,
  overrides: Partial<ConciergeCallEventPayload>,
  now: () => Date,
): ConciergeCallEventPayload {
  const ts = overrides.ts ?? nowIso(now);
  return {
    callId: record.callId,
    state: overrides.state ?? record.state,
    platform: overrides.platform ?? record.platform,
    deviceId: overrides.deviceId ?? record.deviceId,
    displayName: overrides.displayName ?? record.displayName,
    ttsMode: overrides.ttsMode ?? record.ttsMode,
    muted: overrides.muted ?? record.muted,
    targetGatewayId: overrides.targetGatewayId ?? record.targetGatewayId,
    transcriptDelta: overrides.transcriptDelta,
    assistantTextDelta: overrides.assistantTextDelta,
    urgency: overrides.urgency,
    handoffToken: overrides.handoffToken,
    metrics: {
      ...record.metrics,
      ...overrides.metrics,
    },
    reason: overrides.reason,
    emittedAt: overrides.emittedAt ?? ts,
    mediaEventType: overrides.mediaEventType,
    sequence: overrides.sequence,
    transcriptFinal: overrides.transcriptFinal,
    assistantTextFinal: overrides.assistantTextFinal,
    activeTurnId: overrides.activeTurnId ?? record.activeTurnId,
    providerSource: overrides.providerSource,
    providerId: overrides.providerId,
    fallbackReason: overrides.fallbackReason,
    assistantAudioBase64: overrides.assistantAudioBase64,
    assistantAudioDurationSeconds: overrides.assistantAudioDurationSeconds,
    ts,
  };
}

export function createConciergeTurnEventCollector(input: {
  record: CallRuntimeRecord;
  startedAt: Date;
  eventBus: EventBus;
  now: () => Date;
  baseEvent: (
    record: CallRuntimeRecord,
    overrides: Partial<ConciergeCallEventPayload>,
  ) => ConciergeCallEventPayload;
}): {
  promise: Promise<ConciergeCallEventPayload[]>;
  bindTurnId: (turnId: string) => void;
  dispose: () => void;
} {
  const { record, startedAt, eventBus, now, baseEvent } = input;
  let boundTurnId: string | undefined;
  let settled = false;
  let resolvePromise!: (events: ConciergeCallEventPayload[]) => void;
  let rejectPromise!: (error: ConciergeCallRuntimeError) => void;

  const promise = new Promise<ConciergeCallEventPayload[]>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const bufferedTurnEvents: Array<Record<string, unknown>> = [];

  const timeout = setTimeout(() => {
    finish(() => rejectPromise(new ConciergeCallRuntimeError("FAILED_PRECONDITION", "Concierge call turn timed out")));
  }, 30_000);

  const unsubscribe = eventBus.on("space.turn_event", (rawEvent) => {
    if (settled) {
      return;
    }
    const typedEvent = rawEvent as { spaceId?: string };
    if (typedEvent.spaceId !== record.spaceId) {
      return;
    }
    if (!boundTurnId) {
      bufferedTurnEvents.push(rawEvent as Record<string, unknown>);
      return;
    }
    processTurnEvent(rawEvent as Record<string, unknown>);
  });

  const finish = (fn: () => void) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    unsubscribe();
    bufferedTurnEvents.length = 0;
    if (boundTurnId && record.activeTurnId === boundTurnId) {
      record.activeTurnId = undefined;
    }
    fn();
  };

  const bindTurnId = (turnId: string) => {
    if (settled) {
      return;
    }
    boundTurnId = turnId;
    for (const bufferedEvent of bufferedTurnEvents) {
      if (settled) {
        break;
      }
      processTurnEvent(bufferedEvent);
    }
    bufferedTurnEvents.length = 0;
  };

  const processTurnEvent = (rawEvent: Record<string, unknown>) => {
    if (rawEvent.spaceId !== record.spaceId || rawEvent.turnId !== boundTurnId) {
      return;
    }

    const event = rawEvent.event as Record<string, unknown> | undefined;
    if (!event) {
      return;
    }
    const type = typeof event.type === "string" ? event.type : undefined;
    if (!type) {
      return;
    }

    if (type === "text_delta") {
      const text = normalizeOptional(event.text as string | undefined);
      if (!text) {
        return;
      }
      collected += text;
      if (!record.metrics.llmFirstTokenMs) {
        record.metrics.llmFirstTokenMs = Math.max(0, now().getTime() - startedAt.getTime());
      }
      collectedEvents.push(
        baseEvent(record, {
          assistantTextDelta: text,
          assistantTextFinal: false,
          activeTurnId: boundTurnId,
          mediaEventType: "assistant_text_partial",
          reason: "assistant_text_delta",
        }),
      );
      return;
    }

    if (type === "feedback_requested") {
      const request = event.request as Record<string, unknown> | undefined;
      const description = normalizeOptional(request?.description as string | undefined)
        ?? "The concierge needs approval before it can continue.";
      collectedEvents.push(
        baseEvent(record, {
          assistantTextDelta: description,
          assistantTextFinal: true,
          activeTurnId: boundTurnId,
          mediaEventType: "assistant_text_final",
          reason: "feedback_requested",
        }),
      );
      finish(() => resolvePromise(collectedEvents));
      return;
    }

    if (type === "turn_completed") {
      const result = event.result as { finalMessage?: { content?: string } } | undefined;
      const finalMessage = normalizeOptional(result?.finalMessage?.content)
        ?? normalizeOptional(collected)
        ?? "Completed.";
      collectedEvents.push(
        baseEvent(record, {
          assistantTextDelta: finalMessage,
          assistantTextFinal: true,
          activeTurnId: boundTurnId,
          mediaEventType: "assistant_text_final",
          reason: "assistant_turn_completed",
        }),
      );
      finish(() => resolvePromise(collectedEvents));
      return;
    }

    if (type === "error") {
      const error = event.error as { message?: string } | undefined;
      const message = normalizeOptional(error?.message) ?? "The concierge call turn failed.";
      finish(() => rejectPromise(new ConciergeCallRuntimeError("FAILED_PRECONDITION", message)));
    }
  };

  const collectedEvents: ConciergeCallEventPayload[] = [];
  let collected = "";

  return {
    promise,
    bindTurnId,
    dispose: () => {
      finish(() => undefined);
    },
  };
}
