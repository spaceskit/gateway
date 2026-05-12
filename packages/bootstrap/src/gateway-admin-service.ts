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
import { USER_ESCALATION_SKILL_ID } from "@spaceskit/core";
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
  type ClaudeOAuthAccessTokenResult,
  type ClaudeOAuthUsageResult,
} from "./services/claude-oauth-telemetry.js";
import {
  queryCodexAppServerTelemetry,
  type CodexAppServerTelemetryResult,
} from "./services/codex-app-server-telemetry.js";
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
  deriveProviderFromModel,
  isSpaceAdminErrorLike,
  mergeSkillIds,
  normalizeProviderId,
  normalizeSelectionMode,
  parseModelConfig,
  parseStringArray,
  resolveOpenAICompatibleModelsEndpoint,
  throwGatewayError,
  uniqueModelIds,
  withProviderPrefix,
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
  ensureGatewayAdminConciergeSpace,
  ensureGatewayAdminMainSpace,
  type GatewayAdminManagedSpaceRepairContext,
} from "./gateway-admin-managed-space-repair.js";
import {
  applyManagedAgentDefinitionSelection,
  applyManagedAgentProviderModelSelection,
  type ManagedAgentSelectionContext,
} from "./gateway-admin-managed-agent-selection.js";
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
  resolveGatewayAdminRuntimeDefaults,
  updateGatewayAdminManagedRuntimeProfile,
  validateGatewayAdminRuntimeDefaultSelection,
  type GatewayAdminRuntimeDefaultsContext,
} from "./gateway-admin-runtime-defaults.js";
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
        this.detectClaudeAgentSdkCatalog(config, forceRefresh),
      detectCodexAppServerCatalog: (config, forceRefresh) =>
        this.detectCodexAppServerCatalog(config, forceRefresh),
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
      queryCodexAppServer: (executablePath) =>
        this.queryCodexAppServer(executablePath),
      readClaudeOAuthAccessToken: () =>
        this.readClaudeOAuthAccessToken(),
      fetchClaudeOAuthUsage: (accessToken) =>
        this.fetchClaudeOAuthUsage(accessToken),
    });
    this.catalogDetectionService = new GatewayAdminCatalogDetectionService({
      claudeAgentSdkMetadataProbe: options.claudeAgentSdkMetadataProbe,
      codexAppServerMetadataProbe: options.codexAppServerMetadataProbe,
      resolveConfiguredProviderApiKey: (providerId, config) =>
        this.resolveConfiguredProviderApiKey(providerId, config),
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

  private runtimeDefaultsContext(): GatewayAdminRuntimeDefaultsContext {
    return {
      profileRepo: this.profileRepo,
      gatewayRuntimeDefaultsRepo: this.gatewayRuntimeDefaultsRepo,
      mainProfileId: this.mainProfileId,
      conciergeProfileId: this.conciergeProfileId,
      defaultProviderId: this.defaultProviderId,
      defaultModelId: this.defaultModelId,
      listProviderConfigs: () => this.listProviderConfigs(),
      listProviderCatalogs: (input) => this.listProviderCatalogs(input),
      isProviderConfigAllowed: (providerId) => this.isProviderConfigAllowed(providerId),
      mergeAllowedModels: (providerId, model, modelIds) =>
        this.mergeAllowedModels(providerId, model, modelIds),
      validateProviderRuntimeSelection: (providerId, modelId) =>
        this.validateProviderRuntimeSelection(providerId, modelId),
      requireProfileRepo: () => this.requireProfileRepo(),
    };
  }

  async getRuntimeDefaults(
    _input: GatewayGetRuntimeDefaultsPayload = {},
  ): Promise<GatewayRuntimeDefaultsPayload> {
    return resolveGatewayAdminRuntimeDefaults(this.runtimeDefaultsContext());
  }

  async setRuntimeDefaults(
    input: GatewaySetRuntimeDefaultsPayload,
  ): Promise<GatewaySetRuntimeDefaultsResponsePayload> {
    if (!input.main && !input.concierge) {
      throwGatewayError(
        "INVALID_ARGUMENT",
        "At least one runtime-default branch must be provided.",
      );
    }

    const runtimeDefaultsContext = this.runtimeDefaultsContext();
    const current = await resolveGatewayAdminRuntimeDefaults(runtimeDefaultsContext);
    const main = input.main
      ? await validateGatewayAdminRuntimeDefaultSelection(runtimeDefaultsContext, input.main, "main")
      : current.main;
    const concierge = input.concierge
      ? await validateGatewayAdminRuntimeDefaultSelection(runtimeDefaultsContext, input.concierge, "concierge")
      : current.concierge;

    const persisted = this.gatewayRuntimeDefaultsRepo?.set({
      mainProviderId: main.providerId,
      mainModelId: main.modelId,
      conciergeProviderId: concierge.providerId,
      conciergeModelId: concierge.modelId,
    });

    const mainSpaceId = this.resolveMainTargetSpaceId(undefined);
    const conciergeSpaceId = this.resolveConciergeTargetSpaceId(undefined);
    await this.ensureMainProfileActive(true);
    await this.ensureConciergeProfileActive(true);
    await this.ensureMainSpace(true);
    await this.ensureConciergeSpace(true);

    updateGatewayAdminManagedRuntimeProfile(
      runtimeDefaultsContext,
      this.mainProfileId,
      main,
      true,
      "gateway_runtime_defaults",
    );
    updateGatewayAdminManagedRuntimeProfile(
      runtimeDefaultsContext,
      this.conciergeProfileId,
      concierge,
      false,
      "gateway_runtime_defaults",
    );

    await this.normalizeMainAssignment(mainSpaceId);
    await this.normalizeConciergeAssignment(conciergeSpaceId);

    const mainAgentState = await this.resolveMainAgentState({
      spaceId: mainSpaceId,
      repairIfMissing: true,
    });
    const conciergeAgentState = await this.resolveConciergeAgentState({
      spaceId: conciergeSpaceId,
      repairIfMissing: true,
    });

    return {
      defaults: {
        main,
        concierge,
        updatedAt: persisted?.updated_at ?? new Date().toISOString(),
      },
      mainAgentState,
      conciergeAgentState,
    };
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
    const selectionContext = this.managedAgentSelectionContext(
      profileRepo,
      this.mainProfileId,
      "gateway_main_agent_swap",
    );

    if (selectionMode === "provider_model") {
      await applyManagedAgentProviderModelSelection(input, selectionContext);
    } else {
      await applyManagedAgentDefinitionSelection(input, selectionContext);
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
    const selectionContext = this.managedAgentSelectionContext(
      profileRepo,
      this.conciergeProfileId,
      "gateway_concierge_agent_swap",
    );

    if (selectionMode === "provider_model") {
      await applyManagedAgentProviderModelSelection(input, selectionContext);
    } else {
      await applyManagedAgentDefinitionSelection(input, selectionContext);
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

  private managedAgentSelectionContext(
    profileRepo: ProfileRepository,
    profileId: string,
    updateSource: string,
  ): ManagedAgentSelectionContext {
    return {
      profileRepo,
      profileId,
      updateSource,
      listProviderConfigs: () => this.listProviderConfigs(),
      mergeAllowedModels: (providerId, model, modelIds) => this.mergeAllowedModels(
        providerId,
        model,
        modelIds,
      ),
      validateProviderRuntimeSelection: (providerId, modelId) => (
        this.validateProviderRuntimeSelection(providerId, modelId)
      ),
      validateProfileModelSelection: (input) => this.validateProfileModelSelection(input),
      validatePinnedProviderModel: (providerHint, modelHint) => this.validatePinnedProviderModel(
        providerHint,
        modelHint,
      ),
    };
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
    return ensureGatewayAdminMainSpace(this.managedSpaceRepairContext(), repairIfMissing);
  }

  private async ensureConciergeSpace(
    repairIfMissing: boolean,
  ): Promise<{ spaceUid: string; repaired: boolean; assignedProfileId?: string; updatedAt: string }> {
    return ensureGatewayAdminConciergeSpace(this.managedSpaceRepairContext(), repairIfMissing);
  }

  private managedSpaceRepairContext(): GatewayAdminManagedSpaceRepairContext {
    return {
      spaceAdminService: this.spaceAdminService,
      spaceRepo: this.spaceRepo,
      main: {
        spaceId: this.mainSpaceId,
        resourceId: this.mainSpaceResourceId,
        name: this.mainSpaceName,
        goal: this.mainSpaceGoal,
        profileId: this.mainProfileId,
        agentId: this.mainAgentId,
      },
      concierge: {
        spaceId: this.conciergeSpaceId,
        resourceId: this.conciergeSpaceResourceId,
        name: this.conciergeSpaceName,
        goal: this.conciergeSpaceGoal,
        profileId: this.conciergeProfileId,
        agentId: this.conciergeAgentId,
      },
    };
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
      resolveEmbeddedMacDefaultProvider: () => this.resolveEmbeddedMacDefaultProvider(),
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

  private async queryCodexAppServer(executablePath: string): Promise<CodexAppServerTelemetryResult> {
    return queryCodexAppServerTelemetry(executablePath);
  }

  private async readClaudeOAuthAccessToken(): Promise<ClaudeOAuthAccessTokenResult> {
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

  private readClaudeOAuthAccessTokenFromKeychain(): ClaudeOAuthAccessTokenResult {
    return readClaudeOAuthAccessTokenFromKeychainPayload();
  }

  private readClaudeOAuthAccessTokenFromCredentialsFile(): ClaudeOAuthAccessTokenResult {
    return readClaudeOAuthAccessTokenFromCredentialsFilePayload();
  }

  private async fetchClaudeOAuthUsage(accessToken: string): Promise<ClaudeOAuthUsageResult> {
    return fetchClaudeOAuthUsageWindowPayloads(accessToken);
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

  private async detectClaudeAgentSdkCatalog(
    config?: ProviderRuntimeConfig,
    forceRefresh = false,
  ): Promise<ClaudeAgentSdkCatalogProbe> {
    return this.catalogDetectionService.detectClaudeAgentSdkCatalog(config, forceRefresh);
  }

  private async detectCodexAppServerCatalog(
    config?: ProviderRuntimeConfig,
    forceRefresh = false,
  ): Promise<CodexAppServerCatalogProbe> {
    return this.catalogDetectionService.detectCodexAppServerCatalog(config, forceRefresh);
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
