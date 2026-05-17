import { parseBooleanEnv, parseVoiceSourceEnv } from "./config.js";

export function buildDefaultVoiceRouteFromEnv(): {
  preferredSource: "managed" | "byok" | "local_model" | "apple_speech";
  preferredProviderId?: string;
  byokProviderId?: string;
  localModelProviderId?: string;
  appleSpeechProviderId?: string;
  allowByokFallback: boolean;
  allowLocalFallback: boolean;
  allowAppleSpeechFallback: boolean;
  stt: {
    preferredSource: "managed" | "byok" | "local_model" | "apple_speech";
    preferredProviderId?: string;
    byokProviderId?: string;
    localModelProviderId?: string;
    appleSpeechProviderId?: string;
    allowByokFallback: boolean;
    allowLocalFallback: boolean;
    allowAppleSpeechFallback: boolean;
  };
  tts: {
    preferredSource: "managed" | "byok" | "local_model" | "apple_speech";
    preferredProviderId?: string;
    byokProviderId?: string;
    localModelProviderId?: string;
    appleSpeechProviderId?: string;
    allowByokFallback: boolean;
    allowLocalFallback: boolean;
    allowAppleSpeechFallback: boolean;
  };
} {
  return {
    preferredSource: parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_DEFAULT_SOURCE) ?? "managed",
    preferredProviderId: Bun.env.SPACESKIT_VOICE_MANAGED_PROVIDER_ID?.trim() || undefined,
    byokProviderId: Bun.env.SPACESKIT_VOICE_BYOK_PROVIDER_ID?.trim() || undefined,
    localModelProviderId: Bun.env.SPACESKIT_VOICE_LOCAL_PROVIDER_ID?.trim() || undefined,
    appleSpeechProviderId: Bun.env.SPACESKIT_VOICE_APPLE_PROVIDER_ID?.trim() || undefined,
    allowByokFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_BYOK_FALLBACK, false),
    allowLocalFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_LOCAL_FALLBACK, true),
    allowAppleSpeechFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_APPLE_FALLBACK, true),
    stt: {
      preferredSource: parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_STT_DEFAULT_SOURCE)
        ?? parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_DEFAULT_SOURCE)
        ?? "managed",
      preferredProviderId: Bun.env.SPACESKIT_VOICE_STT_MANAGED_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_MANAGED_PROVIDER_ID?.trim()
        || undefined,
      byokProviderId: Bun.env.SPACESKIT_VOICE_STT_BYOK_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_BYOK_PROVIDER_ID?.trim()
        || undefined,
      localModelProviderId: Bun.env.SPACESKIT_VOICE_STT_LOCAL_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_LOCAL_PROVIDER_ID?.trim()
        || undefined,
      appleSpeechProviderId: Bun.env.SPACESKIT_VOICE_STT_APPLE_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_APPLE_PROVIDER_ID?.trim()
        || undefined,
      allowByokFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_STT_ALLOW_BYOK_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_BYOK_FALLBACK, false),
      ),
      allowLocalFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_STT_ALLOW_LOCAL_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_LOCAL_FALLBACK, true),
      ),
      allowAppleSpeechFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_STT_ALLOW_APPLE_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_APPLE_FALLBACK, true),
      ),
    },
    tts: {
      preferredSource: parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_TTS_DEFAULT_SOURCE)
        ?? parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_DEFAULT_SOURCE)
        ?? "managed",
      preferredProviderId: Bun.env.SPACESKIT_VOICE_TTS_MANAGED_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_MANAGED_PROVIDER_ID?.trim()
        || undefined,
      byokProviderId: Bun.env.SPACESKIT_VOICE_TTS_BYOK_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_BYOK_PROVIDER_ID?.trim()
        || undefined,
      localModelProviderId: Bun.env.SPACESKIT_VOICE_TTS_LOCAL_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_LOCAL_PROVIDER_ID?.trim()
        || undefined,
      appleSpeechProviderId: Bun.env.SPACESKIT_VOICE_TTS_APPLE_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_APPLE_PROVIDER_ID?.trim()
        || undefined,
      allowByokFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_TTS_ALLOW_BYOK_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_BYOK_FALLBACK, false),
      ),
      allowLocalFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_TTS_ALLOW_LOCAL_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_LOCAL_FALLBACK, true),
      ),
      allowAppleSpeechFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_TTS_ALLOW_APPLE_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_APPLE_FALLBACK, true),
      ),
    },
  };
}

export function seedDefaultVoiceProviderConfigs(
  repo: {
    upsert: (input: {
      providerId: string;
      channel: "stt" | "tts";
      source: "managed" | "byok" | "local_model" | "apple_speech";
      priority?: number;
      healthStatus?: string;
      costProfileJson?: string;
      secretRef?: string;
      metadataJson?: string;
    }) => unknown;
  } | null | undefined,
  defaults: {
    stt?: {
      preferredProviderId?: string;
      byokProviderId?: string;
      localModelProviderId?: string;
      appleSpeechProviderId?: string;
    };
    tts?: {
      preferredProviderId?: string;
      byokProviderId?: string;
      localModelProviderId?: string;
      appleSpeechProviderId?: string;
    };
  },
): void {
  if (!repo) return;

  const seedChannel = (
    channel: "stt" | "tts",
    channelDefaults: {
      preferredProviderId?: string;
      byokProviderId?: string;
      localModelProviderId?: string;
      appleSpeechProviderId?: string;
    } | undefined,
  ) => {
    if (!channelDefaults) return;

    const entries: Array<{
      providerId?: string;
      source: "managed" | "byok" | "local_model" | "apple_speech";
      priority: number;
    }> = [
      { providerId: channelDefaults.preferredProviderId, source: "managed", priority: 10 },
      { providerId: channelDefaults.byokProviderId, source: "byok", priority: 20 },
      { providerId: channelDefaults.localModelProviderId, source: "local_model", priority: 30 },
      { providerId: channelDefaults.appleSpeechProviderId, source: "apple_speech", priority: 40 },
    ];

    for (const entry of entries) {
      const providerId = entry.providerId?.trim();
      if (!providerId) continue;
      repo.upsert({
        providerId,
        channel,
        source: entry.source,
        priority: entry.priority,
        healthStatus: "unknown",
      });
    }
  };

  seedChannel("stt", defaults.stt);
  seedChannel("tts", defaults.tts);
}
