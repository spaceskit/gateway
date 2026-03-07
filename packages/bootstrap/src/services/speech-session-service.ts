import { randomUUID } from "node:crypto";
import type { SpaceManager } from "@spaceskit/core";
import type { VoiceUsageRepository } from "@spaceskit/persistence";
import { normalizeOrDeterministicUuid } from "../utils/uuid.js";
import type {
  VoiceFallbackReason,
  VoiceProviderSource,
  VoiceRoutePreferences,
} from "./voice-routing-service.js";
import { VoiceRoutingService } from "./voice-routing-service.js";
import type { VoiceUsageLockService } from "./voice-usage-lock-service.js";

export type SpeechSessionState =
  | "idle"
  | "running"
  | "stopped"
  | "interrupted"
  | "ended";

export type SpeechControlCommand =
  | "start"
  | "stop"
  | "interrupt"
  | "end";

export interface SpeechSessionEvent {
  sessionId: string;
  spaceId: string;
  spaceUid: string;
  type?: string;
  message?: string;
  state: SpeechSessionState;
  eventType: string;
  providerSource?: VoiceProviderSource;
  providerId?: string;
  fallbackReason?: VoiceFallbackReason;
  usage?: SpeechSessionUsageMetrics;
  lockReason?: string;
  transcript?: string;
  turnId?: string;
  sequence?: number;
  sequenceNo?: number;
  reason?: string;
  emittedAt?: string;
  ts: string;
}

export interface StartSpeechSessionInput {
  spaceId: string;
  spaceUid?: string;
  sessionId?: string;
  locale?: string;
  sourceDevice?: string;
  enableTranscription?: boolean;
  enablePlayback?: boolean;
  agentId?: string;
  principalId?: string;
  deviceId?: string;
  autoSubmitTurns?: boolean;
  preferredSource?: VoiceProviderSource;
  preferredProviderId?: string;
  byokProviderId?: string;
  localModelProviderId?: string;
  appleSpeechProviderId?: string;
  allowByokFallback?: boolean;
  allowLocalFallback?: boolean;
  allowAppleSpeechFallback?: boolean;
}

export interface SpeechAudioChunkInput {
  sessionId: string;
  sequence: number;
  sequenceNo?: number;
  audioBase64: string;
  sampleRateHz?: number;
  channels?: number;
  codec?: string;
  audioDurationSeconds?: number;
  ttsChars?: number;
  ttsSeconds?: number;
  transcriptText?: string;
  isFinal?: boolean;
}

export interface SpeechControlInput {
  sessionId: string;
  command: Exclude<SpeechControlCommand, "start">;
  reason?: string;
}

export interface SpeechSessionServiceOptions {
  spaceManager: SpaceManager;
  voiceUsageRepo?: VoiceUsageRepository;
  voiceUsageLockService?: VoiceUsageLockService;
  voiceRoutingService?: VoiceRoutingService;
  defaultVoiceRoute?: VoiceRoutePreferences;
  now?: () => Date;
}

export interface SpeechSessionUsageMetrics {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
}

export class SpeechSessionError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION";

  constructor(
    code: SpeechSessionError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

interface SpeechSessionRecord {
  sessionId: string;
  spaceId: string;
  spaceUid: string;
  agentId?: string;
  principalId?: string;
  deviceId?: string;
  state: SpeechSessionState;
  sequence: number;
  transcript: string[];
  autoSubmitTurns: boolean;
  routePreferences: VoiceRoutePreferences;
  providerSource: VoiceProviderSource;
  providerId: string;
  usage: SpeechSessionUsageMetrics;
  createdAt: string;
  updatedAt: string;
}

export class SpeechSessionService {
  private readonly sessions = new Map<string, SpeechSessionRecord>();
  private readonly now: () => Date;

  constructor(private readonly options: SpeechSessionServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  startSession(input: StartSpeechSessionInput): SpeechSessionEvent {
    const spaceId = input.spaceId.trim();
    if (!spaceId) {
      throw new SpeechSessionError("INVALID_ARGUMENT", "spaceId is required");
    }
    const spaceUid = normalizeOrDeterministicUuid(input.spaceUid, spaceId, "spaceskit.space.uuid");

    const sessionId = input.sessionId?.trim() || `speech-${randomUUID()}`;
    const now = this.now().toISOString();
    const existing = this.sessions.get(sessionId);

    const routePreferences = this.buildRoutePreferences(input);
    const route = this.resolveInitialRoute(routePreferences);

    if (!route.allowed || !route.source || !route.providerId) {
      throw new SpeechSessionError(
        "FAILED_PRECONDITION",
        route.message || "Voice route unavailable for requested session",
      );
    }

    if (existing && existing.state !== "ended") {
      existing.state = "running";
      existing.spaceUid = spaceUid;
      existing.updatedAt = now;
      existing.principalId = input.principalId?.trim() || undefined;
      existing.deviceId = input.deviceId?.trim() || undefined;
      existing.providerSource = route.source;
      existing.providerId = route.providerId;
      existing.routePreferences = routePreferences;
      return this.event(existing, "session_started");
    }

    const session: SpeechSessionRecord = {
      sessionId,
      spaceId,
      spaceUid,
      agentId: input.agentId?.trim() || undefined,
      principalId: input.principalId?.trim() || undefined,
      deviceId: input.deviceId?.trim() || undefined,
      state: "running",
      sequence: 0,
      transcript: [],
      autoSubmitTurns: input.autoSubmitTurns !== false,
      routePreferences,
      providerSource: route.source,
      providerId: route.providerId,
      usage: {
        sttSeconds: 0,
        ttsChars: 0,
        ttsSeconds: 0,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, session);
    return this.event(session, "session_started", {
      fallbackReason: route.reason === "no_route" ? undefined : route.reason,
    });
  }

  async appendAudioChunk(input: SpeechAudioChunkInput): Promise<SpeechSessionEvent[]> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new SpeechSessionError("NOT_FOUND", `Speech session not found: ${input.sessionId}`);
    }
    if (
      session.state !== "running"
      && session.state !== "stopped"
      && session.state !== "interrupted"
    ) {
      throw new SpeechSessionError(
        "FAILED_PRECONDITION",
        `Cannot accept audio in state: ${session.state}`,
      );
    }

    const sequence = Number.isFinite(input.sequence)
      ? input.sequence
      : Number.isFinite(input.sequenceNo)
        ? input.sequenceNo as number
        : NaN;
    if (!Number.isFinite(sequence)) {
      throw new SpeechSessionError("INVALID_ARGUMENT", "sequence is required");
    }

    if (!input.audioBase64?.trim()) {
      throw new SpeechSessionError("INVALID_ARGUMENT", "audioBase64 is required");
    }

    // "stop" pauses ingestion until resumed by next audio chunk.
    if (session.state === "stopped" || session.state === "interrupted") {
      session.state = "running";
    }

    session.sequence = Math.max(session.sequence, sequence);
    session.updatedAt = this.now().toISOString();

    const audioDurationSeconds = normalizeAudioDuration(input.audioDurationSeconds, input.audioBase64);
    const ttsChars = sanitizeInt(input.ttsChars);
    const ttsSeconds = sanitizeFloat(input.ttsSeconds);
    const rerouteEvents = this.ensureVoiceRouteForChunk(session, {
      sttSeconds: audioDurationSeconds,
      ttsChars,
      ttsSeconds,
    });

    session.usage.sttSeconds += audioDurationSeconds;
    session.usage.ttsChars += ttsChars;
    session.usage.ttsSeconds += ttsSeconds;

    this.options.voiceUsageRepo?.createEvent({
      sessionId: session.sessionId,
      spaceId: session.spaceId,
      source: session.providerSource,
      providerId: session.providerId,
      sttSeconds: audioDurationSeconds,
      ttsChars,
      ttsSeconds,
      metadataJson: JSON.stringify({
        sequence,
        isFinal: input.isFinal === true,
      }),
      createdAt: session.updatedAt,
    });

    const segment = (input.transcriptText?.trim() || `segment-${sequence}`);
    session.transcript.push(segment);

    const events: SpeechSessionEvent[] = [
      ...rerouteEvents,
      this.event(session, "transcript_segment", {
        transcript: segment,
        sequence,
      }),
    ];

    if (input.isFinal) {
      const transcript = session.transcript.join(" ").trim();
      let turnId: string | undefined;
      if (session.autoSubmitTurns && transcript.length > 0) {
        const executionIdentity = session.principalId || session.deviceId
          ? {
            principalId: session.principalId,
            deviceId: session.deviceId,
          }
          : undefined;
        const result = await this.options.spaceManager.executeTurn(
          session.spaceId,
          transcript,
          session.agentId,
          executionIdentity,
        );
        turnId = result.turnId;
      }

      events.push(this.event(session, "transcript_final", {
        transcript,
        turnId,
        sequence,
      }));
    }

    return events;
  }

  control(input: SpeechControlInput): SpeechSessionEvent {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new SpeechSessionError("NOT_FOUND", `Speech session not found: ${input.sessionId}`);
    }

    if (session.state === "ended" && input.command !== "end") {
      throw new SpeechSessionError("FAILED_PRECONDITION", "Speech session already ended");
    }

    switch (input.command) {
      case "stop":
        session.state = "stopped";
        break;
      case "interrupt":
        session.state = "interrupted";
        break;
      case "end":
        session.state = "ended";
        break;
      default:
        throw new SpeechSessionError("INVALID_ARGUMENT", `Unsupported command: ${input.command}`);
    }
    session.updatedAt = this.now().toISOString();

    return this.event(session, "session_control", {
      reason: input.reason,
    });
  }

  getSession(sessionId: string): SpeechSessionEvent | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.event(session, "session_state");
  }

  private event(
    session: SpeechSessionRecord,
    eventType: string,
    extras: Partial<SpeechSessionEvent> = {},
  ): SpeechSessionEvent {
    const emittedAt = this.now().toISOString();
    const event: SpeechSessionEvent = {
      sessionId: session.sessionId,
      spaceId: session.spaceId,
      spaceUid: session.spaceUid,
      type: mapSpeechEventType(eventType, session.state),
      state: session.state,
      eventType,
      providerSource: session.providerSource,
      providerId: session.providerId,
      usage: {
        sttSeconds: session.usage.sttSeconds,
        ttsChars: session.usage.ttsChars,
        ttsSeconds: session.usage.ttsSeconds,
      },
      ts: emittedAt,
      emittedAt,
      ...extras,
    };
    if (event.sequence !== undefined && event.sequenceNo === undefined) {
      event.sequenceNo = event.sequence;
    }
    if (!event.message && event.reason) {
      event.message = event.reason;
    }
    return event;
  }

  private buildRoutePreferences(input: StartSpeechSessionInput): VoiceRoutePreferences {
    return {
      preferredSource: input.preferredSource ?? this.options.defaultVoiceRoute?.preferredSource ?? "managed",
      preferredProviderId: input.preferredProviderId ?? this.options.defaultVoiceRoute?.preferredProviderId,
      byokProviderId: input.byokProviderId ?? this.options.defaultVoiceRoute?.byokProviderId,
      localModelProviderId: input.localModelProviderId ?? this.options.defaultVoiceRoute?.localModelProviderId,
      appleSpeechProviderId: input.appleSpeechProviderId ?? this.options.defaultVoiceRoute?.appleSpeechProviderId,
      allowByokFallback: input.allowByokFallback ?? this.options.defaultVoiceRoute?.allowByokFallback ?? false,
      allowLocalFallback: input.allowLocalFallback ?? this.options.defaultVoiceRoute?.allowLocalFallback ?? true,
      allowAppleSpeechFallback: input.allowAppleSpeechFallback ?? this.options.defaultVoiceRoute?.allowAppleSpeechFallback ?? true,
    };
  }

  private resolveInitialRoute(preferences: VoiceRoutePreferences): {
    allowed: boolean;
    source?: VoiceProviderSource;
    providerId?: string;
    reason: VoiceFallbackReason | "no_route";
    message?: string;
  } {
    const preferredSource = preferences.preferredSource ?? "managed";
    const managedAllowed = this.options.voiceUsageLockService?.evaluate(preferredSource).allowed ?? true;

    if (this.options.voiceRoutingService) {
      return this.options.voiceRoutingService.resolveStartRoute(preferences, managedAllowed);
    }

    if (preferredSource === "managed" && !managedAllowed) {
      return {
        allowed: false,
        reason: "no_route",
        message: "Managed voice usage is locked and fallback routing is unavailable",
      };
    }

    return {
      allowed: true,
      source: preferredSource,
      providerId: preferences.preferredProviderId?.trim() || `${preferredSource}/default`,
      reason: "default",
    };
  }

  private ensureVoiceRouteForChunk(
    session: SpeechSessionRecord,
    delta: { sttSeconds: number; ttsChars: number; ttsSeconds: number },
  ): SpeechSessionEvent[] {
    const lockService = this.options.voiceUsageLockService;
    if (!lockService) return [];

    const decision = lockService.evaluate(session.providerSource, delta);
    if (decision.allowed) return [];

    const fallback = this.options.voiceRoutingService?.resolveFallback(
      session.routePreferences,
      "quota_fallback",
    );

    if (!fallback?.allowed || !fallback.source || !fallback.providerId) {
      throw new SpeechSessionError(
        "FAILED_PRECONDITION",
        `Managed voice usage locked (${decision.reason}) and no fallback route is available`,
      );
    }

    session.providerSource = fallback.source;
    session.providerId = fallback.providerId;
    session.updatedAt = this.now().toISOString();

    return [
      this.event(session, "session_rerouted", {
        reason: decision.reason,
        lockReason: decision.reason,
        fallbackReason: fallback.reason === "no_route" ? undefined : fallback.reason,
      }),
    ];
  }
}

function sanitizeFloat(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

function sanitizeInt(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(Number(value)));
}

function normalizeAudioDuration(
  explicitSeconds: number | undefined,
  audioBase64: string,
): number {
  if (Number.isFinite(explicitSeconds)) {
    return Math.max(0, Number(explicitSeconds));
  }

  // Fallback estimate: assume PCM16 mono @16kHz if caller doesn't provide duration.
  const estimatedBytes = Math.max(0, Math.floor((audioBase64.length * 3) / 4));
  if (estimatedBytes <= 0) return 0;
  const bytesPerSecond = 16_000 * 2;
  return estimatedBytes / bytesPerSecond;
}

function mapSpeechEventType(
  eventType: string,
  state: SpeechSessionState,
):
  | "started"
  | "listening"
  | "processing"
  | "interrupted"
  | "completed"
  | "error"
  | "clarification_requested" {
  switch (eventType) {
    case "session_started":
      return "started";
    case "transcript_segment":
      return "listening";
    case "session_rerouted":
      return "processing";
    case "transcript_final":
      return "completed";
    case "session_control":
      if (state === "interrupted") return "interrupted";
      if (state === "ended") return "completed";
      return "processing";
    default:
      return "processing";
  }
}
