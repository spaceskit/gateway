import type { Logger } from "@spaceskit/observability";
import type {
  GatewayRuntimeDefaultsRepository,
  IntegrationRequestRepository,
  ProfileRepository,
  ProviderConfigRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import type { SpaceAdminService } from "@spaceskit/core";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type {
  GatewayGetMainAgentPayload,
  GatewayIntegrationClassPayload,
  GatewayIntegrationStatusPayload,
  GatewayModelCatalogEntryPayload,
  GatewayModelCatalogSourcePayload,
  GatewayModelDetectionStatusPayload,
  GatewayModelProviderCatalogPayload,
  GatewayProviderAuthAccountPayload,
  GatewayProviderAuthModePayload,
  GatewayProviderAuthStatusPayload,
  GatewayProviderCatalogGroupPayload,
  GatewayRuntimeDefaultsPayload,
  GatewaySetMainAgentPayload,
  ProviderRuntimeConfigPayload,
  ProviderTelemetryPayload,
  ProviderTelemetrySourcePayload,
  ProviderTelemetryWindowPayload,
} from "@spaceskit/server";
import type {
  ProviderSecretRefService,
  ProviderSecretRefSummary,
} from "./services/provider-secret-ref-service.js";
import type { InterconnectorCatalogService } from "./services/interconnector-catalog-service.js";
import type { UsageSnapshotService } from "./services/usage-snapshot-service.js";
import type { LocalUsageTelemetryService } from "./services/local-usage-telemetry-service.js";
import type { CliToolService } from "./services/cli-tool-service.js";
import type { AccessGrantService } from "./services/access-grant-service.js";
import type { ToolApprovalGrantService } from "./services/tool-approval-grant-service.js";
import type { LocalExecutableResolver } from "./execution/local-executable-resolver.js";
import type {
  ClaudeAgentSdkCatalogProbe,
  CodexAppServerCatalogProbe,
} from "./gateway-admin-telemetry-normalizers.js";
import type { AppleFoundationAvailabilitySnapshot } from "./gateway-admin-provider-policy-service.js";

export type GatewayProviderAuthMode = GatewayProviderAuthModePayload;
export type GatewayModelDetectionStatus = GatewayModelDetectionStatusPayload;
export type GatewayModelCatalogSource = GatewayModelCatalogSourcePayload;
export type GatewayProviderCatalogGroup = GatewayProviderCatalogGroupPayload;
export type GatewayIntegrationClass = GatewayIntegrationClassPayload;
export type GatewayIntegrationStatus = GatewayIntegrationStatusPayload;
export type GatewayProviderAuthStatus = GatewayProviderAuthStatusPayload;
export type GatewayProviderAuthAccount = GatewayProviderAuthAccountPayload;
export type GatewayModelCatalogEntry = GatewayModelCatalogEntryPayload;
export type GatewayModelProviderCatalog = GatewayModelProviderCatalogPayload;
export type GatewayRuntimeDefaults = GatewayRuntimeDefaultsPayload;
export type PublicProviderRuntimeConfig = ProviderRuntimeConfigPayload;
export type ProviderTelemetry = ProviderTelemetryPayload;
export type ProviderTelemetrySource = ProviderTelemetrySourcePayload;
export type ProviderTelemetryWindow = ProviderTelemetryWindowPayload;

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
