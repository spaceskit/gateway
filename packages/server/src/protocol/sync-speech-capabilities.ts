export interface SyncResourceRefPayload {
  type?: string;
  id?: string;
  versionHash?: string;
  resourceType: string;
  resourceId: string;
  title?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface SyncResourcePayload {
  ref: SyncResourceRefPayload;
  content: Record<string, unknown>;
}

export interface SyncResourceDeniedPayload {
  ref: SyncResourceRefPayload;
  reason: string;
}

export interface SyncProvenancePayload {
  peerId: string;
  ref: SyncResourceRefPayload;
  action: string;
  status: string;
  reason?: string;
  pulledAt: string;
}

export interface SyncAnnouncePayload {
  apiVersion?: string;
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  endpointUrl?: string;
  authSecretHash?: string;
  skillCount?: number;
  actionCount?: number;
  experienceCount?: number;
  profileCount?: number;
}

export interface SyncAnnounceResponsePayload {
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  syncEnabled: boolean;
  announcedAt: string;
  apiVersion?: string;
}

export interface SyncQueryResourcesPayload {
  apiVersion?: string;
  peerId: string;
  resourceId?: string;
  types?: string[];
  tags?: string[];
  updatedAfter?: string;
  cursor?: string;
  limit?: number;
}

export interface SyncQueryResourcesResponsePayload {
  resources: SyncResourceRefPayload[];
  nextCursor?: string;
  apiVersion?: string;
}

export interface SyncPullResourcesPayload {
  apiVersion?: string;
  peerId: string;
  idempotencyKey: string;
  refs: SyncResourceRefPayload[];
}

export interface SyncPullResourcesResponsePayload {
  resources: SyncResourcePayload[];
  denied: SyncResourceDeniedPayload[];
  provenance?: SyncProvenancePayload[];
  appliedCount: number;
  skippedCount: number;
  apiVersion?: string;
}

export type VoiceProviderSourcePayload =
  | "managed"
  | "byok"
  | "local_model"
  | "apple_speech";

export type VoiceChannelPayload = "stt" | "tts";

export type VoiceProviderHealthStatusPayload =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unavailable";

export type VoiceFallbackReasonPayload =
  | "default"
  | "manual_override"
  | "quota_fallback"
  | "local_forced";

export interface SpeechUsageMetricsPayload {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
}

export interface SpeechEngineMetricsPayload {
  vadDetectionMs?: number;
  sttTranscriptionMs?: number;
  ttsFirstAudioMs?: number;
  ttsFullSynthesisMs?: number;
}

export interface SpeechRoutePreferencesPayload {
  channel: VoiceChannelPayload;
  preferredSource?: VoiceProviderSourcePayload;
  preferredProviderId?: string;
  byokProviderId?: string;
  localModelProviderId?: string;
  appleSpeechProviderId?: string;
  allowByokFallback?: boolean;
  allowLocalFallback?: boolean;
  allowAppleSpeechFallback?: boolean;
}

export interface VoiceRoutePayload {
  channel: VoiceChannelPayload;
  source: VoiceProviderSourcePayload;
  providerId: string;
}

export interface VoiceProviderConfigPayload {
  providerId: string;
  channel: VoiceChannelPayload;
  source: VoiceProviderSourcePayload;
  priority: number;
  healthStatus: VoiceProviderHealthStatusPayload;
  costProfile?: string;
}

export interface VoiceLockDecisionPayload {
  channel: VoiceChannelPayload;
  source: VoiceProviderSourcePayload;
  allowed: boolean;
  reason: string;
  retryAt?: string;
  fallbackHint?: string;
}

export interface VoiceFallbackEventPayload {
  channel: VoiceChannelPayload;
  fromRoute?: VoiceRoutePayload;
  toRoute?: VoiceRoutePayload;
  reason: VoiceFallbackReasonPayload;
  detail?: string;
}

export interface VoiceIntentDecisionPayload {
  intentType: "space_content" | "orchestration_command" | "clarification_required";
  confidence: number;
  rationale?: string;
  clarificationPrompt?: string;
  capabilityId?: string;
}

export interface SpeechStartPayload {
  apiVersion?: string;
  spaceId: string;
  spaceUid?: string;
  sessionId?: string;
  locale?: string;
  sourceDevice?: string;
  enableTranscription?: boolean;
  enablePlayback?: boolean;
  agentId?: string;
  autoSubmitTurns?: boolean;
  preferredSource?: VoiceProviderSourcePayload;
  preferredProviderId?: string;
  byokProviderId?: string;
  localModelProviderId?: string;
  appleSpeechProviderId?: string;
  allowByokFallback?: boolean;
  allowLocalFallback?: boolean;
  allowAppleSpeechFallback?: boolean;
  sttPreferences?: SpeechRoutePreferencesPayload;
  ttsPreferences?: SpeechRoutePreferencesPayload;
}

export interface SpeechAudioChunkPayload {
  apiVersion?: string;
  sessionId: string;
  sequenceNo?: number;
  sequence: number;
  audioBase64: string;
  sampleRateHz?: number;
  channels?: number;
  codec?: string;
  audioDurationSeconds?: number;
  ttsChars?: number;
  ttsSeconds?: number;
  transcriptText?: string;
  isFinal?: boolean;
  engineMetrics?: SpeechEngineMetricsPayload;
}

export interface SpeechControlPayload {
  apiVersion?: string;
  sessionId: string;
  command: "stop" | "interrupt" | "end";
  reason?: string;
}

export interface SpeechEventPayload {
  sessionId: string;
  spaceId: string;
  spaceUid: string;
  type?: string;
  message?: string;
  intent?: VoiceIntentDecisionPayload;
  state: "idle" | "running" | "stopped" | "interrupted" | "ended";
  eventType: string;
  providerSource?: VoiceProviderSourcePayload;
  providerId?: string;
  fallbackReason?: VoiceFallbackReasonPayload;
  usage?: SpeechUsageMetricsPayload;
  lockReason?: string;
  transcript?: string;
  turnId?: string;
  sequence?: number;
  sequenceNo?: number;
  reason?: string;
  emittedAt?: string;
  sttRoute?: VoiceRoutePayload;
  ttsRoute?: VoiceRoutePayload;
  lockDecision?: VoiceLockDecisionPayload;
  fallbackEvent?: VoiceFallbackEventPayload;
  providerConfigs?: VoiceProviderConfigPayload[];
  engineMetrics?: SpeechEngineMetricsPayload;
  ts: string;
}

export interface ConciergeCallStartPayload {
  apiVersion?: string;
  callId: string;
  deviceId?: string;
  platform: string;
  ttsMode?: string;
  targetGatewayId?: string;
  displayName?: string;
  handoffContext?: {
    destinationPlatform?: string;
    destinationDeviceId?: string;
    destinationClientId?: string;
    resumeUrl?: string;
  };
  spaceId?: string;
  spaceUid?: string;
  targetAgentId?: string;
}

export interface ConciergeCallAnswerPayload {
  apiVersion?: string;
  callId: string;
  deviceId?: string;
  platform?: string;
}

export interface ConciergeCallEndPayload {
  apiVersion?: string;
  callId: string;
  reason?: string;
}

export interface ConciergeCallSetMutedPayload {
  apiVersion?: string;
  callId: string;
  muted: boolean;
}

export interface ConciergeCallAudioChunkPayload {
  apiVersion?: string;
  callId: string;
  sequence: number;
  audioBase64: string;
  audioDurationSeconds?: number;
  sampleRateHz?: number;
  channels?: number;
  codec?: string;
  transcriptText?: string;
  isFinal?: boolean;
}

export interface ConciergeCallControlPayload {
  apiVersion?: string;
  callId: string;
  command: "interrupt";
  reason?: string;
}

export interface ConciergeCallMetricsPayload {
  callSetupMs?: number;
  sttFirstPartialMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstAudioMs?: number;
  routeChangeCount?: number;
  handoffCount?: number;
  providerFallbackCount?: number;
  interruptCount?: number;
  playbackUnderrunCount?: number;
  reconnectCount?: number;
}

export interface ConciergeCallHandoffPreparePayload {
  apiVersion?: string;
  callId: string;
  destinationPlatform: string;
  sourceDeviceId?: string;
  destinationDeviceId?: string;
  destinationClientId?: string;
  resumeUrl?: string;
}

export interface ConciergeCallHandoffTokenPayload {
  token: string;
  callId: string;
  sourceDeviceId?: string;
  destinationPlatform: string;
  destinationDeviceId?: string;
  destinationClientId?: string;
  resumeUrl?: string;
  expiresAt: string;
  signature: string;
}

export interface ConciergeCallHandoffPrepareResponsePayload {
  event: ConciergeCallEventPayload;
  handoffToken: ConciergeCallHandoffTokenPayload;
}

export interface ConciergeCallHandoffAcceptPayload {
  apiVersion?: string;
  callId: string;
  handoffToken: string;
  platform?: string;
}

export interface ConciergeCallRegisterPushPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId: string;
  platform: string;
  pushToken: string;
  voipTopic?: string;
  proactiveOptIn?: boolean;
}

export interface ConciergeVoipPushRegistrationPayload {
  principalId?: string;
  deviceId: string;
  platform: string;
  pushToken: string;
  voipTopic?: string;
  proactiveOptIn: boolean;
  registeredAt: string;
}

export interface ConciergeCallEventPayload {
  callId: string;
  state: "connecting" | "active" | "ended";
  platform: string;
  deviceId?: string;
  displayName: string;
  ttsMode: string;
  muted: boolean;
  targetGatewayId?: string;
  transcriptDelta?: string;
  assistantTextDelta?: string;
  urgency?: string;
  handoffToken?: ConciergeCallHandoffTokenPayload;
  metrics?: ConciergeCallMetricsPayload;
  reason?: string;
  emittedAt?: string;
  mediaEventType?:
    | "transcript_partial"
    | "transcript_final"
    | "assistant_text_partial"
    | "assistant_text_final"
    | "assistant_audio_chunk"
    | "interrupted"
    | "route_changed"
    | "playback_started"
    | "playback_ended";
  sequence?: number;
  transcriptFinal?: boolean;
  assistantTextFinal?: boolean;
  activeTurnId?: string;
  providerSource?: string;
  providerId?: string;
  fallbackReason?: string;
  assistantAudioBase64?: string;
  assistantAudioDurationSeconds?: number;
  ts: string;
}

export interface ConciergeCallEventsResponsePayload {
  events: ConciergeCallEventPayload[];
}

export interface CapabilitiesRegisterPayload {
  providers: AdapterCapabilityProvider[];
}

export interface CapabilitiesDeregisterPayload {
  providerIds: string[];
}

export interface AdapterCapabilityProvider {
  id: string;
  name: string;
  source: "adapter";
  capabilityType: string;
  operations: string[];
}

export interface AdapterCapabilityInvokePayload {
  invocationId: string;
  capability: string;
  operation: string;
  args: Record<string, unknown>;
  targetProvider?: string;
}

export interface CapabilityResultPayload {
  invocationId: string;
  providerId: string;
  data: unknown;
  durationMs?: number;
}

export interface CapabilityErrorPayload {
  invocationId: string;
  providerId?: string;
  code?: string;
  message: string;
  details?: unknown;
}
