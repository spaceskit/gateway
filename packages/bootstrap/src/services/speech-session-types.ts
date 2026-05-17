import type { SpaceManager } from "@spaceskit/core";
import type {
  VoiceProviderConfigRepository,
  VoiceUsageRepository,
} from "@spaceskit/persistence";
import type {
  VoiceChannel,
  VoiceChannelRoutePreferences,
  VoiceFallbackReason,
  VoiceProviderSource,
  VoiceRoutePreferences,
  VoiceRoutingService,
} from "./voice-routing-service.js";
import type {
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
  /**
   * Called when an executeTurn invocation throws or resolves to a
   * failure. Default is silent (the failure is still surfaced through
   * the session state). Pass a logger.error binding when you want
   * stderr/log telemetry.
   */
  onTurnFailure?: (info: { sessionId: string; spaceId: string; err: unknown }) => void;
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

export interface SpeechSessionRecord {
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
