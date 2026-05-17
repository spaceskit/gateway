import type { VoiceProviderConfigRepository } from "@spaceskit/persistence";
import type {
  SpeechProviderConfigPayload,
  SpeechSessionEvent,
  SpeechSessionRecord,
} from "./speech-session-types.js";
import {
  cloneUsageByChannel,
  cloneUsageMetrics,
  mapSpeechEventType,
  normalizeHealthStatus,
  parseCostProfile,
} from "./speech-session-normalizers.js";

interface SpeechSessionEventAssemblyOptions {
  now: () => Date;
  voiceProviderConfigRepo?: VoiceProviderConfigRepository;
}

export function buildSpeechSessionEvent(
  session: SpeechSessionRecord,
  eventType: string,
  extras: Partial<SpeechSessionEvent> = {},
  options: SpeechSessionEventAssemblyOptions,
): SpeechSessionEvent {
  const emittedAt = options.now().toISOString();
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
    providerConfigs: listSpeechProviderConfigs(options.voiceProviderConfigRepo),
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

function listSpeechProviderConfigs(
  repo: VoiceProviderConfigRepository | undefined,
): SpeechProviderConfigPayload[] {
  const rows = repo?.list() ?? [];
  return rows.map((row) => ({
    providerId: row.provider_id,
    channel: row.channel === "tts" ? "tts" : "stt",
    source: row.source === "unknown" ? "managed" : row.source,
    priority: row.priority,
    healthStatus: normalizeHealthStatus(row.health_status),
    costProfile: parseCostProfile(row.cost_profile_json),
  }));
}
