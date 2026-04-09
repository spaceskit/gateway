import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { Logger } from "@spaceskit/observability";
import type { VoiceProviderSource } from "./services/voice-routing-service.js";
import type { GatewayConfig } from "./config-types.js";
import { resolveGatewayProfile } from "./config-types.js";

export type { GatewayConfig } from "./config-types.js";
export { resolveGatewayProfile } from "./config-types.js";

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
  const defaultConciergeSpaceId = gatewayProfile === "external" ? "external-concierge-space" : "concierge-space";
  const defaultConciergeSpaceName = `${gatewayProfileLabel} Concierge`;
  const mainSpaceId = Bun.env.SPACESKIT_MAIN_SPACE_ID ?? defaultMainSpaceId;
  const mainSpaceName = Bun.env.SPACESKIT_MAIN_SPACE_NAME ?? defaultMainSpaceName;
  const mainSpaceResourceId = Bun.env.SPACESKIT_MAIN_RESOURCE_ID ?? defaultMainResourceId;
  const mainSpaceGoal = Bun.env.SPACESKIT_MAIN_SPACE_GOAL
    ?? "Default shared space for gateway startup and orchestrator coordination.";
  const mainProfileId = Bun.env.SPACESKIT_MAIN_PROFILE_ID ?? "main-profile";
  const mainOrchestratorProfileId = Bun.env.SPACESKIT_MAIN_ORCHESTRATOR_PROFILE_ID
    ?? mainProfileId;
  const mainAgentId = Bun.env.SPACESKIT_MAIN_AGENT_ID ?? "main-agent";
  const conciergeSpaceId = Bun.env.SPACESKIT_CONCIERGE_SPACE_ID ?? defaultConciergeSpaceId;
  const defaultConciergeResourceId = `system.concierge.backing-space.${conciergeSpaceId}`;
  const conciergeSpaceName = Bun.env.SPACESKIT_CONCIERGE_SPACE_NAME ?? defaultConciergeSpaceName;
  const conciergeSpaceResourceId = Bun.env.SPACESKIT_CONCIERGE_RESOURCE_ID ?? defaultConciergeResourceId;
  const conciergeSpaceGoal = Bun.env.SPACESKIT_CONCIERGE_SPACE_GOAL
    ?? "Dedicated concierge backing space for app navigation, routing, and call continuity.";
  const conciergeProfileId = Bun.env.SPACESKIT_CONCIERGE_PROFILE_ID ?? "concierge-profile";
  const conciergeAgentId = Bun.env.SPACESKIT_CONCIERGE_AGENT_ID ?? "concierge-agent";
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
  const httpPrincipalAuthStrictExplicitDisable =
    gatewayProfile === "external" && httpPrincipalAuthStrictEnv === false;
  const httpPrincipalAuthStrict = gatewayProfile === "external"
    ? true
    : (httpPrincipalAuthStrictEnv ?? false);
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
    conciergeSpaceId,
    conciergeSpaceName,
    conciergeSpaceResourceId,
    conciergeSpaceGoal,
    conciergeProfileId,
    conciergeAgentId,
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
    httpPrincipalAuthStrictExplicitDisable,
    httpPrincipalAuthHs256Secret,
    httpPrincipalAuthMaxClockSkewSeconds,
  };
}

export function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
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

export function parseOptionalNumberEnv(value: string | undefined): number | undefined {
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

export function parseVoiceSourceEnv(value: string | undefined): VoiceProviderSource | undefined {
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

export async function probeAppleFoundationAvailability(
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

export function resolveDbRootFolder(dbPath: string): string | undefined {
  const normalized = dbPath.trim();
  if (!normalized || normalized === ":memory:") {
    return undefined;
  }

  const absoluteDbPath = resolve(normalized);
  return dirname(absoluteDbPath);
}

export function defaultSpacesRootForHost(
  gatewayProfile: GatewayConfig["gatewayProfile"],
  databaseRootFolder?: string,
): string {
  if (process.platform === "darwin" && gatewayProfile === "embedded") {
    return resolve(homedir(), "Documents", "Spaces");
  }
  return resolve(databaseRootFolder ?? ".", "spaces");
}
