// Memory
export type {
  MemoryProvider,
  MemoryDocument,
  MemoryQuery,
  MemorySearchResult,
  MemorySaveInput,
  MemoryScope,
  MemoryType,
  ContextPayload,
  TurnMemoryInput,
  MemoryVersion,
  ListOptions,
  MemoryProviderRegistry as MemoryProviderRegistryInterface,
} from "./memory/types.js";
export { ExperienceMemoryProvider } from "./memory/experience-memory-provider.js";
export { MemoryProviderRegistry } from "./memory/memory-registry.js";
export { Mem0Provider } from "./memory/mem0-provider.js";
export type { Mem0ProviderOptions } from "./memory/mem0-provider.js";
export { LettaProvider } from "./memory/letta-provider.js";
export type { LettaProviderOptions } from "./memory/letta-provider.js";

// Notifications
export type {
  NotificationCategory,
  NotificationSeverity,
  Notification,
  NotificationTarget,
  NotificationSubscription,
  NotificationService,
  NotificationPushHandler,
  NotificationStats,
} from "./notifications/types.js";
export { DefaultNotificationService } from "./notifications/notification-service.js";
export {
  AppleNotificationLifecycleService,
  InMemoryAppleNotificationLifecycleRepository,
} from "./notifications/apple-notification-lifecycle.js";
export type {
  AppleAlertDeliveryDecision,
  AppleAlertDeliveryPlanInput,
  AppleAlertPushInput,
  AppleApnsPushRequest,
  AppleNotificationAction,
  AppleNotificationDelivery,
  AppleNotificationDeliveryChannel,
  AppleNotificationDeliveryStatus,
  AppleNotificationLifecycleRepository,
  AppleNotificationPreferences,
  AppleNotificationQuietHours,
  ApplePushDeviceRegistration,
  ApplePushEnvironment,
  ApplePushPlatform,
  ApplePushTokenKind,
  AppleVoipPushInput,
  BackgroundFeedbackActionResult,
  BackgroundFeedbackResolveInput,
  PatchAppleNotificationPreferencesInput,
  RecordAppleNotificationDeliveryInput,
  RegisterApplePushDeviceInput,
} from "./notifications/apple-notification-lifecycle.js";

// Experiences (extended)
export { ExperienceGenerator } from "./experiences/experience-generator.js";
export type { ExperienceGeneratorOptions } from "./experiences/experience-generator.js";
export type { EmbeddingService } from "./experiences/embedding-service.js";
export { SimpleEmbeddingService, OpenAIEmbeddingService } from "./experiences/embedding-service.js";

// Checkpointing
export { SQLiteCheckpointManager } from "./spaces/checkpoint.js";
export type { CheckpointManager, Checkpoint, CheckpointData } from "./spaces/checkpoint.js";

// Space Templates
export {
  SpaceTemplateSchema,
  SpaceTemplateAgentSchema,
  SpaceTemplateCapabilitySchema,
  validateTemplate,
  instantiateTemplate,
} from "./spaces/space-templates.js";
export type { SpaceTemplate, SpaceTemplateAgent, SpaceFromTemplateOptions } from "./spaces/space-templates.js";

// Templates (read model & validation)
export {
  validateTemplateForApply,
  toTemplateReadModel,
} from "./templates/index.js";
export type {
  SpaceTemplateReadModel,
  TemplateApplyResult,
  TemplateValidationResult,
  TemplateCommunicationMode,
  ToTemplateReadModelOptions,
} from "./templates/index.js";

// Dead Letter Queue
export { SQLiteDeadLetterQueue } from "./spaces/dead-letter.js";
export type { DeadLetter, DeadLetterQueue, DeadLetterEnqueueParams } from "./spaces/dead-letter.js";

// Session Continuity
export { SessionContinuityManager } from "./spaces/session-continuity.js";
export type { SessionState, SessionContinuityOptions } from "./spaces/session-continuity.js";

// Delegation validation
export { validateDelegation } from "./agents/delegation-validation.js";
export type { DelegationRequest, DelegationValidationResult } from "./agents/delegation-validation.js";

// Platform Introspection Tools
export {
  createPlatformToolDefinitions,
  createPlatformToolExecutor,
  createPlatformToolFilter,
  isPlatformTool,
} from "./agents/platform-tools.js";
export type { PlatformToolConfig, PlatformToolExecutionContext } from "./agents/platform-tools.js";
export {
  createConciergeEscalationToolDefinitions,
  createConciergeEscalationToolExecutor,
  createConciergeEscalationToolFilter,
  isConciergeEscalationTool,
  USER_ESCALATION_SKILL_ID,
} from "./agents/concierge-escalation-tools.js";
export type {
  ConciergeEscalationAllowedResponse,
  ConciergeEscalationCancelInput,
  ConciergeEscalationDeliveryChannel,
  ConciergeEscalationFallbackPolicy,
  ConciergeEscalationRequestInput,
  ConciergeEscalationRequestResult,
  ConciergeEscalationResponseMode,
  ConciergeEscalationStatus,
  ConciergeEscalationStatusResult,
  ConciergeEscalationToolConfig,
  ConciergeEscalationToolExecutionContext,
  ConciergeEscalationUrgency,
} from "./agents/concierge-escalation-tools.js";

// Model Router
export { ModelRouter } from "./agents/model-router.js";
export type { ModelRoutingPolicy, ModelRoutingResult } from "./agents/model-router.js";

// Agent Versioning
export { AgentVersionManager } from "./agents/agent-versioning.js";
export type {
  AgentProfileSnapshot,
  AgentVersionPin,
  AgentVersionManagerOptions,
} from "./agents/agent-versioning.js";

// Config Hot-Reload
export { ConfigHotReloader } from "./config/index.js";
export type {
  ConfigChangeEvent,
  ConfigChangeListener,
  ConfigValidator,
  ConfigHotReloadOptions,
} from "./config/index.js";

// Plugin System
export { PluginSystem, InstallSource } from "./plugins/index.js";
export type {
  PluginManifest,
  TrustLevel as PluginTrustLevel,
  PluginStatus,
  PluginInstance,
  PluginSandbox,
  PluginSystemOptions,
  PluginRegistryEntry,
} from "./plugins/index.js";

// Multi-Gateway Sync
export { GatewaySync } from "./sync/index.js";
export type { SyncPeer, SyncMessage, GatewaySyncOptions } from "./sync/index.js";

// Onboarding
export type {
  AppLaunchPhase,
  OnboardingGoal,
  OnboardingCaptureMode,
  OnboardingProfile,
  OnboardingState,
} from "./onboarding/index.js";
export { DEFAULT_ONBOARDING_STATE } from "./onboarding/index.js";

// Auth
export type {
  DeviceAuthPhase,
  BiometricAvailability,
  DeviceAuthState,
  DeviceAuthTransition,
  DeviceAuthEvent,
} from "./auth/index.js";
export { INITIAL_DEVICE_AUTH_STATE, transitionDeviceAuth } from "./auth/index.js";

// Terminology
export type { TerminologyProfile, TermMapping } from "./terminology/index.js";
export { TERM_MAPPINGS, getTerm, getTermMap } from "./terminology/index.js";

// Gateway
export type {
  GatewayTransportPosture,
  GatewayConnectionStatus,
  GatewayRiskLevel,
  GatewayReadModel,
} from "./gateway/index.js";
export { deriveRiskLevel, riskSummary } from "./gateway/index.js";

// Orchestrator
export {
  parseCommandIntent,
  routeCommandIntent,
  suggestModelTier,
  isSummaryEligible,
  assembleSummary,
  MAX_PINNED_DECISIONS,
  MAX_DECISION_LENGTH,
  validateDecisionText,
  canAddDecision,
  transitionPinnedDecision,
  validatePipelinePreset,
  getNextStages,
} from "./orchestrator/index.js";
export type {
  CommandIntentType,
  CommandComplexity,
  CommandIntent,
  CommandIntentResult,
  SummaryDecision,
  OrchestratorSummaryPayload,
  SummaryTurnInput,
  PinnedDecisionStatus,
  PinnedDecisionAction,
  PinnedDecision,
  DecisionValidationResult,
  PipelineStage,
  PipelinePreset,
  PipelineValidationResult,
} from "./orchestrator/index.js";

// Usage
export type {
  UsageLoadPhase,
  UsageSummaryReadModel,
  GatewayCoreSummary,
  UsageDetailReadModel,
  ProviderUsageSummary,
  UsageWindowInput,
} from "./usage/index.js";
export { shouldDeferUsageLoad, isUsageStale, toUsageSummary } from "./usage/index.js";

// Sharing / Invite Links
export type {
  InviteLinkVersion,
  InviteLinkV1,
  InviteLinkV2,
  InviteLink,
  InviteRoute,
  InviteRouteDecision,
  RouteResolverInput,
} from "./sharing/index.js";
export { encodeInviteLink, decodeInviteLink, isV2Link, resolveInviteRoute } from "./sharing/index.js";

// Concierge Call Service
export {
  ConciergeCallService,
  ConciergeCallServiceError,
  normalizeOptional as conciergeNormalizeOptional,
  normalizeRequired as conciergeNormalizeRequired,
  normalizeTtsMode,
} from "./concierge/index.js";
export type {
  ConciergeCallServiceOptions,
  ConciergeCallTtsModePayload,
  ConciergeCallStartPayload,
  ConciergeCallAnswerPayload,
  ConciergeCallEndPayload,
  ConciergeCallSetMutedPayload,
  ConciergeCallHandoffPreparePayload,
  ConciergeCallHandoffTokenPayload,
  ConciergeCallHandoffPrepareResponsePayload,
  ConciergeCallHandoffAcceptPayload,
  ConciergeCallRegisterPushPayload,
  ConciergeVoipPushRegistrationPayload,
  ConciergeCallMetricsPayload,
  ConciergeCallEventPayload,
} from "./concierge/index.js";
