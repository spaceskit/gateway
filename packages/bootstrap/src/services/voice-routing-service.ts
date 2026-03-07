export type VoiceProviderSource =
  | "managed"
  | "byok"
  | "local_model"
  | "apple_speech";

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
}

export interface VoiceRoutingDecision {
  allowed: boolean;
  source?: VoiceProviderSource;
  providerId?: string;
  reason: VoiceFallbackReason | "no_route";
  message?: string;
}

/**
 * Voice routing policy for the speech session MVP runtime.
 * Keeps decisions deterministic and simple:
 * - Honor explicit non-managed source overrides.
 * - Use managed source by default.
 * - When managed is blocked, fall back in fixed order.
 */
export class VoiceRoutingService {
  resolveStartRoute(
    preferences: VoiceRoutePreferences,
    managedAllowed: boolean,
  ): VoiceRoutingDecision {
    const preferredSource = preferences.preferredSource ?? "managed";

    if (preferredSource !== "managed") {
      return {
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
        allowed: true,
        source: "managed",
        providerId: preferences.preferredProviderId?.trim() || "managed/default",
        reason: "default",
      };
    }

    return this.resolveFallback(preferences, "quota_fallback");
  }

  resolveFallback(
    preferences: VoiceRoutePreferences,
    reason: VoiceFallbackReason = "quota_fallback",
  ): VoiceRoutingDecision {
    if (preferences.allowByokFallback && preferences.byokProviderId?.trim()) {
      return {
        allowed: true,
        source: "byok",
        providerId: preferences.byokProviderId.trim(),
        reason,
      };
    }

    if (preferences.allowLocalFallback) {
      return {
        allowed: true,
        source: "local_model",
        providerId: preferences.localModelProviderId?.trim() || "local/default",
        reason,
      };
    }

    if (preferences.allowAppleSpeechFallback) {
      return {
        allowed: true,
        source: "apple_speech",
        providerId: preferences.appleSpeechProviderId?.trim() || "apple/speech",
        reason,
      };
    }

    return {
      allowed: false,
      reason: "no_route",
      message: "No fallback voice route is available",
    };
  }

  private providerIdForSource(
    source: VoiceProviderSource,
    preferences: VoiceRoutePreferences,
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
