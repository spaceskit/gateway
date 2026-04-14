// Errors
export { RateLimitError, CircuitOpenError, ProviderRateLimitError } from "./errors/index.js";

// Agents
export type {
  ModelProvider,
  ModelMessage,
  ToolCall,
  ToolResult,
  ToolDefinition,
  GenerateOptions,
  GenerateResult,
  StreamChunk,
  CliExecutionMode,
  CliExecutionObserver,
  CliExecutionObserverEvent,
  FinishReason,
  TurnAccessMode,
  TurnExecutionMode,
  TurnReasoningEffort,
  ThinkingConfig,
  ProviderFeedbackRequest,
  ProviderFeedbackResponse,
  ProviderSessionHandle,
  TokenUsage,
  TokenUsageDetails,
  ModelInfo,
  GatewayToolBridgeConfig,
  McpBridgeConfig,
} from "./agents/model-provider.js";

export type {
  AgentRuntime,
  AgentConfig,
  AgentState,
  TurnContext,
  TurnResult,
  TurnEvent,
  RuntimeFeedbackCheckpoint,
  RuntimeApprovalSelection,
} from "./agents/agent-runtime.js";

export type {
  CapabilityTier,
  TierProviderHints,
  ArchetypeId,
  ArchetypeDefinition,
} from "./agents/capability-tiers.js";
export {
  resolveArchetypeHint,
  isCapabilityTier,
  resolveTierProviderHints,
} from "./agents/capability-tiers.js";
export type { PromptBudgetClass } from "./agents/model-capability-registry.js";
export { inferContextWindow } from "./agents/model-capability-registry.js";
export type { CliLaunchSnapshot, CliLaunchSnapshotSource } from "./agents/cli-launch-snapshot.js";
export { resolveCliLaunchSnapshot } from "./agents/cli-launch-snapshot.js";
export type { TurnAccessMode as TurnRequestAccessMode } from "./agents/model-provider.js";

export type {
  ToolExecutor,
  ToolExecutionContext,
  ToolPermission,
} from "./agents/tool-executor.js";

export type {
  ProviderRouter,
  RoutingDecision,
  ModelRequirements,
  FallbackReason,
} from "./agents/provider-router.js";

export { computeRetryDecision, DEFAULT_PROVIDER_RETRY_CONFIG } from "./agents/provider-retry.js";
export type { ProviderRetryConfig, RetryDecision } from "./agents/provider-retry.js";
export {
  buildMediatedToolPrompt,
  buildToolUsageGuidance,
  hasInjectedToolGuidance,
} from "./agents/agent-runtime-tools.js";
export {
  parseFencedToolCalls,
  stripFencedToolCallBlocks,
} from "./agents/mediated-tool-calls.js";
export { ReflectionService } from "./reflection/reflection-service.js";
export type {
  ExperienceJobInput,
  ExperienceJobResult,
  InsightProposalJobInput,
  InsightProposalJobResult,
  ReflectionFallbackMode,
  ReflectionGenerationTrace,
  ReflectionModelPolicy,
  ReflectionModelTarget,
  ReflectionServiceOptions,
  SummaryJobInput,
  SummaryJobKind,
  SummaryJobResult,
} from "./reflection/reflection-service.js";

// Identity
export { deterministicUuid, isUuid, normalizeOrDeterministicUuid, normalizeUuid } from "./identity/uuid.js";

// Capabilities
export type {
  CapabilityType,
  ConnectorFamilyId,
  ConnectorInstanceId,
  ConnectorKind,
  ConnectorRuntime,
  ConnectorTrustClass,
  ConnectorInstanceStatus,
  ConnectorBindingType,
  ConnectorBindingTarget,
  ConnectorBinding,
  ConnectorAction,
  ConnectorFamily,
  ConnectorInstance,
  ConnectorPolicy,
  ProviderSource,
  CapabilityProvider,
  CapabilityInvocation,
  CapabilityResult,
  AggregatedCapabilityResult,
  CapabilityRoutingPreferences,
} from "./capabilities/types.js";
export { CAPABILITY_TYPES, isCapabilityType } from "./capabilities/types.js";

export type {
  ConnectorSelectorFieldDef,
  ConnectorSelectorSchema,
  SelectorValidationResult,
} from "./capabilities/selector-schema.js";
export {
  SELECTOR_SCHEMAS,
  getSchemaForFamily,
  validateConnectorSelector,
} from "./capabilities/selector-schema.js";

export { CapabilityRegistry, CapabilityNotAvailableError, CapabilityDeniedError } from "./capabilities/registry.js";
export type {
  CapabilityHandler,
  CapabilityPolicyContext,
  GatewayPolicyEvaluationResult,
  GatewayPolicyEvaluator,
  CapabilityExecutionOrigin,
  CapabilityExecutionBackend,
  CapabilityExecutionRoute,
  CapabilityExecutionRoutingInput,
  CapabilityExecutionRoutingResolver,
  CapabilitySandboxInvocationInput,
  CapabilitySandboxInvoker,
} from "./capabilities/registry.js";

// Spaces
export type {
  SpaceState,
  SpaceConfig,
  SpaceSnapshot,
  SpaceArtifact,
  SpaceAgentAssignment,
  SpaceResource,
  SpaceResourceType,
  TurnModelStrategy,
  TurnModelConfig,
  ConversationTopology,
  CoordinatorRole,
  InterAgentMode,
  InterAgentCall,
  TaskDependency,
} from "./spaces/types.js";
export type {
  GatewayMemoryDefaults,
  SpaceExperienceCaptureMode,
  SpaceMemoryPolicy,
  SpacePrivacyMode,
  ThinkingCapturePolicy,
} from "./spaces/memory-policy.js";

// Skills & Actions
export type {
  Skill,
  Action,
  ActionStep,
  ActionStepType,
  ActionPermissions,
  ActionStatus,
  ActionRun,
} from "./skills/types.js";

// Experiences
export type {
  Experience,
  ExperienceStatus,
  AgentObservation,
  ScoredExperience,
} from "./experiences/types.js";

// Profiles & Personality
export type {
  AgentProfile,
  AgentProfileRevision,
  ProfileStatus,
  PersonalityInsight,
  InsightStatus,
  ModeratorProfile,
  ModeratorPolicy,
} from "./profiles/types.js";
export { DEFAULT_MODERATOR_POLICY } from "./profiles/types.js";

// Profiles — read model & validation
export {
  toAgentTemplateReadModel,
  validateProfileModelConfig,
  transitionInsightState,
} from "./profiles/index.js";
export type {
  AgentTemplateReadModel,
  ProfileModelConfigValidationResult,
  ProfileModelConfig,
  InsightAction,
} from "./profiles/index.js";

// Feedback (human-in-the-loop)
export type {
  FeedbackRequest,
  FeedbackResponse,
  FeedbackCategory,
  FeedbackStatus,
  FeedbackResponseType,
} from "./feedback/types.js";

export {
  INITIAL_APPROVAL_PROMPT_PHASE,
  createInitialApprovalPromptState,
  transitionApprovalPrompt,
  shouldFallbackToPhone,
  toWatchPrompt,
} from "./feedback/approval-prompt-state.js";
export type {
  ApprovalPromptPhase,
  ApprovalPromptEvent,
  ApprovalActionResult,
  ApprovalPromptState,
  WatchApprovalPrompt,
} from "./feedback/approval-prompt-state.js";

// MCP
export {
  toExternalRuntimeState,
  deriveMcpHealthSummary,
} from "./mcp/index.js";
export type {
  McpEndpointHealthModel,
  McpBindingStatus,
  McpTransport,
  McpDiscoveredAgent,
  McpApprovedBinding,
  SpaceExternalRuntimeState,
  ToExternalRuntimeStateInput,
} from "./mcp/index.js";

// Security
export type {
  SecurityVerdict,
  TrustLevel,
  AgentSecurityScope,
  SecurityPolicy,
  ArtifactProvenance,
  SecretType,
  DetectedSecret,
  SecretsScanResult,
  SecretsDetectionConfig,
} from "./security/types.js";
export { DEFAULT_SECURITY_POLICY, DEFAULT_AGENT_SCOPE, DEFAULT_SECRETS_DETECTION_CONFIG } from "./security/types.js";
export type {
  DangerousCapabilityId,
  DangerousCapabilityRule,
  EffectiveDangerousCapability,
  EffectiveToolAccess,
  EffectiveToolAccessOperation,
  GuestAccessPreset,
  SafetyProfileDefinition,
  SafetyProfileId,
  ToolAccessEvaluation,
  ToolAccessPolicy,
  ToolAccessPolicyScopeType,
  ToolAccessRule,
  ToolAccessRuleSelectorKind,
} from "./security/tool-access.js";
export { DEFAULT_SAFETY_PROFILES } from "./security/tool-access.js";

// Events
export { EventBus } from "./events/event-bus.js";
export type { GatewayEvent, EventHandler } from "./events/event-bus.js";

// Agent implementations
export { DefaultAgentRuntime } from "./agents/default-agent-runtime.js";
export type { DefaultAgentRuntimeOptions } from "./agents/default-agent-runtime.js";
export { ExternalMcpAgentRuntime } from "./agents/external-mcp-agent-runtime.js";
export type { ExternalMcpAgentRuntimeOptions } from "./agents/external-mcp-agent-runtime.js";

export { DefaultToolExecutor } from "./agents/default-tool-executor.js";
export type { DefaultToolExecutorOptions, CapabilityError } from "./agents/default-tool-executor.js";

// Space manager
export { SpaceManager } from "./spaces/space-manager.js";
export type {
  SpaceManagerOptions,
  SaveTurnInput,
  TurnExecutionIdentity,
} from "./spaces/space-manager.js";
export { SpaceAdminService, SpaceAdminError, normalizeSpaceState } from "./spaces/space-admin-service.js";
export type {
  SpaceAdminErrorCode,
  SpaceStoreRecord,
  CreateSpaceStoreInput,
  ListSpacesStoreQuery,
  SpaceAssignmentStoreRecord,
  UpsertSpaceAssignmentStoreInput,
  SpaceSkillStoreRecord,
  UpsertSpaceSkillStoreInput,
  SpaceResourceStoreRecord,
  UpsertSpaceResourceStoreInput,
  SpaceAdminServiceOptions,
  AddAgentInput,
  UpdateAgentAssignmentInput,
  SetSpaceOrchestratorInput,
  AddSpaceSkillInput,
  RemoveSpaceSkillInput,
  AddSpaceResourceInput,
  RemoveSpaceResourceInput,
  CreateSpaceInput,
  ListSpacesOptions,
} from "./spaces/space-admin-service.js";

// Middleware
export { MiddlewarePipeline } from "./middleware/pipeline.js";
export type {
  MiddlewareLayer,
  MiddlewareContext,
  MiddlewareFn,
  Middleware,
} from "./middleware/types.js";

// Built-in middleware
export {
  createSecurityMiddleware,
  createBudgetMiddleware,
  createAuditMiddleware,
  createContextWindowMiddleware,
  createTracingMiddleware,
  createResilienceMiddleware,
  createValidationMiddleware,
  createSecretsMiddleware,
} from "./middleware/builtin/index.js";
export type {
  AuditRecord,
  TracingMiddlewareOptions,
  TraceSpan,
  ResilienceMiddlewareOptions,
  ValidationMiddlewareOptions,
  SecretsMiddlewareOptions,
} from "./middleware/builtin/index.js";

// Budget policy
export { checkBudget, estimateCostUsd } from "./policy/budget.js";
export type { BudgetPolicy, BudgetState, BudgetCheckResult } from "./policy/budget.js";

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
