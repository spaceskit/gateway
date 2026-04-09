import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";

// ---------------------------------------------------------------------------
// Profile resolution
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
  /** Default concierge backing space ID ensured on startup. */
  conciergeSpaceId: string;
  /** Display name for the default concierge backing space. */
  conciergeSpaceName: string;
  /** Resource ID assigned to the default concierge backing space. */
  conciergeSpaceResourceId: string;
  /** Default goal text for the concierge backing space. */
  conciergeSpaceGoal: string;
  /** Default concierge profile ID ensured on startup. */
  conciergeProfileId: string;
  /** Default concierge agent ID ensured on startup. */
  conciergeAgentId: string;
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
   * External gateways always require strict signed-bearer verification.
   */
  httpPrincipalAuthStrict: boolean;
  /**
   * Tracks an invalid external-profile attempt to disable strict HTTP principal auth via env.
   * Startup must fail closed when this is set.
   */
  httpPrincipalAuthStrictExplicitDisable: boolean;
  /** Shared secret used to verify signed HTTP principal bearer tokens. */
  httpPrincipalAuthHs256Secret?: string;
  /** Allowed clock skew, in seconds, when validating signed HTTP principal bearer claims. */
  httpPrincipalAuthMaxClockSkewSeconds: number;
}
