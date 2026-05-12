import type { Logger } from "@spaceskit/observability";
import type {
  GatewayRuntimeDefaultsRepository,
  IntegrationRequestRepository,
  ProfileModelConfig,
  ProfileRepository,
  ProviderConfigRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import type { SpaceAdminService } from "@spaceskit/core";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type {
  GatewayConciergeAgentStatePayload,
  GatewayGetConciergeAgentPayload,
  GatewayGetMainAgentPayload,
  GatewayGetRuntimeDefaultsPayload,
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
  GatewayRuntimeDefaultsPayload,
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
  GatewaySetRuntimeDefaultsPayload,
  GatewaySetRuntimeDefaultsResponsePayload,
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
  ProviderRuntimeConfigPayload,
  GatewayGetToolResponsePayload,
  GatewayRemoveToolResponsePayload,
} from "@spaceskit/server";
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
import {
  fetchClaudeOAuthUsage as fetchClaudeOAuthUsageWindowPayloads,
  readClaudeOAuthAccessTokenFromCredentialsFile as readClaudeOAuthAccessTokenFromCredentialsFilePayload,
  readClaudeOAuthAccessTokenFromKeychain as readClaudeOAuthAccessTokenFromKeychainPayload,
} from "./services/claude-oauth-telemetry.js";
import { queryCodexAppServerTelemetry } from "./services/codex-app-server-telemetry.js";
import {
  isLocalProvider,
  keyFromEnvironment,
  LOCAL_PROVIDER_MODEL_MANIFEST,
} from "./services/provider-catalog-support.js";
import type { LocalExecutableResolver } from "./execution/local-executable-resolver.js";
import {
  LocalAgentDiscoveryService,
  type DiscoveredLocalAgent,
  type OpenAICompatibleDetectionResult,
} from "./services/local-agent-discovery-service.js";
import {
  normalizeProviderId,
  throwGatewayError,
  uniqueModelIds,
} from "./gateway-admin-model-normalizers.js";
import type {
  ClaudeAgentSdkCatalogProbe,
  CodexAppServerCatalogProbe,
} from "./gateway-admin-telemetry-normalizers.js";
import {
  applyProviderConfigToEnvironment,
  mergeAllowedProviderModels,
  providerRuntimeConfigToPayload,
} from "./gateway-admin-provider-config-support.js";
import {
  loadGatewayAdminProfileRuntime,
  provisionGatewayAdminLocalProfile,
  resolveGatewayAdminExactProviderRuntimeConfig,
  resolveGatewayAdminProviderForProfile,
  validateGatewayAdminProfileModelSelection,
  type ExactProviderRuntimeSelection,
  type GatewayAdminProfileRuntimeContext,
  type ProfileRuntimeContext,
  type ProvisionLocalProfileInput,
  type ProvisionLocalProfileResult,
} from "./gateway-admin-profile-runtime.js";
import {
  deleteGatewayAdminSecretRef,
  getGatewayAdminProviderSettings,
  listGatewayAdminSecretRefs,
  putGatewayAdminSecretRef,
  removeGatewayAdminProviderConfig,
  setGatewayAdminProviderConfig,
  type GatewayAdminProviderSettingsContext,
} from "./gateway-admin-provider-settings.js";
import { GatewayAdminToolIntegrationService } from "./gateway-admin-tool-integration-service.js";
import { GatewayAdminProviderTelemetryService } from "./gateway-admin-provider-telemetry-service.js";
import { GatewayAdminProviderCatalogService } from "./gateway-admin-provider-catalog-service.js";
import { GatewayAdminCatalogDetectionService } from "./gateway-admin-catalog-detection-service.js";
import { GatewayAdminManagedAgentRuntimeService } from "./gateway-admin-managed-agent-runtime-service.js";
import { OpenAICompatibleModelDiscoveryService } from "./services/openai-compatible-model-discovery-service.js";
import {
  GatewayAdminProviderPolicyService,
  type AppleFoundationAvailabilitySnapshot,
} from "./gateway-admin-provider-policy-service.js";
import { seedGatewayAdminProvidersFromEnvironment } from "./gateway-admin-provider-env-seeder.js";

export type { DiscoveredLocalAgent } from "./services/local-agent-discovery-service.js";
export type { AppleFoundationAvailabilitySnapshot } from "./gateway-admin-provider-policy-service.js";
export type {
  ExactProviderRuntimeSelection,
  ProfileRuntimeContext,
  ProvisionLocalProfileInput,
  ProvisionLocalProfileResult,
} from "./gateway-admin-profile-runtime.js";

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
export type GatewayRuntimeDefaults = GatewayRuntimeDefaultsPayload;

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

export interface GetMainAgentInput extends GatewayGetMainAgentPayload {}

export interface SetMainAgentInput extends GatewaySetMainAgentPayload {}

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
  gatewayRuntimeDefaultsRepo?: GatewayRuntimeDefaultsRepository;
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
  codexAppServerMetadataProbe?: (input: {
    providerId: string;
    model: string;
    authMode: GatewayProviderAuthMode;
    apiKey?: string;
  }) => Promise<CodexAppServerCatalogProbe>;
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
  private readonly gatewayRuntimeDefaultsRepo?: GatewayRuntimeDefaultsRepository;
  private readonly toolIntegrationService: GatewayAdminToolIntegrationService;
  private readonly providerTelemetryService: GatewayAdminProviderTelemetryService;
  private readonly gatewayProfile: GatewayCoreProfileId;
  private readonly defaultProviderId?: string;
  private readonly defaultModelId?: string;
  private readonly providerPolicyService: GatewayAdminProviderPolicyService;
  private readonly providerCatalogService: GatewayAdminProviderCatalogService;
  private readonly openAICompatibleModelDiscoveryService: OpenAICompatibleModelDiscoveryService;
  private readonly localAgentDiscoveryService: LocalAgentDiscoveryService;
  private readonly catalogDetectionService: GatewayAdminCatalogDetectionService;
  private readonly managedAgentRuntimeService: GatewayAdminManagedAgentRuntimeService;
  private readonly providerConfigs = new Map<string, ProviderRuntimeConfig>();
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
    this.gatewayRuntimeDefaultsRepo = options.gatewayRuntimeDefaultsRepo;
    this.toolIntegrationService = new GatewayAdminToolIntegrationService({
      integrationRequestRepo: options.integrationRequestRepo,
      cliToolService: options.cliToolService,
      interconnectorCatalogService: options.interconnectorCatalogService,
      accessGrantService: options.accessGrantService,
      toolApprovalGrantService: options.toolApprovalGrantService,
    });
    this.gatewayProfile = options.gatewayProfile ?? "external";
    this.defaultProviderId = normalizeProviderId(options.defaultProviderId);
    this.defaultModelId = options.defaultModelId;
    this.providerPolicyService = new GatewayAdminProviderPolicyService({
      gatewayProfile: this.gatewayProfile,
      enableAppleFoundationProvider: options.enableAppleFoundationProvider ?? false,
      hostPlatform: options.hostPlatform ?? process.platform,
      hostArch: options.hostArch ?? process.arch,
      appleFoundationAvailability: options.appleFoundationAvailability,
    });
    this.openAICompatibleModelDiscoveryService = new OpenAICompatibleModelDiscoveryService();
    this.localAgentDiscoveryService = new LocalAgentDiscoveryService({
      executableResolver: options.executableResolver,
      providerConfigs: this.providerConfigs,
      resolveProviderBaseURL: (providerId, configuredBaseURL) =>
        this.resolveProviderBaseURL(providerId, configuredBaseURL),
      providerPolicyRestrictionReason: (providerId) =>
        this.providerPolicyRestrictionReason(providerId),
      detectOpenAICompatibleModels: (baseURL) =>
        this.detectOpenAICompatibleModels(baseURL),
    });
    this.providerCatalogService = new GatewayAdminProviderCatalogService({
      providerConfigs: this.providerConfigs,
      ensureAppleFoundationAvailability: () => this.ensureAppleFoundationAvailability(),
      providerVisibleInCatalog: (providerId) => this.providerVisibleInCatalog(providerId),
      isProviderConfigAllowed: (providerId) => this.isProviderConfigAllowed(providerId),
      loadLocalAgentSnapshot: (forceRefresh) => this.loadLocalAgentSnapshot(forceRefresh),
      resolveProviderBaseURL: (providerId, configuredBaseURL) =>
        this.resolveProviderBaseURL(providerId, configuredBaseURL),
      detectOpenAICompatibleModels: (baseURL, detectionOptions) =>
        this.detectOpenAICompatibleModels(baseURL, detectionOptions),
      detectClaudeAgentSdkCatalog: (config, forceRefresh) =>
        this.catalogDetectionService.detectClaudeAgentSdkCatalog(config, forceRefresh),
      detectCodexAppServerCatalog: (config, forceRefresh) =>
        this.catalogDetectionService.detectCodexAppServerCatalog(config, forceRefresh),
      providerPolicyRestrictionReason: (providerId) =>
        this.providerPolicyRestrictionReason(providerId),
      appleProviderRuntimeEligibleSync: () => this.appleProviderRuntimeEligibleSync(),
    });
    this.providerTelemetryService = new GatewayAdminProviderTelemetryService({
      logger: this.logger,
      usageSnapshotService: options.usageSnapshotService,
      localUsageTelemetryService: options.localUsageTelemetryService,
      listProviderConfigs: () => this.listProviderConfigs(),
      findExecutable: (commands) => this.findExecutable(commands),
      resolveProviderBaseURL: (providerId, configuredBaseURL) =>
        this.resolveProviderBaseURL(providerId, configuredBaseURL),
      detectOpenAICompatibleModels: (baseURL) =>
        this.detectOpenAICompatibleModels(baseURL),
      queryCodexAppServer: (executablePath) => this.queryCodexAppServer(executablePath),
      readClaudeOAuthAccessToken: () => this.readClaudeOAuthAccessToken(),
      fetchClaudeOAuthUsage: (accessToken) => this.fetchClaudeOAuthUsage(accessToken),
    });
    this.catalogDetectionService = new GatewayAdminCatalogDetectionService({
      claudeAgentSdkMetadataProbe: options.claudeAgentSdkMetadataProbe,
      codexAppServerMetadataProbe: options.codexAppServerMetadataProbe,
      resolveConfiguredProviderApiKey: (providerId, config) =>
        this.resolveConfiguredProviderApiKey(providerId, config),
    });
    this.managedAgentRuntimeService = new GatewayAdminManagedAgentRuntimeService({
      profileRepo: this.profileRepo,
      spaceAdminService: this.spaceAdminService,
      spaceRepo: this.spaceRepo,
      gatewayRuntimeDefaultsRepo: this.gatewayRuntimeDefaultsRepo,
      gatewayProfile: this.gatewayProfile,
      defaultProviderId: this.defaultProviderId,
      defaultModelId: this.defaultModelId,
      mainSpaceId: this.mainSpaceId,
      mainSpaceName: this.mainSpaceName,
      mainSpaceResourceId: this.mainSpaceResourceId,
      mainSpaceGoal: this.mainSpaceGoal,
      mainProfileId: this.mainProfileId,
      mainAgentId: this.mainAgentId,
      conciergeSpaceId: this.conciergeSpaceId,
      conciergeSpaceName: this.conciergeSpaceName,
      conciergeSpaceResourceId: this.conciergeSpaceResourceId,
      conciergeSpaceGoal: this.conciergeSpaceGoal,
      conciergeProfileId: this.conciergeProfileId,
      conciergeAgentId: this.conciergeAgentId,
      mainAgentSwapEnabled: this.mainAgentSwapEnabled,
      mainAgentAutoRepairEnabled: this.mainAgentAutoRepairEnabled,
      providerConfigs: this.providerConfigs,
      listProviderConfigs: () => this.listProviderConfigs(),
      listProviderCatalogs: (input) => this.listProviderCatalogs(input),
      isProviderConfigAllowed: (providerId) => this.isProviderConfigAllowed(providerId),
      mergeAllowedModels: (providerId, model, modelIds) =>
        this.mergeAllowedModels(providerId, model, modelIds),
      ensureAppleFoundationAvailability: () => this.ensureAppleFoundationAvailability(),
      appleProviderRuntimeEligibleSync: () => this.appleProviderRuntimeEligibleSync(),
      resolveProviderBaseURL: (providerId, configuredBaseURL) =>
        this.resolveProviderBaseURL(providerId, configuredBaseURL),
      detectOpenAICompatibleModels: (baseURL, detectionOptions) =>
        this.detectOpenAICompatibleModels(baseURL, detectionOptions),
      validateProfileModelSelection: (input) => this.validateProfileModelSelection(input),
    });

    seedGatewayAdminProvidersFromEnvironment({
      logger: this.logger,
      providerConfigRepo: this.providerConfigRepo,
      providerConfigs: this.providerConfigs,
      defaultProviderId: this.defaultProviderId,
      defaultModelId: this.defaultModelId,
      defaultApiKey: options.defaultApiKey,
      isProviderConfigAllowed: (providerId) => this.isProviderConfigAllowed(providerId),
      providerVisibleInCatalog: (providerId) => this.providerVisibleInCatalog(providerId),
      resolveProviderBaseURL: (providerId, configuredBaseURL) =>
        this.resolveProviderBaseURL(providerId, configuredBaseURL),
      findExecutable: (commands) => this.findExecutable(commands),
    });
  }

  private appleFoundationHostSupported(): boolean {
    return this.providerPolicyService.appleFoundationHostSupported();
  }

  private async ensureAppleFoundationAvailability(): Promise<AppleFoundationAvailabilitySnapshot> {
    return this.providerPolicyService.ensureAppleFoundationAvailability();
  }

  private appleProviderEnabledSync(): { enabled: boolean; reason: string } {
    return this.providerPolicyService.appleProviderEnabledSync();
  }

  private appleProviderRuntimeEligibleSync(): { eligible: boolean; reason: string } {
    return this.providerPolicyService.appleProviderRuntimeEligibleSync();
  }

  private embeddedLocalIntegrationsAllowed(): boolean {
    return this.providerPolicyService.embeddedLocalIntegrationsAllowed();
  }

  private ensureAppleProviderEnabledSync(operation: string): void {
    this.providerPolicyService.ensureAppleProviderEnabledSync(operation);
  }

  private ensureAppleProviderRuntimeEligibleSync(operation: string): void {
    this.providerPolicyService.ensureAppleProviderRuntimeEligibleSync(operation);
  }

  private providerVisibleInCatalog(providerId: string): boolean {
    return this.providerPolicyService.providerVisibleInCatalog(providerId);
  }

  private providerPolicyRestrictionReason(providerId: string): string | undefined {
    return this.providerPolicyService.providerPolicyRestrictionReason(providerId);
  }

  async discoverLocalAgents(): Promise<DiscoveredLocalAgent[]> {
    return this.localAgentDiscoveryService.discoverLocalAgents();
  }

  private async loadLocalAgentSnapshot(forceRefresh: boolean): Promise<DiscoveredLocalAgent[]> {
    return this.localAgentDiscoveryService.loadLocalAgentSnapshot(forceRefresh);
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

  async getRuntimeDefaults(
    input: GatewayGetRuntimeDefaultsPayload = {},
  ): Promise<GatewayRuntimeDefaultsPayload> {
    return this.managedAgentRuntimeService.getRuntimeDefaults(input);
  }

  async setRuntimeDefaults(
    input: GatewaySetRuntimeDefaultsPayload,
  ): Promise<GatewaySetRuntimeDefaultsResponsePayload> {
    return this.managedAgentRuntimeService.setRuntimeDefaults(input);
  }

  resolveMainSpaceId(): string {
    return this.managedAgentRuntimeService.resolveMainSpaceId();
  }

  resolveConciergeSpaceId(): string {
    return this.managedAgentRuntimeService.resolveConciergeSpaceId();
  }

  async getMainAgent(input: GetMainAgentInput = {}): Promise<GatewayMainAgentStatePayload> {
    return this.managedAgentRuntimeService.getMainAgent(input);
  }

  async getConciergeAgent(
    input: GatewayGetConciergeAgentPayload = {},
  ): Promise<GatewayConciergeAgentStatePayload> {
    return this.managedAgentRuntimeService.getConciergeAgent(input);
  }

  async setMainAgent(input: SetMainAgentInput): Promise<GatewayMainAgentStatePayload> {
    return this.managedAgentRuntimeService.setMainAgent(input);
  }

  async setConciergeAgent(
    input: GatewaySetConciergeAgentPayload,
  ): Promise<GatewayConciergeAgentStatePayload> {
    return this.managedAgentRuntimeService.setConciergeAgent(input);
  }

  private resolveFallbackProviderModel(): { providerHint: string; modelHint: string } | null {
    return this.managedAgentRuntimeService.resolveFallbackProviderModel();
  }

  private async resolveValidatedProviderModel(input: {
    providerHintRaw?: string;
    modelHintRaw?: string;
    repairIfInvalid: boolean;
    allowFallbackRepair?: boolean;
  }) {
    return this.managedAgentRuntimeService.resolveValidatedProviderModel(input);
  }

  private async ensureAgentAssignment(
    spaceId: string,
    agentId: string,
    profileId: string,
  ): Promise<boolean> {
    return this.managedAgentRuntimeService.ensureAgentAssignment(spaceId, agentId, profileId);
  }

  async listProviderCatalogs(input?: {
    providerId?: string;
    refresh?: boolean;
  }): Promise<GatewayModelProviderCatalog[]> {
    return this.providerCatalogService.listProviderCatalogs(input);
  }

  async listAvailableModels(input?: {
    providerId?: string;
    refresh?: boolean;
  }): Promise<GatewayModelProviderCatalog[]> {
    return this.listProviderCatalogs(input);
  }

  listTools(_input: GatewayListToolsPayload = {}): GatewayListToolsResponsePayload["tools"] {
    return this.toolIntegrationService.listTools(_input);
  }

  getTool(toolId: string): GatewayGetToolResponsePayload["tool"] {
    return this.toolIntegrationService.getTool(toolId);
  }

  listInterconnectors(
    _input: GatewayListInterconnectorsPayload = {},
  ): GatewayListInterconnectorsResponsePayload["interconnectors"] {
    return this.toolIntegrationService.listInterconnectors(_input);
  }

  async rescanInterconnectors(
    _input: GatewayRescanInterconnectorsPayload = {},
  ): Promise<GatewayRescanInterconnectorsResponsePayload["interconnectors"]> {
    return this.toolIntegrationService.rescanInterconnectors(_input);
  }

  scaffoldTool(
    input: GatewayScaffoldToolPayload,
  ): GatewayScaffoldToolResponsePayload {
    return this.toolIntegrationService.scaffoldTool(input);
  }

  async registerTool(
    input: GatewayRegisterToolPayload,
  ): Promise<GatewayRegisterToolResponsePayload["tool"]> {
    return this.toolIntegrationService.registerTool(input);
  }

  async removeTool(toolId: string): Promise<GatewayRemoveToolResponsePayload> {
    return this.toolIntegrationService.removeTool(toolId);
  }

  async setToolEnabled(
    input: GatewaySetToolEnabledPayload,
  ): Promise<GatewaySetToolEnabledResponsePayload> {
    return this.toolIntegrationService.setToolEnabled(input);
  }

  listToolApprovalGrants(
    input: GatewayListToolApprovalGrantsPayload,
    principalId: string,
    deviceId?: string,
  ): GatewayListToolApprovalGrantsResponsePayload["grants"] {
    return this.toolIntegrationService.listToolApprovalGrants(input, principalId, deviceId);
  }

  revokeToolApprovalGrant(
    input: GatewayRevokeToolApprovalGrantPayload,
    principalId: string,
    deviceId?: string,
  ): GatewayRevokeToolApprovalGrantResponsePayload {
    return this.toolIntegrationService.revokeToolApprovalGrant(input, principalId, deviceId);
  }

  createIntegrationRequest(
    input: GatewayCreateIntegrationRequestPayload,
    principalId?: string,
    deviceId?: string,
  ): GatewayCreateIntegrationRequestResponsePayload["request"] {
    return this.toolIntegrationService.createIntegrationRequest(input, principalId, deviceId);
  }

  listIntegrationRequests(
    input?: GatewayListIntegrationRequestsPayload,
  ): GatewayListIntegrationRequestsResponsePayload["requests"] {
    return this.toolIntegrationService.listIntegrationRequests(input);
  }

  setUsageSnapshotService(service?: UsageSnapshotService): void {
    this.providerTelemetryService.setUsageSnapshotService(service);
  }

  setLocalUsageTelemetryService(service?: LocalUsageTelemetryService): void {
    this.providerTelemetryService.setLocalUsageTelemetryService(service);
  }

  async getProviderTelemetry(input?: {
    providerId?: string;
  }): Promise<ProviderTelemetry[]> {
    return this.providerTelemetryService.getProviderTelemetry(input);
  }

  async getLocalUsageTelemetry(input?: {
    providerId?: string;
    providerIds?: string[];
  }): Promise<LocalProviderUsageTelemetry[]> {
    return this.providerTelemetryService.getLocalUsageTelemetry(input);
  }

  private providerSettingsContext(): GatewayAdminProviderSettingsContext {
    return {
      logger: this.logger,
      providerConfigs: this.providerConfigs,
      providerConfigRepo: this.providerConfigRepo,
      providerSecretRefService: this.providerSecretRefService,
      defaultModelId: this.defaultModelId,
      ensureAppleProviderEnabledSync: (operation) =>
        this.ensureAppleProviderEnabledSync(operation),
      assertProviderConfigAllowed: (providerId, input, existing) =>
        this.assertProviderConfigAllowed(providerId, input, existing),
      mergeAllowedModels: (providerId, model, modelIds) =>
        this.mergeAllowedModels(providerId, model, modelIds),
      resolveProviderBaseURL: (providerId, configuredBaseURL) =>
        this.resolveProviderBaseURL(providerId, configuredBaseURL),
      applyConfigToEnvironment: (config) => this.applyConfigToEnvironment(config),
      invalidateProviderRuntimeCaches: (providerId) =>
        this.invalidateProviderRuntimeCaches(providerId),
    };
  }

  getProviderSettings(providerIdRaw: string): PublicProviderRuntimeConfig {
    return getGatewayAdminProviderSettings(this.providerSettingsContext(), providerIdRaw);
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
    return setGatewayAdminProviderConfig(this.providerSettingsContext(), input);
  }

  putSecretRef(input: PutSecretRefInput): PutSecretRefResult {
    return putGatewayAdminSecretRef(this.providerSettingsContext(), input);
  }

  listSecretRefs(providerId?: string): ProviderSecretRefSummary[] {
    return listGatewayAdminSecretRefs(this.providerSettingsContext(), providerId);
  }

  deleteSecretRef(secretRef: string): boolean {
    return deleteGatewayAdminSecretRef(this.providerSettingsContext(), secretRef);
  }

  removeProviderConfig(providerIdRaw: string): void {
    removeGatewayAdminProviderConfig(this.providerSettingsContext(), providerIdRaw);
  }

  private profileRuntimeContext(): GatewayAdminProfileRuntimeContext {
    return {
      logger: this.logger,
      profileRepo: this.profileRepo,
      gatewayProfile: this.gatewayProfile,
      providerConfigs: this.providerConfigs,
      providerSecretRefService: this.providerSecretRefService,
      defaultProviderId: this.defaultProviderId,
      defaultModelId: this.defaultModelId,
      getLocalClientTemplate: (localClientId) =>
        this.localAgentDiscoveryService.getLocalClientTemplate(localClientId),
      embeddedLocalIntegrationsAllowed: () => this.embeddedLocalIntegrationsAllowed(),
      ensureAgentAssignment: (spaceId, agentId, profileId) =>
        this.ensureAgentAssignment(spaceId, agentId, profileId),
      // CLI providers are now auto-seeded during bootstrap; Apple should only
      // be selected through the normal priority order in providerConfigs,
      // not silently injected as a hidden default.
      resolveEmbeddedMacDefaultProvider: () => undefined,
      providerPolicyRestrictionReason: (providerId) =>
        this.providerPolicyRestrictionReason(providerId),
      resolveFallbackProviderModel: () => this.resolveFallbackProviderModel(),
      resolveValidatedProviderModel: (input) => this.resolveValidatedProviderModel(input),
      ensureAppleProviderRuntimeEligibleSync: (operation) =>
        this.ensureAppleProviderRuntimeEligibleSync(operation),
      ensureAppleProviderEnabledSync: (operation) =>
        this.ensureAppleProviderEnabledSync(operation),
      resolveProviderBaseURL: (providerId, configuredBaseURL) =>
        this.resolveProviderBaseURL(providerId, configuredBaseURL),
      resolveConfiguredProviderApiKey: (providerId, config) =>
        this.resolveConfiguredProviderApiKey(providerId, config),
      getProviderSettings: (providerId) => this.getProviderSettings(providerId),
    };
  }

  async provisionLocalProfile(input: ProvisionLocalProfileInput): Promise<ProvisionLocalProfileResult> {
    return provisionGatewayAdminLocalProfile(this.profileRuntimeContext(), input);
  }

  loadProfileRuntime(profileIdRaw?: string): ProfileRuntimeContext | null {
    return loadGatewayAdminProfileRuntime(this.profileRuntimeContext(), profileIdRaw);
  }

  async resolveProviderForProfile(
    providerHintRaw?: string,
    modelHint?: string,
  ): Promise<ExactProviderRuntimeSelection> {
    return resolveGatewayAdminProviderForProfile(
      this.profileRuntimeContext(),
      providerHintRaw,
      modelHint,
    );
  }

  resolveExactProviderRuntimeConfig(input: {
    providerId: string;
    model?: string;
  }): ExactProviderRuntimeSelection {
    return resolveGatewayAdminExactProviderRuntimeConfig(
      this.profileRuntimeContext(),
      input,
    );
  }

  validateProfileModelSelection(input: {
    providerHint?: string;
    modelHint?: string;
    modelConfig?: ProfileModelConfig;
  }): void {
    validateGatewayAdminProfileModelSelection(this.profileRuntimeContext(), input);
  }

  private async queryCodexAppServer(executablePath: string) {
    return queryCodexAppServerTelemetry(executablePath);
  }

  private async readClaudeOAuthAccessToken() {
    const fromKeychain = this.readClaudeOAuthAccessTokenFromKeychain();
    if (fromKeychain.accessToken) {
      return fromKeychain;
    }
    const fromFile = this.readClaudeOAuthAccessTokenFromCredentialsFile();
    if (fromFile.accessToken) {
      return fromFile;
    }
    return {
      message: "No Claude OAuth token found; API-key billing does not expose session or weekly quota windows.",
    };
  }

  private readClaudeOAuthAccessTokenFromKeychain() {
    return readClaudeOAuthAccessTokenFromKeychainPayload();
  }

  private readClaudeOAuthAccessTokenFromCredentialsFile() {
    return readClaudeOAuthAccessTokenFromCredentialsFilePayload();
  }

  private async fetchClaudeOAuthUsage(accessToken: string) {
    return fetchClaudeOAuthUsageWindowPayloads(accessToken);
  }

  private mergeAllowedModels(providerId: string, model: string, modelIds: string[]): string[] {
    return mergeAllowedProviderModels({
      providerId,
      model,
      modelIds,
      detectedModelHints: this.detectedLocalModelHints(providerId),
    });
  }

  private detectedLocalModelHints(providerId: string): string[] {
    if (providerId === "codex") {
      return uniqueModelIds([
        ...this.detectCodexCliModels(),
        ...(LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []),
      ]);
    }

    if (providerId === "codex-app-server") {
      return uniqueModelIds([
        ...this.detectCodexCliModels().map((modelId) => modelId.replace(/^codex\//, "codex-app-server/")),
        ...(LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []),
      ]);
    }

    if (!isLocalProvider(providerId)) {
      return [];
    }

    return uniqueModelIds(LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []);
  }

  private applyConfigToEnvironment(config: ProviderRuntimeConfig): void {
    applyProviderConfigToEnvironment(config);
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
    this.providerPolicyService.assertProviderConfigAllowed(providerId, input, existing);
  }

  private isProviderConfigAllowed(providerId: string): boolean {
    return this.providerPolicyService.isProviderConfigAllowed(providerId);
  }

  private resolveProviderBaseURL(providerId: string, configuredBaseURL?: string): string | undefined {
    return this.providerPolicyService.resolveProviderBaseURL(providerId, configuredBaseURL);
  }

  private async detectOpenAICompatibleModels(
    baseURLRaw?: string,
    options?: {
      forceRefresh?: boolean;
    },
  ): Promise<OpenAICompatibleDetectionResult> {
    return this.openAICompatibleModelDiscoveryService.detectModels(baseURLRaw, options);
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
    this.localAgentDiscoveryService.invalidate();
    this.providerCatalogService.invalidate();
    this.catalogDetectionService.invalidate(providerId);
  }

  private findExecutable(commands: string[]): string | null {
    return this.localAgentDiscoveryService.findExecutable(commands);
  }

  private detectCodexCliModels(): string[] {
    return this.localAgentDiscoveryService.detectCodexCliModels();
  }
}
