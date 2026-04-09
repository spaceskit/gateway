export type VoiceProviderSource =
  | "managed"
  | "byok"
  | "local_model"
  | "apple_speech";

export type VoiceChannel = "stt" | "tts";

export type VoiceFallbackReason =
  | "default"
  | "manual_override"
  | "quota_fallback"
  | "local_forced";

export interface VoiceRoutePreferences {
  preferredSource?: VoiceProviderSource;
  preferredProviderId?: string;
  byokProviderId?: string;
  localModelProviderId?: string;
  appleSpeechProviderId?: string;
  allowByokFallback?: boolean;
  allowLocalFallback?: boolean;
  allowAppleSpeechFallback?: boolean;
  stt?: Partial<VoiceChannelRoutePreferences>;
  tts?: Partial<VoiceChannelRoutePreferences>;
}

export interface VoiceChannelRoutePreferences {
  preferredSource?: VoiceProviderSource;
  preferredProviderId?: string;
  byokProviderId?: string;
  localModelProviderId?: string;
  appleSpeechProviderId?: string;
  allowByokFallback?: boolean;
  allowLocalFallback?: boolean;
  allowAppleSpeechFallback?: boolean;
}

export interface VoiceRoutingDecision {
  allowed: boolean;
  source?: VoiceProviderSource;
  providerId?: string;
  reason: VoiceFallbackReason | "no_route";
  message?: string;
}

export interface VoiceChannelRoutingDecision extends VoiceRoutingDecision {
  channel: VoiceChannel;
}

export interface VoiceChannelRoutes {
  stt: VoiceChannelRoutingDecision;
  tts: VoiceChannelRoutingDecision;
}

/**
 * Voice routing policy for the speech session MVP runtime.
 * Keeps decisions deterministic and simple:
 * - Honor explicit non-managed source overrides.
 * - Use managed source by default.
 * - When managed is blocked, fall back in fixed order.
 */
export class VoiceRoutingService {
  resolveStartRoutes(
    preferences: VoiceRoutePreferences,
    managedAllowed: Partial<Record<VoiceChannel, boolean>> = {},
  ): VoiceChannelRoutes {
    return {
      stt: this.resolveStartRouteForChannel(
        "stt",
        this.preferencesForChannel("stt", preferences),
        managedAllowed.stt ?? true,
      ),
      tts: this.resolveStartRouteForChannel(
        "tts",
        this.preferencesForChannel("tts", preferences),
        managedAllowed.tts ?? true,
      ),
    };
  }

  resolveStartRoute(
    preferences: VoiceRoutePreferences,
    managedAllowed: boolean,
  ): VoiceRoutingDecision {
    return this.resolveStartRouteForChannel(
      "stt",
      this.preferencesForChannel("stt", preferences),
      managedAllowed,
    );
  }

  resolveStartRouteForChannel(
    channel: VoiceChannel,
    preferences: VoiceChannelRoutePreferences,
    managedAllowed: boolean,
  ): VoiceChannelRoutingDecision {
    const preferredSource = preferences.preferredSource ?? "managed";

    if (preferredSource !== "managed") {
      return {
        channel,
        allowed: true,
        source: preferredSource,
        providerId: this.providerIdForSource(preferredSource, preferences),
        reason: preferredSource === "local_model" || preferredSource === "apple_speech"
          ? "local_forced"
          : "manual_override",
      };
    }

    if (managedAllowed) {
      return {
        channel,
        allowed: true,
        source: "managed",
        providerId: preferences.preferredProviderId?.trim() || "managed/default",
        reason: "default",
      };
    }

    return this.resolveFallbackForChannel(channel, preferences, "quota_fallback");
  }

  resolveFallback(
    preferences: VoiceRoutePreferences,
    reason: VoiceFallbackReason = "quota_fallback",
  ): VoiceRoutingDecision {
    return this.resolveFallbackForChannel(
      "stt",
      this.preferencesForChannel("stt", preferences),
      reason,
    );
  }

  resolveFallbackForChannel(
    channel: VoiceChannel,
    preferences: VoiceChannelRoutePreferences,
    reason: VoiceFallbackReason = "quota_fallback",
  ): VoiceChannelRoutingDecision {
    if (preferences.allowByokFallback && preferences.byokProviderId?.trim()) {
      return {
        channel,
        allowed: true,
        source: "byok",
        providerId: preferences.byokProviderId.trim(),
        reason,
      };
    }

    if (preferences.allowLocalFallback) {
      return {
        channel,
        allowed: true,
        source: "local_model",
        providerId: preferences.localModelProviderId?.trim() || "local/default",
        reason,
      };
    }

    if (preferences.allowAppleSpeechFallback) {
      return {
        channel,
        allowed: true,
        source: "apple_speech",
        providerId: preferences.appleSpeechProviderId?.trim() || "apple/speech",
        reason,
      };
    }

    return {
      channel,
      allowed: false,
      reason: "no_route",
      message: "No fallback voice route is available",
    };
  }

  private preferencesForChannel(
    channel: VoiceChannel,
    preferences: VoiceRoutePreferences,
  ): VoiceChannelRoutePreferences {
    const channelPreferences = channel === "stt" ? preferences.stt : preferences.tts;
    return {
      preferredSource: channelPreferences?.preferredSource ?? preferences.preferredSource,
      preferredProviderId: channelPreferences?.preferredProviderId ?? preferences.preferredProviderId,
      byokProviderId: channelPreferences?.byokProviderId ?? preferences.byokProviderId,
      localModelProviderId: channelPreferences?.localModelProviderId ?? preferences.localModelProviderId,
      appleSpeechProviderId: channelPreferences?.appleSpeechProviderId ?? preferences.appleSpeechProviderId,
      allowByokFallback: channelPreferences?.allowByokFallback ?? preferences.allowByokFallback,
      allowLocalFallback: channelPreferences?.allowLocalFallback ?? preferences.allowLocalFallback,
      allowAppleSpeechFallback: channelPreferences?.allowAppleSpeechFallback ?? preferences.allowAppleSpeechFallback,
    };
  }

  private providerIdForSource(
    source: VoiceProviderSource,
    preferences: VoiceChannelRoutePreferences,
  ): string {
    switch (source) {
      case "managed":
        return preferences.preferredProviderId?.trim() || "managed/default";
      case "byok":
        return preferences.byokProviderId?.trim() || "byok/default";
      case "local_model":
        return preferences.localModelProviderId?.trim() || "local/default";
      case "apple_speech":
        return preferences.appleSpeechProviderId?.trim() || "apple/speech";
      default:
        return "managed/default";
    }
  }
}
