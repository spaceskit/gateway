import { randomUUID } from "node:crypto";

// ── Payload types (canonical source of truth) ────────────────────────

export type ConciergeCallTtsModePayload = "apple_native" | "elevenlabs_streaming";

export interface ConciergeCallStartPayload {
  callId: string;
  platform: string;
  displayName?: string;
  ttsMode?: ConciergeCallTtsModePayload;
  targetGatewayId?: string;
  spaceId?: string;
  spaceUid?: string;
  targetAgentId?: string;
}

export interface ConciergeCallAnswerPayload {
  callId: string;
  platform?: string;
}

export interface ConciergeCallEndPayload {
  callId: string;
  reason?: string;
}

export interface ConciergeCallSetMutedPayload {
  callId: string;
  muted: boolean;
}

export interface ConciergeCallHandoffPreparePayload {
  callId: string;
  destinationPlatform: string;
  sourceDeviceId?: string;
  destinationDeviceId?: string;
  destinationClientId?: string;
  resumeUrl?: string;
}

export interface ConciergeCallHandoffTokenPayload {
  token: string;
  callId: string;
  sourceDeviceId: string;
  destinationPlatform: string;
  destinationDeviceId?: string;
  destinationClientId?: string;
  resumeUrl?: string;
  expiresAt: string;
  signature: string;
}

export interface ConciergeCallHandoffPrepareResponsePayload {
  event: ConciergeCallEventPayload;
  handoffToken: ConciergeCallHandoffTokenPayload;
}

export interface ConciergeCallHandoffAcceptPayload {
  callId: string;
  handoffToken: string;
  platform?: string;
}

export interface ConciergeCallRegisterPushPayload {
  principalId?: string;
  deviceId: string;
  platform: string;
  pushToken: string;
  voipTopic?: string;
  proactiveOptIn?: boolean;
}

export interface ConciergeVoipPushRegistrationPayload {
  principalId?: string;
  deviceId: string;
  platform: string;
  pushToken: string;
  voipTopic?: string;
  proactiveOptIn: boolean;
  registeredAt: string;
}

export interface ConciergeCallMetricsPayload {
  callSetupMs?: number;
  sttFirstPartialMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstAudioMs?: number;
  routeChangeCount?: number;
  handoffCount?: number;
  providerFallbackCount?: number;
  interruptCount?: number;
  playbackUnderrunCount?: number;
  reconnectCount?: number;
}

export interface ConciergeCallEventPayload {
  callId: string;
  state: "connecting" | "active" | "ended";
  platform: string;
  deviceId?: string;
  displayName: string;
  ttsMode: ConciergeCallTtsModePayload;
  muted: boolean;
  targetGatewayId?: string;
  transcriptDelta?: string;
  assistantTextDelta?: string;
  urgency?: "default" | "urgent";
  handoffToken?: ConciergeCallHandoffTokenPayload;
  metrics?: ConciergeCallMetricsPayload;
  reason?: string;
  emittedAt?: string;
  mediaEventType?:
    | "transcript_partial"
    | "transcript_final"
    | "assistant_text_partial"
    | "assistant_text_final"
    | "assistant_audio_chunk"
    | "interrupted"
    | "route_changed"
    | "playback_started"
    | "playback_ended";
  sequence?: number;
  transcriptFinal?: boolean;
  assistantTextFinal?: boolean;
  activeTurnId?: string;
  providerSource?: string;
  providerId?: string;
  fallbackReason?: string;
  assistantAudioBase64?: string;
  assistantAudioDurationSeconds?: number;
  ts: string;
}

// ── Service options ──────────────────────────────────────────────────

export interface ConciergeCallServiceOptions {
  now?: () => Date;
  handoffTtlMs?: number;
}

// ── Internal records ─────────────────────────────────────────────────

interface ConciergeCallRecord {
  callId: string;
  principalId?: string;
  deviceId?: string;
  platform: string;
  displayName: string;
  ttsMode: ConciergeCallTtsModePayload;
  targetGatewayId?: string;
  spaceId?: string;
  spaceUid?: string;
  targetAgentId?: string;
  muted: boolean;
  state: ConciergeCallEventPayload["state"];
  startedAt: string;
  updatedAt: string;
  metrics: NonNullable<ConciergeCallEventPayload["metrics"]>;
}

interface ConciergeHandoffRecord {
  token: ConciergeCallHandoffTokenPayload;
  createdAt: string;
}

// ── Error class ──────────────────────────────────────────────────────

export class ConciergeCallServiceError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "PERMISSION_DENIED";

  constructor(code: ConciergeCallServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

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
    throw new ConciergeCallServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

export function normalizeTtsMode(
  value: ConciergeCallTtsModePayload | string | undefined,
): ConciergeCallTtsModePayload {
  return value === "elevenlabs_streaming" ? "elevenlabs_streaming" : "apple_native";
}

// ── Service ──────────────────────────────────────────────────────────

export class ConciergeCallService {
  private readonly calls = new Map<string, ConciergeCallRecord>();
  private readonly pushRegistrations = new Map<string, ConciergeVoipPushRegistrationPayload>();
  private readonly handoffTokens = new Map<string, ConciergeHandoffRecord>();
  private readonly now: () => Date;
  private readonly handoffTtlMs: number;

  constructor(options: ConciergeCallServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.handoffTtlMs = options.handoffTtlMs ?? 5 * 60 * 1000;
  }

  startCall(
    input: ConciergeCallStartPayload & { principalId?: string; deviceId?: string },
  ): ConciergeCallEventPayload {
    const callId = normalizeRequired(input.callId, "callId");
    const platform = normalizeRequired(input.platform, "platform");
    const now = this.now().toISOString();
    const existing = this.calls.get(callId);

    if (existing && existing.principalId && input.principalId && existing.principalId !== input.principalId) {
      throw new ConciergeCallServiceError("PERMISSION_DENIED", `Call belongs to a different principal: ${callId}`);
    }

    const record: ConciergeCallRecord = existing ?? {
      callId,
      principalId: normalizeOptional(input.principalId),
      deviceId: normalizeOptional(input.deviceId),
      platform,
      displayName: normalizeOptional(input.displayName) ?? "Spaces Concierge",
      ttsMode: normalizeTtsMode(input.ttsMode),
      targetGatewayId: normalizeOptional(input.targetGatewayId),
      spaceId: normalizeOptional(input.spaceId),
      spaceUid: normalizeOptional(input.spaceUid),
      targetAgentId: normalizeOptional(input.targetAgentId),
      muted: false,
      state: "connecting",
      startedAt: now,
      updatedAt: now,
      metrics: {
        callSetupMs: 0,
        sttFirstPartialMs: 0,
        llmFirstTokenMs: 0,
        ttsFirstAudioMs: 0,
        routeChangeCount: 0,
        handoffCount: 0,
        providerFallbackCount: 0,
        interruptCount: 0,
        playbackUnderrunCount: 0,
        reconnectCount: 0,
      },
    };

    record.principalId = normalizeOptional(input.principalId) ?? record.principalId;
    record.deviceId = normalizeOptional(input.deviceId) ?? record.deviceId;
    record.platform = platform;
    record.displayName = normalizeOptional(input.displayName) ?? record.displayName;
    record.ttsMode = normalizeTtsMode(input.ttsMode ?? record.ttsMode);
    record.targetGatewayId = normalizeOptional(input.targetGatewayId) ?? record.targetGatewayId;
    record.spaceId = normalizeOptional(input.spaceId) ?? record.spaceId;
    record.spaceUid = normalizeOptional(input.spaceUid) ?? record.spaceUid;
    record.targetAgentId = normalizeOptional(input.targetAgentId) ?? record.targetAgentId;
    record.state = "connecting";
    record.updatedAt = now;

    if (!existing) {
      record.startedAt = now;
    }

    this.calls.set(callId, record);

    return this.event(record, {
      reason: "call_started",
      ts: now,
    });
  }

  answerCall(
    input: ConciergeCallAnswerPayload & { principalId?: string; deviceId?: string },
  ): ConciergeCallEventPayload {
    const record = this.requireCall(input.callId, input.principalId);
    const now = this.now().toISOString();
    record.deviceId = normalizeOptional(input.deviceId) ?? record.deviceId;
    record.platform = normalizeOptional(input.platform) ?? record.platform;
    record.state = "active";
    record.updatedAt = now;
    record.metrics.callSetupMs = Math.max(0, Date.parse(now) - Date.parse(record.startedAt));

    return this.event(record, {
      reason: "call_answered",
      ts: now,
    });
  }

  endCall(
    input: ConciergeCallEndPayload & { principalId?: string },
  ): ConciergeCallEventPayload {
    const record = this.requireCall(input.callId, input.principalId);
    const now = this.now().toISOString();
    record.state = "ended";
    record.updatedAt = now;
    this.clearCallHandoffs(record.callId);

    return this.event(record, {
      reason: normalizeOptional(input.reason) ?? "call_ended",
      ts: now,
    });
  }

  setMuted(
    input: ConciergeCallSetMutedPayload & { principalId?: string },
  ): ConciergeCallEventPayload {
    const record = this.requireCall(input.callId, input.principalId);
    const now = this.now().toISOString();
    record.muted = Boolean(input.muted);
    record.updatedAt = now;

    return this.event(record, {
      reason: input.muted ? "muted" : "unmuted",
      ts: now,
    });
  }

  prepareHandoff(
    input: ConciergeCallHandoffPreparePayload & { principalId?: string; deviceId?: string },
  ): ConciergeCallHandoffPrepareResponsePayload {
    const record = this.requireCall(input.callId, input.principalId);
    const destinationPlatform = normalizeRequired(input.destinationPlatform, "destinationPlatform");
    const sourceDeviceId = normalizeOptional(input.sourceDeviceId ?? input.deviceId) ?? record.deviceId ?? "unknown-device";
    const now = this.now();
    const emittedAt = now.toISOString();
    const token: ConciergeCallHandoffTokenPayload = {
      token: `handoff-${randomUUID()}`,
      callId: record.callId,
      sourceDeviceId,
      destinationPlatform,
      destinationDeviceId: normalizeOptional(input.destinationDeviceId),
      destinationClientId: normalizeOptional(input.destinationClientId),
      resumeUrl: normalizeOptional(input.resumeUrl),
      expiresAt: new Date(now.getTime() + this.handoffTtlMs).toISOString(),
      signature: `concierge-call-${randomUUID()}`,
    };
    this.handoffTokens.set(token.token, { token, createdAt: emittedAt });
    record.updatedAt = emittedAt;

    return {
      event: this.event(record, {
        handoffToken: token,
        reason: "handoff_prepared",
        ts: emittedAt,
      }),
      handoffToken: token,
    };
  }

  acceptHandoff(
    input: ConciergeCallHandoffAcceptPayload & { principalId?: string; deviceId?: string },
  ): ConciergeCallEventPayload {
    const record = this.requireCall(input.callId, input.principalId);
    const tokenValue = normalizeRequired(input.handoffToken, "handoffToken");
    const handoff = this.handoffTokens.get(tokenValue);
    if (!handoff || handoff.token.callId !== record.callId) {
      throw new ConciergeCallServiceError("NOT_FOUND", `Handoff token not found for call: ${record.callId}`);
    }
    if (Date.parse(handoff.token.expiresAt) <= this.now().getTime()) {
      this.handoffTokens.delete(tokenValue);
      throw new ConciergeCallServiceError("FAILED_PRECONDITION", "Handoff token expired");
    }

    const now = this.now().toISOString();
    record.platform = normalizeOptional(input.platform) ?? handoff.token.destinationPlatform ?? record.platform;
    record.deviceId = normalizeOptional(input.deviceId) ?? handoff.token.destinationDeviceId ?? record.deviceId;
    record.state = "active";
    record.updatedAt = now;
    record.metrics.handoffCount = (record.metrics.handoffCount ?? 0) + 1;
    this.handoffTokens.delete(tokenValue);

    return this.event(record, {
      handoffToken: handoff.token,
      reason: "handoff_accepted",
      ts: now,
    });
  }

  registerPush(
    input: ConciergeCallRegisterPushPayload & { principalId?: string; deviceId?: string },
  ): ConciergeVoipPushRegistrationPayload {
    const deviceId = normalizeRequired(input.deviceId, "deviceId");
    const platform = normalizeRequired(input.platform, "platform");
    const pushToken = normalizeRequired(input.pushToken, "pushToken");
    const now = this.now().toISOString();
    const registration: ConciergeVoipPushRegistrationPayload = {
      principalId: normalizeOptional(input.principalId),
      deviceId,
      platform,
      pushToken,
      voipTopic: normalizeOptional(input.voipTopic),
      proactiveOptIn: Boolean(input.proactiveOptIn),
      registeredAt: now,
    };

    this.pushRegistrations.set(this.pushRegistrationKey(registration), registration);
    return registration;
  }

  private requireCall(callIdRaw: string, principalId?: string): ConciergeCallRecord {
    const callId = normalizeRequired(callIdRaw, "callId");
    const record = this.calls.get(callId);
    if (!record) {
      throw new ConciergeCallServiceError("NOT_FOUND", `Concierge call not found: ${callId}`);
    }
    if (record.principalId && principalId && record.principalId !== principalId) {
      throw new ConciergeCallServiceError("PERMISSION_DENIED", `Call belongs to a different principal: ${callId}`);
    }
    return record;
  }

  private clearCallHandoffs(callId: string): void {
    for (const [token, handoff] of this.handoffTokens.entries()) {
      if (handoff.token.callId === callId) {
        this.handoffTokens.delete(token);
      }
    }
  }

  private event(
    record: ConciergeCallRecord,
    overrides: Partial<ConciergeCallEventPayload>,
  ): ConciergeCallEventPayload {
    const ts = overrides.ts ?? this.now().toISOString();
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
      metrics: overrides.metrics ?? record.metrics,
      reason: overrides.reason,
      emittedAt: overrides.emittedAt ?? ts,
      mediaEventType: overrides.mediaEventType,
      sequence: overrides.sequence,
      transcriptFinal: overrides.transcriptFinal,
      assistantTextFinal: overrides.assistantTextFinal,
      activeTurnId: overrides.activeTurnId,
      providerSource: overrides.providerSource,
      providerId: overrides.providerId,
      fallbackReason: overrides.fallbackReason,
      assistantAudioBase64: overrides.assistantAudioBase64,
      assistantAudioDurationSeconds: overrides.assistantAudioDurationSeconds,
      ts,
    };
  }

  private pushRegistrationKey(registration: ConciergeVoipPushRegistrationPayload): string {
    return [
      registration.principalId ?? "anonymous",
      registration.deviceId,
      registration.platform,
    ].join(":");
  }
}
