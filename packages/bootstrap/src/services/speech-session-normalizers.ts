import type {
  SpeechAudioChunkInput,
  SpeechEngineLatencyMetrics,
  SpeechRouteSet,
  SpeechRouteState,
  SpeechSessionState,
  SpeechSessionUsageMetrics,
  SpeechUsageByChannel,
} from "./speech-session-types.js";
import type {
  VoiceChannel,
  VoiceChannelRoutePreferences,
  VoiceFallbackReason,
  VoiceProviderSource,
  VoiceRoutePreferences,
} from "./voice-routing-service.js";
import type {
  VoiceUsageDelta,
  VoiceUsageLockDecision,
  VoiceUsageLockService,
} from "./voice-usage-lock-service.js";

export function emptyUsageMetrics(): SpeechSessionUsageMetrics {
  return {
    sttSeconds: 0,
    ttsChars: 0,
    ttsSeconds: 0,
  };
}

export function emptyUsageByChannel(): SpeechUsageByChannel {
  return {
    stt: emptyUsageMetrics(),
    tts: emptyUsageMetrics(),
  };
}

export function cloneUsageMetrics(metrics: SpeechSessionUsageMetrics): SpeechSessionUsageMetrics {
  return {
    sttSeconds: metrics.sttSeconds,
    ttsChars: metrics.ttsChars,
    ttsSeconds: metrics.ttsSeconds,
  };
}

export function cloneUsageByChannel(usage: SpeechUsageByChannel): SpeechUsageByChannel {
  return {
    stt: cloneUsageMetrics(usage.stt),
    tts: cloneUsageMetrics(usage.tts),
  };
}

export function cloneRoutes(routes: SpeechRouteSet): SpeechRouteSet {
  return {
    stt: { ...routes.stt },
    tts: { ...routes.tts },
  };
}

export function toSpeechRouteState(
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

export function channelPreferences(
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

export function postAttributionDeltaForChannel(channel: VoiceChannel): VoiceUsageDelta {
  if (channel === "stt") {
    return { sttSeconds: 0 };
  }
  return { ttsChars: 0, ttsSeconds: 0 };
}

export function evaluateLockForChannel(
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

export function buildChunkUsageDelta(input: SpeechAudioChunkInput): SpeechSessionUsageMetrics {
  return {
    sttSeconds: normalizeAudioDuration(input.audioDurationSeconds, input.audioBase64),
    ttsChars: sanitizeInt(input.ttsChars),
    ttsSeconds: sanitizeFloat(input.ttsSeconds),
  };
}

export function normalizeEngineMetrics(input: SpeechAudioChunkInput): SpeechEngineLatencyMetrics | undefined {
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

export function roundUsage(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function normalizeHealthStatus(
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

export function parseCostProfile(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized || normalized === "{}") {
    return undefined;
  }
  return normalized;
}

export function normalizeFallbackReason(
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

export function firstFallbackReason(
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

export function mapSpeechEventType(
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
