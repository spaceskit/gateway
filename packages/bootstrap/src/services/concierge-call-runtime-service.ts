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
  ConciergeCallRegisterPushPayload,
  ConciergeCallSetMutedPayload,
  ConciergeCallStartPayload,
  ConciergeVoipPushRegistrationPayload,
} from "@spaceskit/server";
import {
  buildConciergeBaseEvent,
  type CallRuntimeRecord,
  ConciergeCallRuntimeError,
  createConciergeTurnEventCollector,
  decorateConciergeCallEvent,
  normalizeOptional,
  normalizeRequired,
  nowIso,
  updateCallRuntimeRecordFromLifecycle,
} from "./concierge-call-runtime-helpers.js";

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
    const turnEventCollector = createConciergeTurnEventCollector({
      record,
      startedAt,
      eventBus: this.options.eventBus,
      now: this.now,
      baseEvent: (runtimeRecord, overrides) => this.baseEvent(runtimeRecord, overrides),
    });
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
    updateCallRuntimeRecordFromLifecycle(record, event);
  }

  private decorateEvent(
    record: CallRuntimeRecord,
    event: ConciergeCallEventPayload,
  ): ConciergeCallEventPayload {
    return decorateConciergeCallEvent(record, event);
  }

  private baseEvent(
    record: CallRuntimeRecord,
    overrides: Partial<ConciergeCallEventPayload>,
  ): ConciergeCallEventPayload {
    return buildConciergeBaseEvent(record, overrides, this.now);
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
