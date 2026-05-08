import type { EventBus } from "@spaceskit/core";
import { ConciergeCallService, ConciergeCallServiceError, normalizeTtsMode } from "@spaceskit/core";
import type { AppleNotificationLifecycleService, SpaceManager } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  ConciergeCallAnswerPayload,
  ConciergeCallAudioChunkPayload,
  ConciergeCallControlPayload,
  ConciergeCallEndPayload,
  ConciergeCallEventPayload,
  ConciergeCallEventsResponsePayload,
  ConciergeCallHandoffAcceptPayload,
  ConciergeCallHandoffPreparePayload,
  ConciergeCallHandoffPrepareResponsePayload,
  ConciergeCallMetricsPayload,
  ConciergeCallRegisterPushPayload,
  ConciergeCallSetMutedPayload,
  ConciergeCallStartPayload,
  ConciergeVoipPushRegistrationPayload,
} from "@spaceskit/server";

class ConciergeCallRuntimeError extends Error {
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

interface CallRuntimeRecord {
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

function normalizeOptional(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequired(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new ConciergeCallRuntimeError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

export class ConciergeCallRuntimeService {
  private readonly callService = new ConciergeCallService();
  private readonly records = new Map<string, CallRuntimeRecord>();
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      eventBus: EventBus;
      logger: Logger;
      spaceManager: SpaceManager;
      appleNotificationService?: Pick<AppleNotificationLifecycleService, "registerDevice"> | null;
      now?: () => Date;
    },
  ) {
    this.now = options.now ?? (() => new Date());
  }

  startCall(
    input: ConciergeCallStartPayload & { principalId?: string; deviceId?: string },
  ): ConciergeCallEventPayload {
    try {
      const spaceId = normalizeRequired(input.spaceId, "spaceId");
      const spaceUid = normalizeOptional(input.spaceUid) ?? spaceId;
      const event = this.callService.startCall({
        ...input,
        ttsMode: normalizeTtsMode(input.ttsMode),
      });
      const existing = this.records.get(event.callId);
      const record: CallRuntimeRecord = {
        callId: event.callId,
        principalId: normalizeOptional(input.principalId) ?? existing?.principalId,
        deviceId: normalizeOptional(input.deviceId) ?? existing?.deviceId ?? event.deviceId,
        platform: event.platform,
        displayName: event.displayName,
        ttsMode: event.ttsMode,
        targetGatewayId: event.targetGatewayId,
        state: event.state,
        muted: event.muted,
        spaceId,
        spaceUid,
        targetAgentId: normalizeOptional(input.targetAgentId) ?? existing?.targetAgentId,
        activeTurnId: undefined,
        metrics: existing?.metrics ?? {
          callSetupMs: event.metrics?.callSetupMs,
          sttFirstPartialMs: event.metrics?.sttFirstPartialMs,
          llmFirstTokenMs: event.metrics?.llmFirstTokenMs,
          ttsFirstAudioMs: event.metrics?.ttsFirstAudioMs,
          routeChangeCount: event.metrics?.routeChangeCount ?? 0,
          handoffCount: event.metrics?.handoffCount ?? 0,
          providerFallbackCount: event.metrics?.providerFallbackCount ?? 0,
          interruptCount: event.metrics?.interruptCount ?? 0,
          playbackUnderrunCount: event.metrics?.playbackUnderrunCount ?? 0,
          reconnectCount: event.metrics?.reconnectCount ?? 0,
        },
        startedAt: event.ts,
        updatedAt: event.ts,
      };
      this.records.set(event.callId, record);
      return this.decorateEvent(record, event);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  answerCall(
    input: ConciergeCallAnswerPayload & { principalId?: string; deviceId?: string },
  ): ConciergeCallEventPayload {
    const record = this.requireRecord(input.callId, input.principalId);
    try {
      const event = this.callService.answerCall(input);
      this.updateRecordFromLifecycle(record, event);
      return this.decorateEvent(record, event);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async endCall(
    input: ConciergeCallEndPayload & { principalId?: string },
  ): Promise<ConciergeCallEventPayload> {
    const record = this.requireRecord(input.callId, input.principalId);
    if (record.activeTurnId) {
      await this.cancelTurn(record, normalizeOptional(input.reason) ?? "call_ended");
    }
    try {
      const event = this.callService.endCall(input);
      this.updateRecordFromLifecycle(record, event);
      record.updatedAt = event.ts;
      return this.decorateEvent(record, event);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  setMuted(
    input: ConciergeCallSetMutedPayload & { principalId?: string },
  ): ConciergeCallEventPayload {
    const record = this.requireRecord(input.callId, input.principalId);
    try {
      const event = this.callService.setMuted(input);
      this.updateRecordFromLifecycle(record, event);
      return this.decorateEvent(record, event);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async appendAudioChunk(
    input: ConciergeCallAudioChunkPayload & { principalId?: string; deviceId?: string },
  ): Promise<ConciergeCallEventsResponsePayload> {
    const record = this.requireRecord(input.callId, input.principalId);
    const events: ConciergeCallEventPayload[] = [];
    const transcriptText = normalizeOptional(input.transcriptText);

    if (transcriptText) {
      if (!record.metrics.sttFirstPartialMs) {
        record.metrics.sttFirstPartialMs = Math.max(0, Date.parse(nowIso(this.now)) - Date.parse(record.startedAt));
      }
      events.push(
        this.baseEvent(record, {
          transcriptDelta: transcriptText,
          transcriptFinal: Boolean(input.isFinal),
          mediaEventType: input.isFinal ? "transcript_final" : "transcript_partial",
          sequence: input.sequence,
          reason: input.isFinal ? "user_transcript_final" : "user_transcript_partial",
        }),
      );
    }

    if (!input.isFinal) {
      return { events };
    }
    if (!transcriptText) {
      throw new ConciergeCallRuntimeError(
        "INVALID_ARGUMENT",
        "transcriptText is required for final concierge call audio chunks",
      );
    }

    if (record.activeTurnId) {
      await this.cancelTurn(record, "superseded_by_new_input");
      record.metrics.interruptCount = (record.metrics.interruptCount ?? 0) + 1;
      events.push(
        this.baseEvent(record, {
          mediaEventType: "interrupted",
          reason: "superseded_by_new_input",
        }),
      );
    }

    const startedAt = this.now();
    const turnEventCollector = this.createTurnEventCollector(record, startedAt);
    let ack: { turnId: string };
    try {
      ack = await this.options.spaceManager.executeTurn(
        record.spaceId,
        transcriptText,
        record.targetAgentId,
        {
          principalId: record.principalId,
          deviceId: record.deviceId,
        },
      );
    } catch (error) {
      turnEventCollector.dispose();
      throw error;
    }
    record.activeTurnId = ack.turnId;
    record.updatedAt = startedAt.toISOString();
    this.options.logger.info(
      `[concierge-call] turn=${ack.turnId} space=${record.spaceId} agent=${record.targetAgentId ?? "default"}`,
    );

    turnEventCollector.bindTurnId(ack.turnId);
    const assistantEvents = await turnEventCollector.promise;
    return { events: [...events, ...assistantEvents] };
  }

  async control(
    input: ConciergeCallControlPayload & { principalId?: string; deviceId?: string },
  ): Promise<ConciergeCallEventPayload> {
    const record = this.requireRecord(input.callId, input.principalId);
    if (input.command !== "interrupt") {
      throw new ConciergeCallRuntimeError("INVALID_ARGUMENT", `Unsupported concierge call control: ${input.command}`);
    }

    await this.cancelTurn(record, normalizeOptional(input.reason) ?? "user_interrupt");
    record.metrics.interruptCount = (record.metrics.interruptCount ?? 0) + 1;
    return this.baseEvent(record, {
      mediaEventType: "interrupted",
      reason: normalizeOptional(input.reason) ?? "user_interrupt",
      activeTurnId: undefined,
    });
  }

  prepareHandoff(
    input: ConciergeCallHandoffPreparePayload & { principalId?: string; deviceId?: string },
  ): ConciergeCallHandoffPrepareResponsePayload {
    const record = this.requireRecord(input.callId, input.principalId);
    try {
      const response = this.callService.prepareHandoff(input);
      this.updateRecordFromLifecycle(record, response.event);
      return {
        event: this.decorateEvent(record, response.event),
        handoffToken: response.handoffToken,
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  acceptHandoff(
    input: ConciergeCallHandoffAcceptPayload & { principalId?: string; deviceId?: string },
  ): ConciergeCallEventPayload {
    const record = this.requireRecord(input.callId, input.principalId);
    try {
      const event = this.callService.acceptHandoff(input);
      this.updateRecordFromLifecycle(record, event);
      return this.decorateEvent(record, event);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  registerPush(
    input: ConciergeCallRegisterPushPayload & { principalId?: string; deviceId?: string },
  ): ConciergeVoipPushRegistrationPayload {
    try {
      const registration = this.callService.registerPush(input);
      if (registration.principalId) {
        void this.options.appleNotificationService?.registerDevice({
          principalId: registration.principalId,
          deviceId: registration.deviceId,
          platform: registration.platform === "macos" ? "macos" : "ios",
          tokenKind: "voip",
          pushToken: registration.pushToken,
          topic: registration.voipTopic,
        });
      }
      return registration;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private createTurnEventCollector(
    record: CallRuntimeRecord,
    startedAt: Date,
  ): {
    promise: Promise<ConciergeCallEventPayload[]>;
    bindTurnId: (turnId: string) => void;
    dispose: () => void;
  } {
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

    const unsubscribe = this.options.eventBus.on("space.turn_event", (rawEvent) => {
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
          record.metrics.llmFirstTokenMs = Math.max(0, this.now().getTime() - startedAt.getTime());
        }
        collectedEvents.push(
          this.baseEvent(record, {
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
          this.baseEvent(record, {
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
          this.baseEvent(record, {
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

  private async cancelTurn(record: CallRuntimeRecord, reason: string): Promise<void> {
    const turnId = record.activeTurnId;
    if (!turnId) {
      return;
    }
    try {
      await this.options.spaceManager.cancelTurn(record.spaceId, turnId);
    } catch (error) {
      this.options.logger.warn("Failed to cancel active concierge call turn", {
        callId: record.callId,
        turnId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (record.activeTurnId === turnId) {
        record.activeTurnId = undefined;
      }
    }
  }

  private requireRecord(callIdRaw: string, principalId?: string): CallRuntimeRecord {
    const callId = normalizeRequired(callIdRaw, "callId");
    const record = this.records.get(callId);
    if (!record) {
      throw new ConciergeCallRuntimeError("NOT_FOUND", `Concierge call not found: ${callId}`);
    }
    if (record.principalId && principalId && record.principalId !== principalId) {
      throw new ConciergeCallRuntimeError("PERMISSION_DENIED", `Call belongs to a different principal: ${callId}`);
    }
    return record;
  }

  private updateRecordFromLifecycle(
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

  private decorateEvent(
    record: CallRuntimeRecord,
    event: ConciergeCallEventPayload,
  ): ConciergeCallEventPayload {
    this.updateRecordFromLifecycle(record, event);
    return {
      ...event,
      metrics: {
        ...record.metrics,
        ...event.metrics,
      },
      activeTurnId: event.activeTurnId ?? record.activeTurnId,
    };
  }

  private baseEvent(
    record: CallRuntimeRecord,
    overrides: Partial<ConciergeCallEventPayload>,
  ): ConciergeCallEventPayload {
    const ts = overrides.ts ?? nowIso(this.now);
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

  private normalizeError(error: unknown): ConciergeCallRuntimeError {
    if (error instanceof ConciergeCallRuntimeError) {
      return error;
    }
    if (error instanceof ConciergeCallServiceError) {
      return new ConciergeCallRuntimeError(error.code, error.message);
    }
    if (error instanceof Error) {
      return new ConciergeCallRuntimeError("INTERNAL", error.message);
    }
    return new ConciergeCallRuntimeError("INTERNAL", String(error));
  }
}
