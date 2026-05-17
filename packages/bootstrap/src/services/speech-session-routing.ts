import type {
  StartSpeechSessionInput,
  SpeechRouteSet,
  SpeechSessionEvent,
  SpeechSessionRecord,
} from "./speech-session-types.js";
import { SpeechSessionError } from "./speech-session-types.js";
import {
  channelPreferences,
  evaluateLockForChannel,
  firstFallbackReason,
  normalizeFallbackReason,
  postAttributionDeltaForChannel,
  toSpeechRouteState,
} from "./speech-session-normalizers.js";
import type {
  VoiceChannel,
  VoiceFallbackReason,
  VoiceRoutePreferences,
  VoiceRoutingService,
} from "./voice-routing-service.js";
import type { VoiceUsageLockService } from "./voice-usage-lock-service.js";

interface VoiceRouteRuntimeOptions {
  voiceRoutingService?: VoiceRoutingService;
  voiceUsageLockService?: VoiceUsageLockService;
}

interface SpeechRerouteOptions extends VoiceRouteRuntimeOptions {
  now: () => Date;
  createEvent: (
    session: SpeechSessionRecord,
    eventType: string,
    extras?: Partial<SpeechSessionEvent>,
  ) => SpeechSessionEvent;
}

export function buildRoutePreferences(
  input: StartSpeechSessionInput,
  defaults: VoiceRoutePreferences = {},
): VoiceRoutePreferences {
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

export function resolveInitialRoutes(
  preferences: VoiceRoutePreferences,
  options: VoiceRouteRuntimeOptions,
): {
  allowed: boolean;
  routes?: SpeechRouteSet;
  fallbackReason?: VoiceFallbackReason;
  message?: string;
} {
  if (options.voiceRoutingService) {
    const managedAllowed = {
      stt: isManagedAllowedForChannel("stt", preferences, options.voiceUsageLockService),
      tts: isManagedAllowedForChannel("tts", preferences, options.voiceUsageLockService),
    };
    const routes = options.voiceRoutingService.resolveStartRoutes(preferences, managedAllowed);
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

  if (sttPreferredSource === "managed" && !isManagedAllowedForChannel("stt", preferences, options.voiceUsageLockService)) {
    return {
      allowed: false,
      message: "Managed STT usage is locked and fallback routing is unavailable",
    };
  }
  if (ttsPreferredSource === "managed" && !isManagedAllowedForChannel("tts", preferences, options.voiceUsageLockService)) {
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

export function ensureVoiceRoutesForNextChunk(
  session: SpeechSessionRecord,
  options: SpeechRerouteOptions,
): SpeechSessionEvent[] {
  const events: SpeechSessionEvent[] = [];
  const sttReroute = rerouteChannelIfLocked(session, "stt", options);
  if (sttReroute) {
    events.push(sttReroute);
  }
  const ttsReroute = rerouteChannelIfLocked(session, "tts", options);
  if (ttsReroute) {
    events.push(ttsReroute);
  }
  return events;
}

function isManagedAllowedForChannel(
  channel: VoiceChannel,
  preferences: VoiceRoutePreferences,
  lockService: VoiceUsageLockService | undefined,
): boolean {
  const preferredSource = channelPreferences(preferences, channel).preferredSource ?? "managed";
  if (!lockService) return true;
  return evaluateLockForChannel(lockService, channel, preferredSource).allowed;
}

function rerouteChannelIfLocked(
  session: SpeechSessionRecord,
  channel: VoiceChannel,
  options: SpeechRerouteOptions,
): SpeechSessionEvent | null {
  const lockService = options.voiceUsageLockService;
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

  const fallback = options.voiceRoutingService?.resolveFallbackForChannel(
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
  session.updatedAt = options.now().toISOString();

  return options.createEvent(session, "session_rerouted", {
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
