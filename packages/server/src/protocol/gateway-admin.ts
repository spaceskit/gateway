import type { GatewayToolHealthStatusPayload } from "./tooling.js";
import type { ProviderUsageSnapshotPayload } from "./usage-policy.js";

export interface GatewayDiscoverLocalAgentsPayload {
  apiVersion?: string;
}

export interface GatewayListProviderConfigsPayload {
  apiVersion?: string;
}

export interface GatewayRuntimeDefaultSelectionPayload {
  providerId: string;
  modelId: string;
}

export interface GatewayRuntimeDefaultsPayload {
  main: GatewayRuntimeDefaultSelectionPayload;
  concierge: GatewayRuntimeDefaultSelectionPayload;
  updatedAt: string;
}

export interface GatewayGetRuntimeDefaultsPayload {
  apiVersion?: string;
}

export interface GatewaySetRuntimeDefaultsPayload {
  apiVersion?: string;
  main?: GatewayRuntimeDefaultSelectionPayload;
  concierge?: GatewayRuntimeDefaultSelectionPayload;
}

export type MainAgentSelectionMode = "provider_model" | "agent_definition";
export type ConciergeAgentSelectionMode = MainAgentSelectionMode;

export interface GatewayGetMainAgentPayload {
  apiVersion?: string;
  spaceId?: string;
  repairIfMissing?: boolean;
}

export interface GatewaySetMainAgentPayload {
  apiVersion?: string;
  spaceId?: string;
  selectionMode: MainAgentSelectionMode;
  providerId?: string;
  modelId?: string;
  sourceAgentDefinitionId?: string;
  applyPersonaInstructions?: boolean;
}

export interface GatewayMainAgentStatePayload {
  spaceId: string;
  spaceUid: string;
  mainAgentId: string;
  mainProfileId: string;
  assignedProfileId?: string;
  providerHint?: string;
  modelHint?: string;
  status: "healthy" | "repaired" | "fallback";
  repaired: boolean;
  fallbackApplied: boolean;
  fallbackReason?: string;
  updatedAt: string;
}

export interface GatewayGetConciergeAgentPayload {
  apiVersion?: string;
  spaceId?: string;
  repairIfMissing?: boolean;
}

export interface GatewaySetConciergeAgentPayload {
  apiVersion?: string;
  spaceId?: string;
  selectionMode: ConciergeAgentSelectionMode;
  providerId?: string;
  modelId?: string;
  sourceAgentDefinitionId?: string;
  applyPersonaInstructions?: boolean;
}

export interface GatewayConciergeAgentStatePayload {
  spaceId: string;
  spaceUid: string;
  conciergeAgentId: string;
  conciergeProfileId: string;
  assignedProfileId?: string;
  providerHint?: string;
  modelHint?: string;
  status: "healthy" | "repaired" | "fallback";
  repaired: boolean;
  fallbackApplied: boolean;
  fallbackReason?: string;
  updatedAt: string;
}

export interface GatewayListAvailableModelsPayload {
  apiVersion?: string;
  providerId?: string;
  refresh?: boolean;
}

export interface GatewayListProviderCatalogsPayload {
  apiVersion?: string;
  providerId?: string;
  refresh?: boolean;
}

export type GatewayInterconnectorAvailabilityStatusPayload = "active" | "degraded" | "inactive";

export interface GatewayInterconnectorBundlePayload {
  bundleId: string;
  bundleDisplayName: string;
  bundleDescription?: string;
  availabilityStatus: GatewayInterconnectorAvailabilityStatusPayload;
  detected: boolean;
  executablePath?: string;
  installHint?: string;
  toolIds: string[];
  toolCount: number;
  managedEnabled: boolean;
  healthStatus: GatewayToolHealthStatusPayload;
  healthMessage?: string;
  updatedAt: string;
}

export interface GatewayListInterconnectorsPayload {
  apiVersion?: string;
}

export interface GatewayListInterconnectorsResponsePayload {
  interconnectors: GatewayInterconnectorBundlePayload[];
  generatedAt: string;
}

export interface GatewayRescanInterconnectorsPayload {
  apiVersion?: string;
}

export interface GatewayRescanInterconnectorsResponsePayload {
  interconnectors: GatewayInterconnectorBundlePayload[];
  generatedAt: string;
}

export interface GatewayCreateIntegrationRequestPayload {
  apiVersion?: string;
  integrationClass: GatewayIntegrationClassPayload;
  requestedName: string;
  useCase?: string;
  sourceURL?: string;
  notes?: string;
}

export interface GatewayListIntegrationRequestsPayload {
  apiVersion?: string;
  integrationClass?: GatewayIntegrationClassPayload;
  limit?: number;
}

export interface GatewayGetProviderTelemetryPayload {
  apiVersion?: string;
  providerId?: string;
}

export interface GatewayGetLocalUsageTelemetryPayload {
  apiVersion?: string;
  providerId?: string;
  providerIds?: string[];
}

export interface GatewayGetProviderSettingsPayload {
  apiVersion?: string;
  providerId: string;
}

export interface GatewaySetProviderConfigPayload {
  apiVersion?: string;
  providerId: string;
  model?: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthModePayload;
  baseURL?: string;
  allowedModels?: string[];
  allowCustomModel?: boolean;
  nativeCliToolsEnabled?: boolean;
}

export interface GatewayUpdateProviderSettingsPayload {
  apiVersion?: string;
  providerId: string;
  model?: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthModePayload;
  baseURL?: string;
  allowedModels?: string[];
  allowCustomModel?: boolean;
  nativeCliToolsEnabled?: boolean;
}

export interface GatewayRemoveProviderConfigPayload {
  apiVersion?: string;
  providerId: string;
}

export interface GatewayFactoryResetPayload {
  apiVersion?: string;
  confirmation: string;
}

export interface SpaceResetPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface GatewayProvisionLocalProfilePayload {
  apiVersion?: string;
  localClientId: string;
  profileId?: string;
  profileName?: string;
  agentId?: string;
  spaceId?: string;
}

export interface DiscoveredLocalAgentPayload {
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

export interface ProviderRuntimeConfigPayload {
  providerId: string;
  model: string;
  baseURL?: string;
  hasApiKey: boolean;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthModePayload;
  allowedModels: string[];
  allowCustomModel: boolean;
  nativeCliToolsEnabled: boolean;
  updatedAt: string;
  source: "env" | "runtime";
}

export type GatewayModelDetectionStatusPayload = "available" | "unavailable" | "error";
export type GatewayModelCatalogSourcePayload = "detected" | "configured" | "fallback" | "allowlist";
export type GatewayModelTierPayload = "fast" | "balanced" | "smartest" | "local";
export type GatewayProviderCatalogGroupPayload = "cloud" | "executor" | "local_runtime";
export type GatewayIntegrationClassPayload = "cloud" | "executor" | "local_runtime";
export type GatewayProviderAuthModePayload = "api_key" | "host_login";
export type GatewayProviderAuthStatusPayload = "authenticated" | "needs_key" | "needs_auth" | "error" | "unsupported";
export type GatewayIntegrationStatusPayload =
  | "installed"
  | "missing"
  | "needs_key"
  | "needs_auth"
  | "reachable"
  | "no_models_loaded"
  | "policy_blocked"
  | "unsupported"
  | "error";

export interface GatewayModelCatalogEntryPayload {
  id: string;
  displayName: string;
  source: GatewayModelCatalogSourcePayload;
  available: boolean;
  contextWindow?: number;
  /**
   * Intent-based tier label assigned by the gateway. Clients render the
   * picker tier cards from this field. Optional during the rollout — older
   * gateway builds may omit it; clients must default to `balanced` when
   * absent. Populated for all entries built by the current gateway.
   */
  tier?: GatewayModelTierPayload;
}

export interface GatewayProviderAuthAccountPayload {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  apiProvider?: string;
  tokenSource?: string;
}

export interface GatewayModelProviderCatalogPayload {
  providerId: string;
  displayName: string;
  group: GatewayProviderCatalogGroupPayload;
  integrationClass: GatewayIntegrationClassPayload;
  status: GatewayIntegrationStatusPayload;
  hasApiKey: boolean;
  requiresApiKey: boolean;
  supportedAuthModes?: GatewayProviderAuthModePayload[];
  authMode?: GatewayProviderAuthModePayload;
  authStatus?: GatewayProviderAuthStatusPayload;
  authAccount?: GatewayProviderAuthAccountPayload;
  baseURL?: string;
  detectionStatus: GatewayModelDetectionStatusPayload;
  detectionError?: string;
  models: GatewayModelCatalogEntryPayload[];
  installHint?: string;
  recommended?: boolean;
  supportsHostedBilling?: boolean;
  configAllowed?: boolean;
}

export interface GatewayIntegrationRequestPayload {
  integrationRequestId: string;
  integrationClass: GatewayIntegrationClassPayload;
  requestedName: string;
  useCase?: string;
  sourceURL?: string;
  notes?: string;
  principalId?: string;
  deviceId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayDiscoverLocalAgentsResponsePayload {
  agents: DiscoveredLocalAgentPayload[];
}

export interface GatewayListProviderConfigsResponsePayload {
  configs: ProviderRuntimeConfigPayload[];
}

export interface GatewayGetRuntimeDefaultsResponsePayload {
  defaults: GatewayRuntimeDefaultsPayload;
}

export interface GatewaySetRuntimeDefaultsResponsePayload {
  defaults: GatewayRuntimeDefaultsPayload;
  mainAgentState: GatewayMainAgentStatePayload;
  conciergeAgentState: GatewayConciergeAgentStatePayload;
}

export interface GatewayGetMainAgentResponsePayload {
  state: GatewayMainAgentStatePayload;
}

export interface GatewaySetMainAgentResponsePayload {
  state: GatewayMainAgentStatePayload;
}

export interface GatewayGetConciergeAgentResponsePayload {
  state: GatewayConciergeAgentStatePayload;
}

export interface GatewaySetConciergeAgentResponsePayload {
  state: GatewayConciergeAgentStatePayload;
}

export interface GatewayListAvailableModelsResponsePayload {
  providers: GatewayModelProviderCatalogPayload[];
  generatedAt: string;
}

export interface GatewayListProviderCatalogsResponsePayload {
  providers: GatewayModelProviderCatalogPayload[];
  generatedAt: string;
}

export interface GatewayCreateIntegrationRequestResponsePayload {
  request: GatewayIntegrationRequestPayload;
}

export interface GatewayListIntegrationRequestsResponsePayload {
  requests: GatewayIntegrationRequestPayload[];
}

export type ProviderTelemetrySourcePayload =
  | "usage_snapshot"
  | "codex_app_server"
  | "claude_cli"
  | "gemini_cli"
  | "lmstudio_runtime";

export interface ProviderTelemetryWindowPayload {
  scopeId: string;
  scopeName?: string;
  window: "primary" | "secondary";
  usedPercent?: number;
  remainingPercent?: number;
  resetsAt?: string;
  windowDurationMins?: number;
}

export interface ProviderTelemetryPayload {
  providerId: string;
  status: ProviderUsageSnapshotPayload["status"];
  source: ProviderTelemetrySourcePayload;
  fetchedAt: string;
  message?: string;
  accountLabel?: string;
  windows: ProviderTelemetryWindowPayload[];
  usage?: ProviderUsageSnapshotPayload;
}

export interface GatewayGetProviderTelemetryResponsePayload {
  telemetry: ProviderTelemetryPayload[];
  generatedAt: string;
}

export interface LocalUsageInstallHintPayload {
  command: string;
  docsUrl: string;
}

export interface LocalUsageWindowPayload {
  window: "primary" | "secondary" | "tertiary";
  label: "session" | "weekly" | "tertiary";
  usedPercent?: number;
  remainingPercent?: number;
  windowMinutes?: number;
  resetsAt?: string;
  resetDescription?: string;
}

export interface CodexBarQuotaPayload {
  available: boolean;
  sourceLabel?: string;
  windows: LocalUsageWindowPayload[];
  creditsRemaining?: number;
  accountLabel?: string;
  updatedAt?: string;
  message?: string;
  installHint?: LocalUsageInstallHintPayload;
}

export interface LocalUsageSessionPayload {
  sessionId: string;
  model?: string;
  startedAt?: string;
  lastActivityAt: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface LocalUsageSummaryPayload {
  windowDays: number;
  sessionCount: number;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface LocalProviderUsageTelemetryPayload {
  providerId: string;
  status: ProviderUsageSnapshotPayload["status"];
  fetchedAt: string;
  message?: string;
  quota: CodexBarQuotaPayload;
  summary: LocalUsageSummaryPayload;
  sessions: LocalUsageSessionPayload[];
}

export interface GatewayGetLocalUsageTelemetryResponsePayload {
  telemetry: LocalProviderUsageTelemetryPayload[];
  generatedAt: string;
}

export interface GatewayGetProviderSettingsResponsePayload {
  settings: ProviderRuntimeConfigPayload;
}

export interface GatewaySetProviderConfigResponsePayload {
  config: ProviderRuntimeConfigPayload;
}

export interface GatewayUpdateProviderSettingsResponsePayload {
  settings: ProviderRuntimeConfigPayload;
}

export interface GatewayRemoveProviderConfigResponsePayload {
  providerId: string;
}

export interface GatewayFactoryResetResponsePayload {
  gatewayId: string;
  gatewayUuid?: string;
  resetAt: string;
  tablesCleared: number;
  rowsDeleted: number;
}

export interface SpaceResetResponsePayload {
  spaceId: string;
  resetAt: string;
  tablesCleared: number;
  rowsDeleted: number;
}

export interface GatewayProvisionLocalProfileResponsePayload {
  profileId: string;
  profileName: string;
  created: boolean;
  providerId: string;
  model: string;
  agentId?: string;
  assignmentCreated?: boolean;
}

export interface GatewaySecretRefPayload {
  secretRef: string;
  providerId: string;
  label: string;
  backend: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface GatewayPutSecretRefPayload {
  apiVersion?: string;
  secretRef?: string;
  providerId: string;
  label?: string;
  secret: string;
  backend?: string;
}

export interface GatewayPutSecretRefResponsePayload {
  secretRef: GatewaySecretRefPayload;
  created: boolean;
}

export interface GatewayListSecretRefsPayload {
  apiVersion?: string;
  providerId?: string;
}

export interface GatewayListSecretRefsResponsePayload {
  secretRefs: GatewaySecretRefPayload[];
}

export interface GatewayDeleteSecretRefPayload {
  apiVersion?: string;
  secretRef: string;
}

export interface GatewayDeleteSecretRefResponsePayload {
  secretRef: string;
  deleted: boolean;
}
