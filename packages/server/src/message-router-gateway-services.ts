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
  GatewayGetRuntimeDefaultsPayload,
  GatewayGetRuntimeDefaultsResponsePayload,
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
  GatewaySetRuntimeDefaultsPayload,
  GatewaySetRuntimeDefaultsResponsePayload,
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
  SchedulerListEvalDefinitionsPayload,
  SchedulerListEvalDefinitionsResponsePayload,
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
  WorkbenchApproveStagePayload,
  WorkbenchApproveStageResponsePayload,
  WorkbenchCancelRunPayload,
  WorkbenchCancelRunResponsePayload,
  WorkbenchCreateBatchPayload,
  WorkbenchCreateBatchResponsePayload,
  WorkbenchGetPolicyPayload,
  WorkbenchGetPolicyResponsePayload,
  WorkbenchGetQueueItemPayload,
  WorkbenchGetQueueItemResponsePayload,
  WorkbenchGetRunPayload,
  WorkbenchGetRunResponsePayload,
  WorkbenchListArtifactsPayload,
  WorkbenchListArtifactsResponsePayload,
  WorkbenchListBatchesPayload,
  WorkbenchListBatchesResponsePayload,
  WorkbenchListQueuePayload,
  WorkbenchListQueueResponsePayload,
  WorkbenchListRunsPayload,
  WorkbenchListRunsResponsePayload,
  WorkbenchRejectStagePayload,
  WorkbenchRejectStageResponsePayload,
  WorkbenchRetryRunPayload,
  WorkbenchRetryRunResponsePayload,
  WorkbenchSetModePayload,
  WorkbenchSetModeResponsePayload,
  WorkbenchStartRunPayload,
  WorkbenchStartRunResponsePayload,
  WorkbenchUpdateBatchPayload,
  WorkbenchUpdateBatchResponsePayload,
  WorkbenchUpdatePolicyPayload,
  WorkbenchUpdatePolicyResponsePayload,
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

export type * from "./message-router-workflow-services.js";

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
  getRuntimeDefaults: (
    input?: GatewayGetRuntimeDefaultsPayload,
  ) => Promise<GatewayGetRuntimeDefaultsResponsePayload["defaults"]>;
  setRuntimeDefaults: (
    input: GatewaySetRuntimeDefaultsPayload,
  ) => Promise<GatewaySetRuntimeDefaultsResponsePayload>;
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
    modelId?: string;
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

export interface RouterRuntimeDeps {
  capabilities: CapabilityRegistry;
  logger: Logger;
}
