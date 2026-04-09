import { randomUUID } from "node:crypto";
import type { SpaceManager } from "@spaceskit/core";
import type {
  VoiceProviderConfigRepository,
  VoiceUsageRepository,
} from "@spaceskit/persistence";
import { normalizeOrDeterministicUuid } from "../utils/uuid.js";
import type {
  VoiceChannel,
  VoiceChannelRoutePreferences,
  VoiceFallbackReason,
  VoiceProviderSource,
  VoiceRoutePreferences,
} from "./voice-routing-service.js";
import { VoiceRoutingService } from "./voice-routing-service.js";
import type {
  VoiceUsageDelta,
  VoiceUsageLockDecision,
  VoiceUsageLockService,
} from "./voice-usage-lock-service.js";

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

export interface SpeechSessionUsageMetrics {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
}

export interface SpeechEngineLatencyMetrics {
  vadDetectionMs?: number;
  sttTranscriptionMs?: number;
  ttsFirstAudioMs?: number;
  ttsFullSynthesisMs?: number;
}

export interface SpeechRouteState {
  channel: VoiceChannel;
  source: VoiceProviderSource;
  providerId: string;
}

export interface SpeechProviderConfigPayload {
  providerId: string;
  channel: VoiceChannel;
  source: VoiceProviderSource;
  priority: number;
  healthStatus: "unknown" | "healthy" | "degraded" | "unavailable";
  costProfile?: string;
}

export interface SpeechRouteSet {
  stt: SpeechRouteState;
  tts: SpeechRouteState;
}

export interface SpeechUsageByChannel {
  stt: SpeechSessionUsageMetrics;
  tts: SpeechSessionUsageMetrics;
}

export interface SpeechFallbackEvent {
  channel: VoiceChannel;
  fromRoute?: SpeechRouteState;
  toRoute?: SpeechRouteState;
  reason: VoiceFallbackReason;
  detail?: string;
}

export interface SpeechLockDecisionPayload {
  channel: VoiceChannel;
  source: VoiceProviderSource;
  allowed: boolean;
  reason: VoiceUsageLockDecision["reason"];
  retryAt?: string;
  fallbackHint?: string;
}

export interface SpeechSessionEvent {
  sessionId: string;
  spaceId: string;
  spaceUid: string;
  type?: string;
  message?: string;
  state: SpeechSessionState;
  eventType: string;
  intent?: {
    intentType: "space_content" | "orchestration_command" | "clarification_required";
    confidence: number;
    rationale?: string;
    clarificationPrompt?: string;
    capabilityId?: string;
  };
  providerSource?: VoiceProviderSource;
  providerId?: string;
  channel?: VoiceChannel;
  fallbackReason?: VoiceFallbackReason;
  usage?: SpeechSessionUsageMetrics;
  usageByChannel?: SpeechUsageByChannel;
  lockReason?: string;
  lockDecision?: SpeechLockDecisionPayload;
  transcript?: string;
  turnId?: string;
  sequence?: number;
  sequenceNo?: number;
  reason?: string;
  emittedAt?: string;
  ts: string;
  sttRoute?: SpeechRouteState;
  ttsRoute?: SpeechRouteState;
  fallbackEvent?: SpeechFallbackEvent;
  providerConfigs?: SpeechProviderConfigPayload[];
  engineMetrics?: SpeechEngineLatencyMetrics;
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
  sttPreferences?: VoiceChannelRoutePreferences;
  ttsPreferences?: VoiceChannelRoutePreferences;
  sttPreferredSource?: VoiceProviderSource;
  sttPreferredProviderId?: string;
  sttByokProviderId?: string;
  sttLocalModelProviderId?: string;
  sttAppleSpeechProviderId?: string;
  sttAllowByokFallback?: boolean;
  sttAllowLocalFallback?: boolean;
  sttAllowAppleSpeechFallback?: boolean;
  ttsPreferredSource?: VoiceProviderSource;
  ttsPreferredProviderId?: string;
  ttsByokProviderId?: string;
  ttsLocalModelProviderId?: string;
  ttsAppleSpeechProviderId?: string;
  ttsAllowByokFallback?: boolean;
  ttsAllowLocalFallback?: boolean;
  ttsAllowAppleSpeechFallback?: boolean;
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
  engineMetrics?: SpeechEngineLatencyMetrics;
  vadDetectionMs?: number;
  sttTranscriptionMs?: number;
  ttsFirstAudioMs?: number;
  ttsFullSynthesisMs?: number;
}

export interface SpeechControlInput {
  sessionId: string;
  command: Exclude<SpeechControlCommand, "start">;
  reason?: string;
}

export interface SpeechSessionServiceOptions {
  spaceManager: SpaceManager;
  voiceUsageRepo?: VoiceUsageRepository;
  voiceProviderConfigRepo?: VoiceProviderConfigRepository;
  voiceUsageLockService?: VoiceUsageLockService;
  voiceRoutingService?: VoiceRoutingService;
  defaultVoiceRoute?: VoiceRoutePreferences;
  now?: () => Date;
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
  transcriptSegments: string[];
  autoSubmitTurns: boolean;
  routePreferences: VoiceRoutePreferences;
  routes: SpeechRouteSet;
  usage: SpeechSessionUsageMetrics;
  usageByChannel: SpeechUsageByChannel;
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
    const initialRoutes = this.resolveInitialRoutes(routePreferences);

    if (!initialRoutes.allowed || !initialRoutes.routes) {
      throw new SpeechSessionError(
        "FAILED_PRECONDITION",
        initialRoutes.message || "Voice route unavailable for requested session",
      );
    }

    if (existing && existing.state !== "ended") {
      existing.state = "running";
      existing.spaceUid = spaceUid;
      existing.updatedAt = now;
      existing.principalId = input.principalId?.trim() || undefined;
      existing.deviceId = input.deviceId?.trim() || undefined;
      existing.routes = cloneRoutes(initialRoutes.routes);
      existing.routePreferences = routePreferences;
      return this.event(existing, "session_started", {
        fallbackReason: initialRoutes.fallbackReason,
      });
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
      transcriptSegments: [],
      autoSubmitTurns: input.autoSubmitTurns !== false,
      routePreferences,
      routes: cloneRoutes(initialRoutes.routes),
      usage: emptyUsageMetrics(),
      usageByChannel: emptyUsageByChannel(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, session);
    return this.event(session, "session_started", {
      fallbackReason: initialRoutes.fallbackReason,
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

    if (session.state === "stopped" || session.state === "interrupted") {
      session.state = "running";
    }

    session.sequence = Math.max(session.sequence, sequence);
    session.updatedAt = this.now().toISOString();

    const delta: SpeechSessionUsageMetrics = {
      sttSeconds: normalizeAudioDuration(input.audioDurationSeconds, input.audioBase64),
      ttsChars: sanitizeInt(input.ttsChars),
      ttsSeconds: sanitizeFloat(input.ttsSeconds),
    };
    const engineMetrics = normalizeEngineMetrics(input);

    const attributedRoutes = cloneRoutes(session.routes);
    this.recordUsageForChunk(session, attributedRoutes, delta, sequence, input.isFinal === true, engineMetrics);
    this.applyUsageDelta(session, delta);

    const rerouteEvents = this.ensureVoiceRoutesForNextChunk(session);

    const segment = input.transcriptText?.trim() || `segment-${sequence}`;
    session.transcriptSegments.push(segment);

    const events: SpeechSessionEvent[] = [
      ...rerouteEvents,
      this.event(session, "transcript_segment", {
        transcript: segment,
        sequence,
        engineMetrics,
      }),
    ];

    if (input.isFinal) {
      const transcript = session.transcriptSegments.join(" ").trim();
      let turnId: string | undefined;
      let turnError: string | undefined;
      if (session.autoSubmitTurns && transcript.length > 0) {
        const executionIdentity = session.principalId || session.deviceId
          ? {
            principalId: session.principalId,
            deviceId: session.deviceId,
          }
          : undefined;
        try {
          const timeoutMs = 30_000;
          const timeoutPromise = new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error("executeTurn timed out after 30s")), timeoutMs);
          });
          const result = await Promise.race([
            this.options.spaceManager.executeTurn(
              session.spaceId,
              transcript,
              session.agentId,
              executionIdentity,
            ),
            timeoutPromise,
          ]);
          turnId = result.turnId;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          turnError = message;
          console.error(
            `[SpeechSession] executeTurn failed for session=${session.sessionId} space=${session.spaceId}: ${message}`,
          );
        }
      }

      events.push(this.event(session, "transcript_final", {
        transcript,
        turnId,
        sequence,
        ...(turnError ? { reason: turnError } : {}),
        engineMetrics,
      }));
      session.transcriptSegments = [];
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
      providerSource: session.routes.stt.source,
      providerId: session.routes.stt.providerId,
      usage: cloneUsageMetrics(session.usage),
      usageByChannel: cloneUsageByChannel(session.usageByChannel),
      ts: emittedAt,
      emittedAt,
      sttRoute: { ...session.routes.stt },
      ttsRoute: { ...session.routes.tts },
      providerConfigs: this.providerConfigs(),
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
    const defaults = this.options.defaultVoiceRoute ?? {};
    return {
      preferredSource: input.preferredSource ?? defaults.preferredSource ?? "managed",
      preferredProviderId: input.preferredProviderId ?? defaults.preferredProviderId,
      byokProviderId: input.byokProviderId ?? defaults.byokProviderId,
      localModelProviderId: input.localModelProviderId ?? defaults.localModelProviderId,
      appleSpeechProviderId: input.appleSpeechProviderId ?? defaults.appleSpeechProviderId,
      allowByokFallback: input.allowByokFallback ?? defaults.allowByokFallback ?? false,
      allowLocalFallback: input.allowLocalFallback ?? defaults.allowLocalFallback ?? true,
      allowAppleSpeechFallback: input.allowAppleSpeechFallback ?? defaults.allowAppleSpeechFallback ?? true,
      stt: {
        preferredSource: input.sttPreferences?.preferredSource
          ?? input.sttPreferredSource
          ?? defaults.stt?.preferredSource,
        preferredProviderId: input.sttPreferences?.preferredProviderId
          ?? input.sttPreferredProviderId
          ?? defaults.stt?.preferredProviderId,
        byokProviderId: input.sttPreferences?.byokProviderId
          ?? input.sttByokProviderId
          ?? defaults.stt?.byokProviderId,
        localModelProviderId: input.sttPreferences?.localModelProviderId
          ?? input.sttLocalModelProviderId
          ?? defaults.stt?.localModelProviderId,
        appleSpeechProviderId: input.sttPreferences?.appleSpeechProviderId
          ?? input.sttAppleSpeechProviderId
          ?? defaults.stt?.appleSpeechProviderId,
        allowByokFallback: input.sttPreferences?.allowByokFallback
          ?? input.sttAllowByokFallback
          ?? defaults.stt?.allowByokFallback,
        allowLocalFallback: input.sttPreferences?.allowLocalFallback
          ?? input.sttAllowLocalFallback
          ?? defaults.stt?.allowLocalFallback,
        allowAppleSpeechFallback: input.sttPreferences?.allowAppleSpeechFallback
          ?? input.sttAllowAppleSpeechFallback
          ?? defaults.stt?.allowAppleSpeechFallback,
      },
      tts: {
        preferredSource: input.ttsPreferences?.preferredSource
          ?? input.ttsPreferredSource
          ?? defaults.tts?.preferredSource,
        preferredProviderId: input.ttsPreferences?.preferredProviderId
          ?? input.ttsPreferredProviderId
          ?? defaults.tts?.preferredProviderId,
        byokProviderId: input.ttsPreferences?.byokProviderId
          ?? input.ttsByokProviderId
          ?? defaults.tts?.byokProviderId,
        localModelProviderId: input.ttsPreferences?.localModelProviderId
          ?? input.ttsLocalModelProviderId
          ?? defaults.tts?.localModelProviderId,
        appleSpeechProviderId: input.ttsPreferences?.appleSpeechProviderId
          ?? input.ttsAppleSpeechProviderId
          ?? defaults.tts?.appleSpeechProviderId,
        allowByokFallback: input.ttsPreferences?.allowByokFallback
          ?? input.ttsAllowByokFallback
          ?? defaults.tts?.allowByokFallback,
        allowLocalFallback: input.ttsPreferences?.allowLocalFallback
          ?? input.ttsAllowLocalFallback
          ?? defaults.tts?.allowLocalFallback,
        allowAppleSpeechFallback: input.ttsPreferences?.allowAppleSpeechFallback
          ?? input.ttsAllowAppleSpeechFallback
          ?? defaults.tts?.allowAppleSpeechFallback,
      },
    };
  }

  private resolveInitialRoutes(preferences: VoiceRoutePreferences): {
    allowed: boolean;
    routes?: SpeechRouteSet;
    fallbackReason?: VoiceFallbackReason;
    message?: string;
  } {
    if (this.options.voiceRoutingService) {
      const managedAllowed = {
        stt: this.isManagedAllowedForChannel("stt", preferences),
        tts: this.isManagedAllowedForChannel("tts", preferences),
      };
      const routes = this.options.voiceRoutingService.resolveStartRoutes(preferences, managedAllowed);
      const blockedChannel = (Object.values(routes) as Array<typeof routes.stt>).find((route) => !route.allowed);
      if (blockedChannel || !routes.stt.source || !routes.stt.providerId || !routes.tts.source || !routes.tts.providerId) {
        return {
          allowed: false,
          message: blockedChannel?.message || "Voice route unavailable for requested session",
        };
      }
      return {
        allowed: true,
        routes: {
          stt: toSpeechRouteState("stt", routes.stt.source, routes.stt.providerId),
          tts: toSpeechRouteState("tts", routes.tts.source, routes.tts.providerId),
        },
        fallbackReason: firstFallbackReason(routes.stt.reason, routes.tts.reason),
      };
    }

    const sttPreferences = channelPreferences(preferences, "stt");
    const ttsPreferences = channelPreferences(preferences, "tts");
    const sttPreferredSource = sttPreferences.preferredSource ?? "managed";
    const ttsPreferredSource = ttsPreferences.preferredSource ?? "managed";

    if (sttPreferredSource === "managed" && !this.isManagedAllowedForChannel("stt", preferences)) {
      return {
        allowed: false,
        message: "Managed STT usage is locked and fallback routing is unavailable",
      };
    }
    if (ttsPreferredSource === "managed" && !this.isManagedAllowedForChannel("tts", preferences)) {
      return {
        allowed: false,
        message: "Managed TTS usage is locked and fallback routing is unavailable",
      };
    }

    return {
      allowed: true,
      routes: {
        stt: toSpeechRouteState(
          "stt",
          sttPreferredSource,
          sttPreferences.preferredProviderId?.trim() || `${sttPreferredSource}/default`,
        ),
        tts: toSpeechRouteState(
          "tts",
          ttsPreferredSource,
          ttsPreferences.preferredProviderId?.trim() || `${ttsPreferredSource}/default`,
        ),
      },
    };
  }

  private isManagedAllowedForChannel(
    channel: VoiceChannel,
    preferences: VoiceRoutePreferences,
  ): boolean {
    const preferredSource = channelPreferences(preferences, channel).preferredSource ?? "managed";
    const lockService = this.options.voiceUsageLockService;
    if (!lockService) return true;
    return evaluateLockForChannel(lockService, channel, preferredSource).allowed;
  }

  private recordUsageForChunk(
    session: SpeechSessionRecord,
    routes: SpeechRouteSet,
    delta: SpeechSessionUsageMetrics,
    sequence: number,
    isFinal: boolean,
    engineMetrics?: SpeechEngineLatencyMetrics,
  ): void {
    if (!this.options.voiceUsageRepo) return;

    const metadataJson = JSON.stringify({
      sequence,
      isFinal,
      engineMetrics,
    });
    if (delta.sttSeconds > 0) {
      this.options.voiceUsageRepo.createEvent({
        sessionId: session.sessionId,
        spaceId: session.spaceId,
        source: routes.stt.source,
        channel: "stt",
        providerId: routes.stt.providerId,
        sttSeconds: delta.sttSeconds,
        metadataJson,
        createdAt: session.updatedAt,
      });
    }
    if (delta.ttsChars > 0 || delta.ttsSeconds > 0) {
      this.options.voiceUsageRepo.createEvent({
        sessionId: session.sessionId,
        spaceId: session.spaceId,
        source: routes.tts.source,
        channel: "tts",
        providerId: routes.tts.providerId,
        ttsChars: delta.ttsChars,
        ttsSeconds: delta.ttsSeconds,
        metadataJson,
        createdAt: session.updatedAt,
      });
    }
  }

  private applyUsageDelta(
    session: SpeechSessionRecord,
    delta: SpeechSessionUsageMetrics,
  ): void {
    session.usage.sttSeconds = roundUsage(session.usage.sttSeconds + delta.sttSeconds);
    session.usage.ttsChars += delta.ttsChars;
    session.usage.ttsSeconds = roundUsage(session.usage.ttsSeconds + delta.ttsSeconds);

    session.usageByChannel.stt.sttSeconds = roundUsage(
      session.usageByChannel.stt.sttSeconds + delta.sttSeconds,
    );
    session.usageByChannel.tts.ttsChars += delta.ttsChars;
    session.usageByChannel.tts.ttsSeconds = roundUsage(
      session.usageByChannel.tts.ttsSeconds + delta.ttsSeconds,
    );
  }

  private ensureVoiceRoutesForNextChunk(session: SpeechSessionRecord): SpeechSessionEvent[] {
    const events: SpeechSessionEvent[] = [];
    const sttReroute = this.rerouteChannelIfLocked(session, "stt");
    if (sttReroute) {
      events.push(sttReroute);
    }
    const ttsReroute = this.rerouteChannelIfLocked(session, "tts");
    if (ttsReroute) {
      events.push(ttsReroute);
    }
    return events;
  }

  private rerouteChannelIfLocked(
    session: SpeechSessionRecord,
    channel: VoiceChannel,
  ): SpeechSessionEvent | null {
    const lockService = this.options.voiceUsageLockService;
    if (!lockService) return null;

    const currentRoute = session.routes[channel];
    if (currentRoute.source !== "managed") {
      return null;
    }
    const decision = evaluateLockForChannel(
      lockService,
      channel,
      currentRoute.source,
      postAttributionDeltaForChannel(channel),
    );
    if (decision.allowed) return null;

    const fallback = this.options.voiceRoutingService?.resolveFallbackForChannel(
      channel,
      channelPreferences(session.routePreferences, channel),
      "quota_fallback",
    );
    if (!fallback?.allowed || !fallback.source || !fallback.providerId) {
      throw new SpeechSessionError(
        "FAILED_PRECONDITION",
        `Managed voice usage locked (${decision.reason}) and no fallback route is available`,
      );
    }

    const previousRoute = { ...currentRoute };
    const nextRoute = toSpeechRouteState(channel, fallback.source, fallback.providerId);
    session.routes[channel] = nextRoute;
    session.updatedAt = this.now().toISOString();

    return this.event(session, "session_rerouted", {
      channel,
      providerSource: fallback.source,
      providerId: fallback.providerId,
      reason: decision.reason,
      lockReason: decision.reason,
      fallbackReason: fallback.reason === "no_route" ? undefined : fallback.reason,
      fallbackEvent: {
        channel,
        fromRoute: previousRoute,
        toRoute: nextRoute,
        reason: normalizeFallbackReason(fallback.reason) ?? "quota_fallback",
        detail: decision.reason,
      },
      lockDecision: {
        channel,
        source: previousRoute.source,
        allowed: decision.allowed,
        reason: decision.reason,
        fallbackHint: `${nextRoute.source}:${nextRoute.providerId}`,
      },
    });
  }

  private providerConfigs(): SpeechProviderConfigPayload[] {
    const rows = this.options.voiceProviderConfigRepo?.list() ?? [];
    return rows.map((row) => ({
      providerId: row.provider_id,
      channel: row.channel === "tts" ? "tts" : "stt",
      source: row.source === "unknown" ? "managed" : row.source,
      priority: row.priority,
      healthStatus: normalizeHealthStatus(row.health_status),
      costProfile: parseCostProfile(row.cost_profile_json),
    }));
  }
}

function emptyUsageMetrics(): SpeechSessionUsageMetrics {
  return {
    sttSeconds: 0,
    ttsChars: 0,
    ttsSeconds: 0,
  };
}

function emptyUsageByChannel(): SpeechUsageByChannel {
  return {
    stt: emptyUsageMetrics(),
    tts: emptyUsageMetrics(),
  };
}

function cloneUsageMetrics(metrics: SpeechSessionUsageMetrics): SpeechSessionUsageMetrics {
  return {
    sttSeconds: metrics.sttSeconds,
    ttsChars: metrics.ttsChars,
    ttsSeconds: metrics.ttsSeconds,
  };
}

function cloneUsageByChannel(usage: SpeechUsageByChannel): SpeechUsageByChannel {
  return {
    stt: cloneUsageMetrics(usage.stt),
    tts: cloneUsageMetrics(usage.tts),
  };
}

function cloneRoutes(routes: SpeechRouteSet): SpeechRouteSet {
  return {
    stt: { ...routes.stt },
    tts: { ...routes.tts },
  };
}

function toSpeechRouteState(
  channel: VoiceChannel,
  source: VoiceProviderSource,
  providerId: string,
): SpeechRouteState {
  return {
    channel,
    source,
    providerId,
  };
}

function channelPreferences(
  preferences: VoiceRoutePreferences,
  channel: VoiceChannel,
): VoiceChannelRoutePreferences {
  const overrides = channel === "stt" ? preferences.stt : preferences.tts;
  return {
    preferredSource: overrides?.preferredSource ?? preferences.preferredSource,
    preferredProviderId: overrides?.preferredProviderId ?? preferences.preferredProviderId,
    byokProviderId: overrides?.byokProviderId ?? preferences.byokProviderId,
    localModelProviderId: overrides?.localModelProviderId ?? preferences.localModelProviderId,
    appleSpeechProviderId: overrides?.appleSpeechProviderId ?? preferences.appleSpeechProviderId,
    allowByokFallback: overrides?.allowByokFallback ?? preferences.allowByokFallback,
    allowLocalFallback: overrides?.allowLocalFallback ?? preferences.allowLocalFallback,
    allowAppleSpeechFallback: overrides?.allowAppleSpeechFallback ?? preferences.allowAppleSpeechFallback,
  };
}

function postAttributionDeltaForChannel(channel: VoiceChannel): VoiceUsageDelta {
  if (channel === "stt") {
    return { sttSeconds: 0 };
  }
  return { ttsChars: 0, ttsSeconds: 0 };
}

function evaluateLockForChannel(
  lockService: VoiceUsageLockService,
  channel: VoiceChannel,
  source: VoiceProviderSource,
  delta: VoiceUsageDelta = {},
): VoiceUsageLockDecision {
  if (typeof lockService.evaluateChannel === "function") {
    return lockService.evaluateChannel(channel, source, delta);
  }
  return lockService.evaluate(source, delta);
}

function normalizeEngineMetrics(input: SpeechAudioChunkInput): SpeechEngineLatencyMetrics | undefined {
  const metrics: SpeechEngineLatencyMetrics = { ...(input.engineMetrics ?? {}) };
  if (Number.isFinite(input.vadDetectionMs)) metrics.vadDetectionMs = Number(input.vadDetectionMs);
  if (Number.isFinite(input.sttTranscriptionMs)) metrics.sttTranscriptionMs = Number(input.sttTranscriptionMs);
  if (Number.isFinite(input.ttsFirstAudioMs)) metrics.ttsFirstAudioMs = Number(input.ttsFirstAudioMs);
  if (Number.isFinite(input.ttsFullSynthesisMs)) metrics.ttsFullSynthesisMs = Number(input.ttsFullSynthesisMs);
  return Object.keys(metrics).length > 0 ? metrics : undefined;
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

function roundUsage(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function normalizeHealthStatus(
  status: string,
): "unknown" | "healthy" | "degraded" | "unavailable" {
  switch (status) {
    case "healthy":
    case "degraded":
    case "unavailable":
      return status;
    default:
      return "unknown";
  }
}

function parseCostProfile(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized || normalized === "{}") {
    return undefined;
  }
  return normalized;
}

function normalizeFallbackReason(
  reason: VoiceFallbackReason | "no_route" | undefined,
): VoiceFallbackReason | undefined {
  switch (reason) {
    case "default":
    case "manual_override":
    case "quota_fallback":
    case "local_forced":
      return reason;
    default:
      return undefined;
  }
}

function firstFallbackReason(
  ...reasons: Array<VoiceFallbackReason | "no_route">
): VoiceFallbackReason | undefined {
  for (const reason of reasons) {
    const normalized = normalizeFallbackReason(reason);
    if (normalized && normalized !== "default") {
      return normalized;
    }
  }
  return undefined;
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
