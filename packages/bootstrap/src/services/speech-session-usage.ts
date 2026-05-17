import type { VoiceUsageRepository } from "@spaceskit/persistence";
import type {
  SpeechEngineLatencyMetrics,
  SpeechRouteSet,
  SpeechSessionRecord,
  SpeechSessionUsageMetrics,
} from "./speech-session-types.js";
import { roundUsage } from "./speech-session-normalizers.js";

export function recordUsageForChunk(
  voiceUsageRepo: VoiceUsageRepository | undefined,
  session: SpeechSessionRecord,
  routes: SpeechRouteSet,
  delta: SpeechSessionUsageMetrics,
  sequence: number,
  isFinal: boolean,
  engineMetrics?: SpeechEngineLatencyMetrics,
): void {
  if (!voiceUsageRepo) return;

  const metadataJson = JSON.stringify({
    sequence,
    isFinal,
    engineMetrics,
  });
  if (delta.sttSeconds > 0) {
    voiceUsageRepo.createEvent({
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
    voiceUsageRepo.createEvent({
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

export function applyUsageDelta(
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
