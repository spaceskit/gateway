/**
 * Spaceskit — bootstrap entry point.
 *
 * Wires together all packages and starts the gateway daemon:
 * 1. Parse configuration (env vars + optional config file)
 * 2. Initialize database (migrations, generation reset)
 * 3. Set up middleware pipeline with built-in middleware
 * 4. Set up capability registry + tool executor
 * 5. Set up memory providers (Experience default + Mem0 + Letta conditionally)
 * 6. Set up notification service
 * 7. Set up experience generator + checkpoint manager
 * 8. Set up space manager (orchestration engine)
 * 9. Set up model router for multi-model support
 * 10. Set up message router (WebSocket dispatch)
 * 11. Set up A2A handler (HTTP endpoints for interop)
 * 12. Set up workflow visualizer + notification handler
 * 13. Start WebSocket server (Bun.serve())
 * 14. Handle graceful shutdown
 *
 * Run directly with Bun — no build step needed:
 *   bun run packages/bootstrap/src/index.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  EventBus,
  CapabilityRegistry,
  MiddlewarePipeline,
  SpaceManager,
  SpaceAdminService,
  DefaultToolExecutor,
  DefaultAgentRuntime,
  ExternalMcpAgentRuntime,
  createSecurityMiddleware,
  createAuditMiddleware,
  createContextWindowMiddleware,
  createTracingMiddleware,
  createResilienceMiddleware,
  createValidationMiddleware,
  createBudgetMiddleware,
  createSecretsMiddleware,
  DEFAULT_SECURITY_POLICY,
  DEFAULT_AGENT_SCOPE,
  // Memory
  ExperienceMemoryProvider,
  MemoryProviderRegistry,
  Mem0Provider,
  LettaProvider,
  // Notifications
  DefaultNotificationService,
  // Experiences
  ExperienceGenerator,
  // Checkpointing
  SQLiteCheckpointManager,
  // Dead letter
  SQLiteDeadLetterQueue,
  // Model router
  ModelRouter,
  // Config hot-reload
  ConfigHotReloader,
  // Plugin system
  PluginSystem,
  // Agent versioning
  AgentVersionManager,
  // Platform introspection tools
  createPlatformToolDefinitions,
  createPlatformToolExecutor,
  createPlatformToolFilter,
} from "@spaceskit/core";
import type {
  AgentSecurityScope,
  CapabilityExecutionRoutingInput,
  SpaceConfig,
  ModelMessage,
  SaveTurnInput,
  Middleware,
  MemoryProvider,
  NotificationService,
  CheckpointManager,
  DeadLetterQueue,
  ConfigChangeEvent,
} from "@spaceskit/core";
import { Logger, createFileOutput } from "@spaceskit/observability";
import {
  initDatabase,
  GatewayPolicyRepository,
  AuditEventsRepository,
  ConnectorFamilyRepository,
  ConnectorInstanceRepository,
  ConnectorBindingRepository,
  ConnectorPolicyRepository,
  ConnectorSecretRefRepository,
  ProviderConfigRepository,
  ProviderSecretRefRepository,
  KnowledgeBaseEntryRepository,
  GatewaySkillCatalogRepository,
  IdempotencyRepository,
  OrchestratorCommandRepository,
  SchedulerJobRepository,
  SchedulerJobSpaceRepository,
  SchedulerJobRunRepository,
  ArtifactRepository,
  SpaceRepository,
  SpaceLinkRepository,
  SpaceContextTransferRepository,
  SpaceShareInviteRepository,
  SpaceParticipantRepository,
  SpaceChangeSetRepository,
  SpaceChangeSetFileRepository,
  SpaceChangeSetReviewRepository,
  SpaceQuotaPolicyRepository,
  ParticipantQuotaPolicyRepository,
  SpaceUsageCounterRepository,
  ParticipantUsageCounterRepository,
  SpaceToolPolicyRepository,
  SpaceAgentAssignmentRepository,
  SpaceMcpEndpointRepository,
  SpaceExternalAgentBindingRepository,
  SpaceResourceRepository,
  SpaceWorkspaceRepository,
  SpaceSkillRepository,
  SpaceTemplateRepository,
  SpacePresetApplicationRepository,
  AgentPresetRepository,
  DeviceIdentityRepository,
  OrchestrationJournalRepository,
  EventLogRepository,
  AgentUsageSessionRepository,
  GatewayCapabilityGrantRepository,
  SyncRuntimeRepository,
  TurnRepository,
  RunRepository,
  RunStepRepository,
  InvocationRecordRepository,
  ApprovalRequestRepository,
  UsageRecordRepository,
  IntegrationRequestRepository,
  UsageAnalyticsRepository,
  VoiceUsageRepository,
  ProfileRepository,
  ExperienceRepository,
  type DatabaseManager,
} from "@spaceskit/persistence";
import { deterministicUuid, normalizeUuid } from "./utils/uuid.js";
import {
  GatewayServer,
  MessageRouter,
  A2AHandler,
  NotificationHandler,
  WorkflowVisualizer,
  createDiagramHandler,
  A2APushNotificationHandler,
} from "@spaceskit/server";
import {
  DefaultGatewayAdminService,
  type PublicProviderRuntimeConfig,
} from "./gateway-admin-service.js";
import { ConnectorAdminService } from "./services/connector-admin-service.js";
import { ProviderSecretRefService } from "./services/provider-secret-ref-service.js";
import { SpaceMcpService } from "./services/space-mcp-service.js";
import { DefaultGatewayPolicyService } from "./services/gateway-policy-service.js";
import { GatewayResetService } from "./services/gateway-reset-service.js";
import { KnowledgeBaseService } from "./services/knowledge-base-service.js";
import { GatewaySkillCatalogService } from "./services/gateway-skill-catalog-service.js";
import { UsageSnapshotService } from "./services/usage-snapshot-service.js";
import { LocalUsageTelemetryService } from "./services/local-usage-telemetry-service.js";
import { SpaceContextService } from "./services/space-context-service.js";
import { OrchestratorCommandService } from "./services/orchestrator-command-service.js";
import { SchedulerService } from "./services/scheduler-service.js";
import { DefaultGatewaySyncService } from "./services/sync-service.js";
import { SpeechSessionService } from "./services/speech-session-service.js";
import { VoiceRoutingService, type VoiceProviderSource } from "./services/voice-routing-service.js";
import {
  VoiceUsageLockService,
  parseVoiceUsagePolicyFromGlobalFlags,
} from "./services/voice-usage-lock-service.js";
import { SpaceSharingService, type SharingIdentityPolicy } from "./services/space-sharing-service.js";
import { SpaceChangeSetService } from "./services/space-changeset-service.js";
import { SpaceQuotaService } from "./services/space-quota-service.js";
import { SpaceToolPolicyService } from "./services/space-tool-policy-service.js";
import { SpaceTurnTraceService } from "./services/space-turn-trace-service.js";
import { SpaceArtifactService } from "./services/space-artifact-service.js";
import { SpaceConfiguratorService } from "./services/space-configurator-service.js";
import { DeviceIdentityService } from "./services/device-identity-service.js";
import { RuntimeLedgerService } from "./services/runtime-ledger-service.js";
import { ExecutionAdapterFactory } from "./execution/execution-adapter-factory.js";
import { GatewayCapabilityAccessService } from "./services/gateway-capability-access-service.js";
import { createSandboxExecutionBackend } from "./services/sandbox-execution-backend.js";
import { SpacesRestApiService } from "./services/spaces-rest-api-service.js";
import { SpacesAdminMcpFacadeService } from "./services/spaces-admin-mcp-facade-service.js";
import { ShareRelayApiService } from "./services/share-relay-api-service.js";
import { GatewayObservabilityApiService } from "./services/gateway-observability-api-service.js";
import { GatewayObservabilityService } from "./services/gateway-observability-service.js";
import { issueHttpPrincipalToken } from "./services/http-principal-auth.js";
import {
  SPACE_WORKSPACE_MANAGED_RESOURCE_PREFIX,
  SpaceWorkspaceService,
  isPathWithinScope,
  normalizeCandidatePath,
} from "./services/space-workspace-service.js";
import {
  evaluateCrossSpaceBoundaryPolicy,
  evaluateSyncBoundaryPolicy,
} from "./services/share-boundary-policy.js";
import {
  createGatewayCoreState,
  evaluateCapabilityRequest,
  grantCapability,
  capabilityRequestFromInvocation,
  capabilityGrantsFromIds,
  type GatewayCoreProfileId,
} from "@spaceskit/gateway-core";
import {
  evaluateTransportPolicy,
  type TransportPolicyInput,
} from "@spaceskit/policy";
import {
  MAIN_SPACE_SYSTEM_SKILLS,
  MAIN_SPACE_SYSTEM_SKILL_IDS,
} from "./seed/main-space-system-skills.js";

// ---------------------------------------------------------------------------
// Profile resolution (exported for testability)
// ---------------------------------------------------------------------------

export function resolveGatewayProfile(
  profileRaw: string | undefined,
  port: number,
): { profile: GatewayCoreProfileId; profileSource: "explicit_env" | "port_inferred" } {
  const normalized = profileRaw?.trim().toLowerCase();
  if (normalized === "embedded") return { profile: "embedded", profileSource: "explicit_env" };
  if (normalized === "external") return { profile: "external", profileSource: "explicit_env" };
  return { profile: port === 9320 ? "embedded" : "external", profileSource: "port_inferred" };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GatewayConfig {
  /** WebSocket server port. Default: 9320. */
  port: number;
  /** WebSocket server host. Default: "127.0.0.1". */
  host: string;
  /** Path to the SQLite database file. Default: "./gateway.db". */
  dbPath: string;
  /** Minimum log level. Default: "info". */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Heartbeat log interval in ms. Set to 0 to disable periodic heartbeat logs. */
  heartbeatIntervalMs: number;
  /** Runtime generation for schema resets. */
  runtimeGeneration: string;
  /** Model provider or executor ID (e.g. "openrouter", "codex"). */
  modelProvider?: string;
  /** Default model ID (e.g. "openrouter/openai/gpt-4.1-mini"). */
  defaultModelId?: string;
  /** API key for the default model runtime. */
  apiKey?: string;
  /** Enables experimental Apple Foundation Model provider wiring (opt-in). */
  enableAppleFoundationProvider: boolean;
  /** MCP endpoint for capability provider (optional). */
  mcpEndpoint?: string;
  /** Mem0 API key (optional — enables Mem0 memory adapter). */
  mem0ApiKey?: string;
  /** Letta base URL (optional — enables Letta memory adapter). */
  lettaBaseUrl?: string;
  /** Letta API key (optional). */
  lettaApiKey?: string;
  /** Enable OpenTelemetry-style tracing. Default: true. */
  enableTracing?: boolean;
  /** Enable rate limiting + circuit breaker. Default: true. */
  enableResilience?: boolean;
  /** Requests per minute for rate limiting. Default: 60. */
  requestsPerMinute?: number;
  /** Include extended diagnostics in /health output. Default: false. */
  healthDebug: boolean;
  /** File path for log output (in addition to stdout/stderr). Optional. */
  logFilePath?: string;
  /** Default main space ID ensured on startup. */
  mainSpaceId: string;
  /** Display name for the default main space. */
  mainSpaceName: string;
  /** Resource ID assigned to the default main space. */
  mainSpaceResourceId: string;
  /** Default goal text for the main space. */
  mainSpaceGoal: string;
  /** Default main profile ID ensured on startup. */
  mainProfileId: string;
  /** Default orchestrator profile ID ensured on startup. */
  mainOrchestratorProfileId: string;
  /** Default main agent ID ensured on startup. */
  mainAgentId: string;
  /** Runtime gateway profile mode. */
  gatewayProfile: GatewayCoreProfileId;
  /** How the gateway profile was determined. */
  profileSource: "explicit_env" | "port_inferred";
  /** Comma-separated grants (capability IDs) to seed on startup. */
  gatewayCapabilityGrants: string[];
  /** External connector family rollout: WhatsApp Cloud. */
  enableWhatsappConnectorFamily: boolean;
  /** External connector family rollout: Discord Bot. */
  enableDiscordConnectorFamily: boolean;
  /** Global coordinator-led master mode toggle. */
  masterModeEnabled: boolean;
  /** Global default planner prompt template for master mode. */
  masterPlannerPromptTemplate?: string;
  /** Global default guest prompt template for master mode. */
  guestAgentPromptTemplate?: string;
  /** Global default peer-review prompt template for master mode. */
  peerReviewPromptTemplate?: string;
  /** Global default synthesis prompt template for master mode. */
  masterSynthesisPromptTemplate?: string;
  /** Local session scanner rolling window in days. */
  localUsageWindowDays: number;
  /** Maximum number of sessions returned per provider for local usage telemetry. */
  localUsageMaxSessions: number;
  /** Minimum number of seconds between local usage telemetry refreshes. */
  localUsageRefreshMinSecs: number;
  /** CodexBar integration mode for local usage telemetry. */
  codexBarMode: "off" | "auto" | "prefer";
  /** Base root folder for per-space workspace folders. */
  spacesRoot: string;
  /** Include full payload bodies in per-space workspace event logs. */
  workspaceLogDebug: boolean;
  /** Default sharing identity mode for space joins. */
  shareIdentityMode: "device_key" | "strict_apple_id";
  /** Allow device-key fallback when strict Apple ID mode is enabled. */
  shareAllowDeviceKeyFallback: boolean;
  /** Optional relay base URL used to emit v2 invite links. */
  shareRelayBaseUrl?: string;
  /** Optional fallback direct gateway URL in relay invite envelopes. */
  shareFallbackGatewayUrl?: string;
  /** Allow in-memory persistence fallback when DB initialization fails (embedded dev only). */
  allowPersistenceFallback: boolean;
  /** Master freeze gate toggle for architecture-hardening constraints. */
  archFreezeEnforced: boolean;
  /** Enables collaboration changeset APIs/services. */
  collabChangesetsEnabled: boolean;
  /** Requires staged writes for collaborative file changes. */
  requireStagedWrites: boolean;
  /** Enables relay v2 sharing payloads and join-route context. */
  relayShareV2Enabled: boolean;
  /** Minimum relay success-rate threshold used for health/SLO reporting. */
  relaySloMinSuccessRate: number;
  /** Minimum sample size before relay success-rate SLO is evaluated. */
  relaySloMinSamples: number;
  /** Marks relay subsystem unhealthy when the success-rate SLO is breached. */
  relaySloEnforce: boolean;
  /** Enables sandbox runtime backend routing for risky operations. */
  sandboxRuntimeEnabled: boolean;
  /** Optional module path used to load a sandbox runtime adapter. */
  sandboxRuntimeModule?: string;
  /** Allows sandbox-routed operations to pass through host execution when no runtime adapter is available. */
  sandboxAllowHostPassthrough: boolean;
  /** Minimum sandbox success-rate threshold used for health/SLO reporting. */
  sandboxSloMinSuccessRate: number;
  /** Minimum sample size before sandbox success-rate SLO is evaluated. */
  sandboxSloMinSamples: number;
  /** Marks sandbox subsystem unhealthy when the success-rate SLO is breached. */
  sandboxSloEnforce: boolean;
  /** Enables v2 effective-tool policy resolver flow. */
  toolPolicyV2Enabled: boolean;
  /** Enables spaces-admin MCP control facade. */
  mainAdminMcpEnabled: boolean;
  /** Enables gateway main-agent swap APIs and mutation flow. */
  mainAgentSwapEnabled: boolean;
  /** Enables startup/runtime auto-repair for missing main-agent assignment/profile state. */
  mainAgentAutoRepairEnabled: boolean;
  /** Enables deterministic usage-session replacement on runtime swaps. */
  agentSessionReplacementEnabled: boolean;
  /** Maximum milliseconds to drain in-flight connections on shutdown. Default: 10000. */
  drainTimeoutMs: number;
  /** Maximum agent-to-agent delegation hops. Default: 5. */
  maxAgentHops: number;
  /** Maximum WebSocket message payload in bytes. Default: 1MB. */
  maxMessageSize: number;
  /** If true, skip WebSocket authentication (development/embedded only). */
  skipAuth: boolean;
  /**
   * Allowed CORS origins for HTTP responses.
   * Use `["*"]` for dev. Empty = reject cross-origin.
   */
  allowedOrigins: string[];
  /**
   * When true, sync endpoints require a non-empty x-spaceskit-sync-secret header.
   * Default: true for external profile, false for embedded.
   */
  syncRequireSecret: boolean;
  /** HTTP rate limit: max requests per minute per IP. Default: 120. */
  httpRateLimitRpm: number;
  /** Maximum concurrent WebSocket connections per IP. Default: 10. */
  maxConnectionsPerIp: number;
  /** Whether A2A task endpoints require Authorization: Bearer <token>. Default: true. */
  a2aRequireAuth: boolean;
  /** Maximum number of tracked A2A tasks before returning 429. Default: 1000. */
  a2aTaskMax: number;
  /** A2A task TTL in milliseconds — tasks older than this are evicted. Default: 3600000 (1 hour). */
  a2aTaskTtlMs: number;
  /**
   * If true, HTTP REST/MCP surfaces require signed HS256 bearer tokens for principal identity.
   * Defaults to true for external profile when an HS256 secret is configured.
   */
  httpPrincipalAuthStrict: boolean;
  /** Shared secret used to verify signed HTTP principal bearer tokens. */
  httpPrincipalAuthHs256Secret?: string;
  /** Allowed clock skew, in seconds, when validating signed HTTP principal bearer claims. */
  httpPrincipalAuthMaxClockSkewSeconds: number;
}

export function loadConfig(): GatewayConfig {
  const port = parseInt(Bun.env.SPACESKIT_PORT ?? "9320", 10);
  const { profile: gatewayProfile, profileSource } = resolveGatewayProfile(
    Bun.env.SPACESKIT_GATEWAY_PROFILE,
    port,
  );
  const gatewayProfileLabel = gatewayProfile === "external" ? "External" : "Embedded";
  const defaultMainSpaceId = gatewayProfile === "external" ? "external-main-space" : "main-space";
  const defaultMainResourceId = gatewayProfile === "external" ? "resource:external" : "resource:main";
  const defaultDbPath = gatewayProfile === "external" ? "./gateway-external.db" : "./gateway.db";
  const defaultMainSpaceName = `${gatewayProfileLabel} Main Space`;
  const mainSpaceId = Bun.env.SPACESKIT_MAIN_SPACE_ID ?? Bun.env.SPACESKIT_MASTER_SPACE_ID ?? defaultMainSpaceId;
  const mainSpaceName = Bun.env.SPACESKIT_MAIN_SPACE_NAME
    ?? Bun.env.SPACESKIT_MASTER_SPACE_NAME
    ?? defaultMainSpaceName;
  const mainSpaceResourceId = Bun.env.SPACESKIT_MAIN_RESOURCE_ID
    ?? Bun.env.SPACESKIT_MASTER_RESOURCE_ID
    ?? defaultMainResourceId;
  const mainSpaceGoal = Bun.env.SPACESKIT_MAIN_SPACE_GOAL
    ?? Bun.env.SPACESKIT_MASTER_SPACE_GOAL
    ?? "Default shared space for gateway startup and orchestrator coordination.";
  const mainProfileId = Bun.env.SPACESKIT_MAIN_PROFILE_ID ?? Bun.env.SPACESKIT_MASTER_PROFILE_ID ?? "main-profile";
  const mainOrchestratorProfileId = Bun.env.SPACESKIT_MAIN_ORCHESTRATOR_PROFILE_ID
    ?? mainProfileId;
  const mainAgentId = Bun.env.SPACESKIT_MAIN_AGENT_ID ?? Bun.env.SPACESKIT_MASTER_AGENT_ID ?? "main-agent";
  const gatewayCapabilityGrants = parseCsvEnv(Bun.env.SPACESKIT_GATEWAY_CAPABILITY_GRANTS);
  const externalByDefault = gatewayProfile === "external";
  const enableWhatsappConnectorFamily = parseBooleanEnv(
    Bun.env.SPACESKIT_ENABLE_WHATSAPP_CONNECTOR_FAMILY,
    externalByDefault,
  );
  const enableDiscordConnectorFamily = parseBooleanEnv(
    Bun.env.SPACESKIT_ENABLE_DISCORD_CONNECTOR_FAMILY,
    externalByDefault,
  );
  const heartbeatIntervalCandidate = parseOptionalNumberEnv(Bun.env.SPACESKIT_HEARTBEAT_INTERVAL_MS);
  const heartbeatIntervalMs = heartbeatIntervalCandidate !== undefined && heartbeatIntervalCandidate >= 0
    ? Math.floor(heartbeatIntervalCandidate)
    : 30_000;
  const masterModeEnabled = parseBooleanEnv(Bun.env.SPACESKIT_MASTER_MODE_ENABLED, true);
  const masterPlannerPromptTemplate = parseOptionalStringEnv(
    Bun.env.SPACESKIT_MASTER_PLANNER_PROMPT_TEMPLATE,
  );
  const guestAgentPromptTemplate = parseOptionalStringEnv(
    Bun.env.SPACESKIT_GUEST_AGENT_PROMPT_TEMPLATE,
  );
  const peerReviewPromptTemplate = parseOptionalStringEnv(
    Bun.env.SPACESKIT_PEER_REVIEW_PROMPT_TEMPLATE,
  );
  const masterSynthesisPromptTemplate = parseOptionalStringEnv(
    Bun.env.SPACESKIT_MASTER_SYNTHESIS_PROMPT_TEMPLATE,
  );
  const dbPath = Bun.env.SPACESKIT_DB_PATH ?? defaultDbPath;
  const resolvedDbRoot = resolveDbRootFolder(dbPath);
  const spacesRoot = parseOptionalStringEnv(Bun.env.SPACESKIT_SPACES_ROOT)
    ?? defaultSpacesRootForHost(gatewayProfile, resolvedDbRoot);
  const workspaceLogDebug = parseBooleanEnv(Bun.env.SPACESKIT_WORKSPACE_LOG_DEBUG, false);
  const shareIdentityMode = parseSharingIdentityMode(Bun.env.SPACESKIT_SHARE_IDENTITY_MODE);
  const shareAllowDeviceKeyFallback = parseBooleanEnv(
    Bun.env.SPACESKIT_SHARE_ALLOW_DEVICE_KEY_FALLBACK,
    true,
  );
  const shareRelayBaseUrl = parseOptionalStringEnv(Bun.env.SPACESKIT_SHARE_RELAY_URL);
  const shareFallbackGatewayUrl = parseOptionalStringEnv(Bun.env.SPACESKIT_SHARE_FALLBACK_GATEWAY_URL);
  const allowPersistenceFallback = parseBooleanEnv(
    Bun.env.SPACESKIT_ALLOW_PERSISTENCE_FALLBACK,
    false,
  );
  const archFreezeEnforced = parseBooleanEnv(Bun.env.SPACESKIT_ARCH_FREEZE_ENFORCED, true);
  const collabChangesetsEnabled = parseBooleanEnv(Bun.env.SPACESKIT_COLLAB_CHANGESETS, false);
  const requireStagedWrites = parseBooleanEnv(Bun.env.SPACESKIT_REQUIRE_STAGED_WRITES, true);
  const relayShareV2Enabled = parseBooleanEnv(Bun.env.SPACESKIT_RELAY_SHARE_V2, true);
  const relaySloMinSuccessRate = clampFraction(
    parseOptionalNumberEnv(Bun.env.SPACESKIT_RELAY_SLO_MIN_SUCCESS_RATE) ?? 0.99,
    0.99,
  );
  const relaySloMinSamples = Math.max(
    1,
    Math.floor(parseOptionalNumberEnv(Bun.env.SPACESKIT_RELAY_SLO_MIN_SAMPLES) ?? 50),
  );
  const relaySloEnforce = parseBooleanEnv(
    Bun.env.SPACESKIT_RELAY_SLO_ENFORCE,
    gatewayProfile === "external",
  );
  const sandboxRuntimeEnabled = parseBooleanEnv(Bun.env.SPACESKIT_SANDBOX_RUNTIME, false);
  const sandboxRuntimeModule = parseOptionalStringEnv(Bun.env.SPACESKIT_SANDBOX_RUNTIME_MODULE);
  const sandboxAllowHostPassthrough = parseBooleanEnv(
    Bun.env.SPACESKIT_SANDBOX_ALLOW_HOST_PASSTHROUGH,
    false,
  );
  const sandboxSloMinSuccessRate = clampFraction(
    parseOptionalNumberEnv(Bun.env.SPACESKIT_SANDBOX_SLO_MIN_SUCCESS_RATE) ?? 0.99,
    0.99,
  );
  const sandboxSloMinSamples = Math.max(
    1,
    Math.floor(parseOptionalNumberEnv(Bun.env.SPACESKIT_SANDBOX_SLO_MIN_SAMPLES) ?? 50),
  );
  const sandboxSloEnforce = parseBooleanEnv(
    Bun.env.SPACESKIT_SANDBOX_SLO_ENFORCE,
    gatewayProfile === "external",
  );
  const toolPolicyV2Enabled = parseBooleanEnv(Bun.env.SPACESKIT_TOOL_POLICY_V2, false);
  const mainAdminMcpEnabled = parseBooleanEnv(Bun.env.SPACESKIT_MAIN_ADMIN_MCP, false);
  const mainAgentSwapEnabled = parseBooleanEnv(Bun.env.SPACESKIT_MAIN_AGENT_SWAP_V1, true);
  const mainAgentAutoRepairEnabled = parseBooleanEnv(Bun.env.SPACESKIT_MAIN_AGENT_AUTO_REPAIR, true);
  const agentSessionReplacementEnabled = parseBooleanEnv(
    Bun.env.SPACESKIT_AGENT_SESSION_REPLACEMENT_V1,
    true,
  );
  const localUsageWindowDays = Math.max(
    1,
    Math.floor(parseOptionalNumberEnv(Bun.env.SPACESKIT_LOCAL_USAGE_WINDOW_DAYS) ?? 30),
  );
  const localUsageMaxSessions = Math.max(
    1,
    Math.floor(parseOptionalNumberEnv(Bun.env.SPACESKIT_LOCAL_USAGE_MAX_SESSIONS) ?? 10),
  );
  const localUsageRefreshMinSecs = Math.max(
    0,
    Math.floor(parseOptionalNumberEnv(Bun.env.SPACESKIT_LOCAL_USAGE_REFRESH_MIN_SECS) ?? 60),
  );
  const codexBarMode = parseCodexBarMode(Bun.env.SPACESKIT_CODEXBAR_MODE);
  const httpPrincipalAuthStrictEnv = parseOptionalBooleanEnv(
    Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT,
  );
  const httpPrincipalAuthHs256Secret = parseOptionalStringEnv(
    Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET,
  );
  const httpPrincipalAuthStrict = httpPrincipalAuthStrictEnv
    ?? (gatewayProfile === "external" && Boolean(httpPrincipalAuthHs256Secret));
  const httpPrincipalAuthMaxClockSkewSeconds = Math.max(
    0,
    Math.floor(
      parseOptionalNumberEnv(Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_MAX_CLOCK_SKEW_SECONDS)
      ?? 60,
    ),
  );

  return {
    port,
    host: Bun.env.SPACESKIT_HOST ?? "127.0.0.1",
    dbPath,
    logLevel: (Bun.env.SPACESKIT_LOG_LEVEL ?? "info") as GatewayConfig["logLevel"],
    heartbeatIntervalMs,
    runtimeGeneration: Bun.env.SPACESKIT_GENERATION ?? "v2_2026_02_21",
    modelProvider: Bun.env.SPACESKIT_MODEL_PROVIDER,
    defaultModelId: Bun.env.SPACESKIT_MODEL,
    apiKey: Bun.env.SPACESKIT_API_KEY,
  enableAppleFoundationProvider: parseBooleanEnv(
      Bun.env.SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER,
      hostSupportsAppleFoundationProvider(),
    ),
    mcpEndpoint: Bun.env.MCP_ENDPOINT,
    mem0ApiKey: Bun.env.MEM0_API_KEY,
    lettaBaseUrl: Bun.env.LETTA_BASE_URL,
    lettaApiKey: Bun.env.LETTA_API_KEY,
    logFilePath: Bun.env.SPACESKIT_LOG_FILE,
    enableTracing: Bun.env.SPACESKIT_TRACING !== "false",
    enableResilience: Bun.env.SPACESKIT_RESILIENCE !== "false",
    requestsPerMinute: parseInt(Bun.env.SPACESKIT_RATE_LIMIT ?? "60", 10),
    healthDebug: parseBooleanEnv(Bun.env.SPACESKIT_HEALTH_DEBUG, false),
    mainSpaceId,
    mainSpaceName,
    mainSpaceResourceId,
    mainSpaceGoal,
    mainProfileId,
    mainOrchestratorProfileId,
    mainAgentId,
    gatewayProfile,
    profileSource,
    gatewayCapabilityGrants,
    enableWhatsappConnectorFamily,
    enableDiscordConnectorFamily,
    masterModeEnabled,
    masterPlannerPromptTemplate,
    guestAgentPromptTemplate,
    peerReviewPromptTemplate,
    masterSynthesisPromptTemplate,
    localUsageWindowDays,
    localUsageMaxSessions,
    localUsageRefreshMinSecs,
    codexBarMode,
    spacesRoot,
    workspaceLogDebug,
    shareIdentityMode,
    shareAllowDeviceKeyFallback,
    shareRelayBaseUrl,
    shareFallbackGatewayUrl,
    allowPersistenceFallback,
    archFreezeEnforced,
    collabChangesetsEnabled,
    requireStagedWrites,
    relayShareV2Enabled,
    relaySloMinSuccessRate,
    relaySloMinSamples,
    relaySloEnforce,
    sandboxRuntimeEnabled,
    sandboxRuntimeModule,
    sandboxAllowHostPassthrough,
    sandboxSloMinSuccessRate,
    sandboxSloMinSamples,
    sandboxSloEnforce,
    toolPolicyV2Enabled,
    mainAdminMcpEnabled,
    mainAgentSwapEnabled,
    mainAgentAutoRepairEnabled,
    agentSessionReplacementEnabled,
    drainTimeoutMs: parseInt(Bun.env.SPACESKIT_DRAIN_TIMEOUT_MS ?? "10000", 10),
    maxAgentHops: parseInt(Bun.env.SPACESKIT_MAX_AGENT_HOPS ?? "5", 10),
    maxMessageSize: parseInt(Bun.env.SPACESKIT_MAX_MESSAGE_SIZE ?? String(1 * 1024 * 1024), 10),
    skipAuth: parseBooleanEnv(Bun.env.SPACESKIT_SKIP_AUTH, false),
    allowedOrigins: parseCsvEnv(Bun.env.SPACESKIT_ALLOWED_ORIGINS),
    syncRequireSecret: parseBooleanEnv(Bun.env.SPACESKIT_SYNC_REQUIRE_SECRET, gatewayProfile === "external"),
    httpRateLimitRpm: parseInt(Bun.env.SPACESKIT_HTTP_RATE_LIMIT ?? "120", 10),
    maxConnectionsPerIp: parseInt(Bun.env.SPACESKIT_MAX_CONNECTIONS_PER_IP ?? "10", 10),
    a2aRequireAuth: parseBooleanEnv(Bun.env.SPACESKIT_A2A_REQUIRE_AUTH, true),
    a2aTaskMax: parseInt(Bun.env.SPACESKIT_A2A_TASK_MAX ?? "1000", 10),
    a2aTaskTtlMs: parseInt(Bun.env.SPACESKIT_A2A_TASK_TTL_MS ?? "3600000", 10),
    httpPrincipalAuthStrict,
    httpPrincipalAuthHs256Secret,
    httpPrincipalAuthMaxClockSkewSeconds,
  };
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function parseOptionalBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return undefined;
}

function parseOptionalNumberEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return undefined;
  return normalized;
}

function parseOptionalStringEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function clampFraction(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function parseSharingIdentityMode(value: string | undefined): "device_key" | "strict_apple_id" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "strict_apple_id") return "strict_apple_id";
  return "device_key";
}

function parseVoiceSourceEnv(value: string | undefined): VoiceProviderSource | undefined {
  const normalized = value?.trim();
  switch (normalized) {
    case "managed":
    case "byok":
    case "local_model":
    case "apple_speech":
      return normalized;
    default:
      return undefined;
  }
}

function parseCodexBarMode(value: string | undefined): "off" | "auto" | "prefer" {
  switch (value?.trim().toLowerCase()) {
    case "off":
      return "off";
    case "prefer":
      return "prefer";
    case "auto":
    default:
      return "auto";
  }
}

interface AppleFoundationAvailability {
  available: boolean;
  reason: string;
}

function hostSupportsAppleFoundationProvider(
  platform: string = process.platform,
  arch: string = process.arch,
): boolean {
  return platform === "darwin" && arch === "arm64";
}

async function probeAppleFoundationAvailability(
  logger: Logger,
  enabled: boolean,
): Promise<AppleFoundationAvailability> {
  if (!enabled) {
    return {
      available: false,
      reason: "SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER is disabled.",
    };
  }

  if (!hostSupportsAppleFoundationProvider()) {
    return {
      available: false,
      reason: `Apple Foundation Models require darwin/arm64. Current host: ${process.platform}/${process.arch}.`,
    };
  }

  try {
    const runtime = await import("@meridius-labs/apple-on-device-ai");
    return await runtime.appleAISDK.checkAvailability();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("Apple Foundation availability probe failed", { reason });
    return {
      available: false,
      reason,
    };
  }
}

function resolveDbRootFolder(dbPath: string): string | undefined {
  const normalized = dbPath.trim();
  if (!normalized || normalized === ":memory:") {
    return undefined;
  }

  const absoluteDbPath = resolve(normalized);
  return dirname(absoluteDbPath);
}

function defaultSpacesRootForHost(
  gatewayProfile: GatewayCoreProfileId,
  databaseRootFolder?: string,
): string {
  if (process.platform === "darwin" && gatewayProfile === "embedded") {
    return resolve(homedir(), "Documents", "Spaces");
  }
  return resolve(databaseRootFolder ?? ".", "spaces");
}

function gatewayUuidSeed(config: GatewayConfig): string {
  return [
    config.mainSpaceResourceId,
    config.dbPath,
    config.host,
    String(config.port),
  ].join("|");
}

function loadOrCreateGatewayUuid(db: DatabaseManager, seed: string): string {
  db.db.exec(
    `CREATE TABLE IF NOT EXISTS gateway_runtime_metadata (
      singleton_id INTEGER PRIMARY KEY,
      gateway_uuid TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );

  const existing = db.db
    .query("SELECT gateway_uuid FROM gateway_runtime_metadata WHERE singleton_id = 1")
    .get() as { gateway_uuid?: string } | null;

  const existingUuid = normalizeUuid(existing?.gateway_uuid);
  if (existingUuid) {
    return existingUuid;
  }

  const gatewayUuid = deterministicUuid(seed, "spaceskit.gateway.uuid");
  db.db.query(
    `INSERT INTO gateway_runtime_metadata(singleton_id, gateway_uuid, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(singleton_id)
     DO UPDATE SET gateway_uuid = excluded.gateway_uuid, updated_at = excluded.updated_at`,
  ).run(gatewayUuid, new Date().toISOString());
  return gatewayUuid;
}

interface EnsureMainDefaultsResult {
  profile: "created" | "restored" | "reused";
  space: "created" | "reused";
  assignment: "created" | "updated" | "reused";
  orchestrator: "updated" | "reused" | "skipped";
}

interface EnsureMainSpaceSystemSkillsResult {
  seeded: number;
  attached: number;
}

interface MainProfileRuntimeSelection {
  providerHint: string;
  modelHint: string;
}

function resolveMainProfileRuntimeSelection(
  config: GatewayConfig,
  providerConfigs: Pick<PublicProviderRuntimeConfig, "providerId" | "model">[],
): MainProfileRuntimeSelection {
  const configuredProviderHint = config.modelProvider?.trim() ?? "";
  const configuredModelHint = config.defaultModelId?.trim() ?? "";
  if (configuredProviderHint && configuredModelHint) {
    const configuredProviderAvailable = providerConfigs.some((entry) =>
      entry.providerId.trim().toLowerCase() === configuredProviderHint.toLowerCase(),
    );
    if (configuredProviderAvailable) {
      return {
        providerHint: configuredProviderHint,
        modelHint: configuredModelHint,
      };
    }
  }

  const firstAvailable = providerConfigs.find((entry) => {
    return Boolean(entry.providerId?.trim()) && Boolean(entry.model?.trim());
  });
  if (firstAvailable) {
    return {
      providerHint: firstAvailable.providerId.trim(),
      modelHint: firstAvailable.model.trim(),
    };
  }

  return {
    providerHint: "",
    modelHint: "",
  };
}

async function ensureMainDefaults(
  config: GatewayConfig,
  logger: Logger,
  profileRepo: ProfileRepository | null,
  spaceAdminService: SpaceAdminService,
  runtimeSelection: MainProfileRuntimeSelection,
): Promise<EnsureMainDefaultsResult | null> {
  if (!profileRepo) {
    logger.warn("Skipping main defaults bootstrap: profile persistence unavailable");
    return null;
  }

  let profileStatus: EnsureMainDefaultsResult["profile"] = "reused";
  let spaceStatus: EnsureMainDefaultsResult["space"] = "reused";
  let assignmentStatus: EnsureMainDefaultsResult["assignment"] = "reused";
  let orchestratorStatus: EnsureMainDefaultsResult["orchestrator"] = "reused";
  const profileLabel = config.gatewayProfile === "external" ? "External" : "Embedded";

  const existingProfile = profileRepo.getById(config.mainProfileId);
  if (!existingProfile) {
    profileRepo.create({
      profileId: config.mainProfileId,
      name: `${profileLabel} Main Agent`,
      description: `Default ${config.gatewayProfile} gateway startup profile for the main agent.`,
      canModerate: true,
      personalityPrompt: `You are the default ${config.gatewayProfile} main gateway agent. Coordinate spaces clearly and safely.`,
      providerHint: runtimeSelection.providerHint,
      modelHint: runtimeSelection.modelHint,
    });
    profileStatus = "created";
  } else if (existingProfile.archived === 1) {
    profileRepo.restore(config.mainProfileId);
    profileStatus = "restored";
  }

  const desiredOrchestratorProfileId = config.mainOrchestratorProfileId || config.mainProfileId;
  const orchestratorProfile = profileRepo.getById(desiredOrchestratorProfileId);
  if (!orchestratorProfile || orchestratorProfile.archived === 1) {
    logger.warn("Configured orchestrator profile is unavailable; falling back to main profile", {
      configuredProfileId: desiredOrchestratorProfileId,
      fallbackProfileId: config.mainProfileId,
    });
    orchestratorStatus = "skipped";
  }
  const effectiveOrchestratorProfileId = (!orchestratorProfile || orchestratorProfile.archived === 1)
    ? config.mainProfileId
    : desiredOrchestratorProfileId;

  const existingSpace = await spaceAdminService.getSpace(config.mainSpaceId);
  if (!existingSpace) {
    await spaceAdminService.createSpace({
      spaceId: config.mainSpaceId,
      resourceId: config.mainSpaceResourceId,
      spaceType: "main",
      name: config.mainSpaceName,
      goal: config.mainSpaceGoal,
      turnModel: "sequential_all",
      visibility: "shared",
      initialAgents: [
        {
          agentId: config.mainAgentId,
          profileId: config.mainProfileId,
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        },
      ],
    });
    spaceStatus = "created";
    assignmentStatus = "created";
  } else {
    const existingAssignment = existingSpace.agents.find(
      (assignment) => assignment.agentId === config.mainAgentId,
    );

    if (!existingAssignment) {
      await spaceAdminService.addAgent({
        spaceId: config.mainSpaceId,
        agentId: config.mainAgentId,
        profileId: config.mainProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      });
      assignmentStatus = "created";
    } else {
      const needsUpdate =
        existingAssignment.profileId !== config.mainProfileId
        || existingAssignment.role !== "global_coordinator"
        || existingAssignment.turnOrder !== 0
        || !existingAssignment.isPrimary;

      if (needsUpdate) {
        await spaceAdminService.updateAgentAssignment({
          spaceId: config.mainSpaceId,
          agentId: config.mainAgentId,
          profileId: config.mainProfileId,
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        });
        assignmentStatus = "updated";
      }
    }
  }

  const refreshedMainSpace = await spaceAdminService.getSpace(config.mainSpaceId);
  if (!refreshedMainSpace) {
    throw new Error(`Failed to load main space after bootstrap: ${config.mainSpaceId}`);
  }
  if (refreshedMainSpace.orchestratorProfileId !== effectiveOrchestratorProfileId) {
    await spaceAdminService.setSpaceOrchestrator({
      spaceId: config.mainSpaceId,
      profileId: effectiveOrchestratorProfileId,
    });
    orchestratorStatus = "updated";
  }

  return {
    profile: profileStatus,
    space: spaceStatus,
    assignment: assignmentStatus,
    orchestrator: orchestratorStatus,
  };
}

async function ensureMainSpaceSystemSkills(
  config: GatewayConfig,
  logger: Logger,
  spaceAdminService: SpaceAdminService,
  gatewaySkillCatalogService: GatewaySkillCatalogService | null,
): Promise<EnsureMainSpaceSystemSkillsResult> {
  if (!gatewaySkillCatalogService) {
    logger.warn("Skipping main-space skill seed: gateway skill catalog service unavailable");
    return { seeded: 0, attached: 0 };
  }

  let seeded = 0;
  for (const skill of MAIN_SPACE_SYSTEM_SKILLS) {
    gatewaySkillCatalogService.upsertSkill({
      skillId: skill.skillId,
      name: skill.name,
      description: skill.description,
      contentMarkdown: skill.contentMarkdown,
      sourceRef: skill.sourceRef,
      tags: skill.tags,
      status: skill.status,
    });
    seeded += 1;
  }

  let attached = 0;
  for (const skillId of MAIN_SPACE_SYSTEM_SKILL_IDS) {
    await spaceAdminService.addSkillToSpace({
      spaceId: config.mainSpaceId,
      skillId,
    });
    attached += 1;
  }

  return {
    seeded,
    attached,
  };
}

// ---------------------------------------------------------------------------
// Startup security helpers
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERNS = ["key", "secret", "password", "token"] as const;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

function redactSensitiveValue(value: unknown): string {
  const str = String(value);
  if (str.length <= 4) return "****";
  return "*".repeat(str.length - 4) + str.slice(-4);
}

function logConfigSummary(config: GatewayConfig, logger: Logger): void {
  const entries = Object.entries(config as unknown as Record<string, unknown>);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (isSensitiveKey(key) && value !== undefined && value !== null && value !== "") {
      redacted[key] = redactSensitiveValue(value);
    } else {
      redacted[key] = value;
    }
  }
  logger.info("Resolved gateway configuration", redacted);
}

function enforceStartupEnvValidation(config: GatewayConfig, logger: Logger): void {
  // Log resolved config for all profiles (secrets are redacted)
  logConfigSummary(config, logger);

  if (config.gatewayProfile !== "external") return;

  const errors: string[] = [];

  // Validate port range
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push(`Invalid port: ${config.port} (must be 1–65535)`);
  }

  // Validate host is present
  if (!config.host || config.host.trim() === "") {
    errors.push("SPACESKIT_HOST must be set for external profile");
  }

  if (errors.length > 0) {
    for (const err of errors) {
      logger.error(`Startup env validation failed: ${err}`);
    }
    throw new Error(`Startup env validation failed for external profile:\n${errors.join("\n")}`);
  }
}

function enforceTransportPolicy(config: GatewayConfig, logger: Logger): void {
  const noisePublicKey = Bun.env.SPACESKIT_NOISE_PUBLIC_KEY?.trim();
  const noisePrivateKey = Bun.env.SPACESKIT_NOISE_PRIVATE_KEY?.trim();

  const rawOverride = Bun.env.SPACESKIT_ENFORCE_TRANSPORT_POLICY;
  const enforcementOverride: boolean | undefined =
    rawOverride === "true" ? true : rawOverride === "false" ? false : undefined;

  const input: TransportPolicyInput = {
    host: config.host,
    port: config.port,
    gatewayProfile: config.gatewayProfile,
    noiseEnabled: Boolean(noisePublicKey && noisePrivateKey),
    enforcementOverride,
  };

  const result = evaluateTransportPolicy(input);

  if (result.denied) {
    logger.error(result.details);
    throw new Error(result.details);
  }

  if (result.posture === "plaintext_denied") {
    logger.warn(result.details + " — enforcement disabled, proceeding with caution");
  }
}

function acquireDbExclusiveLock(db: DatabaseManager, dbPath: string, logger: Logger): void {
  try {
    // Attempt an exclusive transaction — if another writer holds the lock this will throw
    db.db.exec("BEGIN EXCLUSIVE; COMMIT;");
    logger.info("Database lock acquired", { dbPath });
  } catch (err) {
    const message = "Another gateway process is using this database — refusing to start to prevent multi-writer corruption";
    logger.error(message, { error: String(err) });
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export interface GatewayInstance {
  config: GatewayConfig;
  logger: Logger;
  eventBus: EventBus;
  capabilities: CapabilityRegistry;
  middleware: MiddlewarePipeline;
  spaceManager: SpaceManager;
  spaceAdminService: SpaceAdminService;
  gatewayAdminService: DefaultGatewayAdminService;
  connectorAdminService: ConnectorAdminService | null;
  memoryRegistry: MemoryProviderRegistry;
  notificationService: NotificationService;
  checkpointManager: CheckpointManager | null;
  deadLetterQueue: DeadLetterQueue | null;
  modelRouter: ModelRouter | null;
  pluginSystem: PluginSystem;
  agentVersionManager: AgentVersionManager;
  configReloader: ConfigHotReloader<GatewayConfig> | null;
  db: DatabaseManager | null;
  server: GatewayServer | null;
  shutdown: () => Promise<void>;
}

/**
 * Initialize and start the gateway. Returns a handle for programmatic control.
 */
export async function startGateway(
  configOverride?: Partial<GatewayConfig>,
): Promise<GatewayInstance> {
  const config = { ...loadConfig(), ...configOverride };
  const databaseRootFolder = resolveDbRootFolder(config.dbPath);
  const resolvedSpacesRoot = resolve(
    normalizeOptionalString(config.spacesRoot)
      ?? defaultSpacesRootForHost(config.gatewayProfile, databaseRootFolder),
  );
  config.spacesRoot = resolvedSpacesRoot;
  const resolvedGatewayUuidSeed = gatewayUuidSeed(config);
  let gatewayUuid = deterministicUuid(resolvedGatewayUuidSeed, "spaceskit.gateway.uuid");

  const logger = new Logger({
    minLevel: config.logLevel,
    module: "gateway",
    output: config.logFilePath
      ? createFileOutput({ filePath: config.logFilePath, tee: true })
      : undefined,
  });

  logger.info("Starting Spaceskit", {
    port: config.port,
    host: config.host,
    dbPath: config.dbPath,
    spacesRoot: config.spacesRoot,
    generation: config.runtimeGeneration,
    gatewayProfile: config.gatewayProfile,
    healthDebug: config.healthDebug,
    startupCapabilityGrants: config.gatewayCapabilityGrants,
    runtime: `Bun ${Bun.version}`,
  });

  // P0: Block skipAuth on external (production) profile
  if (config.skipAuth && config.gatewayProfile === "external") {
    logger.error(
      "CRITICAL: skipAuth is enabled on an external (production) gateway profile. " +
      "This is a severe security misconfiguration. Set SPACESKIT_SKIP_AUTH=false or " +
      "change SPACESKIT_GATEWAY_PROFILE to embedded for local development.",
      { gatewayProfile: config.gatewayProfile, skipAuth: config.skipAuth },
    );
    throw new Error(
      "Startup aborted: skipAuth=true is not permitted with gatewayProfile=external. " +
      "Remove SPACESKIT_SKIP_AUTH=true before starting in production.",
    );
  }
  if (config.httpPrincipalAuthStrict && !config.httpPrincipalAuthHs256Secret) {
    logger.error(
      "CRITICAL: strict HTTP principal verification is enabled without an HS256 secret. " +
      "Set SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET before enabling strict mode.",
      {
        httpPrincipalAuthStrict: config.httpPrincipalAuthStrict,
      },
    );
    throw new Error(
      "Startup aborted: SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT=true requires " +
      "SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET.",
    );
  }
  if (config.gatewayProfile === "external" && !config.httpPrincipalAuthStrict) {
    logger.warn(
      "HTTP principal verification strict mode is disabled for external profile. " +
      "Legacy principal header/bearer compatibility remains enabled.",
      {
        gatewayProfile: config.gatewayProfile,
        httpPrincipalAuthStrict: config.httpPrincipalAuthStrict,
      },
    );
  }

  // ---- Startup security checks ----
  enforceStartupEnvValidation(config, logger);
  enforceTransportPolicy(config, logger);

  const configuredGrants = capabilityGrantsFromIds(config.gatewayCapabilityGrants, "startup_config");
  let gatewayCoreState = createGatewayCoreState({ profileId: config.gatewayProfile });
  let appliedCapabilityGrants: string[] = [];
  let skippedCapabilityGrants: string[] = [];
  let invalidCapabilityGrants: string[] = configuredGrants.invalid;

  // ---- Core subsystems ----
  const eventBus = new EventBus();
  const capabilities = new CapabilityRegistry(eventBus);
  const executionAdapterFactory = new ExecutionAdapterFactory();

  // ---- Database ----
  let db: DatabaseManager | null = null;
  let spaceRepo: SpaceRepository | null = null;
  let spaceAssignmentRepo: SpaceAgentAssignmentRepository | null = null;
  let spaceMcpEndpointRepo: SpaceMcpEndpointRepository | null = null;
  let spaceExternalAgentBindingRepo: SpaceExternalAgentBindingRepository | null = null;
  let spaceResourceRepo: SpaceResourceRepository | null = null;
  let spaceWorkspaceRepo: SpaceWorkspaceRepository | null = null;
  let spaceSkillRepo: SpaceSkillRepository | null = null;
  let artifactRepo: ArtifactRepository | null = null;
  let spaceLinkRepo: SpaceLinkRepository | null = null;
  let spaceContextTransferRepo: SpaceContextTransferRepository | null = null;
  let spaceShareInviteRepo: SpaceShareInviteRepository | null = null;
  let spaceParticipantRepo: SpaceParticipantRepository | null = null;
  let spaceChangeSetRepo: SpaceChangeSetRepository | null = null;
  let spaceChangeSetFileRepo: SpaceChangeSetFileRepository | null = null;
  let spaceChangeSetReviewRepo: SpaceChangeSetReviewRepository | null = null;
  let spaceQuotaPolicyRepo: SpaceQuotaPolicyRepository | null = null;
  let participantQuotaPolicyRepo: ParticipantQuotaPolicyRepository | null = null;
  let spaceUsageCounterRepo: SpaceUsageCounterRepository | null = null;
  let participantUsageCounterRepo: ParticipantUsageCounterRepository | null = null;
  let spaceToolPolicyRepo: SpaceToolPolicyRepository | null = null;
  let spaceTemplateRepo: SpaceTemplateRepository | null = null;
  let spacePresetApplicationRepo: SpacePresetApplicationRepository | null = null;
  let orchestrationJournalRepo: OrchestrationJournalRepository | null = null;
  let eventLogRepo: EventLogRepository | null = null;
  let agentUsageSessionRepo: AgentUsageSessionRepository | null = null;
  let deviceIdentityRepo: DeviceIdentityRepository | null = null;
  let orchestratorCommandRepo: OrchestratorCommandRepository | null = null;
  let schedulerJobRepo: SchedulerJobRepository | null = null;
  let schedulerJobSpaceRepo: SchedulerJobSpaceRepository | null = null;
  let schedulerJobRunRepo: SchedulerJobRunRepository | null = null;
  let idempotencyRepo: IdempotencyRepository | null = null;
  let gatewayPolicyRepo: GatewayPolicyRepository | null = null;
  let auditEventsRepo: AuditEventsRepository | null = null;
  let connectorFamilyRepo: ConnectorFamilyRepository | null = null;
  let connectorInstanceRepo: ConnectorInstanceRepository | null = null;
  let connectorBindingRepo: ConnectorBindingRepository | null = null;
  let connectorPolicyRepo: ConnectorPolicyRepository | null = null;
  let connectorSecretRefRepo: ConnectorSecretRefRepository | null = null;
  let providerConfigRepo: ProviderConfigRepository | null = null;
  let providerSecretRefRepo: ProviderSecretRefRepository | null = null;
  let knowledgeBaseRepo: KnowledgeBaseEntryRepository | null = null;
  let gatewaySkillCatalogRepo: GatewaySkillCatalogRepository | null = null;
  let gatewayCapabilityGrantRepo: GatewayCapabilityGrantRepository | null = null;
  let syncRuntimeRepo: SyncRuntimeRepository | null = null;
  let turnRepo: TurnRepository | null = null;
  let runRepo: RunRepository | null = null;
  let runStepRepo: RunStepRepository | null = null;
  let invocationRecordRepo: InvocationRecordRepository | null = null;
  let approvalRequestRepo: ApprovalRequestRepository | null = null;
  let usageRecordRepo: UsageRecordRepository | null = null;
  let integrationRequestRepo: IntegrationRequestRepository | null = null;
  let usageRepo: UsageAnalyticsRepository | null = null;
  let voiceUsageRepo: VoiceUsageRepository | null = null;
  let profileRepo: ProfileRepository | null = null;
  let experienceRepo: ExperienceRepository | null = null;
  let agentPresetRepo: AgentPresetRepository | null = null;
  let spaceWorkspaceService: SpaceWorkspaceService | null = null;
  let spaceTurnTraceService: SpaceTurnTraceService | null = null;
  let spaceArtifactService: SpaceArtifactService | null = null;
  let runtimeLedgerService: RuntimeLedgerService | null = null;

  try {
    db = initDatabase({
      path: config.dbPath,
      runtimeGeneration: config.runtimeGeneration,
    });

    acquireDbExclusiveLock(db, config.dbPath, logger);

    if (db.generationResetInfo) {
      logger.warn("Runtime generation changed — ephemeral data cleared", {
        from: db.generationResetInfo.previousGeneration,
        to: db.generationResetInfo.newGeneration,
      });
    }

    gatewayUuid = loadOrCreateGatewayUuid(db, resolvedGatewayUuidSeed);

    spaceRepo = new SpaceRepository(db.db);
    spaceAssignmentRepo = new SpaceAgentAssignmentRepository(db.db);
    spaceMcpEndpointRepo = new SpaceMcpEndpointRepository(db.db);
    spaceExternalAgentBindingRepo = new SpaceExternalAgentBindingRepository(db.db);
    spaceResourceRepo = new SpaceResourceRepository(db.db);
    spaceWorkspaceRepo = new SpaceWorkspaceRepository(db.db);
    spaceSkillRepo = new SpaceSkillRepository(db.db);
    artifactRepo = new ArtifactRepository(db.db);
    spaceLinkRepo = new SpaceLinkRepository(db.db);
    spaceContextTransferRepo = new SpaceContextTransferRepository(db.db);
    spaceShareInviteRepo = new SpaceShareInviteRepository(db.db);
    spaceParticipantRepo = new SpaceParticipantRepository(db.db);
    spaceChangeSetRepo = new SpaceChangeSetRepository(db.db);
    spaceChangeSetFileRepo = new SpaceChangeSetFileRepository(db.db);
    spaceChangeSetReviewRepo = new SpaceChangeSetReviewRepository(db.db);
    spaceQuotaPolicyRepo = new SpaceQuotaPolicyRepository(db.db);
    participantQuotaPolicyRepo = new ParticipantQuotaPolicyRepository(db.db);
    spaceUsageCounterRepo = new SpaceUsageCounterRepository(db.db);
    participantUsageCounterRepo = new ParticipantUsageCounterRepository(db.db);
    spaceToolPolicyRepo = new SpaceToolPolicyRepository(db.db);
    spaceTemplateRepo = new SpaceTemplateRepository(db.db);
    spacePresetApplicationRepo = new SpacePresetApplicationRepository(db.db);
    orchestrationJournalRepo = new OrchestrationJournalRepository(db.db);
    eventLogRepo = new EventLogRepository(db.db);
    agentUsageSessionRepo = new AgentUsageSessionRepository(db.db);
    deviceIdentityRepo = new DeviceIdentityRepository(db.db);
    orchestratorCommandRepo = new OrchestratorCommandRepository(db.db);
    schedulerJobRepo = new SchedulerJobRepository(db.db);
    schedulerJobSpaceRepo = new SchedulerJobSpaceRepository(db.db);
    schedulerJobRunRepo = new SchedulerJobRunRepository(db.db);
    idempotencyRepo = new IdempotencyRepository(db.db);
    gatewayPolicyRepo = new GatewayPolicyRepository(db.db);
    auditEventsRepo = new AuditEventsRepository(db.db);
    connectorFamilyRepo = new ConnectorFamilyRepository(db.db);
    connectorInstanceRepo = new ConnectorInstanceRepository(db.db);
    connectorBindingRepo = new ConnectorBindingRepository(db.db);
    connectorPolicyRepo = new ConnectorPolicyRepository(db.db);
    connectorSecretRefRepo = new ConnectorSecretRefRepository(db.db);
    providerConfigRepo = new ProviderConfigRepository(db.db);
    providerSecretRefRepo = new ProviderSecretRefRepository(db.db);
    knowledgeBaseRepo = new KnowledgeBaseEntryRepository(db.db);
    gatewaySkillCatalogRepo = new GatewaySkillCatalogRepository(db.db);
    gatewayCapabilityGrantRepo = new GatewayCapabilityGrantRepository(db.db);
    syncRuntimeRepo = new SyncRuntimeRepository(db.db);
    turnRepo = new TurnRepository(db.db);
    runRepo = new RunRepository(db.db);
    runStepRepo = new RunStepRepository(db.db);
    invocationRecordRepo = new InvocationRecordRepository(db.db);
    approvalRequestRepo = new ApprovalRequestRepository(db.db);
    usageRecordRepo = new UsageRecordRepository(db.db);
    integrationRequestRepo = new IntegrationRequestRepository(db.db);
    usageRepo = new UsageAnalyticsRepository(db.db);
    voiceUsageRepo = new VoiceUsageRepository(db.db);
    profileRepo = new ProfileRepository(db.db);
    experienceRepo = new ExperienceRepository(db.db);
    agentPresetRepo = new AgentPresetRepository(db.db);

    runtimeLedgerService = new RuntimeLedgerService({
      runs: runRepo,
      runSteps: runStepRepo,
      invocationRecords: invocationRecordRepo,
      approvalRequests: approvalRequestRepo,
      usageRecords: usageRecordRepo,
      classifyIntegrationClass: (providerId?: string) => executionAdapterFactory.classify(providerId ?? "openai"),
    });

    const journalCutoffIso = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString();
    const startupPruned = orchestrationJournalRepo.pruneBefore(journalCutoffIso);
    if (startupPruned > 0) {
      logger.info("Pruned orchestration journal entries on startup", { deleted: startupPruned });
    }

    logger.info("Database initialized");
  } catch (err) {
    const errMsg = String(err instanceof Error ? err.message : err);
    if (errMsg.includes("Another gateway process is using this database")) {
      throw err;
    }
    const fallbackAllowed = config.gatewayProfile === "embedded" && config.allowPersistenceFallback;
    if (!fallbackAllowed) {
      logger.error(
        "Database initialization failed and persistence fallback is disabled for this gateway profile",
        err,
      );
      throw err instanceof Error
        ? err
        : new Error("Database initialization failed and persistence fallback is disabled");
    }
    logger.warn(
      "Database initialization failed — continuing without persistence because SPACESKIT_ALLOW_PERSISTENCE_FALLBACK=true",
      { error: err instanceof Error ? err.message : String(err) },
    );
  }

  spaceWorkspaceService = (
    spaceRepo
    && spaceResourceRepo
    && spaceWorkspaceRepo
  )
    ? new SpaceWorkspaceService({
      spaces: spaceRepo,
      resources: spaceResourceRepo,
      workspaces: spaceWorkspaceRepo,
      spacesRoot: config.spacesRoot,
      logger: logger.child({ module: "space-workspace" }),
      debugEventPayloads: config.workspaceLogDebug,
    })
    : null;
  if (spaceWorkspaceService) {
    logger.info("Space workspace service initialized", {
      spacesRoot: spaceWorkspaceService.getSpacesRoot(),
      layoutVersion: 1,
      debugEventPayloads: config.workspaceLogDebug,
    });
    eventBus.onAny((event) => {
      const spaceId = normalizeOptionalString((event as Record<string, unknown>).spaceId);
      if (!spaceId) return;
      void spaceWorkspaceService!.appendSpaceEventLog(spaceId, event as Record<string, unknown>);
    });
  }

  // ---- Middleware pipeline ----
  const middleware = new MiddlewarePipeline();

  // Validation (order 1 — runs first)
  middleware.use(createValidationMiddleware({}));

  // Context window management
  const getContextWindowSize = (modelId?: string): number => {
    const normalizedModelId = modelId?.trim().toLowerCase();
    if (normalizedModelId?.startsWith("lmstudio/")) {
      // Conservative local default to avoid LM Studio Bad Request crashes.
      return 8_192;
    }
    // Preserve existing large default for hosted/cloud providers.
    return 128_000;
  };
  middleware.use(createContextWindowMiddleware({
    eventBus,
    getContextWindowSize,
  }));

  // Security
  middleware.use(createSecurityMiddleware({ eventBus }));

  if (spaceWorkspaceService) {
    middleware.use({
      name: "workspace-guard",
      layer: "capability",
      order: 35,
      process: async (ctx, next) => {
        const invocation = isRecord(ctx.input) ? ctx.input : null;
        const capability = normalizeOptionalString(invocation?.capability);
        if (capability !== "files" && capability !== "filesystem") {
          await next();
          return;
        }

        const spaceId = normalizeOptionalString(ctx.spaceId);
        const agentId = normalizeOptionalString(ctx.agentId);
        if (!spaceId || !agentId) {
          await next();
          return;
        }

        const args = isRecord(invocation?.args) ? invocation!.args : {};
        const operation = normalizeOptionalString(invocation?.operation) ?? "";
        const normalizedCapability = capability === "filesystem" ? "files" : capability;
        const operationMetadata = resolveCapabilityOperationMetadata(
          capabilities as unknown as Record<string, unknown>,
          {
            capability: normalizedCapability,
            operation,
            args,
            targetProvider: normalizeOptionalString(args.targetProvider),
          },
          spaceId,
        );
        if (!operationMetadata.filesystemWrite) {
          await next();
          return;
        }
        const pathArgs = operationMetadata.pathArgs ?? [];
        if (pathArgs.length === 0) {
          ctx.terminate = true;
          ctx.output = {
            code: "FAILED_PRECONDITION",
            message: `filesystem write metadata must declare pathArgs: ${capability}.${operation}`,
            retryable: false,
            errorType: "WorkspaceGuard",
            tool: `${capability}.${operation}`,
          };
          return;
        }

        const workspace = await spaceWorkspaceService.ensureWorkspace(spaceId);
        const ownScratchpadPath = await spaceWorkspaceService.getAgentScratchpadPath(spaceId, agentId);
        const candidatePaths = collectFilesystemPathCandidatesByKeys(args, pathArgs)
          .map((rawPath) => normalizeCandidatePath(rawPath, args.cwd))
          .filter((path): path is string => Boolean(path));
        if (candidatePaths.length === 0) {
          ctx.terminate = true;
          ctx.output = {
            code: "FAILED_PRECONDITION",
            message: `filesystem write operation requires at least one declared path argument: ${capability}.${operation}`,
            retryable: false,
            errorType: "WorkspaceGuard",
            tool: `${capability}.${operation}`,
          };
          return;
        }

        for (const candidatePath of candidatePaths) {
          if (isPathWithinScope(candidatePath, workspace.sharedContextPath)) {
            if (!candidatePath.toLowerCase().endsWith(".md")) {
              ctx.terminate = true;
              ctx.output = {
                code: "FAILED_PRECONDITION",
                message: `shared-context writes must target .md files: ${candidatePath}`,
                retryable: false,
                errorType: "WorkspaceGuard",
                tool: `${capability}.${operation}`,
              };
              return;
            }
          }

          if (isPathWithinScope(candidatePath, workspace.scratchpadsPath)) {
            if (resolve(candidatePath) !== resolve(ownScratchpadPath)) {
              ctx.terminate = true;
              ctx.output = {
                code: "FAILED_PRECONDITION",
                message: `scratchpad writes are restricted to ${ownScratchpadPath}`,
                retryable: false,
                errorType: "WorkspaceGuard",
                tool: `${capability}.${operation}`,
              };
              return;
            }
          }
        }

        await next();
      },
    });
  }

  // Secrets detection (capability layer — scans tool inputs/outputs)
  middleware.use(createSecretsMiddleware({ eventBus }));

  // Audit logging
  middleware.use(createAuditMiddleware({ eventBus }));

  // Tracing (optional)
  if (config.enableTracing) {
    const tracingMiddleware = createTracingMiddleware({
      enabled: true,
      onSpanEnd: (span) => {
        logger.debug("Trace span", {
          operation: span.operationType,
          service: span.serviceName,
          duration: span.durationMs,
          error: span.error,
        });
      },
    });
    for (const mw of tracingMiddleware) {
      middleware.use(mw);
    }
  }

  // Resilience: rate limiting + circuit breaker (optional)
  if (config.enableResilience) {
    middleware.use(createResilienceMiddleware({
      requestsPerMinute: config.requestsPerMinute ?? 60,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 30_000,
    }));
  }

  // Budget enforcement — reads policy from DB, tracks spend in-memory
  if (db && usageRepo) {
    const estimateCost = (inputTokens: number, outputTokens: number): number =>
      (inputTokens / 1000) * 0.003 + (outputTokens / 1000) * 0.015;

    middleware.use(createBudgetMiddleware({
      eventBus,
      loadPolicy: async () => {
        const row = db!.db.prepare(
          "SELECT soft_cap_usd, hard_cap_usd, warning_threshold FROM usage_budget_policy WHERE singleton_id = 1",
        ).get() as { soft_cap_usd: number; hard_cap_usd: number; warning_threshold: number } | null;

        if (row) {
          return {
            softCapUsd: row.soft_cap_usd,
            hardCapUsd: row.hard_cap_usd,
            warningThreshold: row.warning_threshold,
          };
        }
        // Default generous limits if no policy row exists
        return { softCapUsd: 20.0, hardCapUsd: 50.0, warningThreshold: 0.8 };
      },
      loadState: async () => {
        const aggregate = usageRepo!.aggregateTokens();
        return {
          totalSpentUsd: estimateCost(
            aggregate.inputTokens,
            aggregate.outputTokens,
          ),
        };
      },
      updateState: async (additionalCostUsd: number) => {
        // Persistence-backed usage is calculated from completed turns. Keep this
        // hook as a no-op to satisfy middleware contract without memory drift.
        void additionalCostUsd;
      },
    }));
    logger.info("Budget middleware wired with persistence");
  }

  logger.info("Middleware pipeline configured", {
    middleware: middleware.list().map((m: Middleware) => `${m.name}(${m.layer}:${m.order})`),
  });

  // ---- Memory providers ----
  const memoryRegistry = new MemoryProviderRegistry();

  // Default: Experience-based memory (SQLite + FTS5)
  if (db) {
    const experienceMemory = new ExperienceMemoryProvider({ db: db.db });
    memoryRegistry.register(experienceMemory);
    memoryRegistry.setDefault(experienceMemory.id);
    logger.info("Memory provider registered: ExperienceMemory (default)");
  }

  // Mem0 (optional — requires MEM0_API_KEY)
  if (config.mem0ApiKey) {
    try {
      const mem0 = new Mem0Provider({ apiKey: config.mem0ApiKey });
      await mem0.initialize();
      memoryRegistry.register(mem0);
      logger.info("Memory provider registered: Mem0");
    } catch (err) {
      logger.warn("Mem0 provider failed to initialize — skipping", err as Record<string, unknown>);
    }
  }

  // Letta (optional — requires LETTA_BASE_URL)
  if (config.lettaBaseUrl) {
    try {
      const letta = new LettaProvider({
        baseURL: config.lettaBaseUrl,
        apiKey: config.lettaApiKey,
      });
      await letta.initialize();
      memoryRegistry.register(letta);
      logger.info("Memory provider registered: Letta");
    } catch (err) {
      logger.warn("Letta provider failed to initialize — skipping", err as Record<string, unknown>);
    }
  }

  // ---- Notification service ----
  const notificationService = new DefaultNotificationService({ eventBus });
  logger.info("Notification service initialized");

  // ---- Checkpoint manager ----
  let checkpointManager: SQLiteCheckpointManager | null = null;
  if (db) {
    checkpointManager = new SQLiteCheckpointManager(db.db);
    logger.info("Checkpoint manager initialized");
  }

  // ---- Dead letter queue ----
  let deadLetterQueue: SQLiteDeadLetterQueue | null = null;
  if (db) {
    deadLetterQueue = new SQLiteDeadLetterQueue(db.db);
    logger.info("Dead letter queue initialized");
  }

  // ---- Platform introspection tools (definitions are static; executor/filter deferred until spaceAdminService is created) ----
  const platformToolDefinitions = createPlatformToolDefinitions();
  const gatewayStartedAt = new Date();

  // ---- Tool executor ----
  const toolExecutor = new DefaultToolExecutor({
    capabilityRegistry: capabilities,
    eventBus,
    middleware,
    injectedToolDefinitions: platformToolDefinitions,
    injectedToolExecutor: async (name, args, ctx) => {
      const executor = createPlatformToolExecutor({
        spaceAdminService,
        capabilityRegistry: capabilities,
        turnRepo: turnRepo ?? null,
        profileRepo: profileRepo ?? null,
        startedAt: gatewayStartedAt,
      });
      return executor(name, args, ctx);
    },
    injectedToolFilter: async (spaceId, agentId) => {
      const filter = createPlatformToolFilter(spaceAdminService);
      return filter(spaceId, agentId);
    },
    resolveSecurityScope: async (spaceId: string, agentId: string): Promise<AgentSecurityScope> => {
      const space = await spaceAdminService.getSpace(spaceId);
      const assignment = space?.agents.find((entry) => entry.agentId === agentId);
      const assignmentScope = assignment?.securityScope;
      const workspace = spaceWorkspaceService
        ? await spaceWorkspaceService.ensureWorkspace(spaceId).catch(() => null)
        : null;
      const resources = await spaceAdminService.listResources(spaceId).catch(() => []);
      const resourceFolderScopes = resources
        .filter((resource) => resource.type === "folder")
        .map((resource) => fileUriToFilesystemPath(resource.uri))
        .filter((value): value is string => Boolean(value));

      const mergedFilesystemScopes = uniqueStrings([
        ...extractFilesystemScopes(assignmentScope),
        ...resourceFolderScopes,
        ...(workspace ? [workspace.effectiveWorkspaceRoot] : []),
      ]);

      return {
        ...DEFAULT_AGENT_SCOPE,
        ...assignmentScope,
        agentId,
        allowedCapabilities: uniqueStrings(assignmentScope?.allowedCapabilities ?? []),
        commandAllowlist: uniqueStrings(assignmentScope?.commandAllowlist ?? []),
        filesystemScope: mergedFilesystemScopes[0] ?? assignmentScope?.filesystemScope ?? DEFAULT_AGENT_SCOPE.filesystemScope,
        ...(mergedFilesystemScopes.length > 0
          ? { filesystemScopes: mergedFilesystemScopes }
          : {}),
      };
    },
  });

  // ---- Model provider + router ----
  let modelRouter: ModelRouter | null = null as ModelRouter | null;

  // Initialize the default model runtime from env config
  if (config.modelProvider && config.defaultModelId) {
    try {
      const modelProvider = executionAdapterFactory.createModelProvider({
        providerId: config.modelProvider,
        model: config.defaultModelId,
        apiKey: config.apiKey,
      });
      modelRouter = new ModelRouter(modelProvider, config.defaultModelId);
      logger.info("Model router initialized", {
        provider: config.modelProvider,
        model: config.defaultModelId,
      });
    } catch (err) {
      logger.warn("Model provider initialization failed — turn execution will require manual setup", err as Record<string, unknown>);
    }
  }

  // ---- Plugin system ----
  const pluginSystem = new PluginSystem({
    eventBus,
    capabilityRegistry: capabilities,
    maxPluginTimeoutMs: 30_000,
  });
  logger.info("Plugin system initialized");

  // ---- Agent version manager ----
  const agentVersionManager = new AgentVersionManager({
    eventBus,
    loadRevision: async (profileId: string, revision: number) => {
      if (!profileRepo) return null;
      interface RevisionRow {
        profile_id: string;
        revision: number;
        personality_prompt?: string;
        default_skill_set_ids_json?: string;
        provider_hint?: string;
        model_hint?: string;
        model_config_json?: string;
        source?: string;
      }
      const row = db!.db.prepare(`
        SELECT * FROM agent_profile_revisions WHERE profile_id = ? AND revision = ?
      `).get(profileId, revision) as RevisionRow | null;
      if (!row) return null;
      return {
        profileId: row.profile_id,
        revision: row.revision,
        personalityPrompt: row.personality_prompt ?? "",
        defaultSkillIds: gatewayPolicyService
          ? gatewayPolicyService.filterSkillIds((() => {
            try {
              return JSON.parse(row.default_skill_set_ids_json ?? "[]");
            } catch {
              return [];
            }
          })())
          : (() => {
            try {
              return JSON.parse(row.default_skill_set_ids_json ?? "[]");
            } catch {
              return [];
            }
          })(),
        providerHint: row.provider_hint ?? "",
        modelHint: firstPreferredModelFromConfig(row.model_config_json) ?? row.model_hint ?? "",
        source: row.source ?? "manual",
        resolvedAt: new Date(),
      };
    },
    loadActiveRevision: async (profileId: string) => {
      if (!profileRepo) return null;
      const rev = profileRepo.getActiveRevision(profileId);
      if (!rev) return null;
      return {
        profileId: rev.profile_id,
        revision: rev.revision,
        personalityPrompt: rev.personality_prompt ?? "",
        defaultSkillIds: gatewayPolicyService
          ? gatewayPolicyService.filterSkillIds((() => {
            try {
              return JSON.parse(rev.default_skill_set_ids_json ?? "[]");
            } catch {
              return [];
            }
          })())
          : (() => {
            try {
              return JSON.parse(rev.default_skill_set_ids_json ?? "[]");
            } catch {
              return [];
            }
          })(),
        providerHint: rev.provider_hint ?? "",
        modelHint: firstPreferredModelFromConfig(rev.model_config_json) ?? rev.model_hint ?? "",
        source: rev.source ?? "manual",
        resolvedAt: new Date(),
      };
    },
  });
  logger.info("Agent version manager initialized");

  // ---- Config hot-reload (optional — watches config file) ----
  let configReloader: ConfigHotReloader<GatewayConfig> | null = null;
  const configFilePath = Bun.env.SPACESKIT_CONFIG_FILE;
  if (configFilePath) {
    configReloader = new ConfigHotReloader<GatewayConfig>({
      initialConfig: config,
      eventBus,
      file: {
        path: configFilePath,
        pollInterval: parseInt(Bun.env.SPACESKIT_CONFIG_POLL_MS ?? "5000", 10),
      },
      signal: { enabled: true, filePath: configFilePath },
    });

    configReloader.onConfigChange((event: ConfigChangeEvent<GatewayConfig>) => {
      logger.info("Configuration reloaded", { mode: event.mode });
      // Apply runtime-safe config changes (rate limits, budget caps)
      if (config.enableResilience && event.newValue.requestsPerMinute !== config.requestsPerMinute) {
        logger.info("Rate limit updated", { newLimit: event.newValue.requestsPerMinute });
      }
    });

    await configReloader.start();
    logger.info("Config hot-reload enabled", { path: configFilePath });
  }

  // ---- Space admin service ----
  const protectedMainSpaceSkillIds = new Set(MAIN_SPACE_SYSTEM_SKILL_IDS);
  const spaceAdminService = new SpaceAdminService({
    createSpaceRow: async (input) => {
      if (!spaceRepo) {
        throw new Error("Space persistence unavailable");
      }

      const row = spaceRepo.create({
        spaceId: input.spaceId,
        resourceId: input.resourceId,
        spaceType: input.spaceType,
        name: input.name,
        goal: input.goal,
        turnModel: input.turnModel,
        configJson: input.configJson,
        templateId: input.templateId,
        templateRevision: input.templateRevision,
      });

      return {
        spaceId: row.space_id,
        resourceId: row.resource_id,
        spaceType: row.space_type,
        name: row.name,
        goal: row.goal,
        status: row.status,
        turnModel: row.turn_model,
        spaceConfigJson: row.space_config_json,
        templateId: row.template_id,
        templateRevision: row.template_revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    getSpaceRow: async (spaceId) => {
      if (!spaceRepo) return null;
      const row = spaceRepo.getById(spaceId);
      if (!row) return null;
      return {
        spaceId: row.space_id,
        resourceId: row.resource_id,
        spaceType: row.space_type,
        name: row.name,
        goal: row.goal,
        status: row.status,
        turnModel: row.turn_model,
        spaceConfigJson: row.space_config_json,
        templateId: row.template_id,
        templateRevision: row.template_revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    listSpaceRows: async (query) => {
      if (!spaceRepo) return [];
      return spaceRepo.list({
        statuses: query.statuses,
        resourceId: query.resourceId,
        limit: query.limit,
      }).map((row) => ({
        spaceId: row.space_id,
        resourceId: row.resource_id,
        spaceType: row.space_type,
        name: row.name,
        goal: row.goal,
        status: row.status,
        turnModel: row.turn_model,
        spaceConfigJson: row.space_config_json,
        templateId: row.template_id,
        templateRevision: row.template_revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    updateSpaceConfigJson: async (spaceId, configJson) => {
      if (!spaceRepo) {
        throw new Error("Space persistence unavailable");
      }
      spaceRepo.updateConfig(spaceId, configJson);
    },
    profileExists: async (profileId) => {
      if (!profileRepo) return false;
      return profileRepo.getById(profileId) !== undefined;
    },
    profileArchived: async (profileId) => {
      if (!profileRepo) return true;
      const row = profileRepo.getById(profileId);
      if (!row) return true;
      return row.archived === 1;
    },
    profileCanModerate: async (profileId) => {
      if (!profileRepo) return false;
      const row = profileRepo.getById(profileId);
      if (!row) return false;
      return row.archived === 0 && row.can_moderate === 1;
    },

    getAssignmentRow: async (spaceId, agentId) => {
      if (!spaceAssignmentRepo) return null;
      const row = spaceAssignmentRepo.get(spaceId, agentId);
      if (!row) return null;
      return {
        spaceId: row.space_id,
        agentId: row.agent_id,
        profileId: row.profile_id,
        securityScopeJson: row.security_scope_json,
        spawnContext: row.spawn_context,
        contextOverridesJson: row.context_overrides_json,
        role: row.role,
        turnOrder: row.turn_order,
        isPrimary: row.is_primary,
        assignedAt: row.assigned_at,
        updatedAt: row.updated_at,
      };
    },
    listAssignmentRows: async (spaceId) => {
      if (!spaceAssignmentRepo) return [];
      return spaceAssignmentRepo.listBySpace(spaceId).map((row) => ({
        spaceId: row.space_id,
        agentId: row.agent_id,
        profileId: row.profile_id,
        securityScopeJson: row.security_scope_json,
        spawnContext: row.spawn_context,
        contextOverridesJson: row.context_overrides_json,
        role: row.role,
        turnOrder: row.turn_order,
        isPrimary: row.is_primary,
        assignedAt: row.assigned_at,
        updatedAt: row.updated_at,
      }));
    },
    upsertAssignmentRow: async (input) => {
      if (!spaceAssignmentRepo) {
        throw new Error("Assignment persistence unavailable");
      }
      const row = spaceAssignmentRepo.upsert({
        spaceId: input.spaceId,
        agentId: input.agentId,
        profileId: input.profileId,
        securityScopeJson: input.securityScopeJson ?? null,
        spawnContext: input.spawnContext ?? null,
        contextOverridesJson: input.contextOverridesJson ?? null,
        role: input.role,
        turnOrder: input.turnOrder,
        isPrimary: input.isPrimary,
        assignedAt: input.assignedAt,
      });
      return {
        spaceId: row.space_id,
        agentId: row.agent_id,
        profileId: row.profile_id,
        securityScopeJson: row.security_scope_json,
        spawnContext: row.spawn_context,
        contextOverridesJson: row.context_overrides_json,
        role: row.role,
        turnOrder: row.turn_order,
        isPrimary: row.is_primary,
        assignedAt: row.assigned_at,
        updatedAt: row.updated_at,
      };
    },
    deleteAssignmentRow: async (spaceId, agentId) => {
      if (!spaceAssignmentRepo) return false;
      return spaceAssignmentRepo.delete(spaceId, agentId);
    },
    listSpaceSkillRows: async (spaceId) => {
      if (!spaceSkillRepo) return [];
      return spaceSkillRepo.listBySpace(spaceId).map((row) => ({
        spaceId: row.space_id,
        skillId: row.skill_id,
        addedAt: row.added_at,
      }));
    },
    upsertSpaceSkillRow: async (input) => {
      if (!spaceSkillRepo) {
        throw new Error("Space skill persistence unavailable");
      }
      const row = spaceSkillRepo.upsert({
        spaceId: input.spaceId,
        skillId: input.skillId,
        addedAt: input.addedAt,
      });
      return {
        spaceId: row.space_id,
        skillId: row.skill_id,
        addedAt: row.added_at,
      };
    },
    deleteSpaceSkillRow: async (spaceId, skillId) => {
      if (!spaceSkillRepo) return false;
      return spaceSkillRepo.delete(spaceId, skillId);
    },
    isProtectedSpaceSkill: async (spaceId, skillId) => {
      const normalizedSpaceId = spaceId.trim();
      const normalizedSkillId = skillId.trim();
      if (!normalizedSpaceId || !normalizedSkillId) return false;
      return normalizedSpaceId === config.mainSpaceId && protectedMainSpaceSkillIds.has(normalizedSkillId);
    },
    listSpaceResourceRows: async (spaceId) => {
      if (!spaceResourceRepo) return [];
      return spaceResourceRepo.listBySpace(spaceId).map((row) => ({
        resourceId: row.resource_id,
        spaceId: row.space_id,
        uri: row.uri,
        type: row.type,
        label: row.label,
        addedAt: row.added_at,
      }));
    },
    upsertSpaceResourceRow: async (input) => {
      if (!spaceResourceRepo) {
        throw new Error("Space resource persistence unavailable");
      }
      const row = spaceResourceRepo.upsert({
        resourceId: input.resourceId,
        spaceId: input.spaceId,
        uri: input.uri,
        type: input.type as "folder" | "url",
        label: input.label,
        addedAt: input.addedAt,
      });
      return {
        resourceId: row.resource_id,
        spaceId: row.space_id,
        uri: row.uri,
        type: row.type,
        label: row.label,
        addedAt: row.added_at,
      };
    },
    deleteSpaceResourceRow: async (spaceId, resourceId) => {
      if (!spaceResourceRepo) return false;
      return spaceResourceRepo.delete(spaceId, resourceId);
    },
    reservedSpaceResourceIdPrefixes: [SPACE_WORKSPACE_MANAGED_RESOURCE_PREFIX],
    isProtectedSpaceResource: async (spaceId, resourceId) => {
      if (!spaceWorkspaceService) return false;
      await spaceWorkspaceService.ensureWorkspace(spaceId);
      return spaceWorkspaceService.isManagedWorkspaceResource(spaceId, resourceId);
    },
    loadIdempotencyRecord: async (principalId, endpoint, idempotencyKey) => {
      if (!idempotencyRepo) return null;
      const row = idempotencyRepo.get(principalId, endpoint, idempotencyKey);
      if (!row) return null;
      return {
        requestHash: row.request_hash,
        responseType: row.response_type,
        responsePayload: row.response_payload,
      };
    },
    saveIdempotencyRecord: async (record) => {
      if (!idempotencyRepo) return;
      idempotencyRepo.put({
        principalId: record.principalId,
        endpoint: record.endpoint,
        idempotencyKey: record.idempotencyKey,
        requestHash: record.requestHash,
        responseType: record.responseType,
        responsePayload: record.responsePayload,
      });
    },
    idempotencyPrincipalId: "gateway-space-admin",
  });
  logger.info("Space admin service initialized");

  // Master-key enforcement: external profile requires SPACESKIT_SECRET_REF_MASTER_KEY
  if (config.gatewayProfile === "external" && !Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY?.trim()) {
    logger.error("CRITICAL: SPACESKIT_SECRET_REF_MASTER_KEY is required for external gateway profile but is not set");
    throw new Error("SPACESKIT_SECRET_REF_MASTER_KEY is required for external gateway profile");
  }

  const providerSecretRefService = providerSecretRefRepo
    ? new ProviderSecretRefService({
      repository: providerSecretRefRepo,
      logger: logger.child({ module: "provider-secret-refs" }),
      masterKey: Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY,
    })
    : undefined;

  const spaceMcpService = new SpaceMcpService({
    capabilities,
    spaceAdminService,
    profileRepo,
    endpointRepo: spaceMcpEndpointRepo,
    bindingRepo: spaceExternalAgentBindingRepo,
    providerSecretRefService,
    gatewayProfile: config.gatewayProfile,
    logger: logger.child({ module: "space-mcp" }),
    globalFallback: config.mcpEndpoint
      ? {
        transport: config.mcpEndpoint.startsWith("http") ? "sse" : "stdio",
        endpoint: config.mcpEndpoint,
        secretRef: Bun.env.SPACESKIT_MCP_SECRET_REF,
      }
      : undefined,
  });
  try {
    await spaceMcpService.initialize();
  } catch (err) {
    logger.warn("Space MCP service initialization failed", err as Record<string, unknown>);
  }

  const appleFoundationAvailability = await probeAppleFoundationAvailability(
    logger.child({ module: "apple-foundation-provider" }),
    config.enableAppleFoundationProvider,
  );

  const gatewayAdminService = new DefaultGatewayAdminService({
    logger: logger.child({ module: "gateway-admin" }),
    profileRepo,
    spaceAdminService,
    mainSpaceId: config.mainSpaceId,
    mainSpaceName: config.mainSpaceName,
    mainSpaceResourceId: config.mainSpaceResourceId,
    mainSpaceGoal: config.mainSpaceGoal,
    mainProfileId: config.mainProfileId,
    mainAgentId: config.mainAgentId,
    mainAgentSwapEnabled: config.mainAgentSwapEnabled,
    mainAgentAutoRepairEnabled: config.mainAgentAutoRepairEnabled,
    providerSecretRefService,
    providerConfigRepo: providerConfigRepo ?? undefined,
    integrationRequestRepo: integrationRequestRepo ?? undefined,
    gatewayProfile: config.gatewayProfile,
    defaultProviderId: config.modelProvider,
    defaultModelId: config.defaultModelId,
    defaultApiKey: config.apiKey,
    enableAppleFoundationProvider: config.enableAppleFoundationProvider,
    appleFoundationAvailability,
  });
  logger.info("Gateway admin service initialized");

  const seededProviders = gatewayAdminService.listProviderConfigs();
  if (seededProviders.length === 0) {
    logger.warn(
      "No execution credentials or local runtimes detected. Agent runs will fail. " +
      "Set OPENROUTER_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, or MISTRAL_API_KEY, or configure a supported CLI/local runtime.",
    );
  }

  const connectorAdminService = connectorFamilyRepo
    && connectorInstanceRepo
    && connectorBindingRepo
    && connectorPolicyRepo
    && connectorSecretRefRepo
    ? new ConnectorAdminService({
      logger: logger.child({ module: "connector-admin" }),
      gatewayProfile: config.gatewayProfile,
      familyRepo: connectorFamilyRepo,
      instanceRepo: connectorInstanceRepo,
      bindingRepo: connectorBindingRepo,
      policyRepo: connectorPolicyRepo,
      secretRefRepo: connectorSecretRefRepo,
      auditRepo: auditEventsRepo,
      defaultTargetSpaceId: config.mainSpaceId,
      enableWhatsappFamily: config.enableWhatsappConnectorFamily,
      enableDiscordFamily: config.enableDiscordConnectorFamily,
    })
    : null;
  if (connectorAdminService) {
    logger.info("Connector admin service initialized", {
      profile: config.gatewayProfile,
    });
  }

  const profileAdminService = profileRepo
    ? {
      createProfile: async (input: {
        profileId?: string;
        name: string;
        description?: string;
        personalityPrompt?: string;
        defaultSkillIds?: string[];
        providerHint?: string;
        modelHint?: string;
        modelConfig?: { preferredModels: string[]; fallbackModels?: string[]; constraints?: Record<string, unknown> };
        canModerate?: boolean;
        isDefault?: boolean;
      }) => {
        const profileId = input.profileId?.trim() || `profile-${crypto.randomUUID()}`;
        const existing = profileRepo.getById(profileId);
        if (existing) {
          throw { code: "ALREADY_EXISTS", message: `Profile already exists: ${profileId}` };
        }

        const created = profileRepo.create({
          profileId,
          name: input.name.trim(),
          description: input.description,
          personalityPrompt: input.personalityPrompt,
          defaultSkillIds: input.defaultSkillIds,
          providerHint: input.providerHint,
          modelHint: input.modelHint,
          modelConfig: normalizeProfileModelConfig(input.modelConfig, input.modelHint),
          canModerate: input.canModerate,
          isDefault: input.isDefault,
        });
        const revision = profileRepo.getActiveRevision(profileId);
        return {
          created: true,
          profile: toProfileSummaryPayload(created, revision),
        };
      },
      getProfile: async (profileId: string) => {
        const row = profileRepo.getById(profileId);
        if (!row) return null;
        const revision = profileRepo.getActiveRevision(profileId);
        return toProfileSummaryPayload(row, revision);
      },
      listProfiles: async (includeArchived?: boolean) => {
        return profileRepo
          .list({ includeArchived })
          .map((row) => toProfileSummaryPayload(row, profileRepo.getActiveRevision(row.profile_id)));
      },
      updateProfile: async (input: {
        profileId: string;
        name?: string;
        description?: string;
        personalityPrompt?: string;
        defaultSkillIds?: string[];
        providerHint?: string;
        modelHint?: string;
        modelConfig?: { preferredModels: string[]; fallbackModels?: string[]; constraints?: Record<string, unknown> };
        canModerate?: boolean;
        isDefault?: boolean;
      }) => {
        const existing = profileRepo.getById(input.profileId);
        if (!existing) {
          throw { code: "NOT_FOUND", message: `Profile not found: ${input.profileId}` };
        }

        const updated = profileRepo.update({
          profileId: input.profileId,
          name: input.name,
          description: input.description,
          personalityPrompt: input.personalityPrompt,
          defaultSkillIds: input.defaultSkillIds,
          providerHint: input.providerHint,
          modelHint: input.modelHint,
          modelConfig: normalizeProfileModelConfig(input.modelConfig, input.modelHint),
          canModerate: input.canModerate,
          isDefault: input.isDefault,
          source: "manual",
        });

        return {
          profile: toProfileSummaryPayload(updated.profile, updated.revision),
          newRevision: updated.revision.revision,
        };
      },
      archiveProfile: async (profileId: string) => {
        const existing = profileRepo.getById(profileId);
        if (!existing) {
          throw { code: "NOT_FOUND", message: `Profile not found: ${profileId}` };
        }

        profileRepo.archive(profileId);
        const archived = profileRepo.getById(profileId)!;
        const revision = profileRepo.getActiveRevision(profileId);
        return {
          profile: toProfileSummaryPayload(archived, revision),
          archived: archived.archived === 1,
        };
      },
    }
    : null;

  let server: GatewayServer | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let journalPruneTimer: ReturnType<typeof setInterval> | null = null;
  let schedulerTimer: ReturnType<typeof setInterval> | null = null;
  let lifecycleMaintenanceTimer: ReturnType<typeof setInterval> | null = null;

  const gatewayPolicyService = gatewayPolicyRepo
    ? new DefaultGatewayPolicyService(gatewayPolicyRepo)
    : null;
  const gatewaySkillCatalogService = gatewaySkillCatalogRepo
    ? new GatewaySkillCatalogService({ repository: gatewaySkillCatalogRepo })
    : null;
  const knowledgeBaseService = knowledgeBaseRepo
    ? new KnowledgeBaseService({ repository: knowledgeBaseRepo })
    : null;
  const gatewayCapabilityAccessService = gatewayCapabilityGrantRepo
    ? new GatewayCapabilityAccessService({
      repository: gatewayCapabilityGrantRepo,
      profileId: config.gatewayProfile,
    })
    : null;

  if (gatewayCapabilityAccessService) {
    const seeded = gatewayCapabilityAccessService.seedStartupGrants(config.gatewayCapabilityGrants);
    appliedCapabilityGrants = seeded.applied;
    skippedCapabilityGrants = seeded.skipped;
    invalidCapabilityGrants = seeded.invalid;
  } else {
    for (const grant of configuredGrants.grants) {
      try {
        gatewayCoreState = grantCapability(gatewayCoreState, grant);
        appliedCapabilityGrants.push(grant.capabilityId);
      } catch {
        skippedCapabilityGrants.push(grant.capabilityId);
      }
    }
  }

  if (invalidCapabilityGrants.length > 0) {
    logger.warn("Ignoring invalid startup capability grants", {
      invalidCapabilityGrants,
      expectedSuffixes: [".read", ".write", ".execute"],
    });
  }

  if (skippedCapabilityGrants.length > 0) {
    logger.warn("Skipping startup grants blocked by current gateway profile", {
      skippedCapabilityGrants,
      gatewayProfile: config.gatewayProfile,
    });
  }

  logger.info("Gateway core profile loaded", {
    profile: gatewayCoreState.profile.id,
    appStoreCompatible: gatewayCoreState.profile.appStoreCompatible,
    sandboxRequired: gatewayCoreState.profile.sandboxRequired,
    defaultAction: gatewayCoreState.defaultAction,
    hardBlockedCapabilities: gatewayCoreState.profile.hardBlockedCapabilities,
    appliedCapabilityGrants,
  });

  const voiceRoutingService = new VoiceRoutingService();
  const voiceUsageLockService = new VoiceUsageLockService({
    usageRepo: voiceUsageRepo ?? undefined,
    loadPolicy: () => {
      const globalFlags = gatewayPolicyService?.getPolicy().globalFlags;
      const policy = parseVoiceUsagePolicyFromGlobalFlags(globalFlags);
      return {
        enabled: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_LOCK_ENABLED, policy.enabled),
        managedSttSecondsMonthlyLimit: parseOptionalNumberEnv(Bun.env.SPACESKIT_VOICE_MANAGED_STT_SECONDS_LIMIT)
          ?? policy.managedSttSecondsMonthlyLimit,
        managedTtsCharsMonthlyLimit: parseOptionalNumberEnv(Bun.env.SPACESKIT_VOICE_MANAGED_TTS_CHARS_LIMIT)
          ?? policy.managedTtsCharsMonthlyLimit,
        managedTtsSecondsMonthlyLimit: parseOptionalNumberEnv(Bun.env.SPACESKIT_VOICE_MANAGED_TTS_SECONDS_LIMIT)
          ?? policy.managedTtsSecondsMonthlyLimit,
      };
    },
  });
  const defaultVoiceSource = parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_DEFAULT_SOURCE) ?? "managed";
  const defaultVoiceRoute = {
    preferredSource: defaultVoiceSource,
    preferredProviderId: Bun.env.SPACESKIT_VOICE_MANAGED_PROVIDER_ID?.trim() || undefined,
    byokProviderId: Bun.env.SPACESKIT_VOICE_BYOK_PROVIDER_ID?.trim() || undefined,
    localModelProviderId: Bun.env.SPACESKIT_VOICE_LOCAL_PROVIDER_ID?.trim() || undefined,
    appleSpeechProviderId: Bun.env.SPACESKIT_VOICE_APPLE_PROVIDER_ID?.trim() || undefined,
    allowByokFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_BYOK_FALLBACK, false),
    allowLocalFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_LOCAL_FALLBACK, true),
    allowAppleSpeechFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_APPLE_FALLBACK, true),
  };

  const usageSnapshotService = db && usageRepo
    ? new UsageSnapshotService({
      db: db.db,
      usageRepo,
      voiceUsageRepo: voiceUsageRepo ?? undefined,
      loadVoiceLockState: () => {
        const snapshot = voiceUsageLockService.getSnapshot();
        return {
          enabled: snapshot.policy.enabled,
          managedSttSecondsMonthlyLimit: snapshot.policy.managedSttSecondsMonthlyLimit,
          managedTtsCharsMonthlyLimit: snapshot.policy.managedTtsCharsMonthlyLimit,
          managedTtsSecondsMonthlyLimit: snapshot.policy.managedTtsSecondsMonthlyLimit,
          managedCurrentMonthSttSeconds: snapshot.managedCurrentMonth.sttSeconds,
          managedCurrentMonthTtsChars: snapshot.managedCurrentMonth.ttsChars,
          managedCurrentMonthTtsSeconds: snapshot.managedCurrentMonth.ttsSeconds,
        };
      },
    })
    : null;

  const localUsageTelemetryService = new LocalUsageTelemetryService({
    logger: logger.child({ module: "local-usage-telemetry" }),
    windowDays: config.localUsageWindowDays,
    maxSessions: config.localUsageMaxSessions,
    refreshMinSecs: config.localUsageRefreshMinSecs,
    codexBarMode: config.codexBarMode,
  });

  gatewayAdminService.setUsageSnapshotService(usageSnapshotService ?? undefined);
  gatewayAdminService.setLocalUsageTelemetryService(localUsageTelemetryService);

  const spaceContextService = (
    spaceLinkRepo
    && spaceContextTransferRepo
    && artifactRepo
    && spaceRepo
  )
    ? new SpaceContextService({
      links: spaceLinkRepo,
      transfers: spaceContextTransferRepo,
      artifacts: artifactRepo,
      spaces: spaceRepo,
      evaluateSharePolicy: (context) => {
        const flags = gatewayPolicyService?.getPolicy().globalFlags;
        return evaluateCrossSpaceBoundaryPolicy({
          globalFlags: flags,
          sourceSpaceId: context.sourceSpaceId,
          targetSpaceId: context.targetSpaceId,
          artifactId: context.artifactId,
          operation: "share",
          artifactType: context.artifactType,
          title: context.title,
          tags: context.tags,
          isGeneratedBasic: context.isGeneratedBasic,
        });
      },
      evaluateImportPolicy: (context) => {
        const flags = gatewayPolicyService?.getPolicy().globalFlags;
        return evaluateCrossSpaceBoundaryPolicy({
          globalFlags: flags,
          sourceSpaceId: context.sourceSpaceId,
          targetSpaceId: context.targetSpaceId,
          artifactId: context.artifactId,
          operation: "import",
          artifactType: context.artifactType,
          title: context.title,
          tags: context.tags,
          isGeneratedBasic: context.isGeneratedBasic,
        });
      },
    })
    : null;

  const spaceSharingService = (
    spaceShareInviteRepo
    && spaceParticipantRepo
    && spaceRepo
  )
    ? new SpaceSharingService({
      invites: spaceShareInviteRepo,
      participants: spaceParticipantRepo,
      spaces: spaceRepo,
      defaultInviteTtlSeconds: parseInt(Bun.env.SPACESKIT_SHARE_INVITE_TTL_SECONDS ?? "86400", 10),
      sharingIdentityPolicy: {
        mode: config.shareIdentityMode,
        allowDeviceKeyFallback: config.shareAllowDeviceKeyFallback,
      },
      resolveSpaceSharingIdentityPolicy: (spaceId: string): SharingIdentityPolicy | undefined => {
        if (!spaceRepo) return undefined;
        const row = spaceRepo.getById(spaceId);
        if (!row?.space_config_json) return undefined;
        const parsed = parseJsonRecord(row.space_config_json);
        return parseSharingIdentityPolicyFromSpaceConfig(parsed);
      },
      relayBaseUrl: config.shareRelayBaseUrl,
      fallbackGatewayUrl: config.shareFallbackGatewayUrl,
    })
    : null;

  spaceTurnTraceService = eventLogRepo
    ? new SpaceTurnTraceService({
      eventLog: eventLogRepo,
    })
    : null;

  spaceArtifactService = (
    artifactRepo
    && spaceRepo
  )
    ? new SpaceArtifactService({
      artifacts: artifactRepo,
      spaces: spaceRepo,
    })
    : null;

  const spaceQuotaService = (
    spaceRepo
    && spaceQuotaPolicyRepo
    && participantQuotaPolicyRepo
    && spaceUsageCounterRepo
    && participantUsageCounterRepo
    && spaceChangeSetRepo
    && spaceChangeSetFileRepo
    && usageRepo
    && agentUsageSessionRepo
  )
    ? new SpaceQuotaService({
      spaces: spaceRepo,
      spaceQuotaPolicies: spaceQuotaPolicyRepo,
      participantQuotaPolicies: participantQuotaPolicyRepo,
      spaceUsageCounters: spaceUsageCounterRepo,
      participantUsageCounters: participantUsageCounterRepo,
      changeSets: spaceChangeSetRepo,
      changeSetFiles: spaceChangeSetFileRepo,
      usageAnalytics: usageRepo,
      agentUsageSessions: agentUsageSessionRepo,
    })
    : null;

  const spaceChangeSetService = (
    config.collabChangesetsEnabled
    && spaceRepo
    && spaceParticipantRepo
    && spaceChangeSetRepo
    && spaceChangeSetFileRepo
    && spaceChangeSetReviewRepo
    && spaceWorkspaceService
  )
    ? new SpaceChangeSetService({
      spaces: spaceRepo,
      participants: spaceParticipantRepo,
      changeSets: spaceChangeSetRepo,
      changeSetFiles: spaceChangeSetFileRepo,
      changeSetReviews: spaceChangeSetReviewRepo,
      workspaceResolver: spaceWorkspaceService,
      quotaService: spaceQuotaService ?? undefined,
    })
    : null;

  const spaceToolPolicyService = (
    config.toolPolicyV2Enabled
    && spaceToolPolicyRepo
  )
    ? new SpaceToolPolicyService({
      capabilities,
      spaceAdminService,
      toolPolicies: spaceToolPolicyRepo,
      gatewayProfile: config.gatewayProfile,
      gatewayPolicyService: gatewayPolicyService ?? undefined,
      gatewayCapabilityAccessService: gatewayCapabilityAccessService ?? undefined,
      spaceMcpService: spaceMcpService,
    })
    : null;

  const deviceIdentityService = deviceIdentityRepo
    ? new DeviceIdentityService({
      repository: deviceIdentityRepo,
      requirePreRegistered: Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE === "true",
      onDeviceRevoked: ({ principalId, deviceId }) => {
        server?.disconnectSessionsByDevice(deviceId, principalId);
      },
    })
    : null;

  const spaceConfiguratorService = new SpaceConfiguratorService({
    templates: spaceTemplateRepo,
    agentPresets: agentPresetRepo,
    presetApplications: spacePresetApplicationRepo,
    spaceAdminService,
    profileRepo,
    defaultProfileId: config.mainProfileId,
    defaultAgentId: config.mainAgentId,
  });

  let orchestratorCommandService: OrchestratorCommandService | null = null;
  let schedulerService: SchedulerService | null = null;

  const resolveSyncPeerSecret = (peerId: string): string | undefined => {
    const normalizedPeerKey = peerId
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "_");
    return Bun.env[`SPACESKIT_SYNC_SECRET_${normalizedPeerKey}`]
      ?? Bun.env.SPACESKIT_SYNC_SHARED_SECRET
      ?? undefined;
  };

  const gatewaySyncService = syncRuntimeRepo && artifactRepo
    ? new DefaultGatewaySyncService(syncRuntimeRepo, artifactRepo, {
      spaceRepo: spaceRepo ?? undefined,
      localPeerId: Bun.env.SPACESKIT_SYNC_LOCAL_PEER_ID ?? config.mainSpaceResourceId,
      resolvePeerSecret: resolveSyncPeerSecret,
      autoPullOnAnnounce: Bun.env.SPACESKIT_SYNC_AUTO_PULL_ON_ANNOUNCE === "true",
      autoPullTargetSpaceId: Bun.env.SPACESKIT_SYNC_AUTO_PULL_TARGET_SPACE_ID ?? config.mainSpaceId,
      evaluateQueryPolicy: ({
        peerId,
        resourceType,
        resourceId,
        artifactType,
        title,
        tags,
        isGeneratedBasic,
      }) => {
        const flags = gatewayPolicyService?.getPolicy().globalFlags;
        return evaluateSyncBoundaryPolicy({
          globalFlags: flags,
          peerId,
          resourceType,
          resourceId,
          operation: "query",
          artifactType,
          title,
          tags,
          isGeneratedBasic,
        });
      },
      evaluatePullPolicy: ({
        peerId,
        resourceType,
        resourceId,
        artifactType,
        title,
        tags,
        isGeneratedBasic,
      }) => {
        const flags = gatewayPolicyService?.getPolicy().globalFlags;
        return evaluateSyncBoundaryPolicy({
          globalFlags: flags,
          peerId,
          resourceType,
          resourceId,
          operation: "pull",
          artifactType,
          title,
          tags,
          isGeneratedBasic,
        });
      },
      logger: logger.child({ module: "sync" }),
    })
    : null;

  capabilities.setGatewayPolicyEvaluator((capability, operation, _args, policyContext) => {
    const gatewayCoreDecision = gatewayCapabilityAccessService
      ? gatewayCapabilityAccessService.evaluateInvocation({
        capability,
        operation,
        principalId: policyContext?.principalId,
        deviceId: policyContext?.deviceId,
      }).decision
      : evaluateCapabilityRequest(
        gatewayCoreState,
        capabilityRequestFromInvocation(capability, operation),
      );
    const requiredGrantId = capabilityRequestFromInvocation(capability, operation).capabilityId;
    if (gatewayCoreDecision.decision !== "allow") {
      return {
        allowed: false,
        reason: `${gatewayCoreDecision.reason} (required grant: ${requiredGrantId})`,
      };
    }

    if (gatewayPolicyService) {
      const decision = gatewayPolicyService.evaluateCapability(capability);
      if (!decision.allowed) {
        return {
          allowed: false,
          reason: decision.reason ?? `Capability denied by gateway policy: ${capability}`,
        };
      }
    }

    return { allowed: true };
  });

  const enforceSandboxRouting = config.archFreezeEnforced || config.sandboxRuntimeEnabled;
  const sandboxBackend = enforceSandboxRouting
    ? await createSandboxExecutionBackend({
      logger: logger.child({ module: "sandbox-runtime" }),
      runtimeModule: config.sandboxRuntimeModule,
      allowHostPassthrough: config.sandboxAllowHostPassthrough,
    })
    : null;
  const sandboxRuntimeState: {
    enforceSandboxRouting: boolean;
    backendMode: "disabled" | "module" | "passthrough" | "unavailable";
    routed: number;
    succeeded: number;
    failed: number;
    lastFailureAt?: string;
    lastFailureMessage?: string;
    belowSloSince?: string;
  } = {
    enforceSandboxRouting,
    backendMode: sandboxBackend?.mode ?? "disabled",
    routed: 0,
    succeeded: 0,
    failed: 0,
  };

  const gatewayObservabilityService = new GatewayObservabilityService({
    eventBus,
    logger: logger.child({ module: "observability" }),
    relaySloMinSuccessRate: config.relaySloMinSuccessRate,
    relaySloMinSamples: config.relaySloMinSamples,
    relaySloEnforce: config.relaySloEnforce,
    sandboxSloMinSuccessRate: config.sandboxSloMinSuccessRate,
    sandboxSloMinSamples: config.sandboxSloMinSamples,
    sandboxSloEnforce: config.sandboxSloEnforce,
    getSandboxState: () => ({
      enforceSandboxRouting: sandboxRuntimeState.enforceSandboxRouting,
      backendMode: sandboxRuntimeState.backendMode,
      routed: sandboxRuntimeState.routed,
      succeeded: sandboxRuntimeState.succeeded,
      failed: sandboxRuntimeState.failed,
      belowSloSince: sandboxRuntimeState.belowSloSince,
      lastFailureAt: sandboxRuntimeState.lastFailureAt,
      lastFailureMessage: sandboxRuntimeState.lastFailureMessage,
    }),
  });

  if (config.gatewayProfile === "external" && enforceSandboxRouting) {
    if (config.sandboxAllowHostPassthrough) {
      throw new Error(
        "External profile requires strict sandbox isolation; SPACESKIT_SANDBOX_ALLOW_HOST_PASSTHROUGH=true is not permitted",
      );
    }
    if (!sandboxBackend || sandboxBackend.mode !== "module") {
      throw new Error(
        "External profile requires a configured sandbox runtime module when sandbox routing is enforced",
      );
    }
  }

  if (sandboxBackend) {
    capabilities.setSandboxInvoker(async (input) => {
      sandboxRuntimeState.routed += 1;
      try {
        const result = await sandboxBackend.invoke(input);
        sandboxRuntimeState.succeeded += 1;
        updateSandboxSloState();
        return result;
      } catch (error) {
        sandboxRuntimeState.failed += 1;
        sandboxRuntimeState.lastFailureAt = new Date().toISOString();
        sandboxRuntimeState.lastFailureMessage = error instanceof Error
          ? error.message
          : String(error);
        updateSandboxSloState();
        throw error;
      }
    });
    logger.info("Sandbox execution backend configured", {
      mode: sandboxBackend.mode,
      enforceSandboxRouting,
      sandboxRuntimeEnabled: config.sandboxRuntimeEnabled,
      archFreezeEnforced: config.archFreezeEnforced,
      sloMinSuccessRate: config.sandboxSloMinSuccessRate,
      sloMinSamples: config.sandboxSloMinSamples,
      sloEnforce: config.sandboxSloEnforce,
    });
    if (sandboxBackend.mode === "unavailable") {
      logger.warn("Sandbox backend unavailable — sandbox-routed operations will be denied", {
        sandboxRuntimeModule: config.sandboxRuntimeModule ?? null,
      });
    }
  } else {
    capabilities.setSandboxInvoker(null);
  }

  function updateSandboxSloState(): void {
    const evaluation = evaluateSandboxSlo({
      succeeded: sandboxRuntimeState.succeeded,
      failed: sandboxRuntimeState.failed,
      minSuccessRate: config.sandboxSloMinSuccessRate,
      minSamples: config.sandboxSloMinSamples,
    });

    if (!evaluation.evaluated || evaluation.meetsSlo) {
      sandboxRuntimeState.belowSloSince = undefined;
      return;
    }

    if (!sandboxRuntimeState.belowSloSince) {
      sandboxRuntimeState.belowSloSince = new Date().toISOString();
      logger.warn("Sandbox success-rate SLO breached", {
        gatewayProfile: config.gatewayProfile,
        sandboxMode: sandboxRuntimeState.backendMode,
        successRate: evaluation.successRate,
        minSuccessRate: config.sandboxSloMinSuccessRate,
        samples: evaluation.samples,
        minSamples: config.sandboxSloMinSamples,
        sandboxSloEnforce: config.sandboxSloEnforce,
      });
    }
  }

  capabilities.setExecutionRoutingResolver((routingInput) => (
    resolveCapabilityExecutionRoute(routingInput, {
      enforceSandboxRouting,
    })
  ));

  let mainAgentHealthStatus: "healthy" | "repaired" | "fallback" | "degraded" = "healthy";
  try {
    if (config.mainAgentAutoRepairEnabled) {
      const mainProfileRuntimeSelection = resolveMainProfileRuntimeSelection(config, seededProviders);
      const defaultsResult = await ensureMainDefaults(
        config,
        logger,
        profileRepo,
        spaceAdminService,
        mainProfileRuntimeSelection,
      );
      if (defaultsResult) {
        logger.info("Main defaults ensured", {
          spaceId: config.mainSpaceId,
          profileId: config.mainProfileId,
          orchestratorProfileId: config.mainOrchestratorProfileId,
          agentId: config.mainAgentId,
          profile: defaultsResult.profile,
          space: defaultsResult.space,
          assignment: defaultsResult.assignment,
          orchestrator: defaultsResult.orchestrator,
        });
        const skillsResult = await ensureMainSpaceSystemSkills(
          config,
          logger,
          spaceAdminService,
          gatewaySkillCatalogService,
        );
        logger.info("Main system skills ensured", {
          spaceId: config.mainSpaceId,
          seeded: skillsResult.seeded,
          attached: skillsResult.attached,
        });
      }
    } else {
      logger.info("Skipping main defaults bootstrap: SPACESKIT_MAIN_AGENT_AUTO_REPAIR disabled", {
        spaceId: config.mainSpaceId,
        profileId: config.mainProfileId,
        agentId: config.mainAgentId,
      });
    }
    if (spaceWorkspaceService) {
      await spaceWorkspaceService.ensureWorkspace(config.mainSpaceId);
    }
  } catch (err) {
    mainAgentHealthStatus = "degraded";
    if (config.gatewayProfile === "external" && config.archFreezeEnforced) {
      logger.error("Failed to ensure main defaults; startup blocked for external freeze profile", err as Error);
      throw err instanceof Error
        ? err
        : new Error("Failed to ensure main defaults for external freeze profile");
    }
    logger.warn("Failed to ensure main defaults; continuing in degraded mode", {
      error: err instanceof Error ? err.message : String(err),
      gatewayProfile: config.gatewayProfile,
      archFreezeEnforced: config.archFreezeEnforced,
    });
  }

  if (mainAgentHealthStatus !== "degraded") {
    try {
      const mainAgentState = await gatewayAdminService.getMainAgent({
        spaceId: config.mainSpaceId,
        repairIfMissing: config.mainAgentAutoRepairEnabled,
      });
      mainAgentHealthStatus = mainAgentState.status;
      if (mainAgentState.status === "fallback") {
        logger.warn("Main agent fallback applied", {
          spaceId: config.mainSpaceId,
          mainAgentId: config.mainAgentId,
          mainProfileId: config.mainProfileId,
          providerHint: mainAgentState.providerHint,
          modelHint: mainAgentState.modelHint,
          fallbackReason: mainAgentState.fallbackReason,
        });
      }
    } catch (err) {
      mainAgentHealthStatus = "degraded";
      logger.warn("Main agent health check failed; continuing in degraded mode", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Space manager ----
  const resolveAgentProfileRuntime = async (
    spaceId: string,
    agentId: string,
  ): Promise<{
    profileId: string;
    systemPrompt: string;
    effectiveSkillIds: string[];
    providerHint?: string;
    modelHint?: string;
  }> => {
    const fallbackBase = gatewayAdminService.loadProfileRuntime(config.mainProfileId) ?? {
      profileId: config.mainProfileId,
      systemPrompt: "",
      defaultSkillIds: [],
      providerHint: config.modelProvider,
      modelHint: config.defaultModelId,
    };
    const fallback = {
      ...fallbackBase,
      effectiveSkillIds: uniqueStrings(fallbackBase.defaultSkillIds),
    };

    const space = await spaceAdminService.getSpace(spaceId);
    const assignment = space?.agents.find((entry) => entry.agentId === agentId);
    if (!assignment) {
      return {
        ...fallback,
        effectiveSkillIds: uniqueStrings([
          ...fallback.effectiveSkillIds,
          ...(space?.skillIds ?? []),
        ]),
      };
    }

    const profileRuntime = gatewayAdminService.loadProfileRuntime(assignment.profileId);
    if (!profileRuntime) {
      return {
        profileId: assignment.profileId,
        systemPrompt: "",
        effectiveSkillIds: space?.skillIds ?? [],
      };
    }

    const effectiveSkillIds = uniqueStrings([
      ...profileRuntime.defaultSkillIds,
      ...(space?.skillIds ?? []),
    ]);

    return {
      profileId: profileRuntime.profileId,
      systemPrompt: profileRuntime.systemPrompt,
      effectiveSkillIds,
      providerHint: profileRuntime.providerHint,
      modelHint: profileRuntime.modelHint,
    };
  };

  const spaceManager = new SpaceManager({
    eventBus,
    checkpointManager: checkpointManager ?? undefined,
    deadLetterQueue: deadLetterQueue ?? undefined,
    maxHops: config.maxAgentHops,
    masterModeEnabled: config.masterModeEnabled,
    masterPlannerPromptTemplate: config.masterPlannerPromptTemplate,
    guestAgentPromptTemplate: config.guestAgentPromptTemplate,
    peerReviewPromptTemplate: config.peerReviewPromptTemplate,
    masterSynthesisPromptTemplate: config.masterSynthesisPromptTemplate,
    appendOrchestrationJournalEntry: orchestrationJournalRepo
      ? async (entry) => {
        orchestrationJournalRepo!.create({
          eventId: crypto.randomUUID(),
          spaceId: entry.spaceId,
          turnId: entry.turnId,
          eventType: entry.eventType,
          actorId: entry.actorId,
          lineageId: entry.lineageId,
          hopCount: entry.hopCount,
          payloadJson: JSON.stringify(entry.payload),
        });
      }
      : undefined,
    recordOrchestrationMetric: ({ name, value, tags }) => {
      logger.debug("Orchestration metric", { name, value, ...(tags ?? {}) });
    },
    loadSpaceConfig: async (spaceId: string): Promise<SpaceConfig | null> => {
      return spaceAdminService.getSpace(spaceId);
    },
    updateSpaceStatus: async (spaceId: string, status: string): Promise<void> => {
      spaceRepo?.updateStatus(spaceId, status);
    },
    saveTurn: async (turn: SaveTurnInput): Promise<void> => {
      if (!turnRepo) return;
      // Reconcile: if promptTokens is 0 but totalTokens > completionTokens,
      // derive input tokens from the provider's reported total.
      let tokenInput = turn.promptTokens;
      const tokenOutput = turn.completionTokens;
      if (tokenInput === 0 && turn.totalTokens > tokenOutput) {
        tokenInput = turn.totalTokens - tokenOutput;
      }
      turnRepo.create({
        turnId: turn.turnId,
        spaceId: turn.spaceId,
        actorType: "agent",
        actorId: turn.agentId,
        inputJson: JSON.stringify({ text: turn.input }),
        userTurnId: turn.userTurnId,
      });
      turnRepo.complete(turn.turnId, {
        outputJson: JSON.stringify({ text: turn.output }),
        tokenInput,
        tokenOutput,
      });
    },
    loadHistory: async (spaceId: string, limit = 50): Promise<ModelMessage[]> => {
      if (!turnRepo) return [];
      const turns = [...turnRepo.listBySpace(spaceId, limit)].reverse();
      const history: ModelMessage[] = [];
      const emittedUserTurns = new Set<string>();

      const parseRecord = (raw: string | null): Record<string, unknown> => {
        if (!raw) return {};
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
        } catch {
          return {};
        }
      };

      const resolveLogicalTurnId = (turn: { turn_id: string; user_turn_id: string }): string => {
        const userTurnId = turn.user_turn_id.trim();
        return userTurnId.length > 0 ? userTurnId : turn.turn_id;
      };

      for (const turn of turns) {
        const logicalTurnId = resolveLogicalTurnId(turn);
        const input = parseRecord(turn.input_json);
        const output = parseRecord(turn.output_json);

        const inputText = typeof input.text === "string" ? input.text.trim() : "";
        if (inputText && !emittedUserTurns.has(logicalTurnId)) {
          emittedUserTurns.add(logicalTurnId);
          history.push({
            role: "user",
            content: inputText,
          });
        }

        const outputText = typeof output.text === "string" ? output.text.trim() : "";
        if (outputText) {
          history.push({
            role: "assistant",
            content: outputText,
          });
        }
      }

      return history;
    },
    loadAgentHistory: async (spaceId: string, agentId: string, limit = 50): Promise<ModelMessage[]> => {
      if (!turnRepo) return [];
      const normalizedLimit = Math.max(1, Math.floor(limit));
      const activeSession = agentUsageSessionRepo?.getActive(spaceId, agentId);
      let turns = activeSession
        ? [
          ...listTurnsForActiveSessionBoundary(
            turnRepo,
            spaceId,
            agentId,
            activeSession.started_at,
            normalizedLimit,
          ),
        ]
        : [...turnRepo.listBySpaceAndAgent(spaceId, agentId, normalizedLimit)];
      const history: ModelMessage[] = [];
      const injectedMessages: ModelMessage[] = [];
      const emittedUserTurns = new Set<string>();

      const resolveLogicalTurnId = (turn: { turn_id: string; user_turn_id: string }): string => {
        const userTurnId = turn.user_turn_id.trim();
        return userTurnId.length > 0 ? userTurnId : turn.turn_id;
      };

      if (activeSession && turns.length === 0 && spaceWorkspaceService) {
        const recentTurns = turnRepo.listBySpaceAndAgent(
          spaceId,
          agentId,
          Math.max(normalizedLimit, 24),
        );
        const preBoundaryTurns = recentTurns.filter((turn) => turn.created_at < activeSession.started_at);
        if (preBoundaryTurns.length > 0) {
          try {
            const workspace = await spaceWorkspaceService.getWorkspace(spaceId);
            const handoffDigest = buildDeterministicHandoffDigest(preBoundaryTurns);
            const handoffPath = await writeDeterministicHandoffDigest(
              workspace.sharedContextPath,
              agentId,
              handoffDigest,
            );
            injectedMessages.push({
              role: "system",
              content: [
                "Deterministic handoff digest injected for fresh runtime session.",
                `Digest file: ${handoffPath}`,
                "",
                handoffDigest,
              ].join("\n"),
            });
          } catch (error) {
            logger.warn("Failed to build deterministic handoff digest", {
              spaceId,
              agentId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      turns = turns.reverse();
      for (const turn of turns) {
        const logicalTurnId = resolveLogicalTurnId(turn);
        const inputText = parseTurnText(turn.input_json) ?? "";
        if (inputText && !emittedUserTurns.has(logicalTurnId)) {
          emittedUserTurns.add(logicalTurnId);
          history.push({
            role: "user",
            content: inputText,
          });
        }

        const outputText = parseTurnText(turn.output_json) ?? "";
        if (outputText) {
          history.push({
            role: "assistant",
            content: outputText,
          });
        }
      }

      return [...injectedMessages, ...history];
    },
    resolveRuntime: async (spaceId: string, agentId: string) => {
      const externalBinding = spaceMcpService.getBinding(spaceId, agentId);
      if (externalBinding) {
        return new ExternalMcpAgentRuntime({
          agentId,
          remoteAgentId: externalBinding.remoteAgentId,
          eventBus,
          executeRemoteTurn: async (input: {
            spaceId: string;
            agentId: string;
            remoteAgentId: string;
            turnId: string;
            messages: ModelMessage[];
            lineageId: string;
            hopCount: number;
            maxHops: number;
            principalId?: string;
            deviceId?: string;
          }) =>
            spaceMcpService.invokeExternalAgentTurn({
              ...input,
              messages: input.messages as unknown as Array<Record<string, unknown>>,
            }),
        });
      }

      const profileRuntime = await resolveAgentProfileRuntime(spaceId, agentId);
      const providerSelection = gatewayAdminService.resolveProviderForProfile(
        profileRuntime.providerHint,
        profileRuntime.modelHint,
      );

      const modelProvider = executionAdapterFactory.createModelProvider({
        providerId: providerSelection.providerId,
        model: providerSelection.model,
        apiKey: providerSelection.apiKey,
        baseURL: providerSelection.baseURL,
        isLocal: providerSelection.isLocal,
      });
      const activeSkillMarkdownById = gatewaySkillCatalogService
        ? gatewaySkillCatalogService.getActiveSkillMarkdownMap(profileRuntime.effectiveSkillIds)
        : undefined;
      const baseSystemPrompt = applyEffectiveSkillContext(
        profileRuntime.systemPrompt,
        profileRuntime.effectiveSkillIds,
        activeSkillMarkdownById,
      );
      const workspace = spaceWorkspaceService
        ? await spaceWorkspaceService.ensureWorkspace(spaceId).catch(() => null)
        : null;
      const workspaceContextBlock = workspace && spaceWorkspaceService
        ? await buildWorkspaceContextBlock(spaceWorkspaceService, spaceId, agentId).catch(() => undefined)
        : undefined;
      const promptWithWorkspaceContext = appendWorkspaceContext(baseSystemPrompt, workspaceContextBlock);
      const runtimeSystemPrompt = providerSelection.nativeCliToolsEnabled
        ? appendNativeCliToolUsageGuidance(promptWithWorkspaceContext, providerSelection.providerId)
        : appendToolUsageGuidance(promptWithWorkspaceContext);

      return new DefaultAgentRuntime({
        config: {
          id: agentId,
          profileId: profileRuntime.profileId,
          systemPrompt: runtimeSystemPrompt,
          modelProvider: providerSelection.providerId,
          modelId: providerSelection.model,
          tools: [],
          maxSteps: 10,
          workingDirectory: workspace?.effectiveWorkspaceRoot,
          nativeCliToolsEnabled: providerSelection.nativeCliToolsEnabled,
        },
        modelProvider,
        toolExecutor,
        middleware,
        eventBus,
      });
    },
  });

  logger.info("Space manager initialized");

  orchestratorCommandService = (
    orchestratorCommandRepo
    && spaceContextService
  )
    ? new OrchestratorCommandService({
      repository: orchestratorCommandRepo,
      spaceAdminService,
      spaceManager,
      spaceContextService,
      defaultTargetSpaceId: config.mainSpaceId,
      requireCallerPrincipal: config.gatewayProfile === "external",
      authorizeCommand: spaceSharingService
        ? ({ targetSpaceId, principalId }) => {
          const decision = spaceSharingService.evaluateAccess({
            spaceId: targetSpaceId,
            principalId,
            action: "write",
          });
          return {
            allowed: decision.allowed,
            reason: decision.reason,
          };
        }
        : undefined,
      controlOnlyMode: config.mainAdminMcpEnabled,
      gatewaySkillCatalogService: gatewaySkillCatalogService ?? undefined,
    })
    : null;

  schedulerService = (
    schedulerJobRepo
    && schedulerJobSpaceRepo
    && schedulerJobRunRepo
    && spaceRepo
    && orchestratorCommandService
  )
    ? new SchedulerService({
      jobs: schedulerJobRepo,
      jobSpaces: schedulerJobSpaceRepo,
      runs: schedulerJobRunRepo,
      spaces: spaceRepo,
      spaceAdminService,
      orchestratorCommandService,
      spaceSharingService,
      logger: logger.child({ module: "scheduler" }),
    })
    : null;

  if (schedulerService) {
    try {
      await schedulerService.reconcileSchedulesOnStartup();
      logger.info("Scheduler service initialized");
    } catch (error) {
      logger.warn("Failed to reconcile scheduler state on startup", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const gatewayResetService = db
    ? new GatewayResetService({
      db: db.db,
      logger: logger.child({ module: "gateway-reset" }),
      spaceManager,
      gatewayAdminService,
      getGatewayId: () => config.mainSpaceResourceId,
      getGatewayUuid: () => gatewayUuid,
    })
    : null;

  const speechSessionService = Bun.env.SPACESKIT_ENABLE_SPEECH_MVP === "true"
    ? new SpeechSessionService({
      spaceManager,
      voiceUsageRepo: voiceUsageRepo ?? undefined,
      voiceUsageLockService,
      voiceRoutingService,
      defaultVoiceRoute,
    })
    : null;
  if (speechSessionService) {
    logger.info("Speech session service enabled (SPACESKIT_ENABLE_SPEECH_MVP=true)", {
      defaultVoiceSource: defaultVoiceRoute.preferredSource,
      allowByokFallback: defaultVoiceRoute.allowByokFallback,
      allowLocalFallback: defaultVoiceRoute.allowLocalFallback,
      allowAppleSpeechFallback: defaultVoiceRoute.allowAppleSpeechFallback,
      voiceLockEnabled: voiceUsageLockService.getSnapshot().policy.enabled,
    });
  }

  // ---- Experience generator ----
  if (db && experienceRepo && turnRepo) {
    const defaultMemory = memoryRegistry.getDefault();
    const experienceGenerator = new ExperienceGenerator({
      eventBus,
      memoryProvider: defaultMemory ?? undefined,
      loadHistory: async (spaceId: string) => {
        const turns = turnRepo!.listBySpace(spaceId, 100);
        return turns.map((t) => {
          const inputJson = t.input_json ? JSON.parse(t.input_json) : {};
          const outputJson = t.output_json ? JSON.parse(t.output_json) : {};
          return {
            turnId: t.turn_id,
            agentId: t.actor_id,
            input: inputJson.text ?? "",
            output: outputJson.text ?? "",
            promptTokens: t.token_input_count ?? 0,
            completionTokens: t.token_output_count ?? 0,
            status: t.status,
          };
        });
      },
      loadSpaceConfig: async (spaceId: string) => {
        const space = await spaceAdminService.getSpace(spaceId);
        if (!space) return null;
        return {
          spaceId: space.id,
          resourceId: space.resourceId,
          name: space.name,
          goal: space.goal ?? undefined,
          turnModel: space.turnModel,
          agents: space.agents.map((a) => ({
            agentId: a.agentId,
            profileId: a.profileId,
            isPrimary: a.isPrimary,
          })),
        };
      },
      saveExperience: async (experience) => {
        experienceRepo!.create({
          experienceId: experience.experienceId,
          spaceId: experience.spaceId,
          summary: experience.summary,
          tags: experience.tags,
        });
      },
    });
    logger.info("Experience generator initialized");
  }

  // ---- Message router ----
  const messageRouter = new MessageRouter({
    spaceManager,
    spaceAdminService,
    gatewayAdminService,
    gatewayResetService: gatewayResetService ?? undefined,
    connectorAdminService: connectorAdminService ?? undefined,
    profileAdminService: profileAdminService ?? undefined,
    gatewayPolicyService: gatewayPolicyService ?? undefined,
    gatewaySkillCatalogService: gatewaySkillCatalogService ?? undefined,
    gatewayKnowledgeBaseService: knowledgeBaseService ?? undefined,
    gatewayCapabilityAccessService: gatewayCapabilityAccessService ?? undefined,
    usageSnapshotService: usageSnapshotService ?? undefined,
    spaceContextService: spaceContextService ?? undefined,
    spaceWorkspaceService: spaceWorkspaceService ?? undefined,
    spaceSharingService: spaceSharingService ?? undefined,
    spaceChangeSetService: spaceChangeSetService ?? undefined,
    spaceQuotaService: spaceQuotaService ?? undefined,
    spaceTurnTraceService: spaceTurnTraceService ?? undefined,
    spaceArtifactService: spaceArtifactService ?? undefined,
    spaceToolPolicyService: spaceToolPolicyService ?? undefined,
    spaceMcpService,
    turnHistoryService: turnRepo
      ? {
        listSpaceTurns: async ({ spaceId, limit, offset, lastSeenTurnId }) => {
          const normalizedLastSeenTurnId = normalizeOptionalString(lastSeenTurnId);
          if (normalizedLastSeenTurnId) {
            const rows = turnRepo!.listBySpaceAfterTurn(spaceId, normalizedLastSeenTurnId, limit);
            return {
              turns: rows.map(mapTurnRowToSpaceTurnPayload),
              total: turnRepo!.countBySpaceAfterTurn(spaceId, normalizedLastSeenTurnId),
            };
          }

          const rows = turnRepo!.listBySpace(spaceId, limit, offset);
          return {
            turns: rows.map(mapTurnRowToSpaceTurnPayload),
            total: turnRepo!.countBySpace(spaceId),
          };
        },
      }
      : undefined,
    orchestrationJournalService: orchestrationJournalRepo
      ? {
        listEntries: async ({ spaceId, turnId, limit, offset }) => {
          const rows = orchestrationJournalRepo!.list({
            spaceId,
            turnId,
            limit,
            offset,
          });
          return {
            entries: rows.map((row) => ({
              eventId: row.event_id,
              spaceId: row.space_id,
              turnId: row.turn_id,
              seq: row.seq,
              eventType: row.event_type,
              actorId: row.actor_id,
              lineageId: row.lineage_id,
              hopCount: row.hop_count,
              payload: parseJsonRecord(row.payload_json),
              createdAt: row.created_at,
            })),
            total: orchestrationJournalRepo!.count(spaceId, turnId),
          };
        },
      }
      : undefined,
    deviceIdentityService: deviceIdentityService ?? undefined,
    spaceConfiguratorService: spaceConfiguratorService,
    orchestratorCommandService: orchestratorCommandService ?? undefined,
    schedulerService: schedulerService ?? undefined,
    gatewaySyncService: gatewaySyncService ?? undefined,
    speechSessionService: speechSessionService ?? undefined,
    onFeedbackResolved: runtimeLedgerService
      ? ({ turnId, status, resolution }) => {
        runtimeLedgerService?.recordApprovalResolution(turnId, status, resolution);
      }
      : undefined,
    issueHttpPrincipalToken: config.httpPrincipalAuthHs256Secret
      ? ({ principalId, deviceId, ttlSeconds }) =>
        issueHttpPrincipalToken({
          principalId,
          deviceId,
          hs256Secret: config.httpPrincipalAuthHs256Secret!,
          ttlSeconds,
        })
      : undefined,
    capabilities,
    logger: logger.child({ module: "router" }),
    agentSessionReplacementEnabled: config.agentSessionReplacementEnabled,
    sendToClient: (clientId, msg) => {
      server?.send(clientId, msg);
    },
    broadcastToSpace: (spaceUid, msg) => {
      server?.broadcastToSpace(spaceUid, msg);
    },
  });

  // ---- A2A handler ----
  const configuredBaseUrl = `http://${config.host}:${config.port}`;
  const a2aHandler = new A2AHandler({
    spaceManager,
    eventBus,
    logger: logger.child({ module: "a2a" }),
    baseUrl: configuredBaseUrl,
    loadProfile: async (profileId: string) => {
      if (!profileRepo) return null;
      const row = profileRepo.getById(profileId);
      if (!row) return null;
      const revision = profileRepo.getActiveRevision(profileId);
      return {
        name: row.name,
        description: row.description ?? undefined,
        personalityPrompt: revision?.personality_prompt ?? undefined,
        defaultSkillIds: revision?.default_skill_set_ids_json
          ? JSON.parse(revision.default_skill_set_ids_json)
          : [],
        activeRevision: row.active_revision,
      };
    },
    listProfiles: async () => {
      if (!profileRepo) return [];
      const rows = profileRepo.listActive();
      return rows.map((r) => ({
        profileId: r.profile_id,
        name: r.name,
        description: r.description ?? undefined,
      }));
    },
    authRequired: config.a2aRequireAuth,
    maxTasks: config.a2aTaskMax,
    taskTtlMs: config.a2aTaskTtlMs,
  });

  // ---- A2A push notification handler ----
  const a2aPush = new A2APushNotificationHandler();

  // ---- Workflow visualizer ----
  let workflowVisualizer: WorkflowVisualizer | null = null;
  let diagramHandler: ((req: Request) => Response | null) | null = null;
  if (db) {
    workflowVisualizer = new WorkflowVisualizer(db.db);
    diagramHandler = createDiagramHandler(workflowVisualizer);
  }

  // ---- Notification handler (bridges NotificationService → WebSocket) ----
  const notificationHandler = new NotificationHandler({ notificationService });
  const spaceIdByUidCache = new Map<string, string>();
  const resolveSpaceIdFromUid = spaceAdminService
    ? async (spaceUidRaw: string): Promise<string | undefined> => {
      const normalizedUid = spaceUidRaw.trim().toLowerCase();
      if (!normalizedUid) return undefined;

      const cached = spaceIdByUidCache.get(normalizedUid);
      if (cached) return cached;

      const byId = await spaceAdminService.getSpace(spaceUidRaw.trim());
      if (byId) {
        spaceIdByUidCache.set((byId.spaceUid ?? spaceUidRaw).trim().toLowerCase(), byId.id);
        return byId.id;
      }

      const spaces = await spaceAdminService.listSpaces({ limit: 500 });
      const matched = spaces.find((space) => space.spaceUid.trim().toLowerCase() === normalizedUid);
      if (!matched) return undefined;
      spaceIdByUidCache.set(normalizedUid, matched.id);
      return matched.id;
    }
    : undefined;

  const spacesRestApiService = new SpacesRestApiService({
    spaceChangeSetService: spaceChangeSetService ?? undefined,
    spaceQuotaService: spaceQuotaService ?? undefined,
    spaceTurnTraceService: spaceTurnTraceService ?? undefined,
    spaceArtifactService: spaceArtifactService ?? undefined,
    spaceToolPolicyService: spaceToolPolicyService ?? undefined,
    spaceSharingService: spaceSharingService ?? undefined,
    principalAuth: {
      strictVerification: config.httpPrincipalAuthStrict,
      hs256Secret: config.httpPrincipalAuthHs256Secret,
      maxClockSkewSeconds: config.httpPrincipalAuthMaxClockSkewSeconds,
    },
    requireAuthenticatedPrincipal: config.gatewayProfile === "external",
  });
  const shareRelayApiService = new ShareRelayApiService({
    spaceSharingService: spaceSharingService ?? undefined,
    eventBus,
    principalAuth: {
      strictVerification: config.httpPrincipalAuthStrict,
      hs256Secret: config.httpPrincipalAuthHs256Secret,
      maxClockSkewSeconds: config.httpPrincipalAuthMaxClockSkewSeconds,
    },
    requireAuthenticatedPrincipal: config.gatewayProfile === "external",
  });
  const gatewayObservabilityApiService = new GatewayObservabilityApiService({
    observabilityService: gatewayObservabilityService,
    principalAuth: {
      strictVerification: config.httpPrincipalAuthStrict,
      hs256Secret: config.httpPrincipalAuthHs256Secret,
      maxClockSkewSeconds: config.httpPrincipalAuthMaxClockSkewSeconds,
    },
    requireAuthenticatedPrincipal: config.gatewayProfile === "external",
  });

  const spacesAdminMcpFacadeService = (
    config.mainAdminMcpEnabled
    && orchestratorCommandService
  )
    ? new SpacesAdminMcpFacadeService({
      orchestratorCommandService,
      defaultTargetSpaceId: config.mainSpaceId,
      principalAuth: {
        strictVerification: config.httpPrincipalAuthStrict,
        hs256Secret: config.httpPrincipalAuthHs256Secret,
        maxClockSkewSeconds: config.httpPrincipalAuthMaxClockSkewSeconds,
      },
      requireAuthenticatedPrincipal: config.gatewayProfile === "external",
    })
    : null;

  if (spacesAdminMcpFacadeService) {
    logger.info("spaces-admin MCP facade enabled", {
      endpoint: "/mcp/spaces-admin",
      mainSpaceId: config.mainSpaceId,
    });
  }

  if (spaceTurnTraceService) {
    eventBus.on("space.turn_event", (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId || !turnId) return;
      const eventPayload = event?.event ?? {};
      const eventType = typeof eventPayload?.type === "string" ? eventPayload.type : "space.turn_event";
      spaceTurnTraceService?.recordTurnEvent({
        spaceId,
        turnId,
        agentId: typeof event?.agentId === "string" ? event.agentId : undefined,
        eventType,
        payload: eventPayload,
        createdAt: event?.timestamp instanceof Date
          ? event.timestamp.toISOString()
          : undefined,
      });
    });
  }

  if (runtimeLedgerService) {
    eventBus.on("space.turn_started", (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId || !turnId) return;
      runtimeLedgerService?.recordTurnStarted({
        spaceId,
        turnId,
        inputText: typeof event?.input === "string" ? event.input : "",
      });
    });

    eventBus.on("space.turn_event", (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId || !turnId || !event?.event || typeof event.event.type !== "string") return;
      runtimeLedgerService?.recordTurnEvent({
        spaceId,
        turnId,
        agentId: typeof event?.agentId === "string" ? event.agentId : undefined,
        event: event.event,
      });
    });
  }

  // ---- WebSocket server ----
  try {
    server = new GatewayServer({
      port: config.port,
      host: config.host,
      allowPortFallback: config.port === 9320,
      portFallbackRange: 100,
      maxPayloadLength: config.maxMessageSize,
      eventBus,
      a2aHandler,
      notificationHandler,
      syncHttpHandler: gatewaySyncService
        ? {
          announce: (payload) => gatewaySyncService.announcePeer(payload),
          query: (payload, authSecret) => gatewaySyncService.queryResources(payload, authSecret),
          pull: (payload, authSecret) => gatewaySyncService.pullResources(payload, authSecret),
        }
        : undefined,
      httpHandler: async (req, url) => {
        const observabilityResponse = await gatewayObservabilityApiService.handleRequest(req, url);
        if (observabilityResponse) return observabilityResponse;
        if (spacesAdminMcpFacadeService) {
          const mcpResponse = await spacesAdminMcpFacadeService.handleRequest(req, url);
          if (mcpResponse) return mcpResponse;
        }
        const relayResponse = await shareRelayApiService.handleRequest(req, url);
        if (relayResponse) return relayResponse;
        return spacesRestApiService.handleRequest(req, url);
      },
      validateDeviceIdentity: deviceIdentityService
        ? (input: {
          principalId: string;
          deviceId: string;
          devicePublicKey: string;
          platform?: string;
        }) => {
          const decision = deviceIdentityService.validateAuthenticatedDevice({
            principalId: input.principalId,
            deviceId: input.deviceId,
            publicKey: input.devicePublicKey,
            platform: input.platform,
          });
          return decision.allowed
            ? { allowed: true }
            : { allowed: false, reason: decision.reason };
        }
        : undefined,
      authorizeSubscribe: spaceSharingService
        ? ({ client, spaceUid, spaceId }) => {
          const resolvedSpaceId = spaceId?.trim();
          if (!resolvedSpaceId) {
            return {
              allowed: false,
              reason: `Unknown space UID: ${spaceUid}`,
            };
          }
          const decision = spaceSharingService.evaluateAccess({
            spaceId: resolvedSpaceId,
            principalId: client.publicKey?.trim(),
            action: "read",
          });
          return {
            allowed: decision.allowed,
            reason: decision.reason,
          };
        }
        : undefined,
      logger: logger.child({ module: "ws" }),
      onMessage: async (client, msg) => {
        return messageRouter.handle(client, msg);
      },
      onClientClose: (client) => {
        messageRouter.onClientDisconnected(client.id);
      },
      resolveSpaceUid: spaceAdminService
        ? async (spaceId: string) => {
          const space = await spaceAdminService.getSpace(spaceId);
          if (space?.spaceUid) {
            spaceIdByUidCache.set(space.spaceUid.trim().toLowerCase(), space.id);
          }
          return space?.spaceUid;
        }
        : undefined,
      resolveSpaceId: resolveSpaceIdFromUid,
      skipAuth: config.skipAuth,
      allowedOrigins: config.allowedOrigins,
      syncRequireSecret: config.syncRequireSecret,
      httpRateLimitRpm: config.httpRateLimitRpm,
      maxConnectionsPerIp: config.maxConnectionsPerIp,
      healthCheck: async (context?: { debug?: boolean }) => {
        const subsystems: Record<string, { status: "ok" | "degraded" | "error"; detail?: string }> = {};

        // Database
        subsystems.database = db
          ? { status: "ok", detail: config.dbPath }
          : { status: "degraded", detail: "Running without persistence" };

        // Memory providers
        const memProviders = memoryRegistry.list();
        subsystems.memory = memProviders.length > 0
          ? { status: "ok", detail: `${memProviders.length} provider(s)` }
          : { status: "degraded", detail: "No memory providers" };

        // Model router
        subsystems.modelRouter = modelRouter
          ? { status: "ok", detail: `${config.modelProvider}/${config.defaultModelId}` }
          : { status: "degraded", detail: "No model runtime configured" };

        // Middleware
        const mwCount = middleware.list().length;
        subsystems.middleware = { status: "ok", detail: `${mwCount} middleware registered` };

        // Checkpoint + DLQ
        subsystems.checkpoint = checkpointManager
          ? { status: "ok" }
          : { status: "degraded", detail: "No checkpoint manager" };

        subsystems.deadLetterQueue = deadLetterQueue
          ? { status: "ok" }
          : { status: "degraded", detail: "No dead letter queue" };

        const sandboxSlo = evaluateSandboxSlo({
          succeeded: sandboxRuntimeState.succeeded,
          failed: sandboxRuntimeState.failed,
          minSuccessRate: config.sandboxSloMinSuccessRate,
          minSamples: config.sandboxSloMinSamples,
        });
        if (sandboxRuntimeState.backendMode === "disabled") {
          subsystems.sandbox = {
            status: enforceSandboxRouting ? "degraded" : "ok",
            detail: enforceSandboxRouting
              ? "Sandbox routing enforced but backend disabled"
              : "Sandbox routing disabled",
          };
        } else if (sandboxRuntimeState.backendMode === "unavailable") {
          subsystems.sandbox = {
            status: "error",
            detail: "Sandbox backend unavailable",
          };
        } else if (sandboxRuntimeState.backendMode === "passthrough") {
          subsystems.sandbox = {
            status: config.gatewayProfile === "external" ? "error" : "degraded",
            detail: "Sandbox host passthrough active",
          };
        } else if (config.sandboxSloEnforce && sandboxSlo.evaluated && !sandboxSlo.meetsSlo) {
          subsystems.sandbox = {
            status: "error",
            detail: `Sandbox SLO breached (${sandboxSlo.successRate.toFixed(3)} < ${config.sandboxSloMinSuccessRate.toFixed(3)})`,
          };
        } else {
          subsystems.sandbox = {
            status: "ok",
            detail: `mode=${sandboxRuntimeState.backendMode}, samples=${sandboxSlo.samples}, successRate=${sandboxSlo.successRate.toFixed(3)}`,
          };
        }

        const relaySnapshot = gatewayObservabilityService.getRelaySnapshot();
        if (!config.relayShareV2Enabled) {
          subsystems.relay = {
            status: "ok",
            detail: "Relay share v2 disabled",
          };
        } else if (config.relaySloEnforce && relaySnapshot.overall.sloEvaluated && !relaySnapshot.overall.sloMet) {
          subsystems.relay = {
            status: "error",
            detail: `Relay SLO breached (${relaySnapshot.overall.successRate.toFixed(3)} < ${config.relaySloMinSuccessRate.toFixed(3)})`,
          };
        } else {
          subsystems.relay = {
            status: "ok",
            detail: [
              `samples=${relaySnapshot.overall.samples}`,
              `successRate=${relaySnapshot.overall.successRate.toFixed(3)}`,
              `resolve=${relaySnapshot.resolve.succeeded}/${relaySnapshot.resolve.attempted}`,
              `join=${relaySnapshot.join.succeeded}/${relaySnapshot.join.attempted}`,
            ].join(", "),
          };
        }

        // Overall status
        const hasError = Object.values(subsystems).some((s) => s.status === "error");
        const hasDegraded = Object.values(subsystems).some((s) => s.status === "degraded");

        const healthPayload: {
          status: "ok" | "degraded" | "error";
          uptime: number;
          clients: number;
          subsystems: Record<string, { status: "ok" | "degraded" | "error"; detail?: string }>;
          metadata: {
            gatewayId: string;
            gatewayProfile: GatewayCoreProfileId;
            gatewayUuid: string;
            spacesRoot?: string;
            mainSpaceId: string;
            mainSpaceName: string;
            mainSpaceResourceId: string;
            mainAgentId: string;
            mainProfileId: string;
            mainAgentStatus: "healthy" | "repaired" | "fallback" | "degraded";
          };
          degradation?: {
            reasons: Array<{
              subsystem: string;
              status: "degraded" | "error";
              detail?: string;
            }>;
          };
          debug?: Record<string, unknown>;
        } = {
          status: hasError ? "error" : hasDegraded ? "degraded" : "ok",
          uptime: Math.floor(process.uptime()),
          clients: server?.clientCount ?? 0,
          subsystems,
          metadata: {
            gatewayId: config.mainSpaceResourceId,
            gatewayProfile: config.gatewayProfile,
            gatewayUuid,
            spacesRoot: config.spacesRoot,
            mainSpaceId: config.mainSpaceId,
            mainSpaceName: config.mainSpaceName,
            mainSpaceResourceId: config.mainSpaceResourceId,
            mainAgentId: config.mainAgentId,
            mainProfileId: config.mainProfileId,
            mainAgentStatus: mainAgentHealthStatus,
          },
        };

        const degradationReasons: Array<{
          subsystem: string;
          status: "degraded" | "error";
          detail?: string;
        }> = [];
        for (const [subsystem, state] of Object.entries(subsystems)) {
          if (state.status === "degraded" || state.status === "error") {
            degradationReasons.push({
              subsystem,
              status: state.status,
              detail: state.detail,
            });
          }
        }
        if (degradationReasons.length > 0) {
          healthPayload.degradation = { reasons: degradationReasons };
        }

        const debugEnabled = config.healthDebug || context?.debug === true;
        if (debugEnabled) {
          const defaultMemoryProviderId = memoryRegistry.getDefault()?.id ?? null;
          const mcpStats = spaceMcpService.getHealthStats();
          healthPayload.debug = {
            requestedViaQuery: context?.debug === true,
            enabledViaConfig: config.healthDebug,
            generatedAt: new Date().toISOString(),
            runtime: {
              host: config.host,
              port: config.port,
              dbPath: config.dbPath,
              spacesRoot: config.spacesRoot,
              gatewayUuid,
              gatewayProfile: config.gatewayProfile,
              modelProvider: config.modelProvider ?? null,
              defaultModelId: config.defaultModelId ?? null,
              appleFoundationProviderEnabled: config.enableAppleFoundationProvider,
              mcpEndpointConfigured: Boolean(config.mcpEndpoint),
              perSpaceMcpEndpointCount: mcpStats.configuredSpaceEndpoints,
              perSpaceMcpConnectedCount: mcpStats.connectedSpaceEndpoints,
              externalMcpBindingCount: mcpStats.externalBindings,
              mem0Configured: Boolean(config.mem0ApiKey),
              lettaConfigured: Boolean(config.lettaBaseUrl),
              checkpointEnabled: checkpointManager !== null,
              deadLetterQueueEnabled: deadLetterQueue !== null,
              sandbox: {
                enforceSandboxRouting: sandboxRuntimeState.enforceSandboxRouting,
                backendMode: sandboxRuntimeState.backendMode,
                routed: sandboxRuntimeState.routed,
                succeeded: sandboxRuntimeState.succeeded,
                failed: sandboxRuntimeState.failed,
                successRate: sandboxSlo.successRate,
                samples: sandboxSlo.samples,
                minSuccessRate: config.sandboxSloMinSuccessRate,
                minSamples: config.sandboxSloMinSamples,
                sloEvaluated: sandboxSlo.evaluated,
                sloMet: sandboxSlo.meetsSlo,
                sloEnforced: config.sandboxSloEnforce,
                belowSloSince: sandboxRuntimeState.belowSloSince ?? null,
                lastFailureAt: sandboxRuntimeState.lastFailureAt ?? null,
                lastFailureMessage: sandboxRuntimeState.lastFailureMessage ?? null,
              },
              relay: relaySnapshot,
            },
            memoryProviders: memProviders.map((provider) => ({
              id: provider.id,
              name: provider.name,
              available: provider.available,
              default: provider.id === defaultMemoryProviderId,
            })),
            degradationReasons,
          };
        }

        return healthPayload;
      },
    });

    server.start();
    const configuredPort = config.port;
    const resolvedPort = server.port;
    if (resolvedPort !== configuredPort) {
      logger.warn("Configured port unavailable; using fallback port", {
        host: config.host,
        configuredPort,
        resolvedPort,
      });
      config.port = resolvedPort;
    }
    const effectiveBaseUrl = `http://${config.host}:${config.port}`;
    const a2aMutable = a2aHandler as unknown as {
      setBaseUrl?: (baseUrl: string) => void;
      options?: { baseUrl?: string };
    };
    if (typeof a2aMutable.setBaseUrl === "function") {
      a2aMutable.setBaseUrl(effectiveBaseUrl);
    } else if (a2aMutable.options) {
      // Compatibility with older compiled package output that lacks setBaseUrl().
      a2aMutable.options.baseUrl = effectiveBaseUrl;
    }

    logger.info("WebSocket server listening", {
      port: config.port,
      host: config.host,
      a2a: `${effectiveBaseUrl}/.well-known/agent.json`,
      subsystems: [
        "middleware",
        "memory",
        "notifications",
        db ? "checkpoint" : null,
        db ? "dead-letter" : null,
        db ? "experience-generator" : null,
        db ? "workflow-visualizer" : null,
        config.mem0ApiKey ? "mem0" : null,
        config.lettaBaseUrl ? "letta" : null,
        config.enableTracing ? "tracing" : null,
        config.enableResilience ? "resilience" : null,
        "plugin-system",
        "agent-versioning",
        configReloader ? "config-hot-reload" : null,
      ].filter(Boolean),
    });

    if (config.heartbeatIntervalMs > 0) {
      heartbeatTimer = setInterval(() => {
        logger.info("Gateway heartbeat", {
          port: config.port,
          host: config.host,
          clients: server?.clientCount ?? 0,
          uptimeSec: Math.floor(process.uptime()),
          rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)),
        });
      }, config.heartbeatIntervalMs);
      heartbeatTimer.unref?.();

      logger.info("Gateway heartbeat logging enabled", {
        intervalMs: config.heartbeatIntervalMs,
      });
    }

    if (orchestrationJournalRepo) {
      journalPruneTimer = setInterval(() => {
        try {
          const cutoffIso = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString();
          const deleted = orchestrationJournalRepo!.pruneBefore(cutoffIso);
          if (deleted > 0) {
            logger.info("Pruned orchestration journal entries", { deleted });
          }
        } catch (error) {
          logger.warn("Failed to prune orchestration journal entries", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, 24 * 60 * 60 * 1000);
      journalPruneTimer.unref?.();
    }

    if (schedulerService) {
      const schedulerTickIntervalRaw = parseOptionalNumberEnv(Bun.env.SPACESKIT_SCHEDULER_TICK_MS);
      const schedulerTickIntervalMs = schedulerTickIntervalRaw !== undefined && schedulerTickIntervalRaw > 0
        ? Math.max(1000, Math.floor(schedulerTickIntervalRaw))
        : 15_000;

      schedulerTimer = setInterval(() => {
        void schedulerService!.runDueJobsTick(100)
          .then((executed) => {
            if (executed > 0) {
              logger.info("Scheduler tick executed jobs", { executed });
            }
          })
          .catch((error) => {
            logger.warn("Scheduler tick failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }, schedulerTickIntervalMs);
      schedulerTimer.unref?.();

      logger.info("Scheduler loop started", {
        tickIntervalMs: schedulerTickIntervalMs,
      });
    }

    if (spaceShareInviteRepo || spaceChangeSetService || spaceQuotaService) {
      const maintenanceIntervalRaw = parseOptionalNumberEnv(Bun.env.SPACESKIT_COLLAB_MAINTENANCE_TICK_MS);
      const maintenanceIntervalMs = maintenanceIntervalRaw !== undefined && maintenanceIntervalRaw > 0
        ? Math.max(60_000, Math.floor(maintenanceIntervalRaw))
        : 60 * 60 * 1000;

      const runMaintenance = async () => {
        try {
          const nowIso = new Date().toISOString();
          const expiredInvites = spaceShareInviteRepo?.expireBefore(nowIso) ?? 0;
          const changesetMaintenance = spaceChangeSetService
            ? await spaceChangeSetService.runMaintenance()
            : { expiredDrafts: 0, expiredByTtl: 0, purgedStaging: 0 };
          spaceQuotaService?.reconcileMonthlyCounters();

          if (
            expiredInvites > 0
            || changesetMaintenance.expiredDrafts > 0
            || changesetMaintenance.expiredByTtl > 0
            || changesetMaintenance.purgedStaging > 0
          ) {
            logger.info("Collaboration lifecycle maintenance complete", {
              expiredInvites,
              expiredDrafts: changesetMaintenance.expiredDrafts,
              expiredByTtl: changesetMaintenance.expiredByTtl,
              purgedStaging: changesetMaintenance.purgedStaging,
            });
          }
        } catch (error) {
          logger.warn("Collaboration lifecycle maintenance failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      await runMaintenance();
      lifecycleMaintenanceTimer = setInterval(() => {
        void runMaintenance();
      }, maintenanceIntervalMs);
      lifecycleMaintenanceTimer.unref?.();
      logger.info("Collaboration lifecycle maintenance loop started", {
        tickIntervalMs: maintenanceIntervalMs,
      });
    }
  } catch (err) {
    logger.error("WebSocket server failed to start", err);
  }

  // ---- Graceful shutdown ----
  const shutdown = async () => {
    logger.info("Shutting down gateway...");
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (journalPruneTimer) {
      clearInterval(journalPruneTimer);
      journalPruneTimer = null;
    }
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    if (lifecycleMaintenanceTimer) {
      clearInterval(lifecycleMaintenanceTimer);
      lifecycleMaintenanceTimer = null;
    }
    gatewayObservabilityService.stop();
    configReloader?.stop();
    // Deactivate all active plugins
    for (const plugin of pluginSystem.listPlugins()) {
      if (plugin.status === "active") {
        try { await pluginSystem.deactivate(plugin.manifest.id); } catch { /* best-effort */ }
      }
    }
    try {
      await server?.drain(config.drainTimeoutMs);
      await server?.stop();
    } catch (err) {
      logger.error("Error stopping server", err);
    }
    db?.close();
    logger.info("Gateway stopped");
  };

  process.on("SIGINT", () => {
    shutdown().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    shutdown().then(() => process.exit(0));
  });

  return {
    config,
    logger,
    eventBus,
    capabilities,
    middleware,
    spaceManager,
    spaceAdminService,
    gatewayAdminService,
    connectorAdminService,
    memoryRegistry,
    notificationService,
    checkpointManager,
    deadLetterQueue,
    modelRouter,
    pluginSystem,
    agentVersionManager,
    configReloader,
    db,
    server,
    shutdown,
  };
}

interface PersistedTurnRowLike {
  turn_id: string;
  user_turn_id?: string | null;
  actor_id: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  token_input_count?: number | null;
  token_output_count?: number | null;
  created_at: string;
  completed_at: string | null;
  reply_to_turn_id?: string | null;
}

function mapTurnRowToSpaceTurnPayload(row: PersistedTurnRowLike): {
  turnId: string;
  agentId: string;
  status: string;
  inputText?: string;
  outputText?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
  completedAt?: string;
  replyToTurnId?: string;
} {
  const inputText = parseTurnText(row.input_json);
  const outputText = parseTurnText(row.output_json);
  const promptTokens = normalizeTokenCount(row.token_input_count);
  const completionTokens = normalizeTokenCount(row.token_output_count);
  const userTurnId = row.user_turn_id?.trim();
  const logicalTurnId = userTurnId && userTurnId.length > 0
    ? userTurnId
    : row.turn_id;
  return {
    turnId: logicalTurnId,
    agentId: row.actor_id || "unknown-agent",
    status: row.status,
    inputText,
    outputText,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    replyToTurnId: row.reply_to_turn_id?.trim() || undefined,
  };
}

function parseTurnText(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string") {
      const normalized = parsed.trim();
      return normalized.length > 0 ? normalized : undefined;
    }
    if (parsed && typeof parsed === "object") {
      const object = parsed as Record<string, unknown>;
      for (const key of ["text", "content", "message", "error"]) {
        const value = object[key];
        if (typeof value === "string") {
          const normalized = value.trim();
          if (normalized.length > 0) return normalized;
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

interface SessionBoundaryTurnLike extends HandoffTurnLike {
  user_turn_id: string;
}

interface SessionBoundaryTurnRepository {
  listBySpaceAndAgent: (
    spaceId: string,
    agentId: string,
    limit?: number,
    offset?: number,
  ) => SessionBoundaryTurnLike[];
  listBySpaceAndAgentSince?: (
    spaceId: string,
    agentId: string,
    sinceIso: string,
    limit?: number,
  ) => SessionBoundaryTurnLike[];
}

export function listTurnsForActiveSessionBoundary(
  turnRepo: SessionBoundaryTurnRepository,
  spaceId: string,
  agentId: string,
  startedAtIso: string,
  limit: number,
): SessionBoundaryTurnLike[] {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (typeof turnRepo.listBySpaceAndAgentSince === "function") {
    return turnRepo.listBySpaceAndAgentSince(spaceId, agentId, startedAtIso, normalizedLimit);
  }

  // Backward-compatible fallback for stale persistence package builds that
  // do not yet expose listBySpaceAndAgentSince at runtime.
  return turnRepo
    .listBySpaceAndAgent(spaceId, agentId, normalizedLimit)
    .filter((turn) => turn.created_at >= startedAtIso);
}

export interface HandoffTurnLike {
  turn_id: string;
  created_at: string;
  input_json: string | null;
  output_json: string | null;
}

export function buildDeterministicHandoffDigest(turns: HandoffTurnLike[], maxExchanges = 8): string {
  const sortedTurns = [...turns].sort((lhs, rhs) => {
    if (lhs.created_at !== rhs.created_at) {
      return lhs.created_at.localeCompare(rhs.created_at);
    }
    return lhs.turn_id.localeCompare(rhs.turn_id);
  });
  const exchanges = sortedTurns
    .map((turn) => ({
      user: normalizeDigestText(parseTurnText(turn.input_json)),
      assistant: normalizeDigestText(parseTurnText(turn.output_json)),
    }))
    .filter((exchange) => Boolean(exchange.user || exchange.assistant));
  const selectedExchanges = exchanges.slice(-Math.max(1, Math.floor(maxExchanges)));

  const lines: string[] = [
    "# Mock Handoff Digest",
    "",
    "Deterministic summary of recent turns from before the active usage-session boundary.",
    "Use this as prior context only; runtime state for the current session is otherwise fresh.",
    "",
  ];

  if (selectedExchanges.length === 0) {
    lines.push("No usable pre-boundary turns were found.");
    return lines.join("\n");
  }

  selectedExchanges.forEach((exchange, index) => {
    lines.push(`${index + 1}. User: ${clipDigestText(exchange.user ?? "(none)")}`);
    lines.push(`   Assistant: ${clipDigestText(exchange.assistant ?? "(none)")}`);
  });

  return lines.join("\n");
}

function normalizeDigestText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function clipDigestText(value: string, maxLength = 280): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

async function writeDeterministicHandoffDigest(
  sharedContextPath: string,
  agentId: string,
  digestMarkdown: string,
): Promise<string> {
  const safeAgentPath = sanitizePathSegment(agentId);
  const handoffDirectory = join(sharedContextPath, "agent-handoff", safeAgentPath);
  await mkdir(handoffDirectory, { recursive: true });
  const filePath = join(handoffDirectory, "latest.md");
  await writeFile(filePath, digestMarkdown, "utf8");
  return filePath;
}

function sanitizePathSegment(value: string): string {
  const normalized = value.trim().replace(/[\\/]+/g, "_");
  return normalized.length > 0 ? normalized : "agent";
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function parseSharingIdentityPolicyFromSpaceConfig(
  config: Record<string, unknown>,
): SharingIdentityPolicy | undefined {
  const candidate = (
    (isRecord(config.sharingIdentityPolicy) && config.sharingIdentityPolicy)
    || (isRecord(config.sharing_identity_policy) && config.sharing_identity_policy)
  ) as Record<string, unknown> | undefined;
  if (!candidate) return undefined;

  const modeRaw = normalizeOptionalString(candidate.mode)
    ?? normalizeOptionalString(candidate.identityMode)
    ?? normalizeOptionalString(candidate.identity_mode);
  const mode = modeRaw === "strict_apple_id" ? "strict_apple_id" : "device_key";

  const allowFallbackRaw = candidate.allowDeviceKeyFallback;
  const allowFallback = typeof allowFallbackRaw === "boolean"
    ? allowFallbackRaw
    : candidate.allow_device_key_fallback === true;

  return {
    mode,
    allowDeviceKeyFallback: allowFallback,
  };
}

function normalizeTokenCount(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function toProfileSummaryPayload(
  row: {
    profile_id: string;
    name: string;
    description: string;
    can_moderate: number;
    is_default: number;
    active_revision: number;
    archived: number;
    created_at: string;
    updated_at: string;
  },
  revision: {
    personality_prompt?: string;
    default_skill_set_ids_json?: string;
    provider_hint?: string;
    model_hint?: string;
    model_config_json?: string;
    source?: string;
  } | undefined,
): {
  profileId: string;
  name: string;
  description: string;
  personalityPrompt: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig: {
    preferredModels: string[];
    fallbackModels?: string[];
    constraints?: Record<string, unknown>;
  };
  canModerate: boolean;
  isDefault: boolean;
  status: "active" | "archived";
  activeRevision: number;
  source: string;
  createdAt: string;
  updatedAt: string;
} {
  const modelConfig = parseProfileModelConfig(revision?.model_config_json, revision?.model_hint);
  return {
    profileId: row.profile_id,
    name: row.name,
    description: row.description,
    personalityPrompt: revision?.personality_prompt ?? "",
    defaultSkillIds: parseJsonStringArray(revision?.default_skill_set_ids_json),
    providerHint: revision?.provider_hint || undefined,
    modelHint: modelConfig.preferredModels[0] ?? revision?.model_hint ?? undefined,
    modelConfig,
    canModerate: row.can_moderate === 1,
    isDefault: row.is_default === 1,
    status: row.archived === 1 ? "archived" : "active",
    activeRevision: row.active_revision,
    source: revision?.source ?? "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

function parseProfileModelConfig(
  raw: string | null | undefined,
  modelHint: string | null | undefined,
): {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
} {
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const preferredModels = normalizeStringArray(parsed.preferredModels);
      const fallbackModels = normalizeStringArray(parsed.fallbackModels);
      const constraints = isRecord(parsed.constraints) ? parsed.constraints : undefined;
      return {
        preferredModels: preferredModels.length > 0
          ? preferredModels
          : (modelHint?.trim() ? [modelHint.trim()] : []),
        ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
        ...(constraints ? { constraints } : {}),
      };
    } catch {
      // Fallback below.
    }
  }

  return {
    preferredModels: modelHint?.trim() ? [modelHint.trim()] : [],
    fallbackModels: [],
  };
}

function normalizeProfileModelConfig(
  value: { preferredModels: string[]; fallbackModels?: string[]; constraints?: Record<string, unknown> } | undefined,
  modelHint?: string,
): {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
} {
  const preferredModels = normalizeStringArray(value?.preferredModels);
  const fallbackModels = normalizeStringArray(value?.fallbackModels);
  if (preferredModels.length === 0 && modelHint?.trim()) {
    preferredModels.push(modelHint.trim());
  }

  return {
    preferredModels,
    ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
    ...(value?.constraints ? { constraints: value.constraints } : {}),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function collectFilesystemPathCandidatesByKeys(
  args: Record<string, unknown>,
  pathArgs: string[],
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (!normalized) return;
    candidates.push(normalized);
  };

  for (const key of pathArgs) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    for (const value of resolvePathArgValues(args, normalizedKey)) {
      pushCandidate(value);
    }
  }

  return uniqueStrings(candidates);
}

function resolvePathArgValues(args: Record<string, unknown>, pathArg: string): unknown[] {
  const parts = pathArg.split(".").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (parts.length === 0) return [];

  const walk = (value: unknown, idx: number): unknown[] => {
    if (idx >= parts.length) return [value];
    if (!isRecord(value)) return [];
    const next = value[parts[idx]];
    if (Array.isArray(next)) {
      return next.flatMap((entry) => walk(entry, idx + 1));
    }
    return walk(next, idx + 1);
  };

  return walk(args, 0);
}

function evaluateSandboxSlo(input: {
  succeeded: number;
  failed: number;
  minSuccessRate: number;
  minSamples: number;
}): {
  samples: number;
  successRate: number;
  evaluated: boolean;
  meetsSlo: boolean;
} {
  const succeeded = Math.max(0, input.succeeded);
  const failed = Math.max(0, input.failed);
  const samples = succeeded + failed;
  const successRate = samples === 0 ? 1 : succeeded / samples;
  const evaluated = samples >= Math.max(1, input.minSamples);
  const meetsSlo = !evaluated || successRate >= clampFraction(input.minSuccessRate, 0.99);
  return {
    samples,
    successRate,
    evaluated,
    meetsSlo,
  };
}

function resolveCapabilityOperationMetadata(
  capabilityRegistry: Record<string, unknown>,
  invocation: {
    capability: string;
    operation: string;
    args: Record<string, unknown>;
    targetProvider?: string;
  },
  spaceId?: string,
): {
  filesystemWrite: boolean;
  pathArgs: string[];
} {
  const fallback = {
    filesystemWrite:
      invocation.capability === "files" && isLikelyFilesystemWriteOperationName(invocation.operation),
    pathArgs: [
      "path",
      "filePath",
      "targetPath",
      "sourcePath",
      "destinationPath",
      "directory",
      "cwd",
    ],
  };

  const maybeResolver = capabilityRegistry.getOperationMetadata;
  if (typeof maybeResolver !== "function") {
    return fallback;
  }

  try {
    const resolved = maybeResolver.call(capabilityRegistry, invocation, spaceId);
    if (!isRecord(resolved)) {
      return fallback;
    }
    const pathArgs = Array.isArray(resolved.pathArgs)
      ? resolved.pathArgs.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : fallback.pathArgs;
    const filesystemWrite = typeof resolved.filesystemWrite === "boolean"
      ? resolved.filesystemWrite
      : fallback.filesystemWrite;
    return {
      filesystemWrite,
      pathArgs,
    };
  } catch {
    return fallback;
  }
}

function resolveCapabilityExecutionRoute(
  input: CapabilityExecutionRoutingInput,
  options: {
    enforceSandboxRouting: boolean;
  },
): {
  backend: "host" | "sandbox";
  reason?: string;
} {
  const isFilesystemOperation = input.invocation.capability === "files";
  const requiresRiskyExecution = input.operationMetadata.requiresShell === true
    || isFilesystemOperation
    || input.operationMetadata.filesystemWrite === true;
  if (!requiresRiskyExecution) {
    return { backend: "host" };
  }
  if (!options.enforceSandboxRouting) {
    return { backend: "host" };
  }

  const isGuestOrigin = input.context?.executionOrigin === "guest";
  if (isGuestOrigin) {
    return {
      backend: "sandbox",
      reason: "guest_risky_operation_requires_sandbox",
    };
  }

  const isConnectorOrigin = input.context?.executionOrigin === "connector"
    || input.provider.source === "connector";
  if (isConnectorOrigin) {
    return {
      backend: "sandbox",
      reason: "connector_risky_operation_requires_sandbox",
    };
  }

  return { backend: "host" };
}

function isLikelyFilesystemWriteOperationName(operationRaw: string): boolean {
  const operation = operationRaw.trim().toLowerCase();
  if (!operation) return false;
  return (
    operation.includes("write")
    || operation.includes("append")
    || operation.includes("create")
    || operation.includes("update")
    || operation.includes("save")
    || operation.includes("delete")
    || operation.includes("remove")
    || operation.includes("rename")
    || operation.includes("move")
    || operation.includes("mkdir")
    || operation.includes("touch")
    || operation.includes("copy")
  );
}

function extractFilesystemScopes(scope: AgentSecurityScope | undefined): string[] {
  if (!scope) return [];
  const raw = scope.filesystemScopes?.length
    ? scope.filesystemScopes
    : [scope.filesystemScope];
  return raw
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function fileUriToFilesystemPath(uri: string): string | null {
  const normalized = uri.trim();
  if (!normalized) return null;
  if (normalized.startsWith("file://")) {
    try {
      const url = new URL(normalized);
      return decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  return normalized;
}

function firstPreferredModelFromConfig(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as { preferredModels?: unknown };
    if (!Array.isArray(parsed.preferredModels)) return undefined;
    const first = parsed.preferredModels.find((entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
    );
    return first?.trim();
  } catch {
    return undefined;
  }
}

function applyEffectiveSkillContext(
  systemPrompt: string,
  skillIds: string[],
  activeSkillMarkdownById?: Map<string, string>,
): string {
  const normalizedSkillIds = uniqueStrings(
    skillIds
      .map((skillId) => skillId.trim())
      .filter((skillId) => skillId.length > 0),
  );

  if (normalizedSkillIds.length === 0) {
    return systemPrompt;
  }

  const resolvedSections: string[] = [];
  const unresolvedSkillIds: string[] = [];

  for (const skillId of normalizedSkillIds) {
    const markdown = activeSkillMarkdownById?.get(skillId)?.trim();
    if (markdown && markdown.length > 0) {
      resolvedSections.push(`## ${skillId}\n${markdown}`);
    } else {
      unresolvedSkillIds.push(skillId);
    }
  }

  const appendixParts: string[] = [];
  if (resolvedSections.length > 0) {
    appendixParts.push("Active skill context from gateway catalog:");
    appendixParts.push(...resolvedSections);
  }
  if (unresolvedSkillIds.length > 0) {
    appendixParts.push("Active skill IDs (content unavailable):");
    appendixParts.push(...unresolvedSkillIds.map((skillId) => `- ${skillId}`));
  }

  const appendix = appendixParts.join("\n\n");
  const trimmed = systemPrompt.trim();
  if (!trimmed) return appendix;
  return `${trimmed}\n\n${appendix}`;
}

async function buildWorkspaceContextBlock(
  workspaceService: SpaceWorkspaceService,
  spaceId: string,
  agentId: string,
): Promise<string | undefined> {
  const workspace = await workspaceService.ensureWorkspace(spaceId);
  const scratchpadPath = await workspaceService.getAgentScratchpadPath(spaceId, agentId);
  const lines = [
    "Workspace context:",
    `- Workspace root: ${workspace.effectiveWorkspaceRoot}`,
    `- Work directory: ${workspace.workPath}`,
    `- Shared context directory: ${workspace.sharedContextPath}`,
    `- Your scratchpad file: ${scratchpadPath}`,
    "Rules:",
    "- Shared-context writes must target Markdown files (.md).",
    "- Scratchpad writes must target your own scratchpad file only.",
  ];
  return lines.join("\n");
}

function appendWorkspaceContext(systemPrompt: string, workspaceContext?: string): string {
  const trimmedPrompt = systemPrompt.trim();
  const trimmedWorkspace = workspaceContext?.trim();
  if (!trimmedWorkspace) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedWorkspace;
  return `${trimmedPrompt}\n\n${trimmedWorkspace}`;
}

const TOOL_USAGE_GUIDANCE_MARKER = "Tool execution guidance:";

function appendToolUsageGuidance(systemPrompt: string): string {
  const trimmedPrompt = systemPrompt.trim();
  if (trimmedPrompt.includes(TOOL_USAGE_GUIDANCE_MARKER)) {
    return trimmedPrompt;
  }

  const guidance = [
    TOOL_USAGE_GUIDANCE_MARKER,
    "- If a user asks for external or system data (for example reminders, files, calendar, network, or shell output), use relevant tools/capabilities when available.",
    "- Do not claim you lack access until you check or attempt relevant tools.",
    "- If no relevant tools are available, state that clearly and name the missing capability/tool.",
  ].join("\n");

  if (!trimmedPrompt) {
    return guidance;
  }
  return `${trimmedPrompt}\n\n${guidance}`;
}

function appendNativeCliToolUsageGuidance(systemPrompt: string, providerId: string): string {
  const trimmedPrompt = systemPrompt.trim();
  const guidance = [
    "Native executor tooling guidance:",
    `- You are running through the ${providerId} native CLI executor.`,
    "- Use the selected workspace as your execution root when invoking native executor tools.",
    "- Spaces gateway connectors/tools are not available on this execution path.",
    "- If you use native executor tools, say so plainly in the response when it matters to the outcome.",
  ].join("\n");

  if (!trimmedPrompt) {
    return guidance;
  }
  return `${trimmedPrompt}\n\n${guidance}`;
}

// ---------------------------------------------------------------------------
// CLI entry point — runs when invoked directly with Bun
// ---------------------------------------------------------------------------

if (import.meta.main) {
  startGateway().catch((err) => {
    console.error("Fatal error starting gateway:", err);
    process.exit(1);
  });
}
