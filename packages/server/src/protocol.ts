/**
 * Gateway WebSocket protocol — message types exchanged between
 * the gateway server and connected clients (native app, adapter, CLI).
 *
 * Legacy compatibility note:
 * `proto/` is now the canonical cross-process contract source of truth.
 * This file remains the JSON transport envelope + compatibility surface for
 * the existing WebSocket stack while clients migrate to generated contracts.
 *
 * All messages are JSON-encoded. Binary payloads (audio, etc.) use
 * a separate binary channel identified by message ID.
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface GatewayMessage<T = unknown> {
  /** Message type discriminator. */
  type: string;
  /** Unique message ID for correlation / idempotency. */
  id: string;
  /** If this is a response, the ID of the request it replies to. */
  replyTo?: string;
  /** ISO timestamp. */
  ts: string;
  /** Payload — shape depends on type. */
  payload: T;
}

// ---------------------------------------------------------------------------
// Client → Gateway
// ---------------------------------------------------------------------------

export interface AuthenticatePayload {
  /** Ed25519 public key (base64). */
  publicKey: string;
  /** Signed challenge response (base64). */
  signature: string;
  /** Client identity hint (e.g. "macOS-app", "cli", "adapter"). */
  clientType: string;
  clientVersion: string;
  /** Optional stable device identifier for zero-trust device lifecycle controls. */
  deviceId?: string;
  /** Optional device identity public key. */
  devicePublicKey?: string;
  /** Optional signature proving possession of device key material. */
  deviceProofSignature?: string;
}

export interface ExecuteTurnPayload {
  spaceUid: string;
  input: string;
  /** Optionally target a specific agent. */
  targetAgentId?: string;
  /** Optional turn ID this is a reply to (threading). */
  replyToTurnId?: string;
}

export interface ResumeFeedbackPayload {
  spaceUid: string;
  turnId: string;
  response: "approve" | "reject" | "revise" | "defer";
  revision?: string;
}

export interface SubscribePayload {
  /** Space UIDs to subscribe to for real-time events. */
  spaceUids: string[];
}

export interface SubscribeDeniedSpace {
  spaceUid: string;
  reason: string;
}

export interface SubscribeResponsePayload {
  subscribedSpaceUids: string[];
  denied: SubscribeDeniedSpace[];
}

export interface CapabilityInvokePayload {
  capability: string;
  method: string;
  params: Record<string, unknown>;
  targetProvider?: string;
}

/**
 * Space admin: create a new space.
 */
export interface SpaceCreatePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId?: string;
  workspaceRoot?: string;
  resourceId: string;
  spaceType?: string;
  name: string;
  goal?: string;
  turnModel?: string;
  templateId?: string;
  templateRevision?: number;
  capabilities?: string[];
  capabilityOverrides?: Record<string, string>;
  visibility?: "shared" | "private";
  turnModelConfig?: Record<string, unknown>;
  maxTurns?: number;
  moderatorProfileId?: string;
  initialAgents?: SpaceAddAgentPayload[];
}

/**
 * Space admin: fetch a single space by ID.
 */
export interface SpaceGetPayload {
  apiVersion?: string;
  spaceId: string;
}

/**
 * Space admin: list spaces.
 */
export interface SpaceListPayload {
  apiVersion?: string;
  statuses?: string[];
  resourceId?: string;
  limit?: number;
}

/**
 * Space admin: add an agent assignment.
 */
export interface SpaceAddAgentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScope?: Record<string, unknown>;
  spawnContext?: string;
  contextOverrides?: Record<string, unknown>;
  role?: "participant" | "global_coordinator" | "space_moderator";
  turnOrder?: number;
  isPrimary?: boolean;
}

/**
 * Space admin: remove an assignment.
 */
export interface SpaceRemoveAgentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
}

/**
 * Space admin: update assignment fields.
 */
export interface SpaceUpdateAgentAssignmentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
  profileId?: string;
  securityScope?: Record<string, unknown> | null;
  spawnContext?: string | null;
  contextOverrides?: Record<string, unknown> | null;
  role?: "participant" | "global_coordinator" | "space_moderator";
  turnOrder?: number;
  isPrimary?: boolean;
  /**
   * Force runtime usage-session replacement for this assignment even when profileId is unchanged.
   * Intended for runtime/model swaps that keep the same profile binding.
   */
  resetSession?: boolean;
}

/**
 * Space admin: set orchestrator profile for a space.
 */
export interface SpaceSetOrchestratorPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  profileId: string;
}

/**
 * Space admin: list assignments for one space.
 */
export interface SpaceListAgentAssignmentsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceGetMcpEndpointPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceSetMcpEndpointPayload {
  apiVersion?: string;
  spaceId: string;
  transport: "sse" | "stdio";
  endpoint: string;
  args?: string[];
  secretRef?: string;
  enabled?: boolean;
}

export interface SpaceClearMcpEndpointPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceDiscoverMcpAgentsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceApproveMcpAgentPayload {
  apiVersion?: string;
  spaceId: string;
  remoteAgentId: string;
  displayName?: string;
  agentId?: string;
  profileId?: string;
}

/**
 * Space admin: assign a skill to a space.
 */
export interface SpaceAddSkillPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  skillId: string;
}

/**
 * Space admin: remove a skill from a space.
 */
export interface SpaceRemoveSkillPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  skillId: string;
}

/**
 * Space admin: list skills assigned to one space.
 */
export interface SpaceListSkillsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceWorkspacePayload {
  spaceId: string;
  spaceUid: string;
  mode: "managed" | "folder_bound";
  explicitWorkspaceRoot?: string;
  effectiveWorkspaceRoot: string;
  metaPath: string;
  logsPath: string;
  workPath: string;
  sharedContextPath: string;
  scratchpadsPath: string;
  layoutVersion: number;
  gitRepoDetected: boolean;
  metadataStatus: "unknown" | "ready" | "conflict";
  updatedAt: string;
}

export interface SpaceSetWorkspacePayload {
  apiVersion?: string;
  spaceId: string;
  workspaceRoot?: string | null;
}

export interface SpaceGetWorkspacePayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceGetWorkspaceResponsePayload {
  workspace: SpaceWorkspacePayload;
}

export interface SpaceSetWorkspaceResponsePayload {
  workspace: SpaceWorkspacePayload;
}

export interface SpaceResourcePayload {
  resourceId: string;
  spaceId: string;
  spaceUid: string;
  uri: string;
  type: "folder" | "url";
  label?: string;
  addedAt: string;
}

export interface SpaceAddResourcePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  resourceId?: string;
  spaceId: string;
  uri: string;
  type: "folder" | "url";
  label?: string;
}

export interface SpaceAddResourceResponsePayload {
  resource: SpaceResourcePayload;
}

export interface SpaceRemoveResourcePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  resourceId: string;
}

export interface SpaceRemoveResourceResponsePayload {
  removed: boolean;
  spaceId: string;
  spaceUid: string;
  resourceId: string;
}

export interface SpaceListResourcesPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceListResourcesResponsePayload {
  spaceId: string;
  spaceUid: string;
  resources: SpaceResourcePayload[];
}

export interface SpaceListTurnsPayload {
  apiVersion?: string;
  spaceId?: string;
  spaceUid?: string;
  limit?: number;
  offset?: number;
  /** When provided, return only turns created after this turn ID (cursor-based delta read). */
  lastSeenTurnId?: string;
}

export interface SpaceTurnPayload {
  turnId: string;
  agentId: string;
  status: string;
  inputText?: string;
  outputText?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  createdAt: string;
  completedAt?: string;
  /** Turn ID this is a reply to, if threaded. */
  replyToTurnId?: string;
}

export interface SpaceListTurnsResponsePayload {
  spaceId: string;
  spaceUid: string;
  turns: SpaceTurnPayload[];
  total: number;
  nextOffset?: number;
}

export interface SpaceListOrchestrationJournalPayload {
  apiVersion?: string;
  spaceId?: string;
  spaceUid?: string;
  turnId?: string;
  limit?: number;
  offset?: number;
}

export interface OrchestrationJournalEntryPayload {
  eventId: string;
  spaceId: string;
  spaceUid: string;
  turnId?: string;
  seq: number;
  eventType: string;
  actorId: string;
  lineageId?: string;
  hopCount: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SpaceListOrchestrationJournalResponsePayload {
  spaceId: string;
  spaceUid: string;
  entries: OrchestrationJournalEntryPayload[];
  total: number;
  nextOffset?: number;
}

export interface SpaceAddSkillResponsePayload {
  spaceId: string;
  spaceUid: string;
  skillId: string;
  skills: string[];
  space?: unknown;
}

export interface SpaceRemoveSkillResponsePayload {
  removed: boolean;
  spaceId: string;
  spaceUid: string;
  skillId: string;
  skills: string[];
  space?: unknown;
}

export interface SpaceListSkillsResponsePayload {
  spaceId: string;
  spaceUid: string;
  skills: string[];
}

export interface SpaceAssignmentSummary {
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScope?: Record<string, unknown>;
  spawnContext?: string;
  contextOverrides?: Record<string, unknown>;
  role: "participant" | "global_coordinator" | "space_moderator";
  turnOrder: number;
  isPrimary: boolean;
  assignedAt: string | Date;
  runtimeKind?: "local" | "external_mcp";
  endpointId?: string;
  remoteAgentId?: string;
  displayName?: string;
}

export interface SpaceMcpEndpointPayload {
  endpointId: string;
  spaceId: string;
  transport: "sse" | "stdio";
  endpoint: string;
  args: string[];
  secretRef?: string;
  enabled: boolean;
  healthStatus: "unknown" | "ok" | "degraded" | "error";
  healthMessage?: string;
  lastConnectedAt?: string;
  lastErrorAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceGetMcpEndpointResponsePayload {
  spaceId: string;
  endpoint?: SpaceMcpEndpointPayload;
  fallbackEnabled: boolean;
}

export interface SpaceSetMcpEndpointResponsePayload {
  endpoint: SpaceMcpEndpointPayload;
}

export interface SpaceClearMcpEndpointResponsePayload {
  spaceId: string;
  cleared: boolean;
}

export interface McpDiscoveredAgentPayload {
  remoteAgentId: string;
  displayName: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SpaceDiscoverMcpAgentsResponsePayload {
  spaceId: string;
  endpointId?: string;
  agents: McpDiscoveredAgentPayload[];
}

export interface ExternalAgentRuntimeBindingPayload {
  runtimeKind: "external_mcp";
  spaceId: string;
  agentId: string;
  endpointId: string;
  remoteAgentId: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceApproveMcpAgentResponsePayload {
  spaceId: string;
  assignment: SpaceAssignmentSummary;
  binding: ExternalAgentRuntimeBindingPayload;
}

export interface SpaceSummary {
  id: string;
  spaceUid: string;
  workspace?: SpaceWorkspacePayload;
  resourceId: string;
  name: string;
  goal?: string;
  orchestratorProfileId?: string;
  templateId?: string;
  turnModel: string;
  turnModelConfig?: Record<string, unknown>;
  skillIds?: string[];
  agents: SpaceAssignmentSummary[];
  capabilities: string[];
  capabilityOverrides: Record<string, string>;
  maxTurns?: number;
  visibility: "shared" | "private";
  moderatorProfileId?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ProfileModelConfigPayload {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
}

export interface ProfileSummaryPayload {
  profileId: string;
  name: string;
  description: string;
  personalityPrompt: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfigPayload;
  canModerate: boolean;
  isDefault: boolean;
  status: "active" | "archived";
  activeRevision: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCreatePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  profileId?: string;
  name: string;
  description?: string;
  personalityPrompt?: string;
  defaultSkillIds?: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfigPayload;
  canModerate?: boolean;
  isDefault?: boolean;
}

export interface ProfileCreateResponsePayload {
  profile: ProfileSummaryPayload;
  created: boolean;
}

export interface ProfileGetPayload {
  apiVersion?: string;
  profileId: string;
}

export interface ProfileGetResponsePayload {
  profile: ProfileSummaryPayload;
}

export interface ProfileListPayload {
  apiVersion?: string;
  includeArchived?: boolean;
}

export interface ProfileListResponsePayload {
  profiles: ProfileSummaryPayload[];
}

export interface ProfileUpdatePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  profileId: string;
  name?: string;
  description?: string;
  personalityPrompt?: string;
  defaultSkillIds?: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfigPayload;
  canModerate?: boolean;
  isDefault?: boolean;
}

export interface ProfileUpdateResponsePayload {
  profile: ProfileSummaryPayload;
  newRevision: number;
}

export interface ProfileArchivePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  profileId: string;
}

export interface ProfileArchiveResponsePayload {
  profile: ProfileSummaryPayload;
  archived: boolean;
}

export type PresetKindPayload = "agent" | "space";
export type PresetSourcePayload = "system" | "user";
export type CommunicationModePayload = "async_notes" | "chat_first" | "structured_handoff";

export interface TemplateAgentDefinitionPayload {
  agentId: string;
  profileId: string;
  role?: "participant" | "global_coordinator" | "space_moderator";
  turnOrder?: number;
  isPrimary?: boolean;
}

export interface SpacePresetConfigPayload {
  communicationMode: CommunicationModePayload;
  turnModel: string;
  baseAgents: TemplateAgentDefinitionPayload[];
  agentPresetIds: string[];
}

export interface AgentPresetConfigPayload {
  defaultAgents: TemplateAgentDefinitionPayload[];
}

export interface PresetSummaryPayload {
  presetId: string;
  kind: PresetKindPayload;
  title: string;
  description: string;
  source: PresetSourcePayload;
  version: number;
  tags: string[];
}

export interface PresetDetailPayload extends PresetSummaryPayload {
  spacePreset?: SpacePresetConfigPayload;
  agentPreset?: AgentPresetConfigPayload;
}

export interface PresetListPayload {
  apiVersion?: string;
  kind?: PresetKindPayload | "all";
  source?: PresetSourcePayload | "all";
  tags?: string[];
}

export interface PresetListResponsePayload {
  presets: PresetSummaryPayload[];
}

export interface PresetGetPayload {
  apiVersion?: string;
  presetId: string;
}

export interface PresetGetResponsePayload {
  preset: PresetDetailPayload;
}

export interface PresetApplyToSpacePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  presetId: string;
  targetSpaceId?: string;
  spaceId?: string;
  resourceId?: string;
  name?: string;
  goal?: string;
  visibility?: "shared" | "private";
  workspaceRoot?: string;
}

export interface PresetApplyToSpaceResponsePayload {
  applicationId: string;
  presetId: string;
  spaceId: string;
  createdSpace: boolean;
  appliedAgents: number;
  skippedAgents: number;
  appliedAt: string;
  space: SpaceSummary;
}

export interface PresetSaveAgentPayload {
  apiVersion?: string;
  presetId?: string;
  title: string;
  description?: string;
  defaultAgents?: TemplateAgentDefinitionPayload[];
  tags?: string[];
}

export interface PresetSaveAgentResponsePayload {
  preset: PresetDetailPayload;
  created: boolean;
}

export interface PresetArchiveAgentPayload {
  apiVersion?: string;
  presetId: string;
}

export interface PresetArchiveAgentResponsePayload {
  presetId: string;
  archived: boolean;
}

export interface SpaceTemplateSummaryPayload {
  templateId: string;
  title: string;
  communicationMode: CommunicationModePayload;
  agentPresetIds: string[];
  createdBy: string;
  updatedAt: string;
}

export interface SpacePreviewTemplatePayload {
  apiVersion?: string;
  templateId: string;
  resourceId?: string;
  name?: string;
  goal?: string;
}

export interface SpacePreviewTemplateResponsePayload {
  template: SpaceTemplateSummaryPayload;
  resolved: {
    templateId: string;
    templateRevision: number;
    name: string;
    goal?: string;
    resourceId: string;
    communicationMode: CommunicationModePayload;
    turnModel: string;
    initialAgents: TemplateAgentDefinitionPayload[];
  };
  warnings: string[];
}

export interface SpaceCreateFromTemplatePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  templateId: string;
  spaceId?: string;
  resourceId: string;
  name?: string;
  goal?: string;
  visibility?: "shared" | "private";
  workspaceRoot?: string;
}

export interface SpaceCreateFromTemplateResponsePayload {
  template: SpaceTemplateSummaryPayload;
  space: SpaceSummary;
}

export interface SpaceSaveTemplatePayload {
  apiVersion?: string;
  templateId?: string;
  title: string;
  description?: string;
  communicationMode?: CommunicationModePayload;
  baseAgents?: TemplateAgentDefinitionPayload[];
  agentPresetIds?: string[];
  sourceSpaceId?: string;
  tags?: string[];
}

export interface SpaceSaveTemplateResponsePayload {
  template: SpaceTemplateSummaryPayload;
  created: boolean;
}

export interface DeviceIdentityPayload {
  deviceId: string;
  principalId: string;
  publicKey: string;
  platform?: string;
  keyVersion: string;
  status: "active" | "revoked" | "rotated";
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

export interface AuthRegisterDevicePayload {
  apiVersion?: string;
  deviceId: string;
  publicKey: string;
  platform?: string;
}

export interface AuthRegisterDeviceResponsePayload {
  device: DeviceIdentityPayload;
  created: boolean;
}

export interface AuthRotateDeviceKeyPayload {
  apiVersion?: string;
  deviceId: string;
  nextPublicKey: string;
  platform?: string;
}

export interface AuthRotateDeviceKeyResponsePayload {
  device: DeviceIdentityPayload;
}

export interface AuthRevokeDevicePayload {
  apiVersion?: string;
  deviceId: string;
}

export interface AuthRevokeDeviceResponsePayload {
  deviceId: string;
  revoked: boolean;
  device?: DeviceIdentityPayload;
}

export interface AuthListDevicesPayload {
  apiVersion?: string;
  includeRevoked?: boolean;
}

export interface AuthListDevicesResponsePayload {
  devices: DeviceIdentityPayload[];
}

export interface AuthIssueHttpPrincipalTokenPayload {
  apiVersion?: string;
  /**
   * Requested token lifetime in seconds.
   * The gateway may clamp this to an allowed range.
   */
  ttlSeconds?: number;
}

export interface AuthIssueHttpPrincipalTokenResponsePayload {
  token: string;
  tokenType: "Bearer";
  principalId: string;
  deviceId?: string;
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Gateway admin: discover locally installed execution clients.
 */
export interface GatewayDiscoverLocalAgentsPayload {
  apiVersion?: string;
}

/**
 * Gateway admin: list model runtime configurations.
 */
export interface GatewayListProviderConfigsPayload {
  apiVersion?: string;
}

export type MainAgentSelectionMode = "provider_model" | "profile_template";

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
  sourceProfileId?: string;
  copyPersonality?: boolean;
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

/**
 * Gateway admin: discover models available for configured runtimes.
 */
export interface GatewayListAvailableModelsPayload {
  apiVersion?: string;
  providerId?: string;
}

/**
 * Gateway admin: list runtime catalogs grouped by integration class.
 */
export interface GatewayListProviderCatalogsPayload {
  apiVersion?: string;
  providerId?: string;
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

/**
 * Gateway admin: read telemetry for configured runtimes.
 */
export interface GatewayGetProviderTelemetryPayload {
  apiVersion?: string;
  providerId?: string;
}

/**
 * Gateway admin: read local runtime usage telemetry with local sessions/tokens + quota windows.
 */
export interface GatewayGetLocalUsageTelemetryPayload {
  apiVersion?: string;
  providerId?: string;
}

/**
 * Gateway admin: fetch full runtime settings for one configured runtime.
 */
export interface GatewayGetProviderSettingsPayload {
  apiVersion?: string;
  providerId: string;
}

/**
 * Gateway admin: update one runtime configuration.
 */
export interface GatewaySetProviderConfigPayload {
  apiVersion?: string;
  providerId: string;
  model?: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  baseURL?: string;
  allowedModels?: string[];
  allowCustomModel?: boolean;
  nativeCliToolsEnabled?: boolean;
}

/**
 * Gateway admin: update gateway-level runtime settings (catalog + allowlist).
 */
export interface GatewayUpdateProviderSettingsPayload {
  apiVersion?: string;
  providerId: string;
  model?: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  baseURL?: string;
  allowedModels?: string[];
  allowCustomModel?: boolean;
  nativeCliToolsEnabled?: boolean;
}

/**
 * Gateway admin: remove one runtime configuration.
 */
export interface GatewayRemoveProviderConfigPayload {
  apiVersion?: string;
  providerId: string;
}

/**
 * Gateway admin: destructive factory reset for one gateway runtime.
 */
export interface GatewayFactoryResetPayload {
  apiVersion?: string;
  confirmation: string;
}

export interface SpaceResetPayload {
  apiVersion?: string;
  spaceId: string;
}

/**
 * Gateway admin: provision a profile for a discovered local client.
 */
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
  allowedModels: string[];
  allowCustomModel: boolean;
  nativeCliToolsEnabled: boolean;
  updatedAt: string;
  source: "env" | "runtime";
}

export type GatewayModelDetectionStatusPayload = "available" | "unavailable" | "error";
export type GatewayModelCatalogSourcePayload = "detected" | "configured" | "fallback" | "allowlist";
export type GatewayProviderCatalogGroupPayload = "cloud" | "executor" | "local_runtime";
export type GatewayIntegrationClassPayload = "cloud" | "executor" | "local_runtime";
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
}

export interface GatewayModelProviderCatalogPayload {
  providerId: string;
  displayName: string;
  group: GatewayProviderCatalogGroupPayload;
  integrationClass: GatewayIntegrationClassPayload;
  status: GatewayIntegrationStatusPayload;
  hasApiKey: boolean;
  requiresApiKey: boolean;
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

export interface GatewayGetMainAgentResponsePayload {
  state: GatewayMainAgentStatePayload;
}

export interface GatewaySetMainAgentResponsePayload {
  state: GatewayMainAgentStatePayload;
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

/**
 * Connector control plane: 3-tier connector model.
 */

export type ConnectorKindPayload = "channel" | "capability" | "hybrid";
export type ConnectorRuntimePayload = "adapter" | "connector" | "builtin";
export type ConnectorTrustClassPayload = "embedded_safe" | "external_only";
export type ConnectorInstanceStatusPayload = "active" | "paused" | "error";
export type ConnectorBindingTypePayload = "inbound_route" | "outbound_action" | "capability_export";
export type ConnectorBindingTargetPayload = "main_orchestrator" | "space_orchestrator";
export type ConnectorActionPayload = "notify" | "send_message" | "send_media" | "send_reaction";

export interface GatewayListConnectorFamiliesPayload {
  apiVersion?: string;
}

export interface GatewayConnectorFamilyPayload {
  familyId: string;
  displayName: string;
  kind: ConnectorKindPayload;
  runtime: ConnectorRuntimePayload;
  trustClass: ConnectorTrustClassPayload;
  embeddedEnabled: boolean;
  capabilityTypes: string[];
  features: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListConnectorFamiliesResponsePayload {
  families: GatewayConnectorFamilyPayload[];
}

export interface GatewayListConnectorsPayload {
  apiVersion?: string;
  familyId?: string;
}

export interface GatewayConnectorSecretRefPayload {
  key: string;
  ref: string;
  backend?: string;
}

export interface GatewayUpsertConnectorPayload {
  apiVersion?: string;
  connectorId?: string;
  familyId: string;
  displayName: string;
  accountFingerprint: string;
  label: string;
  status?: ConnectorInstanceStatusPayload;
  metadata?: Record<string, unknown>;
  secretRefs?: GatewayConnectorSecretRefPayload[];
}

export interface GatewayConnectorPayload {
  connectorId: string;
  familyId: string;
  displayName: string;
  accountFingerprintHash: string;
  labelSlug: string;
  status: ConnectorInstanceStatusPayload;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListConnectorsResponsePayload {
  connectors: GatewayConnectorPayload[];
}

export interface GatewayUpsertConnectorResponsePayload {
  connector: GatewayConnectorPayload;
}

export interface GatewayRemoveConnectorPayload {
  apiVersion?: string;
  connectorId: string;
}

export interface GatewayRemoveConnectorResponsePayload {
  connectorId: string;
  removed: boolean;
}

export interface GatewayListConnectorBindingsPayload {
  apiVersion?: string;
  connectorId?: string;
}

export interface GatewayUpsertConnectorBindingPayload {
  apiVersion?: string;
  bindingId?: string;
  connectorId: string;
  bindingType: ConnectorBindingTypePayload;
  selector?: Record<string, unknown>;
  targetType: ConnectorBindingTargetPayload;
  targetSpaceId?: string;
  allowedActions?: ConnectorActionPayload[];
  capabilityTypes?: string[];
  priority?: number;
  enabled?: boolean;
}

export interface GatewayConnectorBindingPayload {
  bindingId: string;
  connectorId: string;
  bindingType: ConnectorBindingTypePayload;
  selector: Record<string, unknown>;
  targetType: ConnectorBindingTargetPayload;
  targetSpaceId?: string;
  allowedActions: ConnectorActionPayload[];
  capabilityTypes: string[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListConnectorBindingsResponsePayload {
  bindings: GatewayConnectorBindingPayload[];
}

export interface GatewayUpsertConnectorBindingResponsePayload {
  binding: GatewayConnectorBindingPayload;
}

export interface GatewayRemoveConnectorBindingPayload {
  apiVersion?: string;
  bindingId: string;
}

export interface GatewayRemoveConnectorBindingResponsePayload {
  bindingId: string;
  removed: boolean;
}

export interface GatewayConnectorPolicyPayload {
  scopeType: "global" | "family" | "instance";
  scopeId: string;
  requestsPerMinute: number;
  burst: number;
  disabled: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface GatewayGetConnectorPolicyPayload {
  apiVersion?: string;
  scopeType: "global" | "family" | "instance";
  scopeId: string;
}

export interface GatewayGetConnectorPolicyResponsePayload {
  policy: GatewayConnectorPolicyPayload;
}

export interface GatewayUpdateConnectorPolicyPayload {
  apiVersion?: string;
  scopeType: "global" | "family" | "instance";
  scopeId: string;
  requestsPerMinute?: number;
  burst?: number;
  disabled?: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
}

export interface GatewayUpdateConnectorPolicyResponsePayload {
  policy: GatewayConnectorPolicyPayload;
}

export interface GatewayTestConnectorPayload {
  apiVersion?: string;
  connectorId: string;
}

export interface GatewayTestConnectorResponsePayload {
  ok: boolean;
  reason?: string;
  connector?: GatewayConnectorPayload;
  inboundRoute?: {
    route: "binding" | "main_fallback";
    targetType: ConnectorBindingTargetPayload;
    targetSpaceId?: string;
    bindingId?: string;
    matchedScore?: number;
  };
  policy?: GatewayConnectorPolicyPayload;
}

/**
 * Usage: polling-friendly snapshot for windows + budget state.
 */
export interface UsageGetSnapshotPayload {
  apiVersion?: string;
}

export interface UsageWindowSummaryPayload {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface BudgetSummaryPayload {
  softCapUsd: number;
  hardCapUsd: number;
  warningThreshold: number;
  spentUsd: number;
  leftUsd: number;
}

export interface ProviderUsageSnapshotPayload {
  providerId: string;
  status: "available" | "unavailable" | "unknown";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
  message?: string;
}

export interface VoiceUsageWindowSummaryPayload {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
  estimatedCostUsd: number;
}

export interface VoiceUsageSourceSummaryPayload {
  source: "managed" | "byok" | "local_model" | "apple_speech" | "unknown";
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
  estimatedCostUsd: number;
}

export interface VoiceUsageLockSummaryPayload {
  enabled: boolean;
  managedSttSecondsMonthlyLimit?: number;
  managedTtsCharsMonthlyLimit?: number;
  managedTtsSecondsMonthlyLimit?: number;
  managedCurrentMonthSttSeconds?: number;
  managedCurrentMonthTtsChars?: number;
  managedCurrentMonthTtsSeconds?: number;
}

export interface VoiceUsageSnapshotPayload {
  windows: {
    last5h: VoiceUsageWindowSummaryPayload;
    last7d: VoiceUsageWindowSummaryPayload;
    last30d: VoiceUsageWindowSummaryPayload;
    lifetime: VoiceUsageWindowSummaryPayload;
  };
  bySource: VoiceUsageSourceSummaryPayload[];
  lock?: VoiceUsageLockSummaryPayload;
}

export interface UsageSnapshotPayload {
  computedAt: string;
  currency: "USD";
  windows: {
    last5h: UsageWindowSummaryPayload;
    last7d: UsageWindowSummaryPayload;
    last30d: UsageWindowSummaryPayload;
    lifetime: UsageWindowSummaryPayload;
  };
  budget: BudgetSummaryPayload;
  providerUsage: ProviderUsageSnapshotPayload[];
  voice?: VoiceUsageSnapshotPayload;
}

export interface UsageGetSnapshotResponsePayload {
  snapshot: UsageSnapshotPayload;
}

/**
 * Gateway policy management.
 */
export interface GatewayPolicyPayload {
  allowedCapabilityTypes: string[];
  deniedCapabilityTypes: string[];
  allowedSkillIds: string[];
  deniedSkillIds: string[];
  globalFlags: Record<string, unknown>;
  updatedAt: string;
}

export interface GatewayGetPolicyPayload {
  apiVersion?: string;
}

export interface GatewayGetPolicyResponsePayload {
  policy: GatewayPolicyPayload;
}

export interface GatewayUpdatePolicyPayload {
  apiVersion?: string;
  allowedCapabilityTypes?: string[];
  deniedCapabilityTypes?: string[];
  allowedSkillIds?: string[];
  deniedSkillIds?: string[];
  globalFlags?: Record<string, unknown>;
}

export interface GatewayUpdatePolicyResponsePayload {
  policy: GatewayPolicyPayload;
}

/**
 * Gateway skill catalog management.
 */
export type GatewaySkillStatusPayload = "active" | "archived";

export interface GatewaySkillEntryPayload {
  skillId: string;
  name: string;
  description?: string;
  contentMarkdown: string;
  sourceRef?: string;
  tags: string[];
  status: GatewaySkillStatusPayload;
  createdAt: string;
  updatedAt: string;
}

export interface GatewaySkillListPayload {
  apiVersion?: string;
  query?: string;
  tags?: string[];
  status?: GatewaySkillStatusPayload | "all";
  limit?: number;
}

export interface GatewaySkillListResponsePayload {
  skills: GatewaySkillEntryPayload[];
}

export interface GatewaySkillGetPayload {
  apiVersion?: string;
  skillId: string;
}

export interface GatewaySkillGetResponsePayload {
  skill: GatewaySkillEntryPayload;
}

export interface GatewaySkillUpsertPayload {
  apiVersion?: string;
  skillId?: string;
  name: string;
  description?: string;
  contentMarkdown: string;
  sourceRef?: string;
  tags?: string[];
  status?: GatewaySkillStatusPayload;
}

export interface GatewaySkillUpsertResponsePayload {
  skill: GatewaySkillEntryPayload;
  created: boolean;
}

export interface GatewaySkillDeletePayload {
  apiVersion?: string;
  skillId: string;
}

export interface GatewaySkillDeleteResponsePayload {
  skillId: string;
  deleted: boolean;
}

/**
 * Gateway knowledge base management (documentation references).
 */
export type GatewayKnowledgeBaseEntryKindPayload = "web" | "file" | "folder";
export type GatewayKnowledgeBaseScopeTypePayload = "global" | "space";

export interface GatewayKnowledgeBaseEntryPayload {
  entryId: string;
  name: string;
  kind: GatewayKnowledgeBaseEntryKindPayload;
  uri: string;
  description?: string;
  tags: string[];
  scopeType: GatewayKnowledgeBaseScopeTypePayload;
  spaceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListKnowledgeBaseEntriesPayload {
  apiVersion?: string;
  spaceId?: string;
  query?: string;
  tags?: string[];
  kinds?: GatewayKnowledgeBaseEntryKindPayload[];
  limit?: number;
}

export interface GatewayListKnowledgeBaseEntriesResponsePayload {
  entries: GatewayKnowledgeBaseEntryPayload[];
}

export interface GatewayUpsertKnowledgeBaseEntryPayload {
  apiVersion?: string;
  entryId?: string;
  name: string;
  kind: GatewayKnowledgeBaseEntryKindPayload;
  uri: string;
  description?: string;
  tags?: string[];
  scopeType: GatewayKnowledgeBaseScopeTypePayload;
  spaceId?: string;
}

export interface GatewayUpsertKnowledgeBaseEntryResponsePayload {
  entry: GatewayKnowledgeBaseEntryPayload;
}

export interface GatewayDeleteKnowledgeBaseEntryPayload {
  apiVersion?: string;
  entryId: string;
}

export interface GatewayDeleteKnowledgeBaseEntryResponsePayload {
  entryId: string;
  deleted: boolean;
}

/**
 * Gateway capability grant management.
 */
export interface GatewayCapabilityGrantPayload {
  principalId: string;
  deviceId: string;
  capabilityId: string;
  level: "read" | "write" | "execute";
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  updatedAt: string;
}

export interface GatewayListCapabilityGrantsPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId?: string;
  includeRevoked?: boolean;
  includeExpired?: boolean;
}

export interface GatewayListCapabilityGrantsResponsePayload {
  grants: GatewayCapabilityGrantPayload[];
}

export interface GatewayGrantCapabilityPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId?: string;
  capabilityId: string;
  reason?: string;
  expiresAt?: string;
}

export interface GatewayGrantCapabilityResponsePayload {
  grant: GatewayCapabilityGrantPayload;
}

export interface GatewayRevokeCapabilityPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId?: string;
  capabilityId: string;
  reason?: string;
}

export interface GatewayRevokeCapabilityResponsePayload {
  revoked: boolean;
  capabilityId: string;
  principalId: string;
  deviceId: string;
  grant?: GatewayCapabilityGrantPayload;
}

/**
 * Gateway scheduler management.
 */
export type SchedulerJobStatusPayload = "active" | "paused" | "invalid";
export type SchedulerRunStatusPayload = "running" | "completed" | "failed" | "skipped";
export type SchedulerRunTriggerPayload = "scheduled" | "manual";
export type SchedulerScheduleKindPayload = "hourly" | "daily" | "weekly";
export type SchedulerActionTypePayload = "space_prompt";

export interface SchedulerSchedulePresetPayload {
  kind: SchedulerScheduleKindPayload;
  intervalHours?: number;
  minute: number;
  hour?: number;
  daysOfWeek?: number[];
}

export interface SchedulerActionPayload {
  type: SchedulerActionTypePayload;
  promptText: string;
  targetAgentId?: string;
}

export interface SchedulerLinkedSpacePayload {
  spaceId: string;
  spaceUid: string;
  name: string;
  isPrimary: boolean;
  linkedAt: string;
}

export interface SchedulerJobPayload {
  jobId: string;
  name: string;
  status: SchedulerJobStatusPayload;
  enabled: boolean;
  cronExpression: string;
  schedulePreset: SchedulerSchedulePresetPayload;
  timezone: string;
  action: SchedulerActionPayload;
  primarySpaceId?: string;
  invalidReason?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunStatus?: SchedulerRunStatusPayload;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
  linkedSpaces: SchedulerLinkedSpacePayload[];
}

export interface SchedulerJobRunPayload {
  runId: string;
  jobId: string;
  trigger: SchedulerRunTriggerPayload;
  status: SchedulerRunStatusPayload;
  commandId?: string;
  scheduledFor?: string;
  startedAt?: string;
  finishedAt?: string;
  skipReason?: string;
  errorCode?: string;
  errorMessage?: string;
  result?: Record<string, unknown>;
}

export interface SchedulerCreateJobPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  name: string;
  timezone: string;
  schedulePreset: SchedulerSchedulePresetPayload;
  action: SchedulerActionPayload;
  primarySpaceId: string;
  relatedSpaceIds?: string[];
}

export interface SchedulerCreateJobResponsePayload {
  job: SchedulerJobPayload;
}

export interface SchedulerGetJobPayload {
  apiVersion?: string;
  jobId: string;
}

export interface SchedulerGetJobResponsePayload {
  job: SchedulerJobPayload;
}

export interface SchedulerListJobsPayload {
  apiVersion?: string;
  statuses?: SchedulerJobStatusPayload[];
  gatewayId?: string;
  limit?: number;
}

export interface SchedulerListJobsResponsePayload {
  jobs: SchedulerJobPayload[];
}

export interface SchedulerUpdateJobPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
  name?: string;
  status?: SchedulerJobStatusPayload;
  timezone?: string;
  schedulePreset?: SchedulerSchedulePresetPayload;
  action?: SchedulerActionPayload;
  primarySpaceId?: string | null;
  relatedSpaceIds?: string[];
}

export interface SchedulerUpdateJobResponsePayload {
  job: SchedulerJobPayload;
}

export interface SchedulerDeleteJobPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
}

export interface SchedulerDeleteJobResponsePayload {
  jobId: string;
  deleted: boolean;
}

export interface SchedulerLinkSpacePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
  spaceId: string;
}

export interface SchedulerLinkSpaceResponsePayload {
  job: SchedulerJobPayload;
}

export interface SchedulerUnlinkSpacePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
  spaceId: string;
}

export interface SchedulerUnlinkSpaceResponsePayload {
  job: SchedulerJobPayload;
}

export interface SchedulerListRunsPayload {
  apiVersion?: string;
  jobId: string;
  limit?: number;
  offset?: number;
}

export interface SchedulerListRunsResponsePayload {
  runs: SchedulerJobRunPayload[];
  total: number;
  nextOffset?: number;
}

export interface SchedulerRunNowPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
}

export interface SchedulerRunNowResponsePayload {
  run: SchedulerJobRunPayload;
  job: SchedulerJobPayload;
}

/**
 * Orchestrator high-level command channel.
 */
export interface OrchestratorCommandPayload {
  apiVersion?: string;
  correlationId?: string;
  idempotencyKey?: string;
  commandType:
    | "list_rooms"
    | "create_room"
    | "list_skills"
    | "create_skill"
    | "handoff_room"
    | "add_agent"
    | "share_context"
    | "run_space_prompt";
  targetSpaceId: string;
  targetAgentId?: string;
  payload?: Record<string, unknown>;
}

export interface OrchestratorGetCommandPayload {
  apiVersion?: string;
  commandId: string;
}

export interface OrchestratorCommandEventPayload {
  status: "accepted" | "running" | "completed" | "failed";
  event: Record<string, unknown>;
  createdAt: string;
}

export interface OrchestratorCommandResultPayload {
  commandId: string;
  correlationId: string;
  apiVersion: string;
  commandType: string;
  targetSpaceId: string;
  targetAgentId?: string;
  status: "accepted" | "running" | "completed" | "failed";
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  updatedAt: string;
  events: OrchestratorCommandEventPayload[];
}

export interface OrchestratorCommandResponsePayload {
  command: OrchestratorCommandResultPayload;
}

/**
 * Cross-space context sharing.
 */
export interface SpaceLinkPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  mode?: string;
}

export interface SpaceUnlinkPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
}

export interface SpaceLinkResponsePayload {
  link: {
    sourceSpaceId: string;
    targetSpaceId: string;
    mode: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface SpaceUnlinkResponsePayload {
  removed: boolean;
  sourceSpaceId: string;
  targetSpaceId: string;
}

export interface SpaceShareContextPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  artifactId: string;
}

export type SpaceShareAccessMode = "read_only" | "collaborator";
export type SpaceShareJoinRoute = "direct" | "relay_proxy";

export interface SpaceInviteLinkPayload {
  version: "v2";
  relayInviteId: string;
  relayUrl: string;
  spaceIdHint?: string;
  spaceUidHint?: string;
  fallbackGatewayUrl?: string;
}

export interface SpaceShareInvitePayload {
  inviteId: string;
  spaceId: string;
  spaceUid: string;
  issuedByPrincipalId: string;
  mode: SpaceShareAccessMode;
  status: "active" | "used" | "revoked" | "expired";
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Present only at invite creation time. */
  inviteToken?: string;
  /** Relay-first share envelope for cross-network joins. */
  inviteLink?: SpaceInviteLinkPayload;
}

export interface SpaceParticipantPayload {
  participantId: string;
  spaceId: string;
  spaceUid: string;
  principalId: string;
  principalType: string;
  mode: SpaceShareAccessMode;
  status: "active" | "revoked";
  joinedViaInviteId?: string;
  deviceId?: string;
  devicePublicKey?: string;
  joinedAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface SpaceShareCreateInvitePayload {
  apiVersion?: string;
  spaceId: string;
  mode: SpaceShareAccessMode;
  expiresInSeconds?: number;
}

export interface SpaceShareCreateInviteResponsePayload {
  invite: SpaceShareInvitePayload;
}

export interface SpaceShareJoinPayload {
  apiVersion?: string;
  spaceId: string;
  inviteToken: string;
  deviceId?: string;
  devicePublicKey?: string;
  identityModeHint?: "device_key" | "strict_apple_id";
  appleIdAssertion?: string;
  joinRoute?: SpaceShareJoinRoute;
  relaySessionToken?: string;
}

export interface SpaceShareJoinResponsePayload {
  participant: SpaceParticipantPayload;
}

export interface SpaceShareRevokePayload {
  apiVersion?: string;
  spaceId: string;
  inviteId?: string;
  participantId?: string;
}

export interface SpaceShareRevokeResponsePayload {
  spaceId: string;
  spaceUid: string;
  inviteId?: string;
  participantId?: string;
  revokedInvite: boolean;
  revokedParticipant: boolean;
}

export interface SpaceShareListParticipantsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceShareListParticipantsResponsePayload {
  spaceId: string;
  spaceUid: string;
  participants: SpaceParticipantPayload[];
}

export type ChangeSetStatusPayload =
  | "draft"
  | "uploaded"
  | "pending_review"
  | "approved"
  | "applied"
  | "rejected"
  | "expired";

export type ChangeSetAdapterPayload = "filesystem" | "git";

export interface ChangeSetPayload {
  changeSetId: string;
  spaceId: string;
  participantId?: string;
  createdByPrincipalId: string;
  status: ChangeSetStatusPayload;
  title?: string;
  description?: string;
  adapter: ChangeSetAdapterPayload;
  targetBranch?: string;
  workspaceBasePath?: string;
  submittedAt?: string;
  reviewedAt?: string;
  appliedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeSetFilePayload {
  relativePath: string;
  stagedPath: string;
  sha256: string;
  sizeBytes: number;
  changeType: "added" | "modified" | "deleted";
  createdAt: string;
}

export interface ChangeSetReviewPayload {
  reviewId: string;
  changeSetId: string;
  reviewerPrincipalId: string;
  decision: "approved" | "rejected";
  comment?: string;
  diffSummary?: Record<string, unknown>;
  createdAt: string;
}

export interface ChangeSetApplyResultPayload {
  changeSetId: string;
  adapter: ChangeSetAdapterPayload;
  appliedPaths: string[];
  rollbackPath: string;
  git?: {
    attempted: boolean;
    commitMessage: string;
    commitHash?: string;
    warning?: string;
  };
}

export interface SpaceCreateChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  title?: string;
  description?: string;
  adapter?: ChangeSetAdapterPayload;
  targetBranch?: string;
  expiresInSeconds?: number;
}

export interface SpaceCreateChangeSetResponsePayload {
  changeSet: ChangeSetPayload;
}

export interface SpaceListChangeSetsPayload {
  apiVersion?: string;
  spaceId: string;
  statuses?: ChangeSetStatusPayload[];
  limit?: number;
  offset?: number;
}

export interface SpaceListChangeSetsResponsePayload {
  spaceId: string;
  changeSets: ChangeSetPayload[];
}

export interface SpaceUploadChangeSetFileInitPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  relativePath: string;
}

export interface SpaceUploadChangeSetFileInitResponsePayload {
  uploadId: string;
  changeSet: ChangeSetPayload;
  relativePath: string;
}

export interface SpaceUploadChangeSetFileCompletePayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  uploadId: string;
  contentBase64?: string;
  sourcePath?: string;
  expectedSha256?: string;
}

export interface SpaceUploadChangeSetFileCompleteResponsePayload {
  changeSet: ChangeSetPayload;
  file: ChangeSetFilePayload;
}

export interface SpaceSubmitChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceSubmitChangeSetResponsePayload {
  changeSet: ChangeSetPayload;
}

export interface SpaceReviewChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  decision: "approved" | "rejected";
  comment?: string;
}

export interface SpaceReviewChangeSetResponsePayload {
  changeSet: ChangeSetPayload;
  review: ChangeSetReviewPayload;
}

export interface SpaceApplyChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceApplyChangeSetResponsePayload {
  changeSet: ChangeSetPayload;
  result: ChangeSetApplyResultPayload;
}

export interface SpaceChangeSetDiffPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceChangeSetDiffResponsePayload {
  changeSetId: string;
  unifiedDiff: string;
  files: Array<{
    relativePath: string;
    changeType: string;
    sizeBytes: number;
  }>;
  generatedAt: string;
}

export interface SpaceQuotaPolicyPayload {
  spaceId: string;
  maxStagingBytes: number;
  maxOpenChangeSets: number;
  maxAppliedChangeSetsPerMonth: number;
  tokenBudget: number;
  maxParticipantStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSetsPerParticipant: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface ParticipantQuotaPolicyPayload {
  spaceId: string;
  principalId: string;
  maxStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSets: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface SpaceUsageSnapshotPayload {
  spaceId: string;
  stagingBytes: number;
  openChangeSets: number;
  appliedChangeSetsPerMonth: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSpendUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
  updatedAt: string;
}

export interface ParticipantUsageSnapshotPayload {
  spaceId: string;
  principalId: string;
  stagingBytes: number;
  uploadsToday: number;
  openChangeSets: number;
  toolCallsPerHour: number;
  updatedAt: string;
}

export interface SpaceGetQuotaPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceGetQuotaResponsePayload {
  spacePolicy: SpaceQuotaPolicyPayload;
  participantPolicy?: ParticipantQuotaPolicyPayload;
}

export interface SpaceUpdateQuotaPolicyPayload {
  apiVersion?: string;
  spaceId: string;
  maxStagingBytes?: number;
  maxOpenChangeSets?: number;
  maxAppliedChangeSetsPerMonth?: number;
  tokenBudget?: number;
  maxParticipantStagingBytes?: number;
  maxUploadsPerDay?: number;
  maxOpenChangeSetsPerParticipant?: number;
  maxToolCallsPerHour?: number;
}

export interface SpaceUpdateQuotaPolicyResponsePayload {
  spacePolicy: SpaceQuotaPolicyPayload;
}

export interface SpaceGetUsagePayload {
  apiVersion?: string;
  spaceId: string;
  includeAgentSessions?: boolean;
  includeGlobalLifetime?: boolean;
}

export interface AgentUsageSessionPayload {
  sessionId: string;
  spaceId: string;
  agentId: string;
  agentRole: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt?: string;
  lastActivityAt: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface SpaceGetUsageResponsePayload {
  spaceUsage: SpaceUsageSnapshotPayload;
  participantUsage?: ParticipantUsageSnapshotPayload;
  agentSessions?: AgentUsageSessionPayload[];
  globalLifetime?: UsageWindowSummaryPayload;
}

export interface SpaceGetTurnTracePayload {
  apiVersion?: string;
  spaceId: string;
  turnId: string;
  limit?: number;
  offset?: number;
}

export interface TurnTraceEventPayload {
  eventId: string;
  seq: number;
  eventType: string;
  eventSubtype?: string;
  agentId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface TurnTraceToolCallPayload {
  toolCallId: string;
  toolName?: string;
  status: "started" | "completed" | "error";
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TurnTracePayload {
  spaceId: string;
  turnId: string;
  total: number;
  events: TurnTraceEventPayload[];
  toolCalls: TurnTraceToolCallPayload[];
  artifactIds: string[];
}

export interface SpaceGetTurnTraceResponsePayload {
  trace: TurnTracePayload;
}

export interface SpaceListArtifactsPayload {
  apiVersion?: string;
  spaceId: string;
  turnId?: string;
  limit?: number;
  offset?: number;
}

export interface SpaceGetArtifactPayload {
  apiVersion?: string;
  spaceId: string;
  artifactId: string;
}

export interface SpaceArtifactSummaryPayload {
  artifactId: string;
  spaceId: string;
  turnId?: string;
  agentId?: string;
  type: string;
  title: string;
  mimeType?: string;
  sizeBytes: number;
  tags: string[];
  visibility: "shared" | "private";
  createdAt: string;
  updatedAt: string;
}

export interface SpaceArtifactDetailPayload extends SpaceArtifactSummaryPayload {
  content: string | Record<string, unknown>;
}

export interface SpaceListArtifactsResponsePayload {
  artifacts: SpaceArtifactSummaryPayload[];
  total: number;
}

export interface SpaceGetArtifactResponsePayload {
  artifact: SpaceArtifactDetailPayload;
}

export interface SpaceResetAgentUsageSessionPayload {
  apiVersion?: string;
  spaceId: string;
  agentId: string;
}

export interface SpaceResetAgentUsageSessionResponsePayload {
  closedSessionId?: string;
  activeSession: AgentUsageSessionPayload;
}

export interface ToolDenyReasonPayload {
  code: string;
  message: string;
}

export interface EffectiveToolOperationPayload {
  operationId: string;
  capability: string;
  operation: string;
  providerIds: string[];
  allowed: boolean;
  denyReasons: ToolDenyReasonPayload[];
}

export interface EffectiveToolMatrixPayload {
  spaceId: string;
  principalId?: string;
  deviceId?: string;
  agentId?: string;
  policyVersion: string;
  operations: EffectiveToolOperationPayload[];
  generatedAt: string;
}

export interface SpaceGetEffectiveToolsPayload {
  apiVersion?: string;
  spaceId: string;
  agentId?: string;
}

export interface SpaceGetEffectiveToolsResponsePayload {
  matrix: EffectiveToolMatrixPayload;
}

export interface SpaceShareContextResponsePayload {
  transfer: {
    transferId: string;
    sourceSpaceId: string;
    targetSpaceId: string;
    artifactId: string;
    status: "shared" | "imported" | "denied";
    denialReason?: string;
    createdAt: string;
    appliedAt?: string;
  };
}

export interface SpacePullSharedContextPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  limit?: number;
}

export interface SpacePullSharedContextResponsePayload {
  importedArtifacts: Array<{
    sourceArtifactId: string;
    importedArtifactId: string;
  }>;
  denied: Array<{
    transferId: string;
    reason: string;
  }>;
}

/**
 * Sync announce/query/pull.
 */
export interface SyncResourceRefPayload {
  /** Proto-aligned alias for resourceType. */
  type?: string;
  /** Proto-aligned alias for resourceId. */
  id?: string;
  /** Proto-aligned content hash for change detection. */
  versionHash?: string;
  resourceType: string;
  resourceId: string;
  title?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface SyncResourcePayload {
  ref: SyncResourceRefPayload;
  content: Record<string, unknown>;
}

export interface SyncResourceDeniedPayload {
  ref: SyncResourceRefPayload;
  reason: string;
}

export interface SyncProvenancePayload {
  peerId: string;
  ref: SyncResourceRefPayload;
  action: string;
  status: string;
  reason?: string;
  pulledAt: string;
}

export interface SyncAnnouncePayload {
  apiVersion?: string;
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  endpointUrl?: string;
  authSecretHash?: string;
  skillCount?: number;
  actionCount?: number;
  experienceCount?: number;
  profileCount?: number;
}

export interface SyncAnnounceResponsePayload {
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  syncEnabled: boolean;
  announcedAt: string;
  apiVersion?: string;
}

export interface SyncQueryResourcesPayload {
  apiVersion?: string;
  peerId: string;
  resourceId?: string;
  types?: string[];
  tags?: string[];
  updatedAfter?: string;
  cursor?: string;
  limit?: number;
}

export interface SyncQueryResourcesResponsePayload {
  resources: SyncResourceRefPayload[];
  nextCursor?: string;
  apiVersion?: string;
}

export interface SyncPullResourcesPayload {
  apiVersion?: string;
  peerId: string;
  idempotencyKey: string;
  refs: SyncResourceRefPayload[];
}

export interface SyncPullResourcesResponsePayload {
  resources: SyncResourcePayload[];
  denied: SyncResourceDeniedPayload[];
  provenance?: SyncProvenancePayload[];
  appliedCount: number;
  skippedCount: number;
  apiVersion?: string;
}

/**
 * Speech session MVP controls.
 */
export type VoiceProviderSourcePayload =
  | "managed"
  | "byok"
  | "local_model"
  | "apple_speech";

export type VoiceFallbackReasonPayload =
  | "default"
  | "manual_override"
  | "quota_fallback"
  | "local_forced";

export interface SpeechUsageMetricsPayload {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
}

export interface SpeechStartPayload {
  apiVersion?: string;
  spaceId: string;
  spaceUid: string;
  sessionId?: string;
  locale?: string;
  sourceDevice?: string;
  enableTranscription?: boolean;
  enablePlayback?: boolean;
  agentId?: string;
  autoSubmitTurns?: boolean;
  preferredSource?: VoiceProviderSourcePayload;
  preferredProviderId?: string;
  byokProviderId?: string;
  localModelProviderId?: string;
  appleSpeechProviderId?: string;
  allowByokFallback?: boolean;
  allowLocalFallback?: boolean;
  allowAppleSpeechFallback?: boolean;
}

export interface SpeechAudioChunkPayload {
  apiVersion?: string;
  sessionId: string;
  /** Proto-aligned alias for sequence. */
  sequenceNo?: number;
  sequence: number;
  audioBase64: string;
  sampleRateHz?: number;
  channels?: number;
  codec?: string;
  audioDurationSeconds?: number;
  ttsChars?: number;
  ttsSeconds?: number;
  transcriptText?: string;
  isFinal?: boolean;
}

export interface SpeechControlPayload {
  apiVersion?: string;
  sessionId: string;
  command: "stop" | "interrupt" | "end";
  reason?: string;
}

export interface SpeechEventPayload {
  sessionId: string;
  spaceId: string;
  spaceUid: string;
  /** Proto-aligned enum-like event category. */
  type?: string;
  /** Proto-aligned human message. */
  message?: string;
  state: "idle" | "running" | "stopped" | "interrupted" | "ended";
  eventType: string;
  providerSource?: VoiceProviderSourcePayload;
  providerId?: string;
  fallbackReason?: VoiceFallbackReasonPayload;
  usage?: SpeechUsageMetricsPayload;
  lockReason?: string;
  transcript?: string;
  turnId?: string;
  sequence?: number;
  sequenceNo?: number;
  reason?: string;
  emittedAt?: string;
  ts: string;
}

/**
 * Adapter -> Gateway: Register one or more native capability providers.
 * The gateway exposes these providers through CapabilityRegistry.
 */
export interface CapabilitiesRegisterPayload {
  providers: AdapterCapabilityProvider[];
}

/**
 * Adapter -> Gateway: Deregister one or more providers.
 */
export interface CapabilitiesDeregisterPayload {
  providerIds: string[];
}

/**
 * Shared provider descriptor used by adapter registration.
 */
export interface AdapterCapabilityProvider {
  id: string;
  name: string;
  source: "adapter";
  capabilityType: string;
  operations: string[];
}

/**
 * Gateway -> Adapter: Invoke a native capability operation.
 */
export interface AdapterCapabilityInvokePayload {
  invocationId: string;
  capability: string;
  operation: string;
  args: Record<string, unknown>;
  targetProvider?: string;
}

/**
 * Adapter -> Gateway: Return invocation result.
 */
export interface CapabilityResultPayload {
  invocationId: string;
  providerId: string;
  data: unknown;
  durationMs?: number;
}

/**
 * Adapter -> Gateway: Return invocation error.
 */
export interface CapabilityErrorPayload {
  invocationId: string;
  providerId?: string;
  code?: string;
  message: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Gateway → Client
// ---------------------------------------------------------------------------

export interface AuthResultPayload {
  success: boolean;
  reason?: string;
  /** Challenge to sign (sent before auth is complete). */
  challenge?: string;
}

export interface TurnEventPayload {
  spaceId: string;
  spaceUid: string;
  turnId: string;
  eventType: "started" | "streaming" | "tool_call" | "feedback_requested" | "rate_limited" | "state_changed" | "completed" | "failed";
  data: unknown;
}

/** Real-time streaming chunk sent during agent turn execution. */
export interface TurnStreamPayload {
  spaceId: string;
  spaceUid: string;
  turnId: string;
  agentId: string;
  /** Incremental text chunk (delta). */
  delta: string;
  /** Sequence number for ordering. */
  seq: number;
  /** Whether this is the final chunk. */
  done: boolean;
}

export interface SpaceStatePayload {
  spaceId: string;
  spaceUid: string;
  state: string;
  turnCount: number;
  activeAgentId?: string;
  pendingFeedback: number;
}

export interface NotificationPayload {
  notificationId: string;
  category: string;
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  body: string;
  spaceId?: string;
  spaceUid?: string;
  agentId?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface SpaceAgentUpdatedEventPayload {
  spaceId: string;
  spaceUid: string;
  agentId: string;
  oldProfileId: string;
  newProfileId: string;
  updatedAt: string;
}

export interface SubscribeNotificationsPayload {
  /** Notification categories to subscribe to (e.g. "space.completed", "turn.failed"). */
  categories: string[];
}

export interface UnsubscribeNotificationsPayload {
  /** Notification categories to unsubscribe from. */
  categories: string[];
}

export interface ErrorPayload {
  code: GatewayErrorCode;
  message: string;
  details?: unknown;
  retryable: boolean;
  correlationId: string;
}

export type GatewayErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN"
  | "UNAUTHENTICATED"
  | "INTERNAL"
  | "UNAVAILABLE"
  | "DEADLINE_EXCEEDED";

// ---------------------------------------------------------------------------
// Inter-agent messaging (bidirectional)
// ---------------------------------------------------------------------------

/**
 * Send a message directly to a specific agent within a space.
 * Does not consume a turn slot — used for coordination signals like
 * "I'm working on X", "I need your output from turn Y", etc.
 */
export interface AgentMessagePayload {
  spaceId: string;
  spaceUid: string;
  /** Sending agent ID. Set by the gateway if the sender is authenticated as an agent. */
  fromAgentId: string;
  /** Target agent ID. Use "*" for broadcast to all agents in the space. */
  toAgentId: string;
  /** Message content (natural language or structured JSON stringified). */
  content: string;
  /** Optional structured metadata (e.g. { ref: "turn-42", kind: "dependency_ready" }). */
  metadata?: Record<string, unknown>;
}

/**
 * Notify an idle agent to resume work.
 * Sent by the coordinator or lead agent when a dependency is resolved
 * or when the agent has been idle too long.
 */
export interface AgentPokePayload {
  spaceId: string;
  spaceUid: string;
  /** Agent to poke. */
  targetAgentId: string;
  /** Reason for the poke (human-readable). */
  reason: string;
  /** Optional: turn ID that unblocked the agent. */
  unblockedByTurnId?: string;
}

/**
 * Gateway → Client: agent idle notification.
 * Emitted when an agent's runtime transitions to idle state and stays
 * idle for longer than the configured threshold.
 */
export interface AgentIdlePayload {
  spaceId: string;
  spaceUid: string;
  agentId: string;
  /** How long the agent has been idle, in milliseconds. */
  idleDurationMs: number;
  /** The last turn ID this agent executed, if any. */
  lastTurnId?: string;
}

// ---------------------------------------------------------------------------
// Task dependencies
// ---------------------------------------------------------------------------

/**
 * Declare a dependency between tasks/turns within a space.
 * The gateway will hold `blockedTurnId` until `dependsOnTurnId` completes.
 */
export interface TaskDependencyPayload {
  spaceId: string;
  spaceUid: string;
  /** The turn/task that is blocked. */
  blockedTurnId: string;
  /** The turn/task that must complete first. */
  dependsOnTurnId: string;
}

/**
 * Gateway → Client: dependency resolved notification.
 */
export interface TaskDependencyResolvedPayload {
  spaceId: string;
  spaceUid: string;
  /** The turn that was blocked and is now unblocked. */
  unblockedTurnId: string;
  /** The turn that completed, resolving the dependency. */
  resolvedByTurnId: string;
}

// ---------------------------------------------------------------------------
// Known message types
// ---------------------------------------------------------------------------

export const MessageTypes = {
  // Client → Gateway
  AUTHENTICATE: "authenticate",
  EXECUTE_TURN: "execute_turn",
  RESUME_FEEDBACK: "resume_feedback",
  SUBSCRIBE: "subscribe",
  CAPABILITY_INVOKE: "capability_invoke",
  SPACE_CREATE: "space.create",
  SPACE_GET: "space.get",
  SPACE_LIST: "space.list",
  SPACE_ADD_AGENT: "space.add_agent",
  SPACE_REMOVE_AGENT: "space.remove_agent",
  SPACE_UPDATE_AGENT_ASSIGNMENT: "space.update_agent_assignment",
  SPACE_SET_ORCHESTRATOR: "space.set_orchestrator",
  SPACE_LIST_AGENT_ASSIGNMENTS: "space.list_agent_assignments",
  SPACE_GET_MCP_ENDPOINT: "space.get_mcp_endpoint",
  SPACE_SET_MCP_ENDPOINT: "space.set_mcp_endpoint",
  SPACE_CLEAR_MCP_ENDPOINT: "space.clear_mcp_endpoint",
  SPACE_DISCOVER_MCP_AGENTS: "space.discover_mcp_agents",
  SPACE_APPROVE_MCP_AGENT: "space.approve_mcp_agent",
  SPACE_ADD_SKILL: "space.add_skill",
  SPACE_REMOVE_SKILL: "space.remove_skill",
  SPACE_LIST_SKILLS: "space.list_skills",
  SPACE_GET_WORKSPACE: "space.get_workspace",
  SPACE_SET_WORKSPACE: "space.set_workspace",
  SPACE_ADD_RESOURCE: "space.add_resource",
  SPACE_REMOVE_RESOURCE: "space.remove_resource",
  SPACE_LIST_RESOURCES: "space.list_resources",
  SPACE_LIST_TURNS: "space.list_turns",
  SPACE_LIST_ORCHESTRATION_JOURNAL: "space.list_orchestration_journal",
  PROFILE_CREATE: "profile.create",
  PROFILE_GET: "profile.get",
  PROFILE_LIST: "profile.list",
  PROFILE_UPDATE: "profile.update",
  PROFILE_ARCHIVE: "profile.archive",
  PRESET_LIST: "preset.list",
  PRESET_GET: "preset.get",
  PRESET_APPLY_TO_SPACE: "preset.apply_to_space",
  PRESET_SAVE_AGENT: "preset.save_agent",
  PRESET_ARCHIVE_AGENT: "preset.archive_agent",
  SPACE_PREVIEW_TEMPLATE: "space.preview_template",
  SPACE_CREATE_FROM_TEMPLATE: "space.create_from_template",
  SPACE_SAVE_TEMPLATE: "space.save_template",
  GATEWAY_SKILL_LIST: "gateway.skill_list",
  GATEWAY_SKILL_GET: "gateway.skill_get",
  GATEWAY_SKILL_UPSERT: "gateway.skill_upsert",
  GATEWAY_SKILL_DELETE: "gateway.skill_delete",
  GATEWAY_DISCOVER_LOCAL_AGENTS: "gateway.discover_local_agents",
  GATEWAY_LIST_PROVIDER_CONFIGS: "gateway.list_provider_configs",
  GATEWAY_GET_MAIN_AGENT: "gateway.get_main_agent",
  GATEWAY_SET_MAIN_AGENT: "gateway.set_main_agent",
  GATEWAY_LIST_AVAILABLE_MODELS: "gateway.list_available_models",
  GATEWAY_LIST_PROVIDER_CATALOGS: "gateway.list_provider_catalogs",
  GATEWAY_CREATE_INTEGRATION_REQUEST: "gateway.create_integration_request",
  GATEWAY_LIST_INTEGRATION_REQUESTS: "gateway.list_integration_requests",
  GATEWAY_GET_PROVIDER_TELEMETRY: "gateway.get_provider_telemetry",
  GATEWAY_GET_LOCAL_USAGE_TELEMETRY: "gateway.get_local_usage_telemetry",
  GATEWAY_GET_PROVIDER_SETTINGS: "gateway.get_provider_settings",
  GATEWAY_UPDATE_PROVIDER_SETTINGS: "gateway.update_provider_settings",
  GATEWAY_SET_PROVIDER_CONFIG: "gateway.set_provider_config",
  GATEWAY_REMOVE_PROVIDER_CONFIG: "gateway.remove_provider_config",
  GATEWAY_FACTORY_RESET: "gateway.factory_reset",
  GATEWAY_PROVISION_LOCAL_PROFILE: "gateway.provision_local_profile",
  GATEWAY_PUT_SECRET_REF: "gateway.put_secret_ref",
  GATEWAY_LIST_SECRET_REFS: "gateway.list_secret_refs",
  GATEWAY_DELETE_SECRET_REF: "gateway.delete_secret_ref",
  GATEWAY_LIST_CONNECTOR_FAMILIES: "gateway.list_connector_families",
  GATEWAY_LIST_CONNECTORS: "gateway.list_connectors",
  GATEWAY_UPSERT_CONNECTOR: "gateway.upsert_connector",
  GATEWAY_REMOVE_CONNECTOR: "gateway.remove_connector",
  GATEWAY_LIST_CONNECTOR_BINDINGS: "gateway.list_connector_bindings",
  GATEWAY_UPSERT_CONNECTOR_BINDING: "gateway.upsert_connector_binding",
  GATEWAY_REMOVE_CONNECTOR_BINDING: "gateway.remove_connector_binding",
  GATEWAY_GET_CONNECTOR_POLICY: "gateway.get_connector_policy",
  GATEWAY_UPDATE_CONNECTOR_POLICY: "gateway.update_connector_policy",
  GATEWAY_TEST_CONNECTOR: "gateway.test_connector",
  GATEWAY_GET_POLICY: "gateway.get_policy",
  GATEWAY_UPDATE_POLICY: "gateway.update_policy",
  GATEWAY_KB_LIST_ENTRIES: "gateway.kb_list_entries",
  GATEWAY_KB_UPSERT_ENTRY: "gateway.kb_upsert_entry",
  GATEWAY_KB_DELETE_ENTRY: "gateway.kb_delete_entry",
  GATEWAY_LIST_CAPABILITY_GRANTS: "gateway.list_capability_grants",
  GATEWAY_GRANT_CAPABILITY: "gateway.grant_capability",
  GATEWAY_REVOKE_CAPABILITY: "gateway.revoke_capability",
  USAGE_GET_SNAPSHOT: "usage.get_snapshot",
  SCHEDULER_CREATE_JOB: "scheduler.create_job",
  SCHEDULER_GET_JOB: "scheduler.get_job",
  SCHEDULER_LIST_JOBS: "scheduler.list_jobs",
  SCHEDULER_UPDATE_JOB: "scheduler.update_job",
  SCHEDULER_DELETE_JOB: "scheduler.delete_job",
  SCHEDULER_LINK_SPACE: "scheduler.link_space",
  SCHEDULER_UNLINK_SPACE: "scheduler.unlink_space",
  SCHEDULER_LIST_RUNS: "scheduler.list_runs",
  SCHEDULER_RUN_NOW: "scheduler.run_now",
  ORCHESTRATOR_COMMAND: "orchestrator.command",
  ORCHESTRATOR_GET_COMMAND: "orchestrator.get_command",
  SPACE_LINK: "space.link",
  SPACE_UNLINK: "space.unlink",
  SPACE_SHARE_CONTEXT: "space.share_context",
  SPACE_PULL_SHARED_CONTEXT: "space.pull_shared_context",
  SPACE_SHARE_CREATE_INVITE: "space.share_create_invite",
  SPACE_SHARE_JOIN: "space.share_join",
  SPACE_SHARE_REVOKE: "space.share_revoke",
  SPACE_SHARE_LIST_PARTICIPANTS: "space.share_list_participants",
  SPACE_CREATE_CHANGESET: "space.create_changeset",
  SPACE_LIST_CHANGESETS: "space.list_changesets",
  SPACE_UPLOAD_CHANGESET_FILE_INIT: "space.upload_changeset_file_init",
  SPACE_UPLOAD_CHANGESET_FILE_COMPLETE: "space.upload_changeset_file_complete",
  SPACE_SUBMIT_CHANGESET: "space.submit_changeset",
  SPACE_REVIEW_CHANGESET: "space.review_changeset",
  SPACE_APPLY_CHANGESET: "space.apply_changeset",
  SPACE_GET_CHANGESET_DIFF: "space.get_changeset_diff",
  SPACE_GET_QUOTA: "space.get_quota",
  SPACE_UPDATE_QUOTA_POLICY: "space.update_quota_policy",
  SPACE_GET_USAGE: "space.get_usage",
  SPACE_GET_TURN_TRACE: "space.get_turn_trace",
  SPACE_LIST_ARTIFACTS: "space.list_artifacts",
  SPACE_GET_ARTIFACT: "space.get_artifact",
  SPACE_RESET: "space.reset",
  SPACE_RESET_AGENT_USAGE_SESSION: "space.reset_agent_usage_session",
  SPACE_GET_EFFECTIVE_TOOLS: "space.get_effective_tools",
  AUTH_REGISTER_DEVICE: "auth.register_device",
  AUTH_ROTATE_DEVICE_KEY: "auth.rotate_device_key",
  AUTH_REVOKE_DEVICE: "auth.revoke_device",
  AUTH_LIST_DEVICES: "auth.list_devices",
  AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN: "auth.issue_http_principal_token",
  SYNC_ANNOUNCE: "sync.announce",
  SYNC_QUERY_RESOURCES: "sync.query_resources",
  SYNC_PULL_RESOURCES: "sync.pull_resources",
  SPEECH_START: "speech.start",
  SPEECH_AUDIO_CHUNK: "speech.audio_chunk",
  SPEECH_CONTROL: "speech.control",
  CAPABILITIES_REGISTER: "capabilities.register",
  CAPABILITIES_DEREGISTER: "capabilities.deregister",
  CAPABILITY_RESULT: "capability.result",
  CAPABILITY_ERROR: "capability.error",
  PING: "ping",

  // Gateway → Client
  AUTH_CHALLENGE: "auth_challenge",
  AUTH_RESULT: "auth_result",
  TURN_EVENT: "turn_event",
  TURN_STREAM: "turn_stream",
  CAPABILITY_INVOKE_ADAPTER: "capability.invoke",
  SPACE_STATE: "space_state",
  SPACE_AGENT_UPDATED: "space.agent_updated",
  NOTIFICATION: "notification",
  ORCHESTRATOR_EVENT: "orchestrator.event",
  SPEECH_EVENT: "speech.event",
  ERROR: "error",
  PONG: "pong",

  // Client → Gateway (notifications)
  SUBSCRIBE_NOTIFICATIONS: "subscribe_notifications",
  UNSUBSCRIBE_NOTIFICATIONS: "unsubscribe_notifications",

  // Inter-agent messaging (bidirectional)
  AGENT_MESSAGE: "agent_message",
  AGENT_POKE: "agent_poke",
  AGENT_IDLE: "agent_idle",

  // Task dependencies
  TASK_DEPENDENCY: "task_dependency",
  TASK_DEPENDENCY_RESOLVED: "task_dependency_resolved",
} as const;
