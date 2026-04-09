import type { CapabilityRegistry, ToolAccessPolicyScopeType } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  AuthIssueHttpPrincipalTokenResponsePayload,
  AuthListDevicesResponsePayload,
  AuthRegisterDevicePayload,
  AuthRegisterDeviceResponsePayload,
  AuthRevokeDevicePayload,
  AuthRevokeDeviceResponsePayload,
  AuthRotateDeviceKeyPayload,
  AuthRotateDeviceKeyResponsePayload,
  ConnectorInboundEventResultPayload,
  GatewayCreateIntegrationRequestPayload,
  GatewayCreateIntegrationRequestResponsePayload,
  GatewayDeleteSecretRefPayload,
  GatewayDeleteSecretRefResponsePayload,
  GatewayDiscoverLocalAgentsResponsePayload,
  GatewayFactoryResetPayload,
  GatewayFactoryResetResponsePayload,
  GatewayGetConnectorPolicyPayload,
  GatewayGetConnectorPolicyResponsePayload,
  GatewayGetExternalConnectivityResponsePayload,
  GatewayGetLocalUsageTelemetryPayload,
  GatewayGetLocalUsageTelemetryResponsePayload,
  GatewayGetConciergeAgentPayload,
  GatewayGetConciergeAgentResponsePayload,
  GatewayGetMainAgentPayload,
  GatewayGetMainAgentResponsePayload,
  GatewayGetPolicyResponsePayload,
  GatewayGetProviderSettingsResponsePayload,
  GatewayGetProviderTelemetryPayload,
  GatewayGetProviderTelemetryResponsePayload,
  GatewayGetToolPayload,
  GatewayGetToolResponsePayload,
  GatewayGetWorkspaceDefaultsResponsePayload,
  GatewayGrantCapabilityPayload,
  GatewayGrantCapabilityResponsePayload,
  GatewayListAvailableModelsPayload,
  GatewayListAvailableModelsResponsePayload,
  GatewayListCapabilityGrantsResponsePayload,
  GatewayListConnectorBindingsPayload,
  GatewayListConnectorBindingsResponsePayload,
  GatewayListConnectorFamiliesResponsePayload,
  GatewayListConnectorsPayload,
  GatewayListConnectorsResponsePayload,
  GatewayListIntegrationRequestsPayload,
  GatewayListIntegrationRequestsResponsePayload,
  GatewayListInterconnectorsPayload,
  GatewayListInterconnectorsResponsePayload,
  GatewayListKnowledgeBaseEntriesPayload,
  GatewayListKnowledgeBaseEntriesResponsePayload,
  GatewayListProviderCatalogsPayload,
  GatewayListProviderCatalogsResponsePayload,
  GatewayListProviderConfigsResponsePayload,
  GatewayListSecretRefsResponsePayload,
  GatewayListToolApprovalGrantsPayload,
  GatewayListToolApprovalGrantsResponsePayload,
  GatewayListToolsPayload,
  GatewayListToolsResponsePayload,
  GatewayProvisionLocalProfilePayload,
  GatewayProvisionLocalProfileResponsePayload,
  GatewayPutSecretRefPayload,
  GatewayPutSecretRefResponsePayload,
  GatewayRegisterToolPayload,
  GatewayRegisterToolResponsePayload,
  GatewayRemoveConnectorBindingPayload,
  GatewayRemoveConnectorBindingResponsePayload,
  GatewayRemoveConnectorPayload,
  GatewayRemoveConnectorResponsePayload,
  GatewayRemoveProviderConfigPayload,
  GatewayRemoveProviderConfigResponsePayload,
  GatewayRemoveToolPayload,
  GatewayRemoveToolResponsePayload,
  GatewaySetToolEnabledPayload,
  GatewaySetToolEnabledResponsePayload,
  GatewayRevokeCapabilityPayload,
  GatewayRevokeCapabilityResponsePayload,
  GatewayRevokeToolApprovalGrantPayload,
  GatewayRevokeToolApprovalGrantResponsePayload,
  GatewayRescanInterconnectorsPayload,
  GatewayRescanInterconnectorsResponsePayload,
  GatewayScaffoldToolPayload,
  GatewayScaffoldToolResponsePayload,
  GatewaySetExternalConnectivityPayload,
  GatewaySetExternalConnectivityResponsePayload,
  GatewaySetConciergeAgentPayload,
  GatewaySetConciergeAgentResponsePayload,
  GatewaySetMainAgentPayload,
  GatewaySetMainAgentResponsePayload,
  GatewaySetProviderConfigPayload,
  GatewaySetProviderConfigResponsePayload,
  GatewaySetWorkspaceDefaultsPayload,
  GatewaySetWorkspaceDefaultsResponsePayload,
  GatewaySkillDeletePayload,
  GatewaySkillDeleteResponsePayload,
  GatewaySkillGetPayload,
  GatewaySkillGetResponsePayload,
  GatewaySkillListPayload,
  GatewaySkillListResponsePayload,
  GatewaySkillUpsertPayload,
  GatewaySkillUpsertResponsePayload,
  GatewayTestConnectorResponsePayload,
  GatewayUpdateConnectorPolicyPayload,
  GatewayUpdateConnectorPolicyResponsePayload,
  GatewayUpdatePolicyPayload,
  GatewayUpdatePolicyResponsePayload,
  GatewayUpdateProviderSettingsPayload,
  GatewayUpdateProviderSettingsResponsePayload,
  GatewayUpdateToolPolicyPayload,
  GatewayUpdateToolPolicyResponsePayload,
  GatewayUpsertConnectorBindingPayload,
  GatewayUpsertConnectorBindingResponsePayload,
  GatewayUpsertConnectorPayload,
  GatewayUpsertConnectorResponsePayload,
  GatewayUpsertKnowledgeBaseEntryPayload,
  GatewayUpsertKnowledgeBaseEntryResponsePayload,
  IdentityArchiveAgentDefinitionPayload,
  IdentityArchiveAgentDefinitionResponsePayload,
  IdentityArchivePersonaPayload,
  IdentityArchivePersonaResponsePayload,
  IdentityCreateAgentDefinitionPayload,
  IdentityCreateAgentDefinitionResponsePayload,
  IdentityCreatePersonaPayload,
  IdentityCreatePersonaResponsePayload,
  IdentityGetAgentDefinitionResponsePayload,
  IdentityGetPersonaResponsePayload,
  IdentityListAgentDefinitionsResponsePayload,
  IdentityListPersonasResponsePayload,
  IdentityPreviewCompiledInstructionsPayload,
  IdentityPreviewCompiledInstructionsResponsePayload,
  IdentityPreviewRuntimeSystemPromptPayload,
  IdentityPreviewRuntimeSystemPromptResponsePayload,
  IdentityPreviewSystemPromptMatrixPayload,
  IdentityPreviewSystemPromptMatrixResponsePayload,
  IdentityUpdateAgentDefinitionPayload,
  IdentityUpdateAgentDefinitionResponsePayload,
  IdentityUpdatePersonaPayload,
  IdentityUpdatePersonaResponsePayload,
  OrchestratorCommandPayload,
  OrchestratorCommandResponsePayload,
  SchedulerCreateJobPayload,
  SchedulerCreateJobResponsePayload,
  SchedulerDeleteJobPayload,
  SchedulerDeleteJobResponsePayload,
  SchedulerGetJobPayload,
  SchedulerGetJobResponsePayload,
  SchedulerLinkSpacePayload,
  SchedulerLinkSpaceResponsePayload,
  SchedulerListJobsPayload,
  SchedulerListJobsResponsePayload,
  SchedulerListRunsPayload,
  SchedulerListRunsResponsePayload,
  SchedulerRunNowPayload,
  SchedulerRunNowResponsePayload,
  SchedulerUnlinkSpacePayload,
  SchedulerUnlinkSpaceResponsePayload,
  SchedulerUpdateJobPayload,
  SchedulerUpdateJobResponsePayload,
  ConciergeCallAnswerPayload,
  ConciergeCallAudioChunkPayload,
  ConciergeCallControlPayload,
  ConciergeCallEndPayload,
  ConciergeCallEventPayload,
  ConciergeCallEventsResponsePayload,
  ConciergeCallHandoffAcceptPayload,
  ConciergeCallHandoffPreparePayload,
  ConciergeCallHandoffPrepareResponsePayload,
  ConciergeCallRegisterPushPayload,
  ConciergeCallSetMutedPayload,
  ConciergeCallStartPayload,
  ConciergeVoipPushRegistrationPayload,
  SpaceResetPayload,
  SpaceResetResponsePayload,
  SpeechAudioChunkPayload,
  SpeechControlPayload,
  SpeechEventPayload,
  SpeechStartPayload,
  SyncAnnouncePayload,
  SyncAnnounceResponsePayload,
  SyncPullResourcesPayload,
  SyncPullResourcesResponsePayload,
  SyncQueryResourcesPayload,
  SyncQueryResourcesResponsePayload,
  UsageGetSnapshotResponsePayload,
} from "./protocol.js";

export interface ConciergeEscalationService {
  resolveRequest: (input: {
    requestId: string;
    status: "ok" | "error";
    payload?: Record<string, unknown>;
    error?: string;
  }) => Promise<{
    requestId: string;
    status: string;
    deliveryChannel: string;
  }>;
}

export interface GatewayAdminService {
  discoverLocalAgents: () => Promise<GatewayDiscoverLocalAgentsResponsePayload["agents"]>;
  listProviderConfigs: () => GatewayListProviderConfigsResponsePayload["configs"];
  resolveMainSpaceId?: () => string;
  resolveConciergeSpaceId?: () => string;
  getMainAgent: (
    input?: GatewayGetMainAgentPayload,
  ) => Promise<GatewayGetMainAgentResponsePayload["state"]>;
  getConciergeAgent: (
    input?: GatewayGetConciergeAgentPayload,
  ) => Promise<GatewayGetConciergeAgentResponsePayload["state"]>;
  setMainAgent: (
    input: GatewaySetMainAgentPayload,
  ) => Promise<GatewaySetMainAgentResponsePayload["state"]>;
  setConciergeAgent: (
    input: GatewaySetConciergeAgentPayload,
  ) => Promise<GatewaySetConciergeAgentResponsePayload["state"]>;
  listAvailableModels: (
    input?: GatewayListAvailableModelsPayload,
  ) => Promise<GatewayListAvailableModelsResponsePayload["providers"]>;
  listProviderCatalogs: (
    input?: GatewayListProviderCatalogsPayload,
  ) => Promise<GatewayListProviderCatalogsResponsePayload["providers"]>;
  listTools: (input?: GatewayListToolsPayload) => GatewayListToolsResponsePayload["tools"];
  getTool: (toolId: string) => GatewayGetToolResponsePayload["tool"];
  listInterconnectors: (
    input?: GatewayListInterconnectorsPayload,
  ) => GatewayListInterconnectorsResponsePayload["interconnectors"];
  rescanInterconnectors: (
    input?: GatewayRescanInterconnectorsPayload,
  ) => Promise<GatewayRescanInterconnectorsResponsePayload["interconnectors"]>;
  scaffoldTool: (input: GatewayScaffoldToolPayload) => GatewayScaffoldToolResponsePayload;
  registerTool: (
    input: GatewayRegisterToolPayload,
  ) => Promise<GatewayRegisterToolResponsePayload["tool"]>;
  removeTool: (toolId: string) => Promise<GatewayRemoveToolResponsePayload>;
  setToolEnabled: (
    input: GatewaySetToolEnabledPayload,
  ) => Promise<GatewaySetToolEnabledResponsePayload>;
  listToolApprovalGrants: (
    input: GatewayListToolApprovalGrantsPayload,
    principalId: string,
    deviceId?: string,
  ) => GatewayListToolApprovalGrantsResponsePayload["grants"];
  revokeToolApprovalGrant: (
    input: GatewayRevokeToolApprovalGrantPayload,
    principalId: string,
    deviceId?: string,
  ) => GatewayRevokeToolApprovalGrantResponsePayload;
  createIntegrationRequest: (
    input: GatewayCreateIntegrationRequestPayload,
    principalId?: string,
    deviceId?: string,
  ) => GatewayCreateIntegrationRequestResponsePayload["request"];
  listIntegrationRequests: (
    input?: GatewayListIntegrationRequestsPayload,
  ) => GatewayListIntegrationRequestsResponsePayload["requests"];
  getProviderTelemetry: (
    input?: GatewayGetProviderTelemetryPayload,
  ) => Promise<GatewayGetProviderTelemetryResponsePayload["telemetry"]>;
  getLocalUsageTelemetry: (
    input?: GatewayGetLocalUsageTelemetryPayload,
  ) => Promise<GatewayGetLocalUsageTelemetryResponsePayload["telemetry"]>;
  getProviderSettings: (providerId: string) => GatewayGetProviderSettingsResponsePayload["settings"];
  updateProviderSettings: (
    input: GatewayUpdateProviderSettingsPayload,
  ) => GatewayUpdateProviderSettingsResponsePayload["settings"];
  setProviderConfig: (
    input: GatewaySetProviderConfigPayload,
  ) => GatewaySetProviderConfigResponsePayload["config"];
  removeProviderConfig: (providerId: string) => void;
  validateProfileModelSelection: (input: {
    providerHint?: string;
    modelHint?: string;
    modelConfig?: {
      preferredModels: string[];
      fallbackModels?: string[];
      constraints?: Record<string, unknown>;
    };
  }) => void;
  provisionLocalProfile: (
    input: GatewayProvisionLocalProfilePayload,
  ) => Promise<GatewayProvisionLocalProfileResponsePayload>;
  putSecretRef: (input: GatewayPutSecretRefPayload) => GatewayPutSecretRefResponsePayload;
  listSecretRefs: (providerId?: string) => GatewayListSecretRefsResponsePayload["secretRefs"];
  deleteSecretRef: (secretRef: string) => boolean;
}

export interface GatewayResetService {
  factoryResetGateway: (
    input: GatewayFactoryResetPayload & { requestedBy: string; requestedDeviceId?: string },
  ) => Promise<GatewayFactoryResetResponsePayload>;
  resetSpace: (
    input: SpaceResetPayload & { requestedBy: string; requestedDeviceId?: string },
  ) => Promise<SpaceResetResponsePayload>;
}

export interface ConnectorAdminService {
  listConnectorFamilies: () => GatewayListConnectorFamiliesResponsePayload["families"];
  listConnectors: (input?: GatewayListConnectorsPayload) =>
    GatewayListConnectorsResponsePayload["connectors"];
  upsertConnector: (input: GatewayUpsertConnectorPayload) =>
    GatewayUpsertConnectorResponsePayload["connector"];
  removeConnector: (connectorId: string) => { removed: boolean };
  listConnectorBindings: (input?: GatewayListConnectorBindingsPayload) =>
    GatewayListConnectorBindingsResponsePayload["bindings"];
  upsertConnectorBinding: (input: GatewayUpsertConnectorBindingPayload) =>
    GatewayUpsertConnectorBindingResponsePayload["binding"];
  removeConnectorBinding: (bindingId: string) => { removed: boolean };
  getConnectorPolicy: (input: GatewayGetConnectorPolicyPayload) =>
    GatewayGetConnectorPolicyResponsePayload["policy"];
  updateConnectorPolicy: (input: GatewayUpdateConnectorPolicyPayload) =>
    GatewayUpdateConnectorPolicyResponsePayload["policy"];
  resolveInboundRoute: (input: {
    connectorId: string;
    selector?: Record<string, unknown>;
  }) => ConnectorInboundEventResultPayload["route"];
  testConnector: (connectorId: string) => GatewayTestConnectorResponsePayload;
}

export interface GatewayIdentityService {
  listAgentDefinitions: (
    includeArchived?: boolean,
  ) => IdentityListAgentDefinitionsResponsePayload["agentDefinitions"];
  getAgentDefinition: (
    agentDefinitionId: string,
  ) => IdentityGetAgentDefinitionResponsePayload["agentDefinition"] | null;
  createAgentDefinition: (
    input: IdentityCreateAgentDefinitionPayload,
  ) => IdentityCreateAgentDefinitionResponsePayload;
  updateAgentDefinition: (
    input: IdentityUpdateAgentDefinitionPayload,
  ) => IdentityUpdateAgentDefinitionResponsePayload;
  archiveAgentDefinition: (
    input: IdentityArchiveAgentDefinitionPayload,
  ) => IdentityArchiveAgentDefinitionResponsePayload;
  listPersonas: (includeArchived?: boolean) => IdentityListPersonasResponsePayload["personas"];
  getPersona: (personaId: string) => IdentityGetPersonaResponsePayload["persona"] | null;
  createPersona: (input: IdentityCreatePersonaPayload) => IdentityCreatePersonaResponsePayload;
  updatePersona: (input: IdentityUpdatePersonaPayload) => IdentityUpdatePersonaResponsePayload;
  archivePersona: (input: IdentityArchivePersonaPayload) => IdentityArchivePersonaResponsePayload;
  previewCompiledInstructions: (
    input: IdentityPreviewCompiledInstructionsPayload,
  ) => IdentityPreviewCompiledInstructionsResponsePayload;
  previewRuntimeSystemPrompt: (
    input: IdentityPreviewRuntimeSystemPromptPayload,
  ) => Promise<IdentityPreviewRuntimeSystemPromptResponsePayload>;
  previewSystemPromptMatrix: (
    input: IdentityPreviewSystemPromptMatrixPayload,
  ) => Promise<IdentityPreviewSystemPromptMatrixResponsePayload>;
}

export interface DeviceIdentityService {
  registerDevice: (input: AuthRegisterDevicePayload & { principalId: string }) =>
    AuthRegisterDeviceResponsePayload;
  rotateDeviceKey: (input: AuthRotateDeviceKeyPayload & { principalId: string }) =>
    AuthRotateDeviceKeyResponsePayload["device"];
  revokeDevice: (input: AuthRevokeDevicePayload & { principalId: string }) =>
    AuthRevokeDeviceResponsePayload;
  listDevices: (principalId: string, includeRevoked?: boolean) =>
    AuthListDevicesResponsePayload["devices"];
}

export interface GatewayPolicyService {
  getPolicy: () => GatewayGetPolicyResponsePayload["policy"];
  updatePolicy: (patch: GatewayUpdatePolicyPayload) => GatewayUpdatePolicyResponsePayload["policy"];
}

export interface GatewayKnowledgeBaseService {
  listEntries: (
    input?: GatewayListKnowledgeBaseEntriesPayload,
  ) => GatewayListKnowledgeBaseEntriesResponsePayload["entries"];
  upsertEntry: (
    input: GatewayUpsertKnowledgeBaseEntryPayload,
  ) => GatewayUpsertKnowledgeBaseEntryResponsePayload["entry"];
  deleteEntry: (entryId: string) => boolean;
}

export interface GatewaySkillCatalogService {
  listSkills: (input?: GatewaySkillListPayload) => GatewaySkillListResponsePayload["skills"];
  getSkill: (skillId: string) => GatewaySkillGetResponsePayload["skill"] | null;
  upsertSkill: (input: GatewaySkillUpsertPayload) => GatewaySkillUpsertResponsePayload;
  deleteSkill: (skillId: string) => boolean;
}

export interface GatewayLibraryService {
  listEntries: (input?: Record<string, unknown>) => { entryId: string; [key: string]: unknown }[];
  getEntry: (entryId: string, includeContent?: boolean) => { entryId: string; [key: string]: unknown } | null;
  saveSkill: (input: Record<string, unknown>) => { entry: Record<string, unknown>; created: boolean };
  importEntry: (input: Record<string, unknown>) => { entry: Record<string, unknown>; created: boolean };
  archiveEntry: (input: Record<string, unknown>) => { entry: Record<string, unknown>; archived: boolean };
  setEntryEnabled: (input: Record<string, unknown>) => { entry: Record<string, unknown> };
  deleteEntry: (input: Record<string, unknown>) => { entryId: string; deleted: boolean };
  scanEntries: () => { entries: Record<string, unknown>[]; scannedAt: string };
  listSkillDrafts: () => { draftId: string; [key: string]: unknown }[];
  getSkillDraft: (draftId: string) => { draftId: string; [key: string]: unknown } | null;
  createSkillDraft: (input: Record<string, unknown>) => { draft: Record<string, unknown>; created: boolean };
  deleteSkillDraft: (input: Record<string, unknown>) => { draftId: string; deleted: boolean };
}

export interface GatewayCapabilityAccessService {
  listCapabilityGrants: (input: {
    principalId: string;
    deviceId?: string;
    includeRevoked?: boolean;
    includeExpired?: boolean;
  }) => GatewayListCapabilityGrantsResponsePayload["grants"];
  grantCapability: (input: {
    principalId: string;
    deviceId?: string;
    capabilityId: GatewayGrantCapabilityPayload["capabilityId"];
    reason?: string;
    grantedBy?: string;
    expiresAt?: string;
  }) => GatewayGrantCapabilityResponsePayload["grant"];
  revokeCapability: (input: {
    principalId: string;
    deviceId?: string;
    capabilityId: GatewayRevokeCapabilityPayload["capabilityId"];
    reason?: string;
    revokedBy?: string;
  }) => GatewayRevokeCapabilityResponsePayload;
}

export interface UsageSnapshotService {
  getSnapshot: () => UsageGetSnapshotResponsePayload["snapshot"];
}

export interface SchedulerService {
  createJob: (
    input: SchedulerCreateJobPayload & { principalId: string },
  ) => Promise<SchedulerCreateJobResponsePayload["job"]>;
  getJob: (
    input: SchedulerGetJobPayload & { principalId?: string },
  ) => Promise<SchedulerGetJobResponsePayload["job"] | null>;
  listJobs: (
    input?: SchedulerListJobsPayload & { principalId?: string },
  ) => Promise<SchedulerListJobsResponsePayload["jobs"]>;
  updateJob: (
    input: SchedulerUpdateJobPayload & { principalId: string },
  ) => Promise<SchedulerUpdateJobResponsePayload["job"]>;
  deleteJob: (
    input: SchedulerDeleteJobPayload & { principalId: string },
  ) => Promise<SchedulerDeleteJobResponsePayload>;
  linkSpace: (
    input: SchedulerLinkSpacePayload & { principalId: string },
  ) => Promise<SchedulerLinkSpaceResponsePayload["job"]>;
  unlinkSpace: (
    input: SchedulerUnlinkSpacePayload & { principalId: string },
  ) => Promise<SchedulerUnlinkSpaceResponsePayload["job"]>;
  listRuns: (
    input: SchedulerListRunsPayload & { principalId?: string },
  ) => Promise<SchedulerListRunsResponsePayload>;
  runNow: (
    input: SchedulerRunNowPayload & { principalId: string },
  ) => Promise<SchedulerRunNowResponsePayload>;
}

export interface GatewayWorkspaceDefaultsService {
  get: () => { space_home_root: string; updated_at: string };
  set: (input: { spaceHomeRoot: string }) => { space_home_root: string; updated_at: string };
}

export interface GatewayExternalConnectivityService {
  getSnapshot: () => Promise<GatewayGetExternalConnectivityResponsePayload>;
  setMode: (mode: GatewaySetExternalConnectivityPayload["mode"]) =>
    Promise<GatewaySetExternalConnectivityResponsePayload>;
}

export interface OrchestratorCommandService {
  submitCommand: (
    input: OrchestratorCommandPayload & {
      principalId?: string;
      deviceId?: string;
      trustedInternal?: boolean;
    },
  ) => Promise<OrchestratorCommandResponsePayload["command"]>;
  getCommand: (commandId: string) => OrchestratorCommandResponsePayload["command"] | null;
}

export interface GatewaySyncService {
  announcePeer: (input: SyncAnnouncePayload) => SyncAnnounceResponsePayload;
  queryResources: (input: SyncQueryResourcesPayload) => SyncQueryResourcesResponsePayload;
  pullResources: (input: SyncPullResourcesPayload) => SyncPullResourcesResponsePayload;
}

export interface SpeechSessionService {
  startSession: (
    input: SpeechStartPayload & { principalId?: string; deviceId?: string },
  ) => SpeechEventPayload;
  appendAudioChunk: (input: SpeechAudioChunkPayload) => Promise<SpeechEventPayload[]>;
  control: (input: SpeechControlPayload) => SpeechEventPayload;
}

export interface ConciergeCallRuntimeService {
  startCall: (
    input: ConciergeCallStartPayload & { principalId?: string; deviceId?: string },
  ) => Promise<ConciergeCallEventPayload> | ConciergeCallEventPayload;
  answerCall: (
    input: ConciergeCallAnswerPayload & { principalId?: string; deviceId?: string },
  ) => Promise<ConciergeCallEventPayload> | ConciergeCallEventPayload;
  endCall: (
    input: ConciergeCallEndPayload & { principalId?: string },
  ) => Promise<ConciergeCallEventPayload> | ConciergeCallEventPayload;
  setMuted: (
    input: ConciergeCallSetMutedPayload & { principalId?: string },
  ) => Promise<ConciergeCallEventPayload> | ConciergeCallEventPayload;
  appendAudioChunk: (
    input: ConciergeCallAudioChunkPayload & { principalId?: string; deviceId?: string },
  ) => Promise<ConciergeCallEventsResponsePayload>;
  control: (
    input: ConciergeCallControlPayload & { principalId?: string; deviceId?: string },
  ) => Promise<ConciergeCallEventPayload> | ConciergeCallEventPayload;
  prepareHandoff: (
    input: ConciergeCallHandoffPreparePayload & { principalId?: string; deviceId?: string },
  ) => Promise<ConciergeCallHandoffPrepareResponsePayload> | ConciergeCallHandoffPrepareResponsePayload;
  acceptHandoff: (
    input: ConciergeCallHandoffAcceptPayload & { principalId?: string; deviceId?: string },
  ) => Promise<ConciergeCallEventPayload> | ConciergeCallEventPayload;
  registerPush: (
    input: ConciergeCallRegisterPushPayload & { principalId?: string; deviceId?: string },
  ) => Promise<ConciergeVoipPushRegistrationPayload> | ConciergeVoipPushRegistrationPayload;
}

export interface ToolAccessPolicyService {
  getEffectiveToolAccess: (input: {
    spaceId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: "owner" | "guest" | "connector" | "system" | "unknown";
    agentId?: string;
    accessMode?: "default" | "full_access";
  }) => Promise<any> | any;
  getToolPolicy: (input: { scopeType: ToolAccessPolicyScopeType; scopeId: string }) => any;
  updateToolPolicy: (input: {
    scopeType: ToolAccessPolicyScopeType;
    scopeId: string;
    rules?: any[];
    dangerousCapabilities?: any[];
    guestAccessPreset?: "read_only" | "collaborator";
  }) => any;
}

export interface RouterRuntimeDeps {
  capabilities: CapabilityRegistry;
  logger: Logger;
}
