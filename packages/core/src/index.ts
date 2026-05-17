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


export * from "./index-runtime-exports.js";
