import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Logger } from "@spaceskit/observability";
import type {
  IntegrationRequestRepository,
  ProfileModelConfig,
  ProfileRepository,
  ProviderConfigRepository,
  ProviderConfigRow,
  SpaceRepository,
} from "@spaceskit/persistence";
import type { SpaceAdminService } from "@spaceskit/core";
import { inferContextWindow, USER_ESCALATION_SKILL_ID } from "@spaceskit/core";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type {
  GatewayConciergeAgentStatePayload,
  GatewayGetConciergeAgentPayload,
  GatewayGetMainAgentPayload,
  GatewayCreateIntegrationRequestPayload,
  GatewayCreateIntegrationRequestResponsePayload,
  GatewayProviderAuthAccountPayload,
  GatewayProviderAuthModePayload,
  GatewayProviderAuthStatusPayload,
  GatewayIntegrationClassPayload,
  GatewayIntegrationStatusPayload,
  GatewayListInterconnectorsPayload,
  GatewayListInterconnectorsResponsePayload,
  GatewayListToolApprovalGrantsPayload,
  GatewayListToolApprovalGrantsResponsePayload,
  GatewayListToolsPayload,
  GatewayListToolsResponsePayload,
  GatewayListIntegrationRequestsPayload,
  GatewayListIntegrationRequestsResponsePayload,
  GatewayMainAgentStatePayload,
  GatewaySetConciergeAgentPayload,
  GatewayRegisterToolPayload,
  GatewayRegisterToolResponsePayload,
  GatewayRevokeToolApprovalGrantPayload,
  GatewayRevokeToolApprovalGrantResponsePayload,
  GatewayRescanInterconnectorsPayload,
  GatewayRescanInterconnectorsResponsePayload,
  GatewayScaffoldToolPayload,
  GatewayScaffoldToolResponsePayload,
  GatewaySetMainAgentPayload,
  GatewayModelCatalogEntryPayload,
  GatewayModelCatalogSourcePayload,
  GatewayModelDetectionStatusPayload,
  GatewayModelProviderCatalogPayload,
  GatewaySetToolEnabledPayload,
  GatewaySetToolEnabledResponsePayload,
  MainAgentSelectionMode,
  GatewayProviderCatalogGroupPayload,
  ProviderTelemetryPayload,
  ProviderTelemetrySourcePayload,
  ProviderTelemetryWindowPayload,
  ProviderUsageSnapshotPayload,
  ProviderRuntimeConfigPayload,
  GatewayGetToolResponsePayload,
  GatewayRemoveToolResponsePayload,
} from "@spaceskit/server";
import {
  ClaudeAgentSdkModelProvider,
  type ClaudeAgentSdkAuthAccount,
  type ClaudeAgentSdkProbeResult,
} from "@spaceskit/provider-runtime";
import type {
  ProviderSecretRefService,
  ProviderSecretRefSummary,
} from "./services/provider-secret-ref-service.js";
import type { InterconnectorCatalogService } from "./services/interconnector-catalog-service.js";
import type { UsageSnapshotService } from "./services/usage-snapshot-service.js";
import type { LocalUsageTelemetryService } from "./services/local-usage-telemetry-service.js";
import type { LocalProviderUsageTelemetry } from "./services/local-usage-telemetry-types.js";
import type { CliToolService } from "./services/cli-tool-service.js";
import type { AccessGrantService } from "./services/access-grant-service.js";
import type { ToolApprovalGrantService } from "./services/tool-approval-grant-service.js";
import { classifyExecutionAdapter, mapExecutionClassToCatalogGroup } from "./execution/execution-adapter-factory.js";
import { LocalExecutableResolver } from "./execution/local-executable-resolver.js";

export interface DiscoveredLocalAgent {
  id: string;
  name: string;
  detected: boolean;
  executablePath?: string;
  appPath?: string;
  serviceReachable?: boolean;
  recommendedProviderId: string;
  recommendedModel: string;
  requiresApiKey: boolean;
  availableModels?: string[];
  detectionError?: string;
  notes?: string;
}

export type GatewayModelDetectionStatus = GatewayModelDetectionStatusPayload;
export type GatewayModelCatalogSource = GatewayModelCatalogSourcePayload;
export type GatewayProviderCatalogGroup = GatewayProviderCatalogGroupPayload;
export type GatewayIntegrationClass = GatewayIntegrationClassPayload;
export type GatewayIntegrationStatus = GatewayIntegrationStatusPayload;
export type GatewayProviderAuthMode = GatewayProviderAuthModePayload;
export type GatewayProviderAuthStatus = GatewayProviderAuthStatusPayload;
export type GatewayProviderAuthAccount = GatewayProviderAuthAccountPayload;
export type GatewayModelCatalogEntry = GatewayModelCatalogEntryPayload;
export type GatewayModelProviderCatalog = GatewayModelProviderCatalogPayload;

interface OpenAICompatibleDetectedModel {
  id: string;
  contextWindow?: number;
}

export interface ProviderRuntimeConfig {
  providerId: string;
  model: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthMode;
  baseURL?: string;
  allowedModels: string[];
  allowCustomModel: boolean;
  nativeCliToolsEnabled: boolean;
  updatedAt: string;
  source: "env" | "runtime";
}

export type PublicProviderRuntimeConfig = ProviderRuntimeConfigPayload;
export type ProviderTelemetry = ProviderTelemetryPayload;
export type ProviderTelemetrySource = ProviderTelemetrySourcePayload;
export type ProviderTelemetryWindow = ProviderTelemetryWindowPayload;

export interface PutSecretRefInput {
  secretRef?: string;
  providerId: string;
  label?: string;
  secret: string;
  backend?: string;
}

export interface PutSecretRefResult {
  secretRef: ProviderSecretRefSummary;
  created: boolean;
}

export interface ProvisionLocalProfileInput {
  localClientId: string;
  profileId?: string;
  profileName?: string;
  agentId?: string;
  spaceId?: string;
}

export interface ProvisionLocalProfileResult {
  profileId: string;
  profileName: string;
  created: boolean;
  providerId: string;
  model: string;
  agentId?: string;
  assignmentCreated?: boolean;
}

export interface GetMainAgentInput extends GatewayGetMainAgentPayload {}

export interface SetMainAgentInput extends GatewaySetMainAgentPayload {}

export interface ProfileRuntimeContext {
  profileId: string;
  systemPrompt: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfig;
}

export interface GatewayAdminServiceOptions {
  logger: Logger;
  profileRepo: ProfileRepository | null;
  spaceAdminService: SpaceAdminService;
  spaceRepo?: SpaceRepository;
  mainSpaceId?: string;
  mainSpaceName?: string;
  mainSpaceResourceId?: string;
  mainSpaceGoal?: string;
  mainProfileId?: string;
  mainAgentId?: string;
  conciergeSpaceId?: string;
  conciergeSpaceName?: string;
  conciergeSpaceResourceId?: string;
  conciergeSpaceGoal?: string;
  conciergeProfileId?: string;
  conciergeAgentId?: string;
  mainAgentSwapEnabled?: boolean;
  mainAgentAutoRepairEnabled?: boolean;
  providerSecretRefService?: ProviderSecretRefService;
  providerConfigRepo?: ProviderConfigRepository;
  gatewayProfile?: GatewayCoreProfileId;
  defaultProviderId?: string;
  defaultModelId?: string;
  defaultApiKey?: string;
  usageSnapshotService?: UsageSnapshotService;
  localUsageTelemetryService?: LocalUsageTelemetryService;
  integrationRequestRepo?: IntegrationRequestRepository;
  cliToolService?: CliToolService;
  interconnectorCatalogService?: InterconnectorCatalogService;
  accessGrantService?: AccessGrantService;
  toolApprovalGrantService?: ToolApprovalGrantService;
  enableAppleFoundationProvider?: boolean;
  appleFoundationAvailability?: AppleFoundationAvailabilitySnapshot;
  hostPlatform?: string;
  hostArch?: string;
  executableResolver?: LocalExecutableResolver;
  claudeAgentSdkMetadataProbe?: (input: {
    providerId: string;
    model: string;
    authMode: GatewayProviderAuthMode;
    apiKey?: string;
  }) => Promise<ClaudeAgentSdkCatalogProbe>;
}

export interface AppleFoundationAvailabilitySnapshot {
  available: boolean;
  reason: string;
}

interface LocalClientTemplate {
  id: string;
  name: string;
  commands: string[];
  appPath?: string;
  recommendedProviderId: string;
  recommendedModel: string;
  requiresApiKey: boolean;
  defaultProfileName: string;
  defaultPersonalityPrompt: string;
  notes?: string;
}

interface ResolvedProviderSelection {
  providerId: string;
  model: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthMode;
  baseURL?: string;
  isLocal: boolean;
  nativeCliToolsEnabled: boolean;
}

interface ClaudeAgentSdkCatalogProbe {
  authStatus: GatewayProviderAuthStatus;
  authAccount?: GatewayProviderAuthAccount;
  models: Array<{
    id: string;
    displayName: string;
    contextWindow?: number;
  }>;
  detectionError?: string;
}

interface ProviderRuntimeValidationResult {
  valid: boolean;
  reason?: string;
  fallbackModelHint?: string;
}

interface ResolvedProviderModelHint {
  valid: boolean;
  providerHint?: string;
  modelHint?: string;
  fallbackApplied: boolean;
  fallbackReason?: string;
  reason?: string;
}

interface LocalProviderTelemetryProbeResult {
  source: ProviderTelemetrySource;
  status: ProviderUsageSnapshotPayload["status"];
  message?: string;
  accountLabel?: string;
  windows?: ProviderTelemetryWindow[];
}

const LOCAL_CLIENT_TEMPLATES: LocalClientTemplate[] = [
  {
    id: "claude",
    name: "Claude",
    commands: ["claude"],
    recommendedProviderId: "claude",
    recommendedModel: "claude/sonnet",
    requiresApiKey: false,
    defaultProfileName: "Claude Agent",
    defaultPersonalityPrompt: "You are a Claude-backed agent focused on clear reasoning and safe execution.",
  },
  {
    id: "gemini",
    name: "Gemini",
    commands: ["gemini"],
    recommendedProviderId: "gemini",
    recommendedModel: "gemini/gemini-2.5-flash",
    requiresApiKey: false,
    defaultProfileName: "Gemini Agent",
    defaultPersonalityPrompt: "You are a Gemini-backed agent focused on concise and grounded responses.",
  },
  {
    id: "codex",
    name: "Codex",
    commands: ["codex"],
    recommendedProviderId: "codex",
    recommendedModel: "codex/gpt-5.1-codex",
    requiresApiKey: false,
    defaultProfileName: "Codex Agent",
    defaultPersonalityPrompt: "You are a coding-focused assistant optimized for implementation tasks.",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    commands: ["lms", "lmstudio"],
    appPath: "/Applications/LM Studio.app",
    recommendedProviderId: "lmstudio",
    recommendedModel: "lmstudio/qwen2.5-coder",
    requiresApiKey: false,
    defaultProfileName: "LM Studio Agent",
    defaultPersonalityPrompt: "You are a local model agent running through LM Studio.",
    notes: "Uses OpenAI-compatible endpoint http://127.0.0.1:1234/v1 by default.",
  },
];

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  apple: "apple/apple-on-device",
  anthropic: "anthropic/claude-sonnet-4-5",
  "claude-agent-sdk": "claude-agent-sdk/claude-sonnet-4-5",
  claude: "claude/sonnet",
  codex: "codex/gpt-5.1-codex",
  gemini: "gemini/gemini-2.5-flash",
  lmstudio: "lmstudio/qwen2.5-coder",
  ollama: "ollama/qwen2.5-coder",
  openrouter: "openrouter/openai/gpt-4.1-mini",
  groq: "groq/llama-3.3-70b-versatile",
  together: "together/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  mistral: "mistral/mistral-large-latest",
  openai: "openai/gpt-4.1",
};

const LOCAL_PROVIDER_MODEL_MANIFEST: Record<string, string[]> = {
  apple: [
    "apple/apple-on-device",
  ],
  anthropic: [
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-opus-4-5",
    "anthropic/claude-haiku-4-5",
  ],
  "claude-agent-sdk": [
    "claude-agent-sdk/claude-sonnet-4-6",
    "claude-agent-sdk/claude-opus-4-6",
    "claude-agent-sdk/claude-haiku-4-5",
    "claude-agent-sdk/claude-sonnet-4-5",
  ],
  claude: [
    "claude/sonnet",
    "claude/opus",
    "claude/haiku",
  ],
  codex: [
    "codex/gpt-5.2-codex",
    "codex/gpt-5.2-codex-max",
    "codex/gpt-5.2-codex-mini",
    "codex/gpt-5.1-codex",
    "codex/gpt-5.1-codex-max",
    "codex/gpt-5.1-codex-mini",
    "codex/gpt-5.2",
    "codex/gpt-5.1",
    "codex/gpt-5-codex",
    "codex/gpt-5",
  ],
  gemini: [
    "gemini/gemini-3-pro-preview",
    "gemini/gemini-3-flash-preview",
    "gemini/gemini-2.5-pro",
    "gemini/gemini-2.5-flash",
  ],
  lmstudio: [],
  ollama: [],
};

const API_KEY_ENV_BY_PROVIDER: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  "claude-agent-sdk": "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  together: "TOGETHER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openai: "OPENAI_API_KEY",
};

const OPENAI_BASE_URL_ENV = "OPENAI_BASE_URL";
const LMSTUDIO_BASE_URL_ENV = "LMSTUDIO_BASE_URL";
const OLLAMA_BASE_URL_ENV = "OLLAMA_BASE_URL";
const LOCAL_PROVIDER_IDS = new Set(["apple", "claude", "codex", "gemini", "lmstudio", "ollama"]);
const OPENAI_COMPATIBLE_PROVIDER_IDS = new Set([
  "openai",
  "lmstudio",
  "ollama",
  "openrouter",
  "groq",
  "together",
  "mistral",
]);
const OPENAI_COMPATIBLE_DETECTION_CACHE_TTL_MS = 30_000;
const CLAUDE_AGENT_SDK_DETECTION_CACHE_TTL_MS = 30_000;
const PROVIDER_AUTH_MODES: Partial<Record<string, GatewayProviderAuthMode[]>> = {
  anthropic: ["api_key"],
  "claude-agent-sdk": ["api_key", "host_login"],
  openai: ["api_key"],
  openrouter: ["api_key"],
  groq: ["api_key"],
  together: ["api_key"],
  mistral: ["api_key"],
};

export class DefaultGatewayAdminService {
  private readonly logger: Logger;
  private readonly profileRepo: ProfileRepository | null;
  private readonly spaceAdminService: SpaceAdminService;
  private readonly spaceRepo?: SpaceRepository;
  private readonly mainSpaceId: string;
  private readonly mainSpaceName: string;
  private readonly mainSpaceResourceId: string;
  private readonly mainSpaceGoal: string;
  private readonly mainProfileId: string;
  private readonly mainAgentId: string;
  private readonly conciergeSpaceId: string;
  private readonly conciergeSpaceName: string;
  private readonly conciergeSpaceResourceId: string;
  private readonly conciergeSpaceGoal: string;
  private readonly conciergeProfileId: string;
  private readonly conciergeAgentId: string;
  private readonly mainAgentSwapEnabled: boolean;
  private readonly mainAgentAutoRepairEnabled: boolean;
  private readonly providerSecretRefService?: ProviderSecretRefService;
  private readonly providerConfigRepo?: ProviderConfigRepository;
  private readonly integrationRequestRepo?: IntegrationRequestRepository;
  private readonly cliToolService?: CliToolService;
  private readonly interconnectorCatalogService?: InterconnectorCatalogService;
  private readonly accessGrantService?: AccessGrantService;
  private readonly toolApprovalGrantService?: ToolApprovalGrantService;
  private readonly gatewayProfile: GatewayCoreProfileId;
  private readonly defaultProviderId?: string;
  private readonly defaultModelId?: string;
  private readonly enableAppleFoundationProvider: boolean;
  private readonly hostPlatform: string;
  private readonly hostArch: string;
  private readonly executableResolver: LocalExecutableResolver;
  private appleFoundationAvailability?: AppleFoundationAvailabilitySnapshot;
  private usageSnapshotService?: UsageSnapshotService;
  private localUsageTelemetryService?: LocalUsageTelemetryService;
  private readonly claudeAgentSdkMetadataProbe?: GatewayAdminServiceOptions["claudeAgentSdkMetadataProbe"];
  private readonly providerConfigs = new Map<string, ProviderRuntimeConfig>();
  private readonly openAICompatibleDetectionCache = new Map<string, {
    expiresAt: number;
    value: {
      serviceReachable: boolean;
      models: OpenAICompatibleDetectedModel[];
      detectionError?: string;
    };
  }>();
  private readonly openAICompatibleDetectionInFlight = new Map<string, Promise<{
    serviceReachable: boolean;
    models: OpenAICompatibleDetectedModel[];
    detectionError?: string;
  }>>();
  private readonly claudeAgentSdkDetectionCache = new Map<string, {
    expiresAt: number;
    value: ClaudeAgentSdkCatalogProbe;
  }>();
  private readonly claudeAgentSdkDetectionInFlight = new Map<string, Promise<ClaudeAgentSdkCatalogProbe>>();

  constructor(options: GatewayAdminServiceOptions) {
    this.logger = options.logger;
    this.profileRepo = options.profileRepo;
    this.spaceAdminService = options.spaceAdminService;
    this.spaceRepo = options.spaceRepo;
    const profileLabel = (options.gatewayProfile ?? "external") === "external" ? "External" : "Embedded";
    this.mainSpaceId = options.mainSpaceId?.trim() || "main-space";
    this.mainSpaceName = options.mainSpaceName?.trim() || `${profileLabel} Main Space`;
    this.mainSpaceResourceId = options.mainSpaceResourceId?.trim()
      || ((options.gatewayProfile ?? "external") === "external" ? "resource:external" : "resource:main");
    this.mainSpaceGoal = options.mainSpaceGoal?.trim()
      || "Default shared space for gateway startup and orchestrator coordination.";
    this.mainProfileId = options.mainProfileId?.trim() || "main-profile";
    this.mainAgentId = options.mainAgentId?.trim() || "main-agent";
    this.conciergeSpaceId = options.conciergeSpaceId?.trim()
      || ((options.gatewayProfile ?? "external") === "external" ? "external-concierge-space" : "concierge-space");
    this.conciergeSpaceName = options.conciergeSpaceName?.trim() || `${profileLabel} Concierge`;
    this.conciergeSpaceResourceId = options.conciergeSpaceResourceId?.trim()
      || `system.concierge.backing-space.${this.conciergeSpaceId}`;
    this.conciergeSpaceGoal = options.conciergeSpaceGoal?.trim()
      || "Dedicated concierge backing space for app navigation, routing, and call continuity.";
    this.conciergeProfileId = options.conciergeProfileId?.trim() || "concierge-profile";
    this.conciergeAgentId = options.conciergeAgentId?.trim() || "concierge-agent";
    this.mainAgentSwapEnabled = options.mainAgentSwapEnabled ?? true;
    this.mainAgentAutoRepairEnabled = options.mainAgentAutoRepairEnabled ?? true;
    this.providerSecretRefService = options.providerSecretRefService;
    this.providerConfigRepo = options.providerConfigRepo;
    this.integrationRequestRepo = options.integrationRequestRepo;
    this.cliToolService = options.cliToolService;
    this.interconnectorCatalogService = options.interconnectorCatalogService;
    this.accessGrantService = options.accessGrantService;
    this.toolApprovalGrantService = options.toolApprovalGrantService;
    this.gatewayProfile = options.gatewayProfile ?? "external";
    this.defaultProviderId = normalizeProviderId(options.defaultProviderId);
    this.defaultModelId = options.defaultModelId;
    this.enableAppleFoundationProvider = options.enableAppleFoundationProvider ?? false;
    this.hostPlatform = options.hostPlatform ?? process.platform;
    this.hostArch = options.hostArch ?? process.arch;
    this.executableResolver = options.executableResolver ?? new LocalExecutableResolver();
    this.appleFoundationAvailability = options.appleFoundationAvailability;
    this.claudeAgentSdkMetadataProbe = options.claudeAgentSdkMetadataProbe;
    this.usageSnapshotService = options.usageSnapshotService;
    this.localUsageTelemetryService = options.localUsageTelemetryService;

    this.seedFromEnvironment(options.defaultApiKey);
  }

  private appleFoundationHostSupported(): boolean {
    return this.hostPlatform === "darwin" && this.hostArch === "arm64";
  }

  private async ensureAppleFoundationAvailability(): Promise<AppleFoundationAvailabilitySnapshot> {
    if (this.appleFoundationAvailability) {
      return this.appleFoundationAvailability;
    }

    if (!this.enableAppleFoundationProvider) {
      this.appleFoundationAvailability = {
        available: false,
        reason: "SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER is disabled.",
      };
      return this.appleFoundationAvailability;
    }

    if (!this.appleFoundationHostSupported()) {
      this.appleFoundationAvailability = {
        available: false,
        reason: `Apple Foundation Models require darwin/arm64. Current host: ${this.hostPlatform}/${this.hostArch}.`,
      };
      return this.appleFoundationAvailability;
    }

    this.appleFoundationAvailability = {
      available: false,
      reason: "Apple Foundation availability probe did not complete.",
    };
    return this.appleFoundationAvailability;
  }

  private appleProviderEnabledSync(): { enabled: boolean; reason: string } {
    if (!this.enableAppleFoundationProvider) {
      return {
        enabled: false,
        reason: "SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER is disabled.",
      };
    }

    return { enabled: true, reason: "Apple Foundation provider is enabled." };
  }

  private appleProviderRuntimeEligibleSync(): { eligible: boolean; reason: string } {
    const enabled = this.appleProviderEnabledSync();
    if (!enabled.enabled) {
      return { eligible: false, reason: enabled.reason };
    }

    if (!this.appleFoundationHostSupported()) {
      return {
        eligible: false,
        reason: `Apple Foundation Models require darwin/arm64. Current host: ${this.hostPlatform}/${this.hostArch}.`,
      };
    }

    if (!this.appleFoundationAvailability || this.appleFoundationAvailability.available !== true) {
      return {
        eligible: false,
        reason: this.appleFoundationAvailability?.reason
          ?? "Apple Intelligence availability check has not passed.",
      };
    }

    return { eligible: true, reason: "Apple Intelligence available." };
  }

  private embeddedLocalIntegrationsAllowed(): boolean {
    return this.gatewayProfile === "embedded"
      && this.hostPlatform === "darwin"
      && this.hostArch === "arm64";
  }

  private ensureAppleProviderEnabledSync(operation: string): void {
    const enabled = this.appleProviderEnabledSync();
    if (enabled.enabled) {
      return;
    }
    throwGatewayError(
      "FAILED_PRECONDITION",
      `${operation} blocked for provider apple: ${enabled.reason}`,
    );
  }

  private ensureAppleProviderRuntimeEligibleSync(operation: string): void {
    const eligibility = this.appleProviderRuntimeEligibleSync();
    if (eligibility.eligible) {
      return;
    }
    throwGatewayError(
      "FAILED_PRECONDITION",
      `${operation} blocked for provider apple: ${eligibility.reason}`,
    );
  }

  private providerVisibleInCatalog(providerId: string): boolean {
    if (providerId !== "apple") {
      return true;
    }
    return this.appleProviderEnabledSync().enabled && this.appleFoundationHostSupported();
  }

  private providerPolicyRestrictionReason(providerId: string): string | undefined {
    if (this.gatewayProfile !== "embedded") {
      return undefined;
    }
    if (providerCatalogGroup(providerId) === "cloud") {
      return undefined;
    }
    if (this.embeddedLocalIntegrationsAllowed()) {
      return undefined;
    }
    return `Provider ${providerId} is disabled in embedded profile on ${this.hostPlatform}/${this.hostArch}. Local executors and local runtimes require embedded macOS on Apple Silicon or an external gateway.`;
  }

  async discoverLocalAgents(): Promise<DiscoveredLocalAgent[]> {
    const lmStudioPolicyReason = this.providerPolicyRestrictionReason("lmstudio");
    const lmStudioDetection = lmStudioPolicyReason
      ? {
        serviceReachable: false,
        models: [] as OpenAICompatibleDetectedModel[],
        detectionError: lmStudioPolicyReason,
      }
      : await this.detectOpenAICompatibleModels(
        this.resolveProviderBaseURL(
          "lmstudio",
          this.providerConfigs.get("lmstudio")?.baseURL,
        ),
      );
    const codexDetectedModels = this.detectCodexCliModels();

    return LOCAL_CLIENT_TEMPLATES.map((template) => {
      const executablePath = this.findExecutable(template.commands);
      const appPath = template.appPath && existsSync(template.appPath) ? template.appPath : undefined;
      const providerId = template.recommendedProviderId;
      const policyReason = this.providerPolicyRestrictionReason(providerId);
      const policyAllowed = !policyReason;
      const detected = policyAllowed && Boolean(executablePath || appPath);
      const localManifestModels = LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? [];
      const availableModels = !policyAllowed
        ? []
        : template.id === "lmstudio"
          ? lmStudioDetection.models.map((model) => withProviderPrefix("lmstudio", model.id))
          : uniqueModelIds([
          ...(template.id === "codex" ? codexDetectedModels : []),
          ...localManifestModels,
        ]);
      const recommendedModel = availableModels?.[0] ?? template.recommendedModel;
      const detectionError = policyReason
        || (template.id === "lmstudio" ? lmStudioDetection.detectionError : undefined);

      return {
        id: template.id,
        name: template.name,
        detected,
        executablePath: executablePath ?? undefined,
        appPath,
        serviceReachable: template.id === "lmstudio"
          ? (policyAllowed ? lmStudioDetection.serviceReachable : false)
          : undefined,
        recommendedProviderId: template.recommendedProviderId,
        recommendedModel,
        requiresApiKey: template.requiresApiKey,
        ...(availableModels && availableModels.length > 0 ? { availableModels } : {}),
        ...(detectionError ? { detectionError } : {}),
        notes: template.notes,
      };
    });
  }

  listProviderConfigs(): PublicProviderRuntimeConfig[] {
    return Array.from(this.providerConfigs.values())
      .filter((config) => this.providerVisibleInCatalog(config.providerId))
      .filter((config) => this.isProviderConfigAllowed(config.providerId))
      .sort((lhs, rhs) => lhs.providerId.localeCompare(rhs.providerId))
      .map((config) => ({
        providerId: config.providerId,
        model: config.model,
        baseURL: config.baseURL,
        hasApiKey: Boolean(config.apiKey || config.apiKeySecretRef),
        apiKeySecretRef: config.apiKeySecretRef,
        allowedModels: this.mergeAllowedModels(config.providerId, config.model, config.allowedModels),
        allowCustomModel: config.allowCustomModel,
        nativeCliToolsEnabled: config.nativeCliToolsEnabled,
        updatedAt: config.updatedAt,
        source: config.source,
      }));
  }

  resolveMainSpaceId(): string {
    return this.mainSpaceId;
  }

  resolveConciergeSpaceId(): string {
    return this.conciergeSpaceId;
  }

  async getMainAgent(input: GetMainAgentInput = {}): Promise<GatewayMainAgentStatePayload> {
    const spaceId = this.resolveMainTargetSpaceId(input.spaceId);
    const repairIfMissing = input.repairIfMissing ?? this.mainAgentAutoRepairEnabled;
    return this.resolveMainAgentState({
      spaceId,
      repairIfMissing,
    });
  }

  async getConciergeAgent(
    input: GatewayGetConciergeAgentPayload = {},
  ): Promise<GatewayConciergeAgentStatePayload> {
    const spaceId = this.resolveConciergeTargetSpaceId(input.spaceId);
    const repairIfMissing = input.repairIfMissing ?? this.mainAgentAutoRepairEnabled;
    return this.resolveConciergeAgentState({
      spaceId,
      repairIfMissing,
    });
  }

  async setMainAgent(input: SetMainAgentInput): Promise<GatewayMainAgentStatePayload> {
    if (!this.mainAgentSwapEnabled) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Main-agent swap is disabled by SPACESKIT_MAIN_AGENT_SWAP_V1",
      );
    }

    const selectionMode = normalizeSelectionMode(input.selectionMode);
    if (!selectionMode) {
      throwGatewayError(
        "INVALID_ARGUMENT",
        "selectionMode must be either provider_model or agent_definition",
      );
    }

    const spaceId = this.resolveMainTargetSpaceId(input.spaceId);
    await this.resolveMainAgentState({
      spaceId,
      repairIfMissing: true,
    });
    const profileRepo = this.requireProfileRepo();

    if (selectionMode === "provider_model") {
      const providerId = normalizeProviderId(input.providerId);
      const modelIdRaw = input.modelId?.trim();
      if (!providerId || !modelIdRaw) {
        throwGatewayError(
          "INVALID_ARGUMENT",
          "providerId and modelId are required for provider_model selection",
        );
      }

      const modelProviderPrefix = deriveProviderFromModel(modelIdRaw);
      if (modelProviderPrefix && modelProviderPrefix !== providerId) {
        throwGatewayError(
          "INVALID_ARGUMENT",
          `modelId provider prefix ${modelProviderPrefix} does not match providerId ${providerId}`,
        );
      }

      const providerConfig = this.listProviderConfigs()
        .find((entry) => entry.providerId.trim().toLowerCase() === providerId);
      if (!providerConfig) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Provider is not configured: ${providerId}`,
        );
      }

      const modelId = withProviderPrefix(providerId, modelIdRaw);
      const allowedModels = this.mergeAllowedModels(
        providerId,
        providerConfig.model,
        providerConfig.allowedModels,
      );
      if (!providerConfig.allowCustomModel && !allowedModels.includes(modelId)) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Model ${modelId} is not allowed for provider ${providerId}.`,
        );
      }

      const runtimeValidation = await this.validateProviderRuntimeSelection(providerId, modelId);
      if (!runtimeValidation.valid) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          runtimeValidation.reason
            || `Provider runtime rejected model ${modelId} for ${providerId}.`,
        );
      }

      profileRepo.update({
        profileId: this.mainProfileId,
        providerHint: providerId,
        modelHint: modelId,
        defaultSkillIds: mergeSkillIds(
          parseStringArray(profileRepo.getActiveRevision(this.mainProfileId)?.default_skill_set_ids_json),
          [USER_ESCALATION_SKILL_ID],
        ),
        modelConfig: {
          preferredModels: [modelId],
          fallbackModels: [],
        },
        source: "gateway_main_agent_swap",
      });
    } else {
      const sourceAgentDefinitionId = input.sourceAgentDefinitionId?.trim();
      if (!sourceAgentDefinitionId) {
        throwGatewayError(
          "INVALID_ARGUMENT",
          "sourceAgentDefinitionId is required for agent_definition selection",
        );
      }

      const sourceProfile = profileRepo.getActiveById(sourceAgentDefinitionId);
      if (!sourceProfile) {
        throwGatewayError("NOT_FOUND", `Agent Definition not found: ${sourceAgentDefinitionId}`);
      }
      const sourceRevision = profileRepo.getActiveRevision(sourceAgentDefinitionId);
      if (!sourceRevision) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Active agent definition revision not found: ${sourceAgentDefinitionId}`,
        );
      }

      const applyPersonaInstructions = input.applyPersonaInstructions ?? true;
      const sourceModelConfig = parseModelConfig(
        sourceRevision.model_config_json,
        sourceRevision.model_hint,
      );
      const sourceProviderHint = normalizeProviderId(sourceRevision.provider_hint)
        || deriveProviderFromModel(sourceRevision.model_hint);
      const sourceModelHint = sourceRevision.model_hint?.trim() || undefined;
      this.validateProfileModelSelection({
        providerHint: sourceProviderHint ?? undefined,
        modelHint: sourceModelHint,
        modelConfig: sourceModelConfig,
      });
      const sourcePinned = this.validatePinnedProviderModel(
        sourceProviderHint ?? undefined,
        sourceModelHint,
      );
      if (!sourcePinned.valid || !sourcePinned.providerHint || !sourcePinned.modelHint) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          sourcePinned.reason
            || `Agent Definition ${sourceAgentDefinitionId} is missing a valid runtime/model configuration.`,
        );
      }
      const runtimeValidation = await this.validateProviderRuntimeSelection(
        sourcePinned.providerHint,
        sourcePinned.modelHint,
      );
      if (!runtimeValidation.valid) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          runtimeValidation.reason
            || `Agent Definition ${sourceAgentDefinitionId} is pinned to a runtime model that is unavailable.`,
        );
      }

      profileRepo.update({
        profileId: this.mainProfileId,
        personalityPrompt: applyPersonaInstructions ? sourceRevision.personality_prompt : undefined,
        defaultSkillIds: mergeSkillIds(
          parseStringArray(sourceRevision.default_skill_set_ids_json),
          [USER_ESCALATION_SKILL_ID],
        ),
        providerHint: sourceProviderHint ?? undefined,
        modelHint: sourceModelHint,
        modelConfig: sourceModelConfig,
        source: "gateway_main_agent_swap",
      });
    }

    await this.normalizeMainAssignment(spaceId);
    return this.resolveMainAgentState({
      spaceId,
      repairIfMissing: true,
    });
  }

  async setConciergeAgent(
    input: GatewaySetConciergeAgentPayload,
  ): Promise<GatewayConciergeAgentStatePayload> {
    if (!this.mainAgentSwapEnabled) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Concierge-agent swap is disabled by SPACESKIT_MAIN_AGENT_SWAP_V1",
      );
    }

    const selectionMode = normalizeSelectionMode(input.selectionMode);
    if (!selectionMode) {
      throwGatewayError(
        "INVALID_ARGUMENT",
        "selectionMode must be either provider_model or agent_definition",
      );
    }

    const spaceId = this.resolveConciergeTargetSpaceId(input.spaceId);
    await this.resolveConciergeAgentState({
      spaceId,
      repairIfMissing: true,
    });
    const profileRepo = this.requireProfileRepo();

    if (selectionMode === "provider_model") {
      const providerId = normalizeProviderId(input.providerId);
      const modelIdRaw = input.modelId?.trim();
      if (!providerId || !modelIdRaw) {
        throwGatewayError(
          "INVALID_ARGUMENT",
          "providerId and modelId are required for provider_model selection",
        );
      }

      const modelProviderPrefix = deriveProviderFromModel(modelIdRaw);
      if (modelProviderPrefix && modelProviderPrefix !== providerId) {
        throwGatewayError(
          "INVALID_ARGUMENT",
          `modelId provider prefix ${modelProviderPrefix} does not match providerId ${providerId}`,
        );
      }

      const providerConfig = this.listProviderConfigs()
        .find((entry) => entry.providerId.trim().toLowerCase() === providerId);
      if (!providerConfig) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Provider is not configured: ${providerId}`,
        );
      }

      const modelId = withProviderPrefix(providerId, modelIdRaw);
      const allowedModels = this.mergeAllowedModels(
        providerId,
        providerConfig.model,
        providerConfig.allowedModels,
      );
      if (!providerConfig.allowCustomModel && !allowedModels.includes(modelId)) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Model ${modelId} is not allowed for provider ${providerId}.`,
        );
      }

      const runtimeValidation = await this.validateProviderRuntimeSelection(providerId, modelId);
      if (!runtimeValidation.valid) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          runtimeValidation.reason
            || `Provider runtime rejected model ${modelId} for ${providerId}.`,
        );
      }

      profileRepo.update({
        profileId: this.conciergeProfileId,
        providerHint: providerId,
        modelHint: modelId,
        defaultSkillIds: mergeSkillIds(
          parseStringArray(profileRepo.getActiveRevision(this.conciergeProfileId)?.default_skill_set_ids_json),
          [USER_ESCALATION_SKILL_ID],
        ),
        modelConfig: {
          preferredModels: [modelId],
          fallbackModels: [],
        },
        source: "gateway_concierge_agent_swap",
      });
    } else {
      const sourceAgentDefinitionId = input.sourceAgentDefinitionId?.trim();
      if (!sourceAgentDefinitionId) {
        throwGatewayError(
          "INVALID_ARGUMENT",
          "sourceAgentDefinitionId is required for agent_definition selection",
        );
      }

      const sourceProfile = profileRepo.getActiveById(sourceAgentDefinitionId);
      if (!sourceProfile) {
        throwGatewayError("NOT_FOUND", `Agent Definition not found: ${sourceAgentDefinitionId}`);
      }
      const sourceRevision = profileRepo.getActiveRevision(sourceAgentDefinitionId);
      if (!sourceRevision) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Active agent definition revision not found: ${sourceAgentDefinitionId}`,
        );
      }

      const applyPersonaInstructions = input.applyPersonaInstructions ?? true;
      const sourceModelConfig = parseModelConfig(
        sourceRevision.model_config_json,
        sourceRevision.model_hint,
      );
      const sourceProviderHint = normalizeProviderId(sourceRevision.provider_hint)
        || deriveProviderFromModel(sourceRevision.model_hint);
      const sourceModelHint = sourceRevision.model_hint?.trim() || undefined;
      this.validateProfileModelSelection({
        providerHint: sourceProviderHint ?? undefined,
        modelHint: sourceModelHint,
        modelConfig: sourceModelConfig,
      });
      const sourcePinned = this.validatePinnedProviderModel(
        sourceProviderHint ?? undefined,
        sourceModelHint,
      );
      if (!sourcePinned.valid || !sourcePinned.providerHint || !sourcePinned.modelHint) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          sourcePinned.reason
            || `Agent Definition ${sourceAgentDefinitionId} is missing a valid runtime/model configuration.`,
        );
      }
      const runtimeValidation = await this.validateProviderRuntimeSelection(
        sourcePinned.providerHint,
        sourcePinned.modelHint,
      );
      if (!runtimeValidation.valid) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          runtimeValidation.reason
            || `Agent Definition ${sourceAgentDefinitionId} is pinned to a runtime model that is unavailable.`,
        );
      }

      profileRepo.update({
        profileId: this.conciergeProfileId,
        personalityPrompt: applyPersonaInstructions ? sourceRevision.personality_prompt : undefined,
        defaultSkillIds: mergeSkillIds(
          parseStringArray(sourceRevision.default_skill_set_ids_json),
          [USER_ESCALATION_SKILL_ID],
        ),
        providerHint: sourceProviderHint ?? undefined,
        modelHint: sourceModelHint,
        modelConfig: sourceModelConfig,
        source: "gateway_concierge_agent_swap",
      });
    }

    await this.normalizeConciergeAssignment(spaceId);
    return this.resolveConciergeAgentState({
      spaceId,
      repairIfMissing: true,
    });
  }

  private resolveMainTargetSpaceId(spaceId?: string): string {
    const normalized = spaceId?.trim();
    if (!normalized) {
      return this.mainSpaceId;
    }
    if (normalized !== this.mainSpaceId) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Main-agent operations are restricted to configured main space: ${this.mainSpaceId}`,
      );
    }
    return normalized;
  }

  private resolveConciergeTargetSpaceId(spaceId?: string): string {
    const normalized = spaceId?.trim();
    if (!normalized) {
      return this.conciergeSpaceId;
    }
    if (normalized !== this.conciergeSpaceId) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Concierge-agent operations are restricted to configured concierge space: ${this.conciergeSpaceId}`,
      );
    }
    return normalized;
  }

  private requireProfileRepo(): ProfileRepository {
    if (!this.profileRepo) {
      throwGatewayError("FAILED_PRECONDITION", "Profile repository unavailable");
    }
    return this.profileRepo;
  }

  private requireCliToolService(): CliToolService {
    if (!this.cliToolService) {
      throwGatewayError("FAILED_PRECONDITION", "CLI tool service unavailable");
    }
    return this.cliToolService;
  }

  private requireToolApprovalGrantService(): ToolApprovalGrantService {
    if (!this.toolApprovalGrantService) {
      throwGatewayError("FAILED_PRECONDITION", "Tool approval grant service unavailable");
    }
    return this.toolApprovalGrantService;
  }

  private async ensureMainProfileActive(
    repairIfMissing: boolean,
  ): Promise<{ repaired: boolean; updatedAt: string }> {
    const profileRepo = this.requireProfileRepo();
    const profileLabel = this.gatewayProfile === "external" ? "External" : "Embedded";
    const existing = profileRepo.getById(this.mainProfileId);
    if (!existing) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Main profile is missing: ${this.mainProfileId}`,
        );
      }
      profileRepo.create({
        profileId: this.mainProfileId,
        name: `${profileLabel} Main Agent`,
        description: `Default ${this.gatewayProfile} gateway startup profile for the main agent.`,
        canModerate: true,
        personalityPrompt: `You are the default ${this.gatewayProfile} main gateway agent. Coordinate spaces clearly and safely.`,
        defaultSkillIds: [USER_ESCALATION_SKILL_ID],
      });
      const created = profileRepo.getById(this.mainProfileId);
      if (!created) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to create main profile: ${this.mainProfileId}`,
        );
      }
      return {
        repaired: true,
        updatedAt: created.updated_at,
      };
    }

    if (existing.archived !== 1) {
      this.ensureProfileDefaultSkills(this.mainProfileId, [USER_ESCALATION_SKILL_ID], "gateway_main_defaults");
      return {
        repaired: false,
        updatedAt: existing.updated_at,
      };
    }

    if (!repairIfMissing) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Main profile is archived: ${this.mainProfileId}`,
      );
    }
    profileRepo.restore(this.mainProfileId);
    const restored = profileRepo.getById(this.mainProfileId);
    if (!restored || restored.archived === 1) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to restore archived main profile: ${this.mainProfileId}`,
      );
    }
    this.ensureProfileDefaultSkills(this.mainProfileId, [USER_ESCALATION_SKILL_ID], "gateway_main_defaults");
    return {
      repaired: true,
      updatedAt: restored.updated_at,
    };
  }

  private async ensureConciergeProfileActive(
    repairIfMissing: boolean,
  ): Promise<{ repaired: boolean; updatedAt: string }> {
    const profileRepo = this.requireProfileRepo();
    const profileLabel = this.gatewayProfile === "external" ? "External" : "Embedded";
    const existing = profileRepo.getById(this.conciergeProfileId);
    if (!existing) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Concierge profile is missing: ${this.conciergeProfileId}`,
        );
      }

      const legacyProfile = this.findLegacyConciergeProfile();
      const legacyRevision = legacyProfile
        ? profileRepo.getActiveRevision(legacyProfile.profile_id)
        : undefined;
      profileRepo.create({
        profileId: this.conciergeProfileId,
        personaId: legacyProfile?.persona_id || "",
        name: `${profileLabel} Concierge`,
        description: "General-purpose system concierge for workspace status, routing, and setup.",
        canModerate: true,
        personalityPrompt: legacyRevision?.personality_prompt
          || "You are the Spaces concierge. Be concise, route users to the right workspace or settings surface, and escalate runtime issues clearly.",
        defaultSkillIds: mergeSkillIds(
          legacyRevision ? parseStringArray(legacyRevision.default_skill_set_ids_json) : [],
          [USER_ESCALATION_SKILL_ID],
        ),
        providerHint: legacyRevision?.provider_hint?.trim() || undefined,
        modelHint: legacyRevision?.model_hint?.trim() || undefined,
        modelConfig: legacyRevision
          ? parseModelConfig(legacyRevision.model_config_json, legacyRevision.model_hint)
          : undefined,
        source: legacyProfile ? "gateway_concierge_profile_migration" : "gateway_concierge_defaults",
      });
      const created = profileRepo.getById(this.conciergeProfileId);
      if (!created) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to create concierge profile: ${this.conciergeProfileId}`,
        );
      }
      return {
        repaired: true,
        updatedAt: created.updated_at,
      };
    }

    if (existing.archived !== 1) {
      this.ensureProfileDefaultSkills(this.conciergeProfileId, [USER_ESCALATION_SKILL_ID], "gateway_concierge_defaults");
      return {
        repaired: false,
        updatedAt: existing.updated_at,
      };
    }

    if (!repairIfMissing) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Concierge profile is archived: ${this.conciergeProfileId}`,
      );
    }
    profileRepo.restore(this.conciergeProfileId);
    const restored = profileRepo.getById(this.conciergeProfileId);
    if (!restored || restored.archived === 1) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to restore archived concierge profile: ${this.conciergeProfileId}`,
      );
    }
    this.ensureProfileDefaultSkills(this.conciergeProfileId, [USER_ESCALATION_SKILL_ID], "gateway_concierge_defaults");
    return {
      repaired: true,
      updatedAt: restored.updated_at,
    };
  }

  private ensureProfileDefaultSkills(
    profileId: string,
    requiredSkillIds: readonly string[],
    source: string,
  ): void {
    const profileRepo = this.requireProfileRepo();
    const activeRevision = profileRepo.getActiveRevision(profileId);
    if (!activeRevision) return;
    const existingSkillIds = parseStringArray(activeRevision.default_skill_set_ids_json);
    const mergedSkillIds = mergeSkillIds(existingSkillIds, requiredSkillIds);
    if (mergedSkillIds.length === existingSkillIds.length) {
      return;
    }
    profileRepo.update({
      profileId,
      defaultSkillIds: mergedSkillIds,
      source,
    });
  }

  private async ensureMainSpace(
    repairIfMissing: boolean,
  ): Promise<{ spaceUid: string; repaired: boolean; assignedProfileId?: string; updatedAt: string }> {
    let space = await this.spaceAdminService.getSpace(this.mainSpaceId);
    let repaired = false;

    if (!space) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Main space is missing: ${this.mainSpaceId}`,
        );
      }
      space = await this.spaceAdminService.createSpace({
        spaceId: this.mainSpaceId,
        resourceId: this.mainSpaceResourceId,
        spaceType: "main",
        name: this.mainSpaceName,
        goal: this.mainSpaceGoal,
        turnModel: "sequential_all",
        visibility: "shared",
        initialAgents: [
          {
            agentId: this.mainAgentId,
            profileId: this.mainProfileId,
            role: "global_coordinator",
            turnOrder: 0,
            isPrimary: true,
          },
        ],
      });
      repaired = true;
    }

    const mainAssignment = space.agents.find((assignment) => assignment.agentId === this.mainAgentId);
    if (!mainAssignment) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Main agent assignment is missing: ${this.mainAgentId}`,
        );
      }
      await this.spaceAdminService.addAgent({
        spaceId: this.mainSpaceId,
        agentId: this.mainAgentId,
        profileId: this.mainProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      });
      repaired = true;
    } else {
      const requiresNormalization = (
        mainAssignment.profileId !== this.mainProfileId
        || mainAssignment.role !== "global_coordinator"
        || mainAssignment.turnOrder !== 0
        || !mainAssignment.isPrimary
      );
      if (requiresNormalization) {
        if (!repairIfMissing) {
          throwGatewayError(
            "FAILED_PRECONDITION",
            `Main assignment is out of policy for agent ${this.mainAgentId}`,
          );
        }
        await this.spaceAdminService.updateAgentAssignment({
          spaceId: this.mainSpaceId,
          agentId: this.mainAgentId,
          profileId: this.mainProfileId,
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        });
        repaired = true;
      }
    }

    let refreshed = await this.spaceAdminService.getSpace(this.mainSpaceId);
    if (!refreshed) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to load main space after repair: ${this.mainSpaceId}`,
      );
    }
    let refreshedAssignment = refreshed.agents.find((assignment) => assignment.agentId === this.mainAgentId);
    if (!refreshedAssignment) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to load canonical main assignment after repair: ${this.mainSpaceId}/${this.mainAgentId}`,
      );
    }

    // Existing spaces may contain stale duplicate primary/coordinator rows from
    // previous runtime behavior or manual DB edits. Keep the canonical
    // main-agent assignment authoritative to avoid "stuck" swap behavior.
    if (this.hasMainAssignmentPolicyConflicts(refreshed.agents)) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Main assignment policy conflict detected for canonical agent ${this.mainAgentId}`,
        );
      }
      await this.spaceAdminService.updateAgentAssignment({
        spaceId: this.mainSpaceId,
        agentId: this.mainAgentId,
        profileId: this.mainProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      });
      repaired = true;

      refreshed = await this.spaceAdminService.getSpace(this.mainSpaceId);
      if (!refreshed) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to load main space after policy normalization: ${this.mainSpaceId}`,
        );
      }
      refreshedAssignment = refreshed.agents.find((assignment) => assignment.agentId === this.mainAgentId);
      if (!refreshedAssignment) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to load canonical main assignment after policy normalization: ${this.mainSpaceId}/${this.mainAgentId}`,
        );
      }
    }

    return {
      spaceUid: refreshed.spaceUid,
      repaired,
      assignedProfileId: refreshedAssignment?.profileId,
      updatedAt: String(refreshed.updatedAt),
    };
  }

  private async ensureConciergeSpace(
    repairIfMissing: boolean,
  ): Promise<{ spaceUid: string; repaired: boolean; assignedProfileId?: string; updatedAt: string }> {
    let space = await this.spaceAdminService.getSpace(this.conciergeSpaceId);
    let repaired = false;

    if (!space) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Concierge space is missing: ${this.conciergeSpaceId}`,
        );
      }
      space = await this.spaceAdminService.createSpace({
        spaceId: this.conciergeSpaceId,
        resourceId: this.conciergeSpaceResourceId,
        spaceType: "concierge",
        name: this.conciergeSpaceName,
        goal: this.conciergeSpaceGoal,
        turnModel: "sequential_all",
        visibility: "private",
        initialAgents: [
          {
            agentId: this.conciergeAgentId,
            profileId: this.conciergeProfileId,
            role: "global_coordinator",
            turnOrder: 0,
            isPrimary: true,
          },
        ],
      });
      repaired = true;
    }

    const rawSpace = this.spaceRepo?.getById(this.conciergeSpaceId);
    const desiredConfigJson = this.buildCanonicalConciergeSpaceConfigJson(rawSpace?.space_config_json);
    const requiresMetadataRepair = Boolean(rawSpace) && (
      rawSpace?.resource_id !== this.conciergeSpaceResourceId
      || rawSpace?.space_type !== "concierge"
      || rawSpace?.name !== this.conciergeSpaceName
      || rawSpace?.goal !== this.conciergeSpaceGoal
      || rawSpace?.turn_model !== "sequential_all"
      || rawSpace?.space_config_json !== desiredConfigJson
    );
    if (requiresMetadataRepair) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Concierge space metadata is out of policy for ${this.conciergeSpaceId}`,
        );
      }
      this.updateRawSpaceMetadata({
        spaceId: this.conciergeSpaceId,
        resourceId: this.conciergeSpaceResourceId,
        spaceType: "concierge",
        name: this.conciergeSpaceName,
        goal: this.conciergeSpaceGoal,
        turnModel: "sequential_all",
        configJson: desiredConfigJson,
      });
      repaired = true;
    }

    const conciergeAssignment = space.agents.find((assignment) => assignment.agentId === this.conciergeAgentId);
    if (!conciergeAssignment) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Concierge agent assignment is missing: ${this.conciergeAgentId}`,
        );
      }
      await this.spaceAdminService.addAgent({
        spaceId: this.conciergeSpaceId,
        agentId: this.conciergeAgentId,
        profileId: this.conciergeProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      });
      repaired = true;
    } else {
      const requiresNormalization = (
        conciergeAssignment.profileId !== this.conciergeProfileId
        || conciergeAssignment.role !== "global_coordinator"
        || conciergeAssignment.turnOrder !== 0
        || !conciergeAssignment.isPrimary
      );
      if (requiresNormalization) {
        if (!repairIfMissing) {
          throwGatewayError(
            "FAILED_PRECONDITION",
            `Concierge assignment is out of policy for agent ${this.conciergeAgentId}`,
          );
        }
        await this.spaceAdminService.updateAgentAssignment({
          spaceId: this.conciergeSpaceId,
          agentId: this.conciergeAgentId,
          profileId: this.conciergeProfileId,
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        });
        repaired = true;
      }
    }

    let refreshed = await this.spaceAdminService.getSpace(this.conciergeSpaceId);
    if (!refreshed) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to load concierge space after repair: ${this.conciergeSpaceId}`,
      );
    }
    let refreshedAssignment = refreshed.agents.find((assignment) => assignment.agentId === this.conciergeAgentId);
    if (!refreshedAssignment) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to load canonical concierge assignment after repair: ${this.conciergeSpaceId}/${this.conciergeAgentId}`,
      );
    }

    if (this.hasConciergeAssignmentPolicyConflicts(refreshed.agents)) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Concierge assignment policy conflict detected for canonical agent ${this.conciergeAgentId}`,
        );
      }
      await this.spaceAdminService.updateAgentAssignment({
        spaceId: this.conciergeSpaceId,
        agentId: this.conciergeAgentId,
        profileId: this.conciergeProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      });
      repaired = true;

      refreshed = await this.spaceAdminService.getSpace(this.conciergeSpaceId);
      if (!refreshed) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to load concierge space after policy normalization: ${this.conciergeSpaceId}`,
        );
      }
      refreshedAssignment = refreshed.agents.find((assignment) => assignment.agentId === this.conciergeAgentId);
      if (!refreshedAssignment) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to load canonical concierge assignment after policy normalization: ${this.conciergeSpaceId}/${this.conciergeAgentId}`,
        );
      }
    }

    if (refreshed.orchestratorProfileId !== this.conciergeProfileId) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Concierge orchestrator profile is out of policy for ${this.conciergeSpaceId}`,
        );
      }
      await this.spaceAdminService.setSpaceOrchestrator({
        spaceId: this.conciergeSpaceId,
        profileId: this.conciergeProfileId,
      });
      repaired = true;

      refreshed = await this.spaceAdminService.getSpace(this.conciergeSpaceId);
      if (!refreshed) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to load concierge space after orchestrator normalization: ${this.conciergeSpaceId}`,
        );
      }
      refreshedAssignment = refreshed.agents.find((assignment) => assignment.agentId === this.conciergeAgentId);
      if (!refreshedAssignment) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to load canonical concierge assignment after orchestrator normalization: ${this.conciergeSpaceId}/${this.conciergeAgentId}`,
        );
      }
    }

    return {
      spaceUid: refreshed.spaceUid,
      repaired,
      assignedProfileId: refreshedAssignment?.profileId,
      updatedAt: String(refreshed.updatedAt),
    };
  }

  private hasMainAssignmentPolicyConflicts(
    assignments: Array<{ agentId: string; role: string; isPrimary: boolean }>,
  ): boolean {
    return assignments.some((assignment) => {
      if (assignment.agentId === this.mainAgentId) {
        return false;
      }
      const role = assignment.role.trim().toLowerCase();
      return assignment.isPrimary || role === "global_coordinator";
    });
  }

  private hasConciergeAssignmentPolicyConflicts(
    assignments: Array<{ agentId: string; role: string; isPrimary: boolean }>,
  ): boolean {
    return assignments.some((assignment) => {
      if (assignment.agentId === this.conciergeAgentId) {
        return false;
      }
      const role = assignment.role.trim().toLowerCase();
      return assignment.isPrimary || role === "global_coordinator";
    });
  }

  private async normalizeMainAssignment(spaceId: string): Promise<void> {
    if (spaceId !== this.mainSpaceId) {
      return;
    }
    await this.ensureMainSpace(true);
  }

  private async normalizeConciergeAssignment(spaceId: string): Promise<void> {
    if (spaceId !== this.conciergeSpaceId) {
      return;
    }
    await this.ensureConciergeSpace(true);
  }

  private buildCanonicalConciergeSpaceConfigJson(existingJson: string | null | undefined): string {
    const parsed = this.parseSpaceConfigRecord(existingJson);
    parsed.visibility = "private";
    parsed.orchestratorProfileId = this.conciergeProfileId;
    return JSON.stringify(parsed);
  }

  private parseSpaceConfigRecord(existingJson: string | null | undefined): Record<string, unknown> {
    if (!existingJson?.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(existingJson) as Record<string, unknown> | null;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...parsed }
        : {};
    } catch {
      return {};
    }
  }

  private updateRawSpaceMetadata(input: {
    spaceId: string;
    resourceId: string;
    spaceType: string;
    name: string;
    goal: string;
    turnModel: string;
    configJson: string;
  }): void {
    const db = (this.spaceRepo as { db?: { query: (sql: string) => { run: (...args: unknown[]) => unknown } } } | undefined)?.db;
    if (!db) {
      throw new Error("Space persistence unavailable for concierge metadata repair");
    }
    db.query(
      `UPDATE spaces
       SET resource_id = ?,
           space_type = ?,
           name = ?,
           goal = ?,
           turn_model = ?,
           space_config_json = ?,
           updated_at = ?
       WHERE space_id = ?`,
    ).run(
      input.resourceId,
      input.spaceType,
      input.name,
      input.goal,
      input.turnModel,
      input.configJson,
      new Date().toISOString(),
      input.spaceId,
    );
  }

  private resolveFallbackProviderModel(): { providerHint: string; modelHint: string } | null {
    const providerConfigs = this.listProviderConfigs();
    if (providerConfigs.length > 0) {
      // Prefer non-Apple provider as fallback; Apple is always-available on macOS
      // but should not shadow user-configured or detected CLI providers.
      const fallback = providerConfigs.find((c) => c.providerId !== "apple")
        ?? providerConfigs[0];
      return {
        providerHint: fallback.providerId,
        modelHint: fallback.model,
      };
    }

    const defaultProvider = normalizeProviderId(this.defaultProviderId)
      || deriveProviderFromModel(this.defaultModelId)
      || this.resolveEmbeddedMacDefaultProvider();
    const defaultModelRaw = this.defaultModelId?.trim();
    if (defaultProvider && defaultModelRaw) {
      return {
        providerHint: defaultProvider,
        modelHint: withProviderPrefix(defaultProvider, defaultModelRaw),
      };
    }

    return null;
  }

  private resolveEmbeddedMacDefaultProvider(): string | undefined {
    // CLI providers are now auto-seeded during bootstrap; Apple should only
    // be selected through the normal priority order in providerConfigs,
    // not silently injected as a hidden default.
    return undefined;
  }

  private validatePinnedProviderModel(
    providerHintRaw?: string,
    modelHintRaw?: string,
  ): { valid: boolean; providerHint?: string; modelHint?: string; reason?: string } {
    const providerHint = deriveProviderFromModel(modelHintRaw) || normalizeProviderId(providerHintRaw);
    if (!providerHint) {
      return {
        valid: false,
        reason: "Main profile is missing runtime/model hints.",
      };
    }

    const providerConfig = this.listProviderConfigs()
      .find((entry) => entry.providerId.trim().toLowerCase() === providerHint);
    if (!providerConfig) {
      return {
        valid: false,
        reason: `Configured provider is unavailable: ${providerHint}`,
      };
    }

    const modelHint = withProviderPrefix(
      providerHint,
      modelHintRaw?.trim() || providerConfig.model,
    );
    const allowedModels = this.mergeAllowedModels(
      providerHint,
      providerConfig.model,
      providerConfig.allowedModels,
    );
    if (!providerConfig.allowCustomModel && !allowedModels.includes(modelHint)) {
      return {
        valid: false,
        reason: `Configured model is unavailable for provider ${providerHint}: ${modelHint}`,
      };
    }

    return {
      valid: true,
      providerHint,
      modelHint,
    };
  }

  private async validateProviderRuntimeSelection(
    providerId: string,
    modelIdRaw: string,
  ): Promise<ProviderRuntimeValidationResult> {
    if (providerId === "apple") {
      await this.ensureAppleFoundationAvailability();
      const eligibility = this.appleProviderRuntimeEligibleSync();
      if (!eligibility.eligible) {
        return {
          valid: false,
          reason: `Apple Foundation Models runtime is unavailable: ${eligibility.reason}`,
        };
      }
      return { valid: true };
    }

    if (providerId !== "lmstudio") {
      return { valid: true };
    }

    const modelId = withProviderPrefix(providerId, modelIdRaw);
    const baseURL = this.resolveProviderBaseURL(
      providerId,
      this.providerConfigs.get(providerId)?.baseURL,
    );
    const endpoint = resolveOpenAICompatibleModelsEndpoint(baseURL);
    const detection = await this.detectOpenAICompatibleModels(baseURL, {
      forceRefresh: true,
    });
    if (!detection.serviceReachable) {
      return {
        valid: false,
        reason: detection.detectionError
          || `LM Studio runtime is unreachable at ${endpoint}. Start LM Studio server and retry.`,
      };
    }

    const detectedModels = uniqueModelIds(
      detection.models.map((entry) => withProviderPrefix(providerId, entry.id)),
    );
    if (detectedModels.length === 0) {
      return {
        valid: false,
        reason: `LM Studio runtime is reachable at ${endpoint} but returned no models. Load a model in LM Studio and retry.`,
      };
    }

    const normalizedModelId = modelId.toLowerCase();
    if (detectedModels.some((candidate) => candidate.toLowerCase() === normalizedModelId)) {
      return { valid: true };
    }

    const preview = detectedModels.slice(0, 3);
    const overflowCount = detectedModels.length - preview.length;
    const overflowSuffix = overflowCount > 0 ? ` (+${overflowCount} more)` : "";

    return {
      valid: false,
      reason: `Model ${modelId} is not loaded in LM Studio runtime. Available models: ${preview.join(", ")}${overflowSuffix}. Load the model in LM Studio or select an available model.`,
      fallbackModelHint: detectedModels[0],
    };
  }

  private async resolveValidatedProviderModel(input: {
    providerHintRaw?: string;
    modelHintRaw?: string;
    repairIfInvalid: boolean;
    allowFallbackRepair?: boolean;
  }): Promise<ResolvedProviderModelHint> {
    const allowFallbackRepair = input.allowFallbackRepair ?? true;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    let pinned = this.validatePinnedProviderModel(
      input.providerHintRaw,
      input.modelHintRaw,
    );
    if (!pinned.valid) {
      if (!input.repairIfInvalid || !allowFallbackRepair) {
        return {
          valid: false,
          fallbackApplied: false,
          reason: pinned.reason || "Runtime/model selection is invalid",
        };
      }

      const fallback = this.resolveFallbackProviderModel();
      if (!fallback) {
        return {
          valid: false,
          fallbackApplied: false,
          reason: "Unable to repair runtime/model selection: no runtimes configured",
        };
      }

      fallbackApplied = true;
      fallbackReason = pinned.reason ?? "Configured runtime/model unavailable";
      pinned = {
        valid: true,
        providerHint: fallback.providerHint,
        modelHint: fallback.modelHint,
      };
    }

    if (!pinned.valid || !pinned.providerHint || !pinned.modelHint) {
      return {
        valid: false,
        fallbackApplied,
        fallbackReason,
        reason: pinned.reason || "Runtime/model selection is invalid",
      };
    }

    const runtimeValidation = await this.validateProviderRuntimeSelection(
      pinned.providerHint,
      pinned.modelHint,
    );
    if (!runtimeValidation.valid) {
      if (!input.repairIfInvalid || !allowFallbackRepair) {
        return {
          valid: false,
          fallbackApplied,
          fallbackReason,
          reason: runtimeValidation.reason || "Runtime model selection is invalid",
        };
      }

      let fallbackProviderHint: string | undefined;
      let fallbackModelHint: string | undefined;
      const runtimeFallbackModel = runtimeValidation.fallbackModelHint;
      if (
        runtimeFallbackModel
        && runtimeFallbackModel.trim().length > 0
        && runtimeFallbackModel.trim().toLowerCase() !== pinned.modelHint.trim().toLowerCase()
      ) {
        fallbackProviderHint = pinned.providerHint;
        fallbackModelHint = runtimeFallbackModel.trim();
      } else {
        const fallback = this.resolveFallbackProviderModel();
        if (fallback) {
          const sameProvider = fallback.providerHint === pinned.providerHint;
          const sameModel = fallback.modelHint.trim().toLowerCase() === pinned.modelHint.trim().toLowerCase();
          if (!(sameProvider && sameModel)) {
            fallbackProviderHint = fallback.providerHint;
            fallbackModelHint = fallback.modelHint;
          }
        }
      }

      if (!fallbackProviderHint || !fallbackModelHint) {
        return {
          valid: false,
          fallbackApplied,
          fallbackReason,
          reason: runtimeValidation.reason || "Unable to repair runtime model selection",
        };
      }

      const fallbackPinned = this.validatePinnedProviderModel(
        fallbackProviderHint,
        fallbackModelHint,
      );
      if (!fallbackPinned.valid || !fallbackPinned.providerHint || !fallbackPinned.modelHint) {
        return {
          valid: false,
          fallbackApplied,
          fallbackReason,
          reason: fallbackPinned.reason
            || runtimeValidation.reason
            || "Fallback runtime/model selection is invalid",
        };
      }

      const fallbackRuntimeValidation = await this.validateProviderRuntimeSelection(
        fallbackPinned.providerHint,
        fallbackPinned.modelHint,
      );
      if (!fallbackRuntimeValidation.valid) {
        return {
          valid: false,
          fallbackApplied,
          fallbackReason,
          reason: fallbackRuntimeValidation.reason
            || runtimeValidation.reason
            || "Fallback runtime model selection is invalid",
        };
      }

      fallbackApplied = true;
      fallbackReason = runtimeValidation.reason ?? "Configured runtime model unavailable";
      pinned = fallbackPinned;
    }

    return {
      valid: true,
      providerHint: pinned.providerHint,
      modelHint: pinned.modelHint,
      fallbackApplied,
      fallbackReason,
    };
  }

  private async resolveMainAgentState(input: {
    spaceId: string;
    repairIfMissing: boolean;
  }): Promise<GatewayMainAgentStatePayload> {
    const profileRepo = this.requireProfileRepo();
    const profileRepair = await this.ensureMainProfileActive(input.repairIfMissing);
    const spaceRepair = await this.ensureMainSpace(input.repairIfMissing);
    let repaired = profileRepair.repaired || spaceRepair.repaired;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    const activeRevision = profileRepo.getActiveRevision(this.mainProfileId);
    if (!activeRevision) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Active main profile revision missing: ${this.mainProfileId}`,
      );
    }

    const resolvedPinned = await this.resolveValidatedProviderModel({
      providerHintRaw: activeRevision.provider_hint,
      modelHintRaw: activeRevision.model_hint,
      repairIfInvalid: input.repairIfMissing,
      allowFallbackRepair: true,
    });
    if (!resolvedPinned.valid || !resolvedPinned.providerHint || !resolvedPinned.modelHint) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        resolvedPinned.reason || "Main profile runtime/model selection is invalid",
      );
    }
    if (resolvedPinned.fallbackApplied) {
      repaired = true;
    }
    fallbackApplied = resolvedPinned.fallbackApplied;
    fallbackReason = resolvedPinned.fallbackReason;

    const refreshedProfile = profileRepo.getById(this.mainProfileId);
    const updatedAt = new Date().toISOString();
    return {
      spaceId: input.spaceId,
      spaceUid: spaceRepair.spaceUid,
      mainAgentId: this.mainAgentId,
      mainProfileId: this.mainProfileId,
      assignedProfileId: spaceRepair.assignedProfileId,
      providerHint: resolvedPinned.providerHint,
      modelHint: resolvedPinned.modelHint,
      status: fallbackApplied ? "fallback" : repaired ? "repaired" : "healthy",
      repaired,
      fallbackApplied,
      fallbackReason,
      updatedAt: refreshedProfile?.updated_at || updatedAt,
    };
  }

  private async resolveConciergeAgentState(input: {
    spaceId: string;
    repairIfMissing: boolean;
  }): Promise<GatewayConciergeAgentStatePayload> {
    const profileRepo = this.requireProfileRepo();
    const profileRepair = await this.ensureConciergeProfileActive(input.repairIfMissing);
    const spaceRepair = await this.ensureConciergeSpace(input.repairIfMissing);
    let repaired = profileRepair.repaired || spaceRepair.repaired;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    const activeRevision = profileRepo.getActiveRevision(this.conciergeProfileId);
    if (!activeRevision) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Active concierge profile revision missing: ${this.conciergeProfileId}`,
      );
    }

    const resolvedPinned = await this.resolveValidatedProviderModel({
      providerHintRaw: activeRevision.provider_hint,
      modelHintRaw: activeRevision.model_hint,
      repairIfInvalid: input.repairIfMissing,
      allowFallbackRepair: false,
    });
    if (!resolvedPinned.valid || !resolvedPinned.providerHint || !resolvedPinned.modelHint) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        resolvedPinned.reason || "Concierge profile runtime/model selection is invalid",
      );
    }
    if (resolvedPinned.fallbackApplied) {
      repaired = true;
    }
    fallbackApplied = resolvedPinned.fallbackApplied;
    fallbackReason = resolvedPinned.fallbackReason;

    const refreshedProfile = profileRepo.getById(this.conciergeProfileId);
    const updatedAt = new Date().toISOString();
    return {
      spaceId: input.spaceId,
      spaceUid: spaceRepair.spaceUid,
      conciergeAgentId: this.conciergeAgentId,
      conciergeProfileId: this.conciergeProfileId,
      assignedProfileId: spaceRepair.assignedProfileId,
      providerHint: resolvedPinned.providerHint,
      modelHint: resolvedPinned.modelHint,
      status: fallbackApplied ? "fallback" : repaired ? "repaired" : "healthy",
      repaired,
      fallbackApplied,
      fallbackReason,
      updatedAt: refreshedProfile?.updated_at || updatedAt,
    };
  }

  private findLegacyConciergeProfile() {
    const profileRepo = this.requireProfileRepo();
    const candidates = profileRepo
      .list({ includeArchived: true })
      .filter((entry) => entry.profile_id.startsWith("system.concierge.profile."));
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates.sort((lhs, rhs) => rhs.updated_at.localeCompare(lhs.updated_at))[0];
  }

  async listProviderCatalogs(input?: {
    providerId?: string;
    refresh?: boolean;
  }): Promise<GatewayModelProviderCatalog[]> {
    await this.ensureAppleFoundationAvailability();
    const requestedProvider = normalizeProviderId(input?.providerId);
    if (input?.providerId && !requestedProvider) {
      throw new Error(`Unknown providerId: ${input.providerId}`);
    }
    if (requestedProvider === "apple" && !this.providerVisibleInCatalog("apple")) {
      throw new Error(`Unknown providerId: ${input?.providerId ?? requestedProvider}`);
    }

    const providerIds = requestedProvider
      ? [requestedProvider]
      : Array.from(new Set([
        ...Object.keys(DEFAULT_MODEL_BY_PROVIDER),
        ...Array.from(this.providerConfigs.keys()),
      ]))
        .filter((providerId) => this.providerVisibleInCatalog(providerId))
        .sort();

    const localAgents = await this.discoverLocalAgents();
    const localAgentsByProvider = new Map<string, DiscoveredLocalAgent>();
    for (const agent of localAgents) {
      localAgentsByProvider.set(agent.recommendedProviderId, agent);
    }

    const openAIDetections = new Map<string, {
      serviceReachable: boolean;
      models: OpenAICompatibleDetectedModel[];
      detectionError?: string;
    }>();
    const claudeAgentSdkDetections = new Map<string, ClaudeAgentSdkCatalogProbe>();

    await Promise.all(
      providerIds
        .filter((providerId) => isOpenAICompatibleProvider(providerId) && this.isProviderConfigAllowed(providerId))
        .map(async (providerId) => {
          const config = this.providerConfigs.get(providerId);
          const baseURL = this.resolveProviderBaseURL(providerId, config?.baseURL);
          const detection = await this.detectOpenAICompatibleModels(baseURL, {
            forceRefresh: input?.refresh === true,
          });
          openAIDetections.set(providerId, detection);
        }),
    );

    await Promise.all(
      providerIds
        .filter((providerId) => providerId === "claude-agent-sdk" && this.isProviderConfigAllowed(providerId))
        .map(async (providerId) => {
          const config = this.providerConfigs.get(providerId);
          const detection = await this.detectClaudeAgentSdkCatalog(config, input?.refresh === true);
          claudeAgentSdkDetections.set(providerId, detection);
        }),
    );

    return providerIds.map((providerId) => {
      const config = this.providerConfigs.get(providerId);
      const policyRestrictionReason = this.providerPolicyRestrictionReason(providerId);
      const configAllowed = this.isProviderConfigAllowed(providerId);
      const baseURL = this.resolveProviderBaseURL(providerId, config?.baseURL);
      const hasApiKey = Boolean(config?.apiKey || config?.apiKeySecretRef || keyFromEnvironment(providerId));
      const supportedAuthModes = providerSupportedAuthModes(providerId);
      const authMode = resolveProviderAuthMode(providerId, config?.authMode);
      let authStatus = inferDefaultProviderAuthStatus(providerId, authMode, hasApiKey);
      let authAccount: GatewayProviderAuthAccount | undefined;
      const requiresApiKey = providerRequiresApiKey(providerId, baseURL, authMode);
      const localAgent = localAgentsByProvider.get(providerId);
      const localRuntimeDetected = localAgent ? localAgent.detected : true;
      let runtimeAvailable = configAllowed && (requiresApiKey ? hasApiKey : true) && localRuntimeDetected;

      const models: GatewayModelCatalogEntry[] = [];
      const addModel = (
        idRaw: string | undefined,
        source: GatewayModelCatalogSource,
        available: boolean,
        contextWindow?: number,
      ) => {
        const idTrimmed = idRaw?.trim();
        if (!idTrimmed) return;
        const inferredContextWindow = contextWindow ?? inferContextWindow(providerId, idTrimmed);
        const id = withProviderPrefix(providerId, idTrimmed);
        const existingIndex = models.findIndex((entry) => entry.id === id);
        if (existingIndex >= 0) {
          if (models[existingIndex].contextWindow === undefined && inferredContextWindow !== undefined) {
            models[existingIndex] = {
              ...models[existingIndex],
              contextWindow: inferredContextWindow,
            };
          }
          return;
        }
        models.push({
          id,
          displayName: id.includes("/") ? id.split("/").slice(1).join("/") : id,
          source,
          available,
          ...(inferredContextWindow !== undefined ? { contextWindow: inferredContextWindow } : {}),
        });
      };

      let detectionStatus: GatewayModelDetectionStatus = runtimeAvailable ? "available" : "unavailable";
      let detectionError: string | undefined = policyRestrictionReason;
      let integrationStatus: GatewayIntegrationStatus = runtimeAvailable ? "reachable" : "missing";

      if (providerId === "apple" && configAllowed) {
        const eligibility = this.appleProviderRuntimeEligibleSync();
        runtimeAvailable = eligibility.eligible;
        detectionStatus = eligibility.eligible ? "available" : "unavailable";
        if (!eligibility.eligible) {
          detectionError = eligibility.reason;
          integrationStatus = "unsupported";
        }
      }

      if (localAgent && configAllowed) {
        if (!localAgent.detected) {
          detectionStatus = "unavailable";
          detectionError = localAgent.detectionError?.trim() || `${localAgent.name} runtime is not detected on this host.`;
          integrationStatus = "missing";
        } else if (localAgent.detectionError?.trim()) {
          detectionStatus = "error";
          detectionError = localAgent.detectionError.trim();
          integrationStatus = "error";
        } else {
          integrationStatus = "installed";
        }

        for (const modelId of localAgent.availableModels ?? []) {
          addModel(modelId, "detected", localAgent.detected);
        }
        for (const modelId of LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []) {
          addModel(modelId, "fallback", localAgent.detected);
        }
      }

      const openAIDetection = openAIDetections.get(providerId);
      if (openAIDetection && configAllowed) {
        if (openAIDetection.models.length > 0) {
          for (const model of openAIDetection.models) {
            addModel(model.id, "detected", runtimeAvailable, model.contextWindow);
          }
          detectionStatus = "available";
          integrationStatus = "reachable";
        } else if (openAIDetection.detectionError) {
          detectionStatus = "error";
          detectionError = openAIDetection.detectionError;
          integrationStatus = "error";
        } else if (openAIDetection.serviceReachable) {
          integrationStatus = "no_models_loaded";
        } else if (!openAIDetection.serviceReachable && !runtimeAvailable) {
          detectionStatus = "unavailable";
          integrationStatus = "missing";
        }
      }

      const claudeAgentSdkDetection = claudeAgentSdkDetections.get(providerId);
      if (claudeAgentSdkDetection && configAllowed) {
        authStatus = claudeAgentSdkDetection.authStatus;
        authAccount = claudeAgentSdkDetection.authAccount;
        if (claudeAgentSdkDetection.models.length > 0) {
          for (const model of claudeAgentSdkDetection.models) {
            addModel(model.id, "detected", authStatus === "authenticated", model.contextWindow);
          }
          detectionStatus = "available";
          detectionError = undefined;
        } else if (claudeAgentSdkDetection.detectionError) {
          detectionError = claudeAgentSdkDetection.detectionError;
          detectionStatus = authStatus === "error" ? "error" : models.length > 0 ? "available" : "unavailable";
        }
      }

      for (const modelId of config?.allowedModels ?? []) {
        addModel(modelId, "allowlist", runtimeAvailable);
      }
      addModel(config?.model, "configured", runtimeAvailable);
      const shouldUseFallbackManifest = providerId !== "claude-agent-sdk"
        || !models.some((entry) => entry.source === "detected");
      if (shouldUseFallbackManifest) {
        for (const modelId of LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []) {
          addModel(modelId, "fallback", runtimeAvailable);
        }
        addModel(DEFAULT_MODEL_BY_PROVIDER[providerId], "fallback", runtimeAvailable);
      }

      // Sort models for cloud providers with dynamically detected model lists.
      // CLI executor providers (claude, codex, gemini) keep manifest insertion order.
      if (
        (isOpenAICompatibleProvider(providerId) && !isCliExecutorProvider(providerId))
        || providerId === "claude-agent-sdk"
      ) {
        models.sort((a, b) => {
          const sourcePriority = (s: GatewayModelCatalogSource): number => {
            if (providerId === "claude-agent-sdk") {
              switch (s) {
                case "detected": return 0;
                case "configured": return 1;
                case "allowlist": return 2;
                case "fallback": return 3;
                default: return 4;
              }
            }
            switch (s) {
              case "configured": return 0;
              case "detected": return 1;
              case "allowlist": return 2;
              case "fallback": return 3;
              default: return 4;
            }
          };
          const aPriority = sourcePriority(a.source);
          const bPriority = sourcePriority(b.source);
          if (aPriority !== bPriority) return aPriority - bPriority;
          const aCtx = a.contextWindow ?? 0;
          const bCtx = b.contextWindow ?? 0;
          if (aCtx !== bCtx) return bCtx - aCtx;
          return a.displayName.localeCompare(b.displayName);
        });
      }

      if (!configAllowed) {
        integrationStatus = "policy_blocked";
      } else if (authStatus === "needs_auth") {
        integrationStatus = "needs_auth";
      } else if (authStatus === "needs_key") {
        integrationStatus = "needs_key";
      } else if (requiresApiKey && !hasApiKey) {
        integrationStatus = "needs_key";
      } else if (authStatus === "error") {
        integrationStatus = "error";
      } else if (detectionStatus === "error") {
        integrationStatus = "error";
      } else if (models.length === 0 && isOpenAICompatibleProvider(providerId) && runtimeAvailable) {
        integrationStatus = "no_models_loaded";
      }

      return {
        providerId,
        displayName: providerDisplayName(providerId),
        group: providerCatalogGroup(providerId),
        integrationClass: providerIntegrationClass(providerId),
        status: integrationStatus,
        hasApiKey,
        requiresApiKey,
        ...(supportedAuthModes.length > 0 ? { supportedAuthModes } : {}),
        ...(authMode ? { authMode } : {}),
        ...(authStatus ? { authStatus } : {}),
        ...(authAccount ? { authAccount } : {}),
        baseURL,
        detectionStatus,
        ...(detectionError ? { detectionError } : {}),
        models,
        installHint: providerInstallHint(providerId),
        recommended: providerRecommended(providerId),
        supportsHostedBilling: providerIntegrationClass(providerId) === "cloud",
        configAllowed,
      };
    });
  }

  async listAvailableModels(input?: {
    providerId?: string;
    refresh?: boolean;
  }): Promise<GatewayModelProviderCatalog[]> {
    return this.listProviderCatalogs(input);
  }

  listTools(_input: GatewayListToolsPayload = {}): GatewayListToolsResponsePayload["tools"] {
    return this.cliToolService?.listTools() ?? [];
  }

  getTool(toolId: string): GatewayGetToolResponsePayload["tool"] {
    return this.cliToolService?.getTool(toolId) ?? null;
  }

  listInterconnectors(
    _input: GatewayListInterconnectorsPayload = {},
  ): GatewayListInterconnectorsResponsePayload["interconnectors"] {
    return this.interconnectorCatalogService?.listBundles() ?? [];
  }

  async rescanInterconnectors(
    _input: GatewayRescanInterconnectorsPayload = {},
  ): Promise<GatewayRescanInterconnectorsResponsePayload["interconnectors"]> {
    if (!this.interconnectorCatalogService) {
      return [];
    }
    const result = await this.interconnectorCatalogService.rescan();
    return result.interconnectors;
  }

  scaffoldTool(
    input: GatewayScaffoldToolPayload,
  ): GatewayScaffoldToolResponsePayload {
    const cliToolService = this.requireCliToolService();
    return cliToolService.scaffoldTool({
      id: input.id,
      displayName: input.displayName,
      description: input.description,
      outputMode: input.outputMode,
    });
  }

  async registerTool(
    input: GatewayRegisterToolPayload,
  ): Promise<GatewayRegisterToolResponsePayload["tool"]> {
    const cliToolService = this.requireCliToolService();
    return cliToolService.registerTool({
      schemaVersion: input.schemaVersion,
      id: input.id,
      displayName: input.displayName,
      description: input.description,
      bundleId: input.bundleId,
      bundleDisplayName: input.bundleDisplayName,
      bundleDescription: input.bundleDescription,
      toolGroupId: input.toolGroupId,
      toolGroupDisplayName: input.toolGroupDisplayName,
      executable: input.executable,
      argsTemplate: input.argsTemplate,
      inputSchema: input.inputSchema,
      instructions: input.instructions,
      examples: input.examples,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      cwdMode: input.cwdMode,
      fixedCwd: input.fixedCwd,
      outputMode: input.outputMode,
      dangerLevel: input.dangerLevel,
      readme: input.readme,
      enabled: input.enabled,
    });
  }

  async removeTool(toolId: string): Promise<GatewayRemoveToolResponsePayload> {
    const cliToolService = this.requireCliToolService();
    const removed = await cliToolService.removeTool(toolId);
    return {
      toolId,
      removed,
    };
  }

  async setToolEnabled(
    input: GatewaySetToolEnabledPayload,
  ): Promise<GatewaySetToolEnabledResponsePayload> {
    const cliToolService = this.requireCliToolService();
    return {
      tools: await cliToolService.setToolEnabled(input.toolId, input.enabled),
    };
  }

  listToolApprovalGrants(
    input: GatewayListToolApprovalGrantsPayload,
    principalId: string,
    deviceId?: string,
  ): GatewayListToolApprovalGrantsResponsePayload["grants"] {
    const toolApprovalGrantService = this.requireToolApprovalGrantService();
    return toolApprovalGrantService.listGrants({
      principalId,
      deviceId: asString(input.deviceId) ?? deviceId,
      spaceId: asString(input.spaceId),
      toolId: asString(input.toolId),
      includeExpired: input.includeExpired,
      includeRevoked: input.includeRevoked,
    });
  }

  revokeToolApprovalGrant(
    input: GatewayRevokeToolApprovalGrantPayload,
    principalId: string,
    deviceId?: string,
  ): GatewayRevokeToolApprovalGrantResponsePayload {
    const toolApprovalGrantService = this.requireToolApprovalGrantService();
    const resolvedDeviceId = asString(input.deviceId) ?? deviceId;
    const result = toolApprovalGrantService.revokeGrant({
      principalId,
      deviceId: resolvedDeviceId,
      spaceId: input.spaceId,
      toolId: input.toolId,
      reason: input.reason,
    });
    this.accessGrantService?.revokeAccess({
      principalId,
      deviceId: resolvedDeviceId,
      spaceId: input.spaceId,
      targetKind: "tool_selector",
      targetId: `tool_operation:${input.toolId}`,
      reason: input.reason ?? `Revoked tool approval for ${input.toolId}.`,
    });
    return result;
  }

  createIntegrationRequest(
    input: GatewayCreateIntegrationRequestPayload,
    principalId?: string,
    deviceId?: string,
  ): GatewayCreateIntegrationRequestResponsePayload["request"] {
    if (!this.integrationRequestRepo) {
      throw new Error("Integration request repository unavailable");
    }
    const requestedName = input.requestedName?.trim();
    if (!requestedName) {
      throw new Error("requestedName is required");
    }
    const integrationClass = normalizeIntegrationClass(input.integrationClass);
    if (!integrationClass) {
      throw new Error("integrationClass is required");
    }
    const row = this.integrationRequestRepo.create({
      integrationRequestId: randomUUID(),
      integrationClass,
      requestedName,
      useCase: input.useCase?.trim(),
      sourceUrl: input.sourceURL?.trim(),
      notes: input.notes?.trim(),
      principalId: principalId?.trim(),
      deviceId: deviceId?.trim(),
    });
    return mapIntegrationRequestRow(row);
  }

  listIntegrationRequests(
    input?: GatewayListIntegrationRequestsPayload,
  ): GatewayListIntegrationRequestsResponsePayload["requests"] {
    if (!this.integrationRequestRepo) {
      return [];
    }
    const integrationClass = normalizeIntegrationClass(input?.integrationClass);
    return this.integrationRequestRepo
      .list(input?.limit, integrationClass)
      .map((row) => mapIntegrationRequestRow(row));
  }

  setUsageSnapshotService(service?: UsageSnapshotService): void {
    this.usageSnapshotService = service;
  }

  setLocalUsageTelemetryService(service?: LocalUsageTelemetryService): void {
    this.localUsageTelemetryService = service;
  }

  async getProviderTelemetry(input?: {
    providerId?: string;
  }): Promise<ProviderTelemetry[]> {
    const requestedProvider = normalizeProviderId(input?.providerId);
    if (input?.providerId && !requestedProvider) {
      throw new Error(`Unknown providerId: ${input.providerId}`);
    }

    const configured = this.listProviderConfigs();
    const configuredById = new Map(
      configured.map((entry) => [entry.providerId.trim().toLowerCase(), entry]),
    );

    if (requestedProvider && !configuredById.has(requestedProvider)) {
      throw new Error(`Unknown providerId: ${requestedProvider}`);
    }

    const targetConfigs = requestedProvider
      ? [configuredById.get(requestedProvider)!]
      : configured;
    return this.buildProviderTelemetryEntries(targetConfigs);
  }

  async getLocalUsageTelemetry(input?: {
    providerId?: string;
  }): Promise<LocalProviderUsageTelemetry[]> {
    const requestedProvider = normalizeProviderId(input?.providerId);
    if (input?.providerId && !requestedProvider) {
      throw new Error(`Unknown providerId: ${input.providerId}`);
    }

    const configured = this.listProviderConfigs();
    const configuredById = new Map(
      configured.map((entry) => [entry.providerId.trim().toLowerCase(), entry]),
    );

    if (requestedProvider && !configuredById.has(requestedProvider)) {
      throw new Error(`Unknown providerId: ${requestedProvider}`);
    }

    const targetConfigs = requestedProvider
      ? [configuredById.get(requestedProvider)!]
      : configured;
    const targetProviderIds = targetConfigs
      .map((entry) => entry.providerId.trim().toLowerCase())
      .filter((providerId) => providerId.length > 0);
    const fallbackTelemetry = await this.buildProviderTelemetryEntries(targetConfigs);
    if (!this.localUsageTelemetryService) {
      const fetchedAt = new Date().toISOString();
      return fallbackTelemetry.map((entry) => ({
        providerId: entry.providerId,
        status: entry.status,
        fetchedAt,
        message: entry.message,
        quota: {
          available: entry.windows.length > 0,
          sourceLabel: mapFallbackTelemetrySource(entry.source),
          windows: entry.windows.map((window) => ({
            window: window.window,
            label: window.window === "primary" ? "session" : "weekly",
            usedPercent: window.usedPercent,
            remainingPercent: window.remainingPercent,
            windowMinutes: window.windowDurationMins,
            resetsAt: window.resetsAt,
          })),
          accountLabel: entry.accountLabel,
          updatedAt: fetchedAt,
          message: "Local usage telemetry service is not configured.",
        },
        summary: {
          windowDays: 30,
          sessionCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          tokenAccuracy: "estimated",
          usageSource: "local_scanner",
        },
        sessions: [],
      }));
    }

    return this.localUsageTelemetryService.getTelemetry({
      providerIds: targetProviderIds,
      fallbackTelemetry,
    });
  }

  private async buildProviderTelemetryEntries(
    configs: PublicProviderRuntimeConfig[],
  ): Promise<ProviderTelemetry[]> {
    const usageByProvider = this.providerUsageById();

    return Promise.all(
      configs.map(async (config) => this.buildProviderTelemetryEntry(
        config,
        usageByProvider.get(config.providerId.trim().toLowerCase()),
      )),
    );
  }

  private async buildProviderTelemetryEntry(
    config: PublicProviderRuntimeConfig,
    usage?: ProviderUsageSnapshotPayload,
  ): Promise<ProviderTelemetry> {
    const providerId = config.providerId.trim().toLowerCase();
    const fallbackStatus = usage?.status ?? "unknown";
    const fetchedAt = new Date().toISOString();
    const probe = await this.probeLocalProviderTelemetry(config, usage);

    return {
      providerId,
      status: probe?.status ?? fallbackStatus,
      source: probe?.source ?? "usage_snapshot",
      fetchedAt,
      message: probe?.message ?? usage?.message,
      accountLabel: probe?.accountLabel,
      windows: probe?.windows ?? [],
      usage,
    };
  }

  getProviderSettings(providerIdRaw: string): PublicProviderRuntimeConfig {
    const providerId = normalizeProviderId(providerIdRaw);
    if (!providerId) {
      throw new Error("providerId is required");
    }
    if (providerId === "apple") {
      this.ensureAppleProviderEnabledSync("getProviderSettings");
    }

    const existing = this.providerConfigs.get(providerId);
    const model = withProviderPrefix(
      providerId,
      existing?.model
        || DEFAULT_MODEL_BY_PROVIDER[providerId]
        || this.defaultModelId
        || `${providerId}/default`,
    );

    const hasApiKey = Boolean(existing?.apiKey || existing?.apiKeySecretRef || keyFromEnvironment(providerId));
    const baseURL = this.resolveProviderBaseURL(providerId, existing?.baseURL);
    const normalizedAllowedModels = normalizeProviderModelList(
      providerId,
      existing?.allowedModels?.length
        ? existing.allowedModels
        : [model],
    );
    const allowedModels = this.mergeAllowedModels(providerId, model, normalizedAllowedModels);
    const allowCustomModel = existing?.allowCustomModel ?? false;
    const nativeCliToolsEnabled = isCliExecutorProvider(providerId)
      ? (existing?.nativeCliToolsEnabled ?? false)
      : false;

    return {
      providerId,
      model,
      baseURL,
      hasApiKey,
      apiKeySecretRef: existing?.apiKeySecretRef,
      authMode: resolveProviderAuthMode(providerId, existing?.authMode),
      allowedModels,
      allowCustomModel,
      nativeCliToolsEnabled,
      updatedAt: existing?.updatedAt ?? new Date().toISOString(),
      source: existing?.source ?? "runtime",
    };
  }

  updateProviderSettings(input: {
    providerId: string;
    model?: string;
    apiKey?: string;
    apiKeySecretRef?: string;
    authMode?: GatewayProviderAuthMode;
    baseURL?: string;
    allowedModels?: string[];
    allowCustomModel?: boolean;
    nativeCliToolsEnabled?: boolean;
  }): PublicProviderRuntimeConfig {
    return this.setProviderConfig(input);
  }

  setProviderConfig(input: {
    providerId: string;
    model?: string;
    apiKey?: string;
    apiKeySecretRef?: string;
    authMode?: GatewayProviderAuthMode;
    baseURL?: string;
    allowedModels?: string[];
    allowCustomModel?: boolean;
    nativeCliToolsEnabled?: boolean;
  }): PublicProviderRuntimeConfig {
    const providerId = normalizeProviderId(input.providerId);
    if (!providerId) {
      throw new Error("providerId is required");
    }
    if (providerId === "apple") {
      this.ensureAppleProviderEnabledSync("setProviderConfig");
    }

    const existing = this.providerConfigs.get(providerId);
    this.assertProviderConfigAllowed(providerId, input, existing);
    const rawModel = input.model?.trim()
      || existing?.model
      || DEFAULT_MODEL_BY_PROVIDER[providerId]
      || this.defaultModelId
      || "";

    if (!rawModel) {
      throw new Error("model is required");
    }
    const model = withProviderPrefix(providerId, rawModel);

    const requestedApiKey = input.apiKey?.trim();
    const requestedSecretRef = input.apiKeySecretRef?.trim();
    const authMode = resolveRequestedProviderAuthMode(providerId, input.authMode, existing?.authMode);
    if (requestedSecretRef) {
      if (!this.providerSecretRefService) {
        throw new Error("Provider secret ref service unavailable");
      }
      const summary = this.providerSecretRefService.getSecretRef(requestedSecretRef);
      if (!summary) {
        throw new Error(`Unknown provider secret ref: ${requestedSecretRef}`);
      }
      if (summary.providerId !== providerId) {
        throw new Error(
          `Secret ref provider mismatch: expected ${providerId}, got ${summary.providerId}`,
        );
      }
    }

    const allowCustomModel = input.allowCustomModel ?? existing?.allowCustomModel ?? false;
    const nativeCliToolsEnabled = isCliExecutorProvider(providerId)
      ? (input.nativeCliToolsEnabled ?? existing?.nativeCliToolsEnabled ?? false)
      : false;
    const normalizedAllowedModels = normalizeProviderModelList(
      providerId,
      input.allowedModels
        ?? existing?.allowedModels
        ?? [model],
    );
    const allowedModels = this.mergeAllowedModels(providerId, model, normalizedAllowedModels);
    const inputHasBaseURL = Object.prototype.hasOwnProperty.call(input, "baseURL");
    const normalizedInputBaseURL = normalizeProviderBaseURL(providerId, input.baseURL);

    const config: ProviderRuntimeConfig = {
      providerId,
      model,
      apiKey: authMode === "api_key"
        ? (requestedApiKey || (requestedSecretRef ? undefined : existing?.apiKey))
        : undefined,
      apiKeySecretRef: requestedSecretRef || (requestedApiKey ? undefined : existing?.apiKeySecretRef),
      authMode,
      baseURL: inputHasBaseURL ? normalizedInputBaseURL : existing?.baseURL,
      allowedModels,
      allowCustomModel,
      nativeCliToolsEnabled,
      updatedAt: new Date().toISOString(),
      source: "runtime",
    };

    this.providerConfigs.set(providerId, config);
    this.applyConfigToEnvironment(config);
    this.invalidateProviderRuntimeCaches(providerId);

    if (this.providerConfigRepo) {
      this.providerConfigRepo.upsert({
        providerId: config.providerId,
        model: config.model,
        baseUrl: config.baseURL,
        allowedModelsJson: JSON.stringify(config.allowedModels),
        allowCustomModel: config.allowCustomModel,
        nativeCliToolsEnabled: config.nativeCliToolsEnabled,
        apiKeySecretRef: config.apiKeySecretRef,
        authMode: config.authMode,
        source: config.source,
      });
    }

    this.logger.info("Gateway provider config updated", {
      providerId,
      model,
      hasApiKey: Boolean(config.apiKey || config.apiKeySecretRef),
      apiKeySecretRef: config.apiKeySecretRef ?? "",
      hasBaseURL: Boolean(config.baseURL),
    });

    return {
      providerId: config.providerId,
      model: config.model,
      baseURL: config.baseURL,
      hasApiKey: Boolean(config.apiKey || config.apiKeySecretRef),
      apiKeySecretRef: config.apiKeySecretRef,
      authMode: config.authMode,
      allowedModels: [...config.allowedModels],
      allowCustomModel: config.allowCustomModel,
      nativeCliToolsEnabled: config.nativeCliToolsEnabled,
      updatedAt: config.updatedAt,
      source: config.source,
    };
  }

  putSecretRef(input: PutSecretRefInput): PutSecretRefResult {
    if (!this.providerSecretRefService) {
      throw new Error("Provider secret ref service unavailable");
    }
    return this.providerSecretRefService.putSecretRef(input);
  }

  listSecretRefs(providerId?: string): ProviderSecretRefSummary[] {
    if (!this.providerSecretRefService) {
      return [];
    }
    return this.providerSecretRefService.listSecretRefs(providerId);
  }

  deleteSecretRef(secretRef: string): boolean {
    if (!this.providerSecretRefService) {
      throw new Error("Provider secret ref service unavailable");
    }
    const deleted = this.providerSecretRefService.deleteSecretRef(secretRef);

    for (const [providerId, config] of this.providerConfigs.entries()) {
      if (config.apiKeySecretRef !== secretRef) continue;
      this.providerConfigs.set(providerId, {
        ...config,
        apiKeySecretRef: undefined,
        updatedAt: new Date().toISOString(),
      });
      this.invalidateProviderRuntimeCaches(providerId);
    }

    return deleted;
  }

  removeProviderConfig(providerIdRaw: string): void {
    const providerId = normalizeProviderId(providerIdRaw);
    if (!providerId) {
      throw new Error("providerId is required");
    }

    const existing = this.providerConfigs.get(providerId);
    this.providerConfigs.delete(providerId);
    this.providerConfigRepo?.remove(providerId);
    this.invalidateProviderRuntimeCaches(providerId);

    const keyEnv = API_KEY_ENV_BY_PROVIDER[providerId];
    if (keyEnv) {
      delete process.env[keyEnv];
    }
    if (providerId === "openai") {
      delete process.env[OPENAI_BASE_URL_ENV];
    }
    if (providerId === "lmstudio") {
      delete process.env[LMSTUDIO_BASE_URL_ENV];
    }

    this.logger.info("Gateway provider config removed", {
      providerId,
      hadConfig: Boolean(existing),
    });
  }

  async provisionLocalProfile(input: ProvisionLocalProfileInput): Promise<ProvisionLocalProfileResult> {
    const template = LOCAL_CLIENT_TEMPLATES.find((entry) => entry.id === input.localClientId);

    if (this.gatewayProfile === "embedded" && !this.embeddedLocalIntegrationsAllowed()) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Local profile provisioning requires embedded macOS on Apple Silicon or an external gateway profile.",
      );
    }
    if (!template) {
      throw new Error(`Unsupported localClientId: ${input.localClientId}`);
    }

    if (!this.profileRepo) {
      throw new Error("Profile repository unavailable");
    }

    const profileId = (input.profileId?.trim() || `local-${template.id}-profile`);
    const profileName = input.profileName?.trim() || template.defaultProfileName;

    const providerConfig = this.providerConfigs.get(template.recommendedProviderId);
    const providerId = providerConfig?.providerId ?? template.recommendedProviderId;
    const model = providerConfig?.model ?? template.recommendedModel;

    const existing = this.profileRepo.getById(profileId);
    let created = false;
    if (!existing) {
      this.profileRepo.create({
        profileId,
        name: profileName,
        description: `Auto-provisioned profile for ${template.name}.`,
        canModerate: false,
        personalityPrompt: template.defaultPersonalityPrompt,
        providerHint: providerId,
        modelHint: model,
      });
      created = true;
    }

    let assignmentCreated: boolean | undefined;
    const agentId = input.agentId?.trim();
    const spaceId = input.spaceId?.trim();
    if (agentId && spaceId) {
      assignmentCreated = await this.ensureAgentAssignment(spaceId, agentId, profileId);
    }

    this.logger.info("Local profile provisioned", {
      localClientId: template.id,
      profileId,
      created,
      providerId,
      model,
      agentId: agentId ?? "",
      spaceId: spaceId ?? "",
      assignmentCreated: assignmentCreated ?? false,
    });

    return {
      profileId,
      profileName,
      created,
      providerId,
      model,
      agentId: agentId || undefined,
      assignmentCreated,
    };
  }

  loadProfileRuntime(profileIdRaw?: string): ProfileRuntimeContext | null {
    if (!this.profileRepo || !profileIdRaw?.trim()) {
      return null;
    }

    const profileId = profileIdRaw.trim();
    const row = this.profileRepo.getById(profileId);
    if (!row || row.archived === 1) {
      return null;
    }

    const revision = this.profileRepo.getActiveRevision(profileId);
    const modelConfig = parseModelConfig(revision?.model_config_json, revision?.model_hint);
    const preferredModelHint = modelConfig.preferredModels[0] || revision?.model_hint?.trim() || undefined;
    return {
      profileId,
      systemPrompt: revision?.personality_prompt?.trim() || "",
      defaultSkillIds: parseStringArray(revision?.default_skill_set_ids_json),
      providerHint: revision?.provider_hint?.trim() || undefined,
      modelHint: preferredModelHint,
      modelConfig,
    };
  }

  async resolveProviderForProfile(
    providerHintRaw?: string,
    modelHint?: string,
  ): Promise<ResolvedProviderSelection> {
    const providerHint = normalizeProviderId(providerHintRaw);
    const providerFromModel = deriveProviderFromModel(modelHint);
    if (providerHint && providerFromModel && providerHint !== providerFromModel) {
      this.logger.warn("Profile provider hint mismatches model hint prefix; preferring model hint provider", {
        providerHint,
        modelHint,
        selectedProvider: providerFromModel,
      });
    }
    let selectedProvider = providerFromModel
      || providerHint
      || this.defaultProviderId
      || deriveProviderFromModel(this.defaultModelId)
      || this.resolveEmbeddedMacDefaultProvider()
      || "openrouter";
    let enforcedModelHint = modelHint?.trim() || undefined;
    const explicitSelection = Boolean(providerFromModel || providerHint);
    const policyRestrictionReason = this.providerPolicyRestrictionReason(selectedProvider);
    if (policyRestrictionReason) {
      const fallback = this.resolveFallbackProviderModel();
      if (!fallback) {
        throwGatewayError("FAILED_PRECONDITION", policyRestrictionReason);
      }
      this.logger.warn("Profile runtime blocked by embedded policy; using fallback runtime/model", {
        requestedProvider: selectedProvider,
        fallbackProvider: fallback.providerHint,
        fallbackModel: fallback.modelHint,
      });
      selectedProvider = fallback.providerHint;
      enforcedModelHint = fallback.modelHint;
    }

    const configuredSelection = this.providerConfigs.get(selectedProvider);
    if (explicitSelection || configuredSelection) {
      const resolvedModel = await this.resolveValidatedProviderModel({
        providerHintRaw: selectedProvider,
        modelHintRaw: enforcedModelHint || configuredSelection?.model,
        repairIfInvalid: true,
      });
      if (!resolvedModel.valid || !resolvedModel.providerHint || !resolvedModel.modelHint) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          resolvedModel.reason || "Runtime/model selection is invalid",
        );
      }
      if (resolvedModel.fallbackApplied) {
        this.logger.warn("Profile runtime unavailable; using fallback runtime/model", {
          requestedProvider: selectedProvider,
          requestedModel: enforcedModelHint || configuredSelection?.model || "",
          fallbackProvider: resolvedModel.providerHint,
          fallbackModel: resolvedModel.modelHint,
          reason: resolvedModel.fallbackReason,
        });
      }
      selectedProvider = resolvedModel.providerHint;
      enforcedModelHint = resolvedModel.modelHint;
    }

    if (selectedProvider === "apple") {
      this.ensureAppleProviderRuntimeEligibleSync("resolveProviderForProfile");
    }

    const config = this.providerConfigs.get(selectedProvider);
    const modelRaw = enforcedModelHint
      || config?.model
      || DEFAULT_MODEL_BY_PROVIDER[selectedProvider]
      || this.defaultModelId
      || "";

    if (!modelRaw) {
      throw new Error(`No model configured for provider ${selectedProvider}`);
    }
    const model = withProviderPrefix(selectedProvider, modelRaw);

    const baseURL = this.resolveProviderBaseURL(selectedProvider, config?.baseURL);
    const apiKeySecretRef = config?.apiKeySecretRef;
    const authMode = resolveProviderAuthMode(selectedProvider, config?.authMode);
    let apiKey = authMode === "api_key"
      ? (config?.apiKey || keyFromEnvironment(selectedProvider))
      : undefined;
    if (!apiKey && apiKeySecretRef && authMode === "api_key") {
      if (!this.providerSecretRefService) {
        throw new Error(`Provider secret ref service unavailable for ref: ${apiKeySecretRef}`);
      }
      const resolved = this.providerSecretRefService.resolveSecret(apiKeySecretRef);
      if (!resolved) {
        throw new Error(`Provider secret ref not found: ${apiKeySecretRef}`);
      }
      apiKey = resolved.secret;
    }

    return {
      providerId: selectedProvider,
      model,
      apiKey,
      apiKeySecretRef,
      authMode,
      baseURL,
      isLocal: isLocalProvider(selectedProvider)
        || (selectedProvider === "openai" && isLikelyLocalBaseURL(baseURL)),
      nativeCliToolsEnabled: config?.nativeCliToolsEnabled ?? false,
    };
  }

  validateProfileModelSelection(input: {
    providerHint?: string;
    modelHint?: string;
    modelConfig?: ProfileModelConfig;
  }): void {
    const providerHint = normalizeProviderId(input.providerHint);
    const candidateModels = collectProfileModelCandidates(input.modelHint, input.modelConfig);
    if (candidateModels.length === 0) {
      return;
    }

    for (const candidateModel of candidateModels) {
      const candidateProviderFromModel = deriveProviderFromModel(candidateModel);
      if (providerHint && candidateProviderFromModel && providerHint !== candidateProviderFromModel) {
        throwGatewayError(
          "INVALID_ARGUMENT",
          `Model ${candidateModel} belongs to provider ${candidateProviderFromModel} but providerHint is ${providerHint}. Update providerHint/modelHint together.`,
        );
      }
      const candidateProvider = candidateProviderFromModel
        || providerHint
        || this.defaultProviderId
        || deriveProviderFromModel(this.defaultModelId)
        || "openai";
      const policyRestrictionReason = this.providerPolicyRestrictionReason(candidateProvider);
      if (policyRestrictionReason) {
        throwGatewayError("FAILED_PRECONDITION", policyRestrictionReason);
      }
      const modelId = withProviderPrefix(candidateProvider, candidateModel);
      const settings = this.getProviderSettings(candidateProvider);
      const allowedModels = normalizeProviderModelList(
        candidateProvider,
        settings.allowedModels.length > 0
          ? settings.allowedModels
          : [settings.model],
      );
      if (settings.allowCustomModel) {
        continue;
      }
      if (!allowedModels.includes(modelId)) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Model ${modelId} is not allowed for provider ${candidateProvider}. Configure provider allowed models first.`,
        );
      }
    }
  }

  private providerUsageById(): Map<string, ProviderUsageSnapshotPayload> {
    const usageByProvider = new Map<string, ProviderUsageSnapshotPayload>();
    if (!this.usageSnapshotService) {
      return usageByProvider;
    }

    try {
      const snapshot = this.usageSnapshotService.getSnapshot();
      for (const usage of snapshot.providerUsage) {
        const providerId = usage.providerId.trim().toLowerCase();
        if (!providerId) continue;
        usageByProvider.set(providerId, usage);
      }
    } catch (err) {
      this.logger.warn("Failed to load usage snapshot for provider telemetry", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return usageByProvider;
  }

  private async probeLocalProviderTelemetry(
    config: PublicProviderRuntimeConfig,
    usage?: ProviderUsageSnapshotPayload,
  ): Promise<LocalProviderTelemetryProbeResult | null> {
    const providerId = config.providerId.trim().toLowerCase();

    switch (providerId) {
      case "codex":
        return this.probeCodexRateLimits(usage);

      case "claude":
        return this.probeClaudeCliStatus(usage);

      case "gemini":
        return this.probeGeminiCliStatus();

      case "lmstudio":
        return this.probeLmStudioRuntime(config);

      default:
        return null;
    }
  }

  private async probeCodexRateLimits(
    usage?: ProviderUsageSnapshotPayload,
  ): Promise<LocalProviderTelemetryProbeResult> {
    const executablePath = this.findExecutable(["codex"]);
    if (!executablePath) {
      return {
        source: "codex_app_server",
        status: "unavailable",
        message: "Codex CLI is not installed on the gateway host.",
      };
    }

    const probe = await this.queryCodexAppServer(executablePath);
    const accountPayload = isObjectRecord(probe.account) ? probe.account : null;
    const account = accountPayload && isObjectRecord(accountPayload.account)
      ? accountPayload.account
      : null;
    const accountPlan = asString(account?.planType);
    const accountEmail = asString(account?.email);
    const accountLabel = joinNonEmpty([accountPlan, accountEmail], " • ");

    const rateLimitsPayload = isObjectRecord(probe.rateLimits) ? probe.rateLimits : null;
    const windows = this.normalizeCodexTelemetryWindows(rateLimitsPayload);

    const status: ProviderUsageSnapshotPayload["status"] = windows.length > 0
      ? "available"
      : (probe.error ? "unavailable" : (usage?.status ?? "unknown"));

    return {
      source: "codex_app_server",
      status,
      accountLabel: accountLabel || undefined,
      windows,
      message: probe.error
        || (windows.length === 0
          ? "Codex app-server did not return rate-limit windows."
          : undefined),
    };
  }

  private normalizeCodexTelemetryWindows(rateLimitsPayload: Record<string, unknown> | null): ProviderTelemetryWindow[] {
    if (!rateLimitsPayload) {
      return [];
    }

    const entryByScopeId = new Map<string, Record<string, unknown>>();
    const pushEntry = (entryRaw: unknown) => {
      if (!isObjectRecord(entryRaw)) return;
      const scopeId = asString(entryRaw.limitId) || "codex";
      entryByScopeId.set(scopeId, entryRaw);
    };

    pushEntry(rateLimitsPayload.rateLimits);

    const byLimitId = rateLimitsPayload.rateLimitsByLimitId;
    if (isObjectRecord(byLimitId)) {
      for (const value of Object.values(byLimitId)) {
        pushEntry(value);
      }
    }

    const windows: ProviderTelemetryWindow[] = [];
    for (const [scopeId, entry] of entryByScopeId.entries()) {
      const scopeName = asString(entry.limitName) || undefined;
      windows.push(...this.codexWindowEntries(scopeId, scopeName, entry));
    }

    return windows.sort((lhs, rhs) => {
      if (lhs.scopeId !== rhs.scopeId) {
        return lhs.scopeId.localeCompare(rhs.scopeId);
      }
      if (lhs.window === rhs.window) return 0;
      return lhs.window === "primary" ? -1 : 1;
    });
  }

  private codexWindowEntries(
    scopeId: string,
    scopeName: string | undefined,
    entry: Record<string, unknown>,
  ): ProviderTelemetryWindow[] {
    const windows: ProviderTelemetryWindow[] = [];

    for (const key of ["primary", "secondary"] as const) {
      const payload = entry[key];
      if (!isObjectRecord(payload)) {
        continue;
      }

      const usedPercent = normalizePercentage(payload.usedPercent);
      const windowDurationMins = asInteger(payload.windowDurationMins);
      const resetsAt = asIsoFromEpochSeconds(payload.resetsAt);

      windows.push({
        scopeId,
        scopeName,
        window: key,
        usedPercent,
        remainingPercent: usedPercent !== undefined
          ? Math.max(0, Math.min(100, 100 - usedPercent))
          : undefined,
        resetsAt,
        windowDurationMins,
      });
    }

    return windows;
  }

  private async queryCodexAppServer(executablePath: string): Promise<{
    rateLimits?: unknown;
    account?: unknown;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const child = spawn(executablePath, ["app-server", "--listen", "stdio://"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let settled = false;
      let initialized = false;
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let rateLimits: unknown;
      let account: unknown;
      let rateLimitsDone = false;
      let accountDone = false;
      let errorMessage: string | undefined;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: { rateLimits?: unknown; account?: unknown; error?: string }) => {
        if (settled) return;
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (!child.killed) {
          child.kill("SIGTERM");
        }
        resolve(result);
      };

      const send = (message: Record<string, unknown>) => {
        if (settled) return;
        if (!child.stdin.writable) return;
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };

      const parseLine = (line: string) => {
        if (!line) return;

        let payload: unknown;
        try {
          payload = JSON.parse(line);
        } catch {
          return;
        }

        if (!isObjectRecord(payload)) {
          return;
        }

        const id = asInteger(payload.id);
        if (id === 1 && !initialized) {
          initialized = true;
          send({ jsonrpc: "2.0", method: "initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} });
          send({ jsonrpc: "2.0", id: 3, method: "account/read", params: {} });
          return;
        }

        if (id === 2) {
          if (payload.result !== undefined) {
            rateLimits = payload.result;
          } else if (isObjectRecord(payload.error)) {
            errorMessage = asString(payload.error.message) || "Codex rate-limit request failed.";
          }
          rateLimitsDone = true;
        } else if (id === 3) {
          if (payload.result !== undefined) {
            account = payload.result;
          } else if (isObjectRecord(payload.error)) {
            errorMessage = asString(payload.error.message) || "Codex account request failed.";
          }
          accountDone = true;
        }

        if (rateLimitsDone && accountDone) {
          finish({
            rateLimits,
            account,
            error: errorMessage,
          });
        }
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdoutBuffer += chunk.toString();
        let newlineIndex = stdoutBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          parseLine(line);
          newlineIndex = stdoutBuffer.indexOf("\n");
        }
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderrBuffer += chunk.toString();
      });

      child.on("error", (err) => {
        finish({
          rateLimits,
          account,
          error: err.message || "Failed to start Codex app-server.",
        });
      });

      child.on("exit", (code, signal) => {
        if (settled) return;
        const normalizedStderr = stderrBuffer.trim();
        finish({
          rateLimits,
          account,
          error: errorMessage
            || normalizedStderr
            || `Codex app-server exited before telemetry completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        });
      });

      timeout = setTimeout(() => {
        finish({
          rateLimits,
          account,
          error: errorMessage || "Timed out waiting for Codex app-server telemetry.",
        });
      }, 4_500);

      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "spaces-gateway",
            version: "0.1.0",
          },
          capabilities: {
            experimentalApi: true,
          },
        },
      });
    });
  }

  private probeClaudeCliStatus(
    usage?: ProviderUsageSnapshotPayload,
  ): LocalProviderTelemetryProbeResult {
    if (!this.findExecutable(["claude"])) {
      return {
        source: "claude_cli",
        status: "unavailable",
        message: "Claude CLI is not installed on the gateway host.",
      };
    }

    const status = usage?.status ?? "available";
    const hasRecentUsage = Boolean(
      usage && (usage.totalTokens > 0 || usage.spentUsd > 0 || usage.status === "available"),
    );

    return {
      source: "claude_cli",
      status,
      message: hasRecentUsage
        ? "Claude CLI is installed; background auth status is not probed. Recent usage indicates the runtime is active."
        : "Claude CLI is installed; background auth status is not probed during telemetry refresh.",
    };
  }

  private probeGeminiCliStatus(): LocalProviderTelemetryProbeResult {
    const executablePath = this.findExecutable(["gemini"]);
    if (!executablePath) {
      return {
        source: "gemini_cli",
        status: "unavailable",
        message: "Gemini CLI is not installed on the gateway host.",
      };
    }

    const result = spawnSync(executablePath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1_500,
    });

    if (result.status !== 0) {
      return {
        source: "gemini_cli",
        status: "unknown",
        message: result.stderr?.trim() || "Unable to read Gemini CLI version.",
      };
    }

    const accountLabel = result.stdout
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return {
      source: "gemini_cli",
      status: "available",
      accountLabel: accountLabel || undefined,
      message: "Gemini CLI does not expose quota windows via public commands.",
    };
  }

  private async probeLmStudioRuntime(
    config: PublicProviderRuntimeConfig,
  ): Promise<LocalProviderTelemetryProbeResult> {
    const baseURL = this.resolveProviderBaseURL("lmstudio", config.baseURL);
    const detection = await this.detectOpenAICompatibleModels(baseURL);

    if (!detection.serviceReachable) {
      return {
        source: "lmstudio_runtime",
        status: "unavailable",
        message: detection.detectionError || "LM Studio endpoint is not reachable.",
      };
    }

    return {
      source: "lmstudio_runtime",
      status: "available",
      message: detection.models.length > 0
        ? `Detected ${detection.models.length} model(s) from LM Studio runtime.`
        : "LM Studio endpoint is reachable but returned no models.",
    };
  }

  private async ensureAgentAssignment(
    spaceId: string,
    agentId: string,
    profileId: string,
  ): Promise<boolean> {
    try {
      const space = await this.spaceAdminService.getSpace(spaceId);
      if (!space) {
        throw new Error(`Space not found: ${spaceId}`);
      }

      const existing = space.agents.find((assignment) => assignment.agentId === agentId);
      if (!existing) {
        await this.spaceAdminService.addAgent({
          spaceId,
          agentId,
          profileId,
          role: "participant",
        });
        return true;
      }

      if (existing.profileId !== profileId) {
        await this.spaceAdminService.updateAgentAssignment({
          spaceId,
          agentId,
          profileId,
        });
        return true;
      }

      return false;
    } catch (err) {
      if (isSpaceAdminErrorLike(err) && err.code === "ALREADY_EXISTS") {
        return false;
      }
      throw err;
    }
  }

  private seedFromEnvironment(defaultApiKey?: string): void {
    const now = new Date().toISOString();

    // Load persisted configs first — env and runtime will overwrite
    if (this.providerConfigRepo) {
      for (const row of this.providerConfigRepo.list()) {
        if (this.providerConfigs.has(row.provider_id)) continue;
        if (!this.isProviderConfigAllowed(row.provider_id)) continue;
        const rowConfig = rowToProviderConfig(row);
        this.providerConfigs.set(row.provider_id, {
          ...rowConfig,
          baseURL: this.resolveProviderBaseURL(rowConfig.providerId, rowConfig.baseURL),
        });
      }
    }

    if (this.defaultProviderId && this.defaultModelId) {
      if (!this.isProviderConfigAllowed(this.defaultProviderId)) {
        this.logger.warn("Skipping blocked embedded default provider from environment", {
          providerId: this.defaultProviderId,
        });
      } else {
        const normalizedDefaultModel = withProviderPrefix(this.defaultProviderId, this.defaultModelId);
        this.providerConfigs.set(this.defaultProviderId, {
          providerId: this.defaultProviderId,
          model: normalizedDefaultModel,
          apiKey: defaultApiKey || keyFromEnvironment(this.defaultProviderId),
          apiKeySecretRef: undefined,
          authMode: resolveProviderAuthMode(this.defaultProviderId),
          baseURL: this.resolveProviderBaseURL(
            this.defaultProviderId,
            this.defaultProviderId === "openai" ? process.env[OPENAI_BASE_URL_ENV] : undefined,
          ),
          allowedModels: [normalizedDefaultModel],
          allowCustomModel: false,
          nativeCliToolsEnabled: false,
          updatedAt: now,
          source: "env",
        });
      }
    }

    for (const providerId of Object.keys(API_KEY_ENV_BY_PROVIDER)) {
      const apiKey = keyFromEnvironment(providerId);
      const existing = this.providerConfigs.get(providerId);
      if (!apiKey && !existing) continue;

      this.providerConfigs.set(providerId, {
        providerId,
        model: withProviderPrefix(
          providerId,
          existing?.model || DEFAULT_MODEL_BY_PROVIDER[providerId] || this.defaultModelId || "",
        ),
        apiKey: resolveProviderAuthMode(providerId, existing?.authMode) === "api_key"
          ? (apiKey || existing?.apiKey)
          : undefined,
        apiKeySecretRef: existing?.apiKeySecretRef,
        authMode: resolveProviderAuthMode(providerId, existing?.authMode),
        baseURL: this.resolveProviderBaseURL(
          providerId,
          providerId === "openai" ? (process.env[OPENAI_BASE_URL_ENV] || existing?.baseURL) : existing?.baseURL,
        ),
        allowedModels: normalizeProviderModelList(
          providerId,
          existing?.allowedModels?.length
            ? existing.allowedModels
            : [existing?.model || DEFAULT_MODEL_BY_PROVIDER[providerId] || this.defaultModelId || ""],
        ),
        allowCustomModel: existing?.allowCustomModel ?? false,
        nativeCliToolsEnabled: existing?.nativeCliToolsEnabled ?? false,
        updatedAt: now,
        source: "env",
      });
    }

    if (this.providerVisibleInCatalog("apple")) {
      const existing = this.providerConfigs.get("apple");
      const model = withProviderPrefix(
        "apple",
        existing?.model || DEFAULT_MODEL_BY_PROVIDER.apple,
      );
      this.providerConfigs.set("apple", {
        providerId: "apple",
        model,
        apiKey: undefined,
        apiKeySecretRef: undefined,
        authMode: undefined,
        baseURL: undefined,
        allowedModels: normalizeProviderModelList("apple", existing?.allowedModels?.length ? existing.allowedModels : [model]),
        allowCustomModel: false,
        nativeCliToolsEnabled: false,
        updatedAt: now,
        source: existing?.source ?? "env",
      });
    }

    // Auto-seed detected CLI executor providers (claude, codex, gemini).
    // These runtimes use their own auth (Max subscription, Google account, etc.)
    // and don't require API keys — seed them if the executable is on the host.
    const cliExecutorIds = ["claude", "codex", "gemini"] as const;
    for (const providerId of cliExecutorIds) {
      if (this.providerConfigs.has(providerId)) continue;
      if (!this.providerVisibleInCatalog(providerId)) continue;
      if (!this.findExecutable([providerId])) continue;
      const defaultModel = DEFAULT_MODEL_BY_PROVIDER[providerId];
      if (!defaultModel) continue;
      const model = withProviderPrefix(providerId, defaultModel);
      const manifest = LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? [];
      this.providerConfigs.set(providerId, {
        providerId,
        model,
        apiKey: undefined,
        apiKeySecretRef: undefined,
        authMode: undefined,
        baseURL: undefined,
        allowedModels: normalizeProviderModelList(providerId, manifest.length > 0 ? manifest : [model]),
        allowCustomModel: false,
        nativeCliToolsEnabled: false,
        updatedAt: now,
        source: "env",
      });
    }
  }

  private mergeAllowedModels(providerId: string, model: string, modelIds: string[]): string[] {
    const merged = uniqueModelIds([
      model,
      ...modelIds,
      ...this.detectedLocalModelHints(providerId),
    ]);
    const normalized = normalizeProviderModelList(providerId, merged);
    return normalized.length > 0 ? normalized : [model];
  }

  private detectedLocalModelHints(providerId: string): string[] {
    if (!isLocalProvider(providerId)) {
      return [];
    }

    if (providerId === "codex") {
      return uniqueModelIds([
        ...this.detectCodexCliModels(),
        ...(LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []),
      ]);
    }

    return uniqueModelIds(LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []);
  }

  private applyConfigToEnvironment(config: ProviderRuntimeConfig): void {
    const keyEnv = API_KEY_ENV_BY_PROVIDER[config.providerId];
    if (keyEnv) {
      if (config.apiKey) {
        process.env[keyEnv] = config.apiKey;
      } else {
        delete process.env[keyEnv];
      }
    }

    if (config.providerId === "openai") {
      if (config.baseURL) {
        process.env[OPENAI_BASE_URL_ENV] = config.baseURL;
      } else {
        delete process.env[OPENAI_BASE_URL_ENV];
      }
    }

    if (config.providerId === "lmstudio") {
      if (config.baseURL) {
        process.env[LMSTUDIO_BASE_URL_ENV] = config.baseURL;
      } else {
        delete process.env[LMSTUDIO_BASE_URL_ENV];
      }
    }
  }

  private assertProviderConfigAllowed(
    providerId: string,
    input: {
      model?: string;
      apiKey?: string;
      apiKeySecretRef?: string;
      baseURL?: string;
      allowedModels?: string[];
      allowCustomModel?: boolean;
    },
    existing?: ProviderRuntimeConfig,
  ): void {
    if (this.gatewayProfile !== "embedded") {
      return;
    }

    const policyRestrictionReason = this.providerPolicyRestrictionReason(providerId);
    if (policyRestrictionReason) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        policyRestrictionReason,
      );
    }

    if (!API_KEY_ENV_BY_PROVIDER[providerId] && !LOCAL_PROVIDER_IDS.has(providerId)) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Custom runtime configuration requires external gateway profile.",
      );
    }

    const nextBaseURL = input.baseURL?.trim() || existing?.baseURL;
    if (nextBaseURL) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Custom model endpoints require external gateway profile.",
      );
    }
  }

  private isProviderConfigAllowed(providerId: string): boolean {
    return !this.providerPolicyRestrictionReason(providerId);
  }

  private resolveProviderBaseURL(providerId: string, configuredBaseURL?: string): string | undefined {
    const explicitBaseURL = normalizeProviderBaseURL(providerId, configuredBaseURL);
    if (explicitBaseURL) {
      if (this.gatewayProfile === "embedded") {
        return undefined;
      }
      return explicitBaseURL;
    }

    if (providerId === "openai") {
      if (this.gatewayProfile === "embedded") {
        return undefined;
      }
      return normalizeProviderBaseURL(providerId, process.env[OPENAI_BASE_URL_ENV]);
    }

    if (providerId === "lmstudio") {
      if (!this.isProviderConfigAllowed(providerId)) {
        return undefined;
      }
      const lmstudioFromEnv = normalizeProviderBaseURL(providerId, process.env[LMSTUDIO_BASE_URL_ENV]);
      if (lmstudioFromEnv) {
        return lmstudioFromEnv;
      }

      return "http://127.0.0.1:1234/v1";
    }

    if (providerId === "ollama") {
      if (!this.isProviderConfigAllowed(providerId)) {
        return undefined;
      }
      return normalizeProviderBaseURL(providerId, process.env[OLLAMA_BASE_URL_ENV]) || "http://127.0.0.1:11434/v1";
    }

    if (providerId === "openrouter") {
      return "https://openrouter.ai/api/v1";
    }

    if (providerId === "groq") {
      return "https://api.groq.com/openai/v1";
    }

    if (providerId === "together") {
      return "https://api.together.xyz/v1";
    }

    if (providerId === "mistral") {
      return "https://api.mistral.ai/v1";
    }

    return undefined;
  }

  private async detectOpenAICompatibleModels(
    baseURLRaw?: string,
    options?: {
      forceRefresh?: boolean;
    },
  ): Promise<{
    serviceReachable: boolean;
    models: OpenAICompatibleDetectedModel[];
    detectionError?: string;
  }> {
    const baseURL = baseURLRaw?.trim();
    if (!baseURL) {
      return {
        serviceReachable: false,
        models: [],
      };
    }
    const endpoint = resolveOpenAICompatibleModelsEndpoint(baseURL);
    const now = Date.now();
    const forceRefresh = options?.forceRefresh === true;
    const cached = this.openAICompatibleDetectionCache.get(endpoint);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return {
        ...cached.value,
        models: cached.value.models.map((entry) => ({ ...entry })),
      };
    }

    const inFlight = forceRefresh ? undefined : this.openAICompatibleDetectionInFlight.get(endpoint);
    if (inFlight) {
      const shared = await inFlight;
      return {
        ...shared,
        models: shared.models.map((entry) => ({ ...entry })),
      };
    }

    const requestPromise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            serviceReachable: false,
            models: [],
            detectionError: `Model discovery failed at ${endpoint}: ${response.status} ${response.statusText}`,
          };
        }

        const payload = await response.json() as { data?: Array<Record<string, unknown>> };
        const modelsById = new Map<string, OpenAICompatibleDetectedModel>();
        for (const entry of payload.data ?? []) {
          const id = typeof entry?.id === "string" ? entry.id.trim() : "";
          if (!id) continue;
          const contextWindow = asPositiveInteger(entry.context_length)
            ?? asPositiveInteger(entry.context_window)
            ?? asPositiveInteger(entry.max_context_length)
            ?? asPositiveInteger(entry.contextLength)
            ?? asPositiveInteger(entry.contextWindow)
            ?? asPositiveInteger(entry.maxContextLength);

          const existing = modelsById.get(id);
          if (!existing) {
            modelsById.set(id, {
              id,
              ...(contextWindow !== undefined ? { contextWindow } : {}),
            });
            continue;
          }

          if (existing.contextWindow === undefined && contextWindow !== undefined) {
            modelsById.set(id, {
              ...existing,
              contextWindow,
            });
          }
        }
        return {
          serviceReachable: true,
          models: Array.from(modelsById.values()),
        };
      } catch (err) {
        return {
          serviceReachable: false,
          models: [],
          detectionError: describeOpenAICompatibleDetectionError(err, endpoint),
        };
      } finally {
        clearTimeout(timeout);
      }
    })();

    this.openAICompatibleDetectionInFlight.set(endpoint, requestPromise);
    const value = await requestPromise;
    this.openAICompatibleDetectionInFlight.delete(endpoint);
    this.openAICompatibleDetectionCache.set(endpoint, {
      expiresAt: Date.now() + OPENAI_COMPATIBLE_DETECTION_CACHE_TTL_MS,
      value,
    });
    return {
      ...value,
      models: value.models.map((entry) => ({ ...entry })),
    };
  }

  private async detectClaudeAgentSdkCatalog(
    config?: ProviderRuntimeConfig,
    forceRefresh = false,
  ): Promise<ClaudeAgentSdkCatalogProbe> {
    const providerId = "claude-agent-sdk";
    const cacheKey = providerId;
    const now = Date.now();
    if (forceRefresh) {
      this.claudeAgentSdkDetectionCache.delete(cacheKey);
      this.claudeAgentSdkDetectionInFlight.delete(cacheKey);
    }

    const cached = this.claudeAgentSdkDetectionCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cloneClaudeAgentSdkCatalogProbe(cached.value);
    }

    const inFlight = forceRefresh ? undefined : this.claudeAgentSdkDetectionInFlight.get(cacheKey);
    if (inFlight) {
      return cloneClaudeAgentSdkCatalogProbe(await inFlight);
    }

    const requestPromise = (async () => {
      const model = withProviderPrefix(
        providerId,
        config?.model || DEFAULT_MODEL_BY_PROVIDER[providerId] || `${providerId}/default`,
      );
      const authMode = resolveProviderAuthMode(providerId, config?.authMode) ?? "api_key";
      if (this.claudeAgentSdkMetadataProbe) {
        return await this.claudeAgentSdkMetadataProbe({
          providerId,
          model,
          authMode,
          apiKey: authMode === "api_key" ? this.resolveConfiguredProviderApiKey(providerId, config) : undefined,
        });
      }

      const provider = new ClaudeAgentSdkModelProvider({
        id: providerId,
        name: providerDisplayName(providerId),
        model,
        apiKey: authMode === "api_key" ? this.resolveConfiguredProviderApiKey(providerId, config) : undefined,
        authMode: authMode as "api_key" | "host_login",
      });
      const probe = await provider.probeMetadata();
      return mapClaudeAgentSdkProbeResult(probe);
    })();

    this.claudeAgentSdkDetectionInFlight.set(cacheKey, requestPromise);
    const value = await requestPromise;
    this.claudeAgentSdkDetectionInFlight.delete(cacheKey);
    this.claudeAgentSdkDetectionCache.set(cacheKey, {
      expiresAt: Date.now() + CLAUDE_AGENT_SDK_DETECTION_CACHE_TTL_MS,
      value,
    });
    return cloneClaudeAgentSdkCatalogProbe(value);
  }

  private resolveConfiguredProviderApiKey(
    providerId: string,
    config?: ProviderRuntimeConfig,
  ): string | undefined {
    if (config?.apiKey) {
      return config.apiKey;
    }

    if (config?.apiKeySecretRef) {
      const resolved = this.providerSecretRefService?.resolveSecret(config.apiKeySecretRef);
      if (resolved?.secret?.trim()) {
        return resolved.secret.trim();
      }
    }

    return keyFromEnvironment(providerId);
  }

  private invalidateProviderRuntimeCaches(providerId: string): void {
    if (providerId === "claude-agent-sdk") {
      this.claudeAgentSdkDetectionCache.delete(providerId);
      this.claudeAgentSdkDetectionInFlight.delete(providerId);
    }
  }

  private findExecutable(commands: string[]): string | null {
    const resolved = this.executableResolver.resolve({
      cacheKey: commands.join("|"),
      commands,
      versionProbe: { args: ["--version"], timeoutMs: 750 },
    });
    return resolved.path ?? null;
  }

  private detectCodexCliModels(): string[] {
    const home = process.env.HOME?.trim();
    if (!home) {
      return [];
    }

    const results: string[] = [];
    const seen = new Set<string>();
    const addModel = (value: unknown) => {
      if (typeof value !== "string") return;
      const normalized = value.trim();
      if (!normalized) return;
      const withPrefix = withProviderPrefix("codex", normalized);
      const key = withPrefix.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      results.push(withPrefix);
    };

    const configPath = join(home, ".codex", "config.toml");
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf8");
        const match = content.match(/^\s*model\s*=\s*"([^"]+)"/m);
        if (match?.[1]) {
          addModel(match[1]);
        }
      } catch {
        // Ignore local config parse issues.
      }
    }

    const cachePath = join(home, ".codex", "models_cache.json");
    if (existsSync(cachePath)) {
      try {
        const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as {
          models?: Array<{ slug?: unknown; visibility?: unknown }>;
        };
        for (const entry of parsed.models ?? []) {
          const visibility = typeof entry.visibility === "string"
            ? entry.visibility.toLowerCase()
            : "";
          if (visibility === "hidden") {
            continue;
          }
          addModel(entry.slug);
        }
      } catch {
        // Ignore cache parse issues.
      }
    }

    return results;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  const parsed = asInteger(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return parsed;
}

function normalizePercentage(value: unknown): number | undefined {
  const numberValue = asInteger(value);
  if (numberValue === undefined) return undefined;
  return Math.max(0, Math.min(100, numberValue));
}

function asIsoFromEpochSeconds(value: unknown): string | undefined {
  const seconds = asInteger(value);
  if (seconds === undefined) return undefined;
  if (seconds <= 0) return undefined;
  try {
    return new Date(seconds * 1_000).toISOString();
  } catch {
    return undefined;
  }
}

function joinNonEmpty(values: Array<string | undefined>, separator: string): string {
  return values
    .map((value) => value?.trim() || "")
    .filter((value) => value.length > 0)
    .join(separator);
}

function rowToProviderConfig(row: ProviderConfigRow): ProviderRuntimeConfig {
  let allowedModels: string[] = [];
  try {
    const parsed = JSON.parse(row.allowed_models_json);
    if (Array.isArray(parsed)) {
      allowedModels = parsed;
    }
  } catch {
    // ignore malformed JSON
  }
  return {
    providerId: row.provider_id,
    model: row.model,
    apiKeySecretRef: row.api_key_secret_ref ?? undefined,
    authMode: normalizeProviderAuthMode(row.auth_mode),
    baseURL: row.base_url ?? undefined,
    allowedModels,
    allowCustomModel: row.allow_custom_model === 1,
    nativeCliToolsEnabled: row.native_cli_tools_enabled === 1,
    updatedAt: row.updated_at,
    source: row.source === "env" ? "env" : "runtime",
  };
}

function cloneClaudeAgentSdkCatalogProbe(
  probe: ClaudeAgentSdkCatalogProbe,
): ClaudeAgentSdkCatalogProbe {
  return {
    authStatus: probe.authStatus,
    authAccount: probe.authAccount ? { ...probe.authAccount } : undefined,
    models: (probe.models ?? []).map((model) => ({ ...model })),
    detectionError: probe.detectionError,
  };
}

function mapClaudeAgentSdkProbeResult(
  probe: ClaudeAgentSdkProbeResult,
): ClaudeAgentSdkCatalogProbe {
  return {
    authStatus: probe.authStatus,
    authAccount: mapClaudeAgentSdkAuthAccount(probe.authAccount),
    models: probe.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      contextWindow: model.contextWindow,
    })),
    detectionError: probe.detectionError,
  };
}

function mapClaudeAgentSdkAuthAccount(
  account?: ClaudeAgentSdkAuthAccount,
): GatewayProviderAuthAccount | undefined {
  if (!account) {
    return undefined;
  }
  const normalized: GatewayProviderAuthAccount = {
    email: account.email?.trim() || undefined,
    organization: account.organization?.trim() || undefined,
    subscriptionType: account.subscriptionType?.trim() || undefined,
    apiProvider: account.apiProvider?.trim() || undefined,
    tokenSource: account.tokenSource?.trim() || undefined,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function normalizeProviderId(providerId?: string): string | undefined {
  if (!providerId) return undefined;
  const normalized = providerId.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized;
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function mergeSkillIds(existing: string[], required: readonly string[]): string[] {
  return Array.from(new Set([...existing, ...required].map((entry) => entry.trim()).filter(Boolean)));
}

function parseModelConfig(
  value: string | null | undefined,
  modelHint: string | null | undefined,
): ProfileModelConfig {
  if (value?.trim()) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const preferredModels = normalizeStringList(parsed.preferredModels);
      const fallbackModels = normalizeStringList(parsed.fallbackModels);
      const constraints = isRecord(parsed.constraints) ? parsed.constraints : undefined;
      return {
        preferredModels: preferredModels.length > 0
          ? preferredModels
          : (modelHint?.trim() ? [modelHint.trim()] : []),
        fallbackModels,
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

function normalizeStringList(value: unknown): string[] {
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

function normalizeIntegrationClass(value?: GatewayIntegrationClassPayload): "cloud" | "executor" | "local_runtime" | undefined {
  if (value === "cloud" || value === "executor" || value === "local_runtime") {
    return value;
  }
  return undefined;
}

function mapIntegrationRequestRow(row: {
  integration_request_id: string;
  integration_class: string;
  requested_name: string;
  use_case: string;
  source_url: string;
  notes: string;
  principal_id: string;
  device_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}): GatewayCreateIntegrationRequestResponsePayload["request"] {
  return {
    integrationRequestId: row.integration_request_id,
    integrationClass: (normalizeIntegrationClass(row.integration_class as GatewayIntegrationClassPayload) ?? "cloud"),
    requestedName: row.requested_name,
    useCase: row.use_case || undefined,
    sourceURL: row.source_url || undefined,
    notes: row.notes || undefined,
    principalId: row.principal_id || undefined,
    deviceId: row.device_id || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deriveProviderFromModel(model?: string): string | undefined {
  if (!model) return undefined;
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  const prefix = trimmed.includes("/") ? trimmed.split("/")[0] : "";
  return normalizeProviderId(prefix);
}

function withProviderPrefix(providerId: string, modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return `${providerId}/`;
  const providerPrefix = `${providerId.toLowerCase()}/`;
  if (trimmed.toLowerCase().startsWith(providerPrefix)) {
    return `${providerId}/${trimmed.slice(providerPrefix.length)}`;
  }
  return `${providerId}/${trimmed}`;
}

function normalizeProviderBaseURL(providerId: string, baseURLRaw?: string): string | undefined {
  const trimmed = baseURLRaw?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (providerId !== "lmstudio") {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname) {
      parsed.pathname = "/v1";
    } else {
      parsed.pathname = pathname;
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function resolveOpenAICompatibleModelsEndpoint(baseURLRaw?: string): string {
  const baseURL = baseURLRaw?.trim() || "http://127.0.0.1:1234/v1";
  return `${baseURL.replace(/\/+$/, "")}/models`;
}

function describeOpenAICompatibleDetectionError(error: unknown, endpoint: string): string {
  const fallback = `Failed to discover models from OpenAI-compatible endpoint: ${endpoint}`;
  if (!(error instanceof Error)) {
    return fallback;
  }

  const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
  if (code === "ConnectionRefused") {
    return `Connection refused at ${endpoint}. If using LM Studio, run: lms server start --port 1234`;
  }

  const message = error.message?.trim();
  if (message) {
    return `${message} (endpoint: ${endpoint})`;
  }

  return fallback;
}

function normalizeProviderModelList(providerId: string, modelIds?: string[]): string[] {
  if (!modelIds || modelIds.length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      modelIds
        .map((modelId) => withProviderPrefix(providerId, modelId))
        .map((modelId) => modelId.trim())
        .filter((modelId) => modelId.length > 0),
    ),
  );
}

function uniqueModelIds(modelIds: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const modelId of modelIds) {
    const normalized = modelId.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function collectProfileModelCandidates(
  modelHint?: string,
  modelConfig?: ProfileModelConfig,
): string[] {
  const candidates = [
    modelHint,
    ...(modelConfig?.preferredModels ?? []),
    ...(modelConfig?.fallbackModels ?? []),
  ];
  return Array.from(
    new Set(
      candidates
        .map((modelId) => modelId?.trim() ?? "")
        .filter((modelId) => modelId.length > 0),
    ),
  );
}

function normalizeSelectionMode(value: unknown): MainAgentSelectionMode | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (normalized === "provider_model" || normalized === "agent_definition") {
    return normalized;
  }
  return null;
}

function providerCatalogGroup(providerId: string): GatewayProviderCatalogGroup {
  return mapExecutionClassToCatalogGroup(classifyExecutionAdapter(providerId));
}

function providerIntegrationClass(providerId: string): GatewayIntegrationClass {
  return classifyExecutionAdapter(providerId);
}

function providerDisplayName(providerId: string): string {
  switch (providerId) {
    case "apple":
      return "Apple Foundation";
    case "anthropic":
      return "Anthropic";
    case "claude-agent-sdk":
      return "Claude Agent SDK";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "groq":
      return "Groq";
    case "together":
      return "Together";
    case "mistral":
      return "Mistral";
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex CLI";
    case "gemini":
      return "Gemini CLI";
    case "lmstudio":
      return "LM Studio";
    case "ollama":
      return "Ollama";
    default:
      return providerId;
  }
}

function providerRequiresApiKey(
  providerId: string,
  baseURL?: string,
  authMode?: GatewayProviderAuthMode,
): boolean {
  if (isLocalProvider(providerId)) {
    return false;
  }
  if (providerId === "claude-agent-sdk") {
    return authMode !== "host_login";
  }
  if (providerId === "openai") {
    return !isLikelyLocalBaseURL(baseURL);
  }
  return true;
}

function providerInstallHint(providerId: string): string | undefined {
  switch (providerId) {
    case "apple":
      return "Runs on-device on Apple Silicon Macs with Apple Intelligence enabled.";
    case "anthropic":
      return "Add ANTHROPIC_API_KEY or configure a runtime key for direct Anthropic API access.";
    case "claude-agent-sdk":
      return "Use ANTHROPIC_API_KEY for direct SDK API access, or sign in with Claude on this gateway host to use a local subscription session.";
    case "claude":
      return "Install Claude Code and sign in locally.";
    case "codex":
      return "Install Codex CLI and sign in locally.";
    case "gemini":
      return "Install Gemini CLI and sign in locally.";
    case "lmstudio":
      return "Install LM Studio, start the local server, and load at least one model.";
    case "ollama":
      return "Install Ollama, start the daemon, and pull at least one model.";
    case "openrouter":
      return "Add OPENROUTER_API_KEY or configure a runtime key.";
    case "groq":
      return "Add GROQ_API_KEY or configure a runtime key.";
    case "together":
      return "Add TOGETHER_API_KEY or configure a runtime key.";
    case "mistral":
      return "Add MISTRAL_API_KEY or configure a runtime key.";
    case "openai":
      return "Add OPENAI_API_KEY or configure a runtime key.";
    default:
      return undefined;
  }
}

function providerSupportedAuthModes(providerId: string): GatewayProviderAuthMode[] {
  return [...(PROVIDER_AUTH_MODES[providerId] ?? [])];
}

function resolveProviderAuthMode(
  providerId: string,
  preferred?: GatewayProviderAuthMode,
): GatewayProviderAuthMode | undefined {
  const supported = providerSupportedAuthModes(providerId);
  if (supported.length === 0) {
    return undefined;
  }
  if (preferred && supported.includes(preferred)) {
    return preferred;
  }
  return supported[0];
}

function resolveRequestedProviderAuthMode(
  providerId: string,
  requested?: GatewayProviderAuthMode,
  existing?: GatewayProviderAuthMode,
): GatewayProviderAuthMode | undefined {
  const supported = providerSupportedAuthModes(providerId);
  if (supported.length === 0) {
    if (requested) {
      throw new Error(`Provider ${providerId} does not support configurable authentication modes.`);
    }
    return undefined;
  }
  if (!requested) {
    return resolveProviderAuthMode(providerId, existing);
  }
  if (!supported.includes(requested)) {
    throw new Error(`Provider ${providerId} does not support auth mode ${requested}.`);
  }
  return requested;
}

function normalizeProviderAuthMode(value?: string | null): GatewayProviderAuthMode | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "api_key" || normalized === "host_login") {
    return normalized;
  }
  return undefined;
}

function inferDefaultProviderAuthStatus(
  providerId: string,
  authMode: GatewayProviderAuthMode | undefined,
  hasApiKey: boolean,
): GatewayProviderAuthStatus | undefined {
  if (authMode === "host_login" && providerId === "claude-agent-sdk") {
    return "needs_auth";
  }
  if (authMode === "api_key") {
    return hasApiKey ? "authenticated" : "needs_key";
  }
  return undefined;
}

function providerRecommended(providerId: string): boolean {
  if (providerId === "apple") {
    return true;
  }
  return providerId === "openrouter"
    || providerId === "codex"
    || providerId === "claude"
    || providerId === "lmstudio";
}

function isCliExecutorProvider(providerId: string): boolean {
  return providerId === "claude" || providerId === "codex" || providerId === "gemini";
}

function isLocalProvider(providerId: string): boolean {
  return LOCAL_PROVIDER_IDS.has(providerId);
}

function isOpenAICompatibleProvider(providerId: string): boolean {
  return OPENAI_COMPATIBLE_PROVIDER_IDS.has(providerId);
}

function isLikelyLocalBaseURL(baseURL?: string): boolean {
  if (!baseURL) return false;
  try {
    const url = new URL(baseURL);
    const host = url.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function keyFromEnvironment(providerId: string): string | undefined {
  const envName = API_KEY_ENV_BY_PROVIDER[providerId];
  if (!envName) return undefined;
  const value = process.env[envName]?.trim();
  return value || undefined;
}

function mapFallbackTelemetrySource(source: ProviderTelemetrySourcePayload): string {
  switch (source) {
    case "codex_app_server":
      return "codex-cli";
    case "claude_cli":
      return "claude-cli";
    case "gemini_cli":
      return "gemini-cli";
    case "lmstudio_runtime":
      return "runtime";
    case "usage_snapshot":
      return "api";
    default:
      return source;
  }
}

function throwGatewayError(
  code: "INVALID_ARGUMENT" | "NOT_FOUND" | "ALREADY_EXISTS" | "FAILED_PRECONDITION",
  message: string,
): never {
  throw { code, message };
}

function isSpaceAdminErrorLike(
  err: unknown,
): err is { code: "INVALID_ARGUMENT" | "NOT_FOUND" | "ALREADY_EXISTS" | "FAILED_PRECONDITION"; message: string } {
  if (typeof err !== "object" || err === null) {
    return false;
  }

  const candidate = err as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string"
    && typeof candidate.message === "string"
  );
}
