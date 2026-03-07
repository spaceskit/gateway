/**
 * MessageRouter — dispatches WebSocket messages to the appropriate handlers.
 *
 * This replaces the stub `onMessage` callback in bootstrap. Each message
 * type maps to a handler that validates the payload, calls the right
 * manager, and returns a response.
 *
 * Stolen patterns:
 * - Microsoft AF: typed message dispatch by discriminator
 * - CrewAI: structured error feedback to agents
 * - Spaceskit original: GatewayMessage envelope with correlation IDs
 */

import { randomUUID } from "node:crypto";
import { isCapabilityType } from "@spaceskit/core";
import type { SpaceAdminService, SpaceManager, CapabilityType, SpaceState } from "@spaceskit/core";
import type { CapabilityRegistry } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import { deterministicUuid, normalizeUuid } from "./uuid.js";
import type {
  GatewayMessage,
  ErrorPayload,
  ExecuteTurnPayload,
  ResumeFeedbackPayload,
  CapabilityInvokePayload,
  CapabilitiesRegisterPayload,
  CapabilitiesDeregisterPayload,
  CapabilityResultPayload,
  CapabilityErrorPayload,
  AdapterCapabilityProvider,
  AdapterCapabilityInvokePayload,
  TurnEventPayload,
  AgentMessagePayload,
  AgentPokePayload,
  TaskDependencyPayload,
  SpaceCreatePayload,
  SpaceGetPayload,
  SpaceListPayload,
  SpaceAddAgentPayload,
  SpaceRemoveAgentPayload,
  SpaceUpdateAgentAssignmentPayload,
  SpaceSetOrchestratorPayload,
  SpaceListAgentAssignmentsPayload,
  SpaceGetMcpEndpointPayload,
  SpaceSetMcpEndpointPayload,
  SpaceClearMcpEndpointPayload,
  SpaceDiscoverMcpAgentsPayload,
  SpaceApproveMcpAgentPayload,
  SpaceAddSkillPayload,
  SpaceRemoveSkillPayload,
  SpaceListSkillsPayload,
  SpaceGetWorkspacePayload,
  SpaceSetWorkspacePayload,
  SpaceAddResourcePayload,
  SpaceRemoveResourcePayload,
  SpaceListResourcesPayload,
  SpaceListTurnsPayload,
  SpaceListOrchestrationJournalPayload,
  GatewayListAvailableModelsPayload,
  GatewayListProviderCatalogsPayload,
  GatewayCreateIntegrationRequestPayload,
  GatewayListIntegrationRequestsPayload,
  GatewayGetMainAgentPayload,
  GatewaySetMainAgentPayload,
  GatewayGetProviderTelemetryPayload,
  GatewayGetLocalUsageTelemetryPayload,
  GatewayGetProviderSettingsPayload,
  GatewayUpdateProviderSettingsPayload,
  GatewaySetProviderConfigPayload,
  GatewayRemoveProviderConfigPayload,
  GatewayFactoryResetPayload,
  GatewayProvisionLocalProfilePayload,
  GatewayPutSecretRefPayload,
  GatewayListSecretRefsPayload,
  GatewayDeleteSecretRefPayload,
  GatewayListConnectorFamiliesPayload,
  GatewayListConnectorsPayload,
  GatewayUpsertConnectorPayload,
  GatewayRemoveConnectorPayload,
  GatewayListConnectorBindingsPayload,
  GatewayUpsertConnectorBindingPayload,
  GatewayRemoveConnectorBindingPayload,
  GatewayGetConnectorPolicyPayload,
  GatewayUpdateConnectorPolicyPayload,
  GatewayTestConnectorPayload,
  ProfileCreatePayload,
  ProfileGetPayload,
  ProfileListPayload,
  ProfileUpdatePayload,
  ProfileArchivePayload,
  PresetListPayload,
  PresetGetPayload,
  PresetApplyToSpacePayload,
  PresetSaveAgentPayload,
  PresetArchiveAgentPayload,
  PresetSummaryPayload,
  PresetDetailPayload,
  SpacePreviewTemplatePayload,
  SpaceCreateFromTemplatePayload,
  SpaceSaveTemplatePayload,
  GatewayGetPolicyPayload,
  GatewayUpdatePolicyPayload,
  GatewaySkillListPayload,
  GatewaySkillGetPayload,
  GatewaySkillUpsertPayload,
  GatewaySkillDeletePayload,
  GatewayListKnowledgeBaseEntriesPayload,
  GatewayUpsertKnowledgeBaseEntryPayload,
  GatewayDeleteKnowledgeBaseEntryPayload,
  GatewayListCapabilityGrantsPayload,
  GatewayGrantCapabilityPayload,
  GatewayRevokeCapabilityPayload,
  UsageGetSnapshotPayload,
  SchedulerCreateJobPayload,
  SchedulerGetJobPayload,
  SchedulerListJobsPayload,
  SchedulerUpdateJobPayload,
  SchedulerDeleteJobPayload,
  SchedulerLinkSpacePayload,
  SchedulerUnlinkSpacePayload,
  SchedulerListRunsPayload,
  SchedulerRunNowPayload,
  OrchestratorCommandPayload,
  OrchestratorGetCommandPayload,
  SpaceLinkPayload,
  SpaceUnlinkPayload,
  SpaceShareContextPayload,
  SpacePullSharedContextPayload,
  SpaceShareCreateInvitePayload,
  SpaceShareJoinPayload,
  SpaceShareRevokePayload,
  SpaceShareListParticipantsPayload,
  SpaceCreateChangeSetPayload,
  SpaceListChangeSetsPayload,
  SpaceUploadChangeSetFileInitPayload,
  SpaceUploadChangeSetFileCompletePayload,
  SpaceSubmitChangeSetPayload,
  SpaceReviewChangeSetPayload,
  SpaceApplyChangeSetPayload,
  SpaceChangeSetDiffPayload,
  SpaceGetQuotaPayload,
  SpaceUpdateQuotaPolicyPayload,
  SpaceGetUsagePayload,
  SpaceGetTurnTracePayload,
  SpaceListArtifactsPayload,
  SpaceGetArtifactPayload,
  SpaceResetAgentUsageSessionPayload,
  SpaceResetPayload,
  SpaceGetEffectiveToolsPayload,
  AuthRegisterDevicePayload,
  AuthRotateDeviceKeyPayload,
  AuthRevokeDevicePayload,
  AuthListDevicesPayload,
  AuthIssueHttpPrincipalTokenPayload,
  SyncAnnouncePayload,
  SyncQueryResourcesPayload,
  SyncPullResourcesPayload,
  SpeechStartPayload,
  SpeechAudioChunkPayload,
  SpeechControlPayload,
  GatewayDiscoverLocalAgentsResponsePayload,
  GatewayListProviderConfigsResponsePayload,
  GatewayGetMainAgentResponsePayload,
  GatewaySetMainAgentResponsePayload,
  GatewayListAvailableModelsResponsePayload,
  GatewayListProviderCatalogsResponsePayload,
  GatewayCreateIntegrationRequestResponsePayload,
  GatewayListIntegrationRequestsResponsePayload,
  GatewayGetProviderTelemetryResponsePayload,
  GatewayGetLocalUsageTelemetryResponsePayload,
  GatewayGetProviderSettingsResponsePayload,
  GatewayUpdateProviderSettingsResponsePayload,
  GatewaySetProviderConfigResponsePayload,
  GatewayRemoveProviderConfigResponsePayload,
  GatewayFactoryResetResponsePayload,
  GatewayProvisionLocalProfileResponsePayload,
  GatewayPutSecretRefResponsePayload,
  GatewayListSecretRefsResponsePayload,
  GatewayDeleteSecretRefResponsePayload,
  GatewayListConnectorFamiliesResponsePayload,
  GatewayListConnectorsResponsePayload,
  GatewayUpsertConnectorResponsePayload,
  GatewayRemoveConnectorResponsePayload,
  GatewayListConnectorBindingsResponsePayload,
  GatewayUpsertConnectorBindingResponsePayload,
  GatewayRemoveConnectorBindingResponsePayload,
  GatewayGetConnectorPolicyResponsePayload,
  GatewayUpdateConnectorPolicyResponsePayload,
  GatewayTestConnectorResponsePayload,
  GatewayGetPolicyResponsePayload,
  GatewayUpdatePolicyResponsePayload,
  GatewayListKnowledgeBaseEntriesResponsePayload,
  GatewayUpsertKnowledgeBaseEntryResponsePayload,
  GatewayDeleteKnowledgeBaseEntryResponsePayload,
  GatewayListCapabilityGrantsResponsePayload,
  GatewayGrantCapabilityResponsePayload,
  GatewayRevokeCapabilityResponsePayload,
  UsageGetSnapshotResponsePayload,
  SchedulerCreateJobResponsePayload,
  SchedulerGetJobResponsePayload,
  SchedulerListJobsResponsePayload,
  SchedulerUpdateJobResponsePayload,
  SchedulerDeleteJobResponsePayload,
  SchedulerLinkSpaceResponsePayload,
  SchedulerUnlinkSpaceResponsePayload,
  SchedulerListRunsResponsePayload,
  SchedulerRunNowResponsePayload,
  OrchestratorCommandResponsePayload,
  SpaceLinkResponsePayload,
  SpaceUnlinkResponsePayload,
  SpaceShareContextResponsePayload,
  SpacePullSharedContextResponsePayload,
  SpaceShareCreateInviteResponsePayload,
  SpaceShareJoinResponsePayload,
  SpaceShareRevokeResponsePayload,
  SpaceShareListParticipantsResponsePayload,
  SpaceCreateChangeSetResponsePayload,
  SpaceListChangeSetsResponsePayload,
  SpaceUploadChangeSetFileInitResponsePayload,
  SpaceUploadChangeSetFileCompleteResponsePayload,
  SpaceSubmitChangeSetResponsePayload,
  SpaceReviewChangeSetResponsePayload,
  SpaceApplyChangeSetResponsePayload,
  SpaceChangeSetDiffResponsePayload,
  SpaceGetQuotaResponsePayload,
  SpaceUpdateQuotaPolicyResponsePayload,
  SpaceGetUsageResponsePayload,
  SpaceGetTurnTraceResponsePayload,
  SpaceListArtifactsResponsePayload,
  SpaceGetArtifactResponsePayload,
  SpaceResetAgentUsageSessionResponsePayload,
  SpaceResetResponsePayload,
  SpaceGetEffectiveToolsResponsePayload,
  SpaceAddSkillResponsePayload,
  SpaceRemoveSkillResponsePayload,
  SpaceListSkillsResponsePayload,
  SpaceWorkspacePayload,
  SpaceGetWorkspaceResponsePayload,
  SpaceSetWorkspaceResponsePayload,
  SpaceAddResourceResponsePayload,
  SpaceRemoveResourceResponsePayload,
  SpaceListResourcesResponsePayload,
  SpaceListTurnsResponsePayload,
  SpaceListOrchestrationJournalResponsePayload,
  SpaceGetMcpEndpointResponsePayload,
  SpaceSetMcpEndpointResponsePayload,
  SpaceClearMcpEndpointResponsePayload,
  SpaceMcpEndpointPayload,
  McpDiscoveredAgentPayload,
  ExternalAgentRuntimeBindingPayload,
  SpaceDiscoverMcpAgentsResponsePayload,
  SpaceApproveMcpAgentResponsePayload,
  SpaceAssignmentSummary,
  SpaceSummary,
  SpaceTurnPayload,
  SpaceAgentUpdatedEventPayload,
  ProfileCreateResponsePayload,
  ProfileGetResponsePayload,
  ProfileListResponsePayload,
  ProfileUpdateResponsePayload,
  ProfileArchiveResponsePayload,
  PresetListResponsePayload,
  PresetGetResponsePayload,
  PresetApplyToSpaceResponsePayload,
  PresetSaveAgentResponsePayload,
  PresetArchiveAgentResponsePayload,
  SpacePreviewTemplateResponsePayload,
  SpaceCreateFromTemplateResponsePayload,
  SpaceSaveTemplateResponsePayload,
  GatewaySkillListResponsePayload,
  GatewaySkillGetResponsePayload,
  GatewaySkillUpsertResponsePayload,
  GatewaySkillDeleteResponsePayload,
  AuthRegisterDeviceResponsePayload,
  AuthRotateDeviceKeyResponsePayload,
  AuthRevokeDeviceResponsePayload,
  AuthListDevicesResponsePayload,
  AuthIssueHttpPrincipalTokenResponsePayload,
  SyncAnnounceResponsePayload,
  SyncQueryResourcesResponsePayload,
  SyncPullResourcesResponsePayload,
  SpeechEventPayload,
  } from "./protocol.js";
import { MessageTypes } from "./protocol.js";
import { buildGatewayErrorPayload } from "./error-contract.js";
import type { ClientSession } from "./gateway-server.js";

export interface GatewayAdminService {
  discoverLocalAgents: () => Promise<GatewayDiscoverLocalAgentsResponsePayload["agents"]>;
  listProviderConfigs: () => GatewayListProviderConfigsResponsePayload["configs"];
  resolveMainSpaceId?: () => string;
  getMainAgent: (
    input?: GatewayGetMainAgentPayload,
  ) => Promise<GatewayGetMainAgentResponsePayload["state"]>;
  setMainAgent: (
    input: GatewaySetMainAgentPayload,
  ) => Promise<GatewaySetMainAgentResponsePayload["state"]>;
  listAvailableModels: (
    input?: GatewayListAvailableModelsPayload,
  ) => Promise<GatewayListAvailableModelsResponsePayload["providers"]>;
  listProviderCatalogs: (
    input?: GatewayListProviderCatalogsPayload,
  ) => Promise<GatewayListProviderCatalogsResponsePayload["providers"]>;
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
  testConnector: (connectorId: string) => GatewayTestConnectorResponsePayload;
}

export interface ProfileAdminService {
  createProfile: (input: ProfileCreatePayload) => Promise<ProfileCreateResponsePayload>;
  getProfile: (profileId: string) => Promise<ProfileGetResponsePayload["profile"] | null>;
  listProfiles: (includeArchived?: boolean) => Promise<ProfileListResponsePayload["profiles"]>;
  updateProfile: (input: ProfileUpdatePayload) => Promise<ProfileUpdateResponsePayload>;
  archiveProfile: (profileId: string) => Promise<ProfileArchiveResponsePayload>;
}

export interface SpaceConfiguratorService {
  listPresets: (input?: PresetListPayload, principalId?: string) => PresetSummaryPayload[];
  getPreset: (presetId: string, principalId?: string) => PresetDetailPayload;
  applyPresetToSpace: (input: PresetApplyToSpacePayload & { principalId: string }) =>
    Promise<object>;
  saveAgentPreset: (input: PresetSaveAgentPayload & { principalId: string }) => Promise<object>;
  archiveAgentPreset: (input: PresetArchiveAgentPayload & { principalId: string }) => Promise<object>;
  previewTemplate: (input: SpacePreviewTemplatePayload, principalId: string) => object;
  createFromTemplate: (input: SpaceCreateFromTemplatePayload, principalId: string) => Promise<object>;
  saveTemplate: (input: SpaceSaveTemplatePayload & { principalId: string }) => Promise<object>;
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
  upsertSkill: (
    input: GatewaySkillUpsertPayload,
  ) => GatewaySkillUpsertResponsePayload;
  deleteSkill: (skillId: string) => boolean;
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
    capabilityId: string;
    reason?: string;
    grantedBy?: string;
    expiresAt?: string;
  }) => GatewayGrantCapabilityResponsePayload["grant"];
  revokeCapability: (input: {
    principalId: string;
    deviceId?: string;
    capabilityId: string;
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

export interface SpaceContextService {
  linkSpaces: (
    sourceSpaceId: string,
    targetSpaceId: string,
    mode?: string,
  ) => SpaceLinkResponsePayload["link"];
  unlinkSpaces: (
    sourceSpaceId: string,
    targetSpaceId: string,
  ) => boolean;
  shareContext: (
    sourceSpaceId: string,
    targetSpaceId: string,
    artifactId: string,
  ) => SpaceShareContextResponsePayload["transfer"];
  pullSharedContext: (
    sourceSpaceId: string,
    targetSpaceId: string,
    limit?: number,
  ) => SpacePullSharedContextResponsePayload;
}

export interface SpaceSharingService {
  evaluateAccess: (input: {
    spaceId: string;
    principalId?: string;
    action: "read" | "write";
  }) => {
    allowed: boolean;
    enforced: boolean;
    mode?: "read_only" | "collaborator";
    reason?: string;
  };
  createInvite: (input: {
    spaceId: string;
    issuedByPrincipalId: string;
    mode: "read_only" | "collaborator";
    expiresInSeconds?: number;
  }) => Omit<SpaceShareCreateInviteResponsePayload["invite"], "spaceUid">;
  joinInvite: (input: {
    spaceId: string;
    inviteToken: string;
    principalId: string;
    principalType?: string;
    deviceId?: string;
    devicePublicKey?: string;
    identityModeHint?: "device_key" | "strict_apple_id";
    appleIdAssertion?: string;
    joinRoute?: "direct" | "relay_proxy";
    relaySessionToken?: string;
  }) => Omit<SpaceShareJoinResponsePayload["participant"], "spaceUid">;
  revokeInvite: (input: {
    spaceId: string;
    inviteId: string;
    requestedByPrincipalId: string;
  }) => boolean;
  revokeParticipant: (input: {
    spaceId: string;
    participantId: string;
    requestedByPrincipalId: string;
  }) => boolean;
  listParticipants: (input: {
    spaceId: string;
    requestedByPrincipalId: string;
  }) => Array<Omit<SpaceShareListParticipantsResponsePayload["participants"][number], "spaceUid">>;
  getActiveParticipant?: (
    spaceId: string,
    principalId: string,
  ) => {
    participantId: string;
    mode: "read_only" | "collaborator";
    joinedViaInviteId?: string;
  } | null;
}

export interface TurnHistoryService {
  listSpaceTurns: (input: {
    spaceId: string;
    limit: number;
    offset: number;
    lastSeenTurnId?: string;
  }) => Promise<{
    turns: SpaceTurnPayload[];
    total: number;
  }>;
}

export interface OrchestrationJournalService {
  listEntries: (input: {
    spaceId: string;
    turnId?: string;
    limit: number;
    offset: number;
  }) => Promise<{
    entries: Array<{
      eventId: string;
      spaceId: string;
      turnId?: string;
      seq: number;
      eventType: string;
      actorId: string;
      lineageId?: string;
      hopCount: number;
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
    total: number;
  }>;
}

export interface SpaceMcpService {
  isExternalProfile: () => boolean;
  isConfiguredForSpace: (spaceId: string) => boolean;
  getSpaceEndpoint: (spaceId: string) => SpaceMcpEndpointPayload | null;
  setSpaceEndpoint: (input: SpaceSetMcpEndpointPayload) => Promise<SpaceMcpEndpointPayload>;
  clearSpaceEndpoint: (spaceId: string) => Promise<boolean>;
  discoverSpaceAgents: (spaceId: string) => Promise<{
    endpointId?: string;
    agents: McpDiscoveredAgentPayload[];
  }>;
  approveSpaceAgent: (input: SpaceApproveMcpAgentPayload) => Promise<{
    assignment: unknown;
    binding: ExternalAgentRuntimeBindingPayload;
  }>;
  listBindings: (spaceId: string) => ExternalAgentRuntimeBindingPayload[];
  removeBinding: (spaceId: string, agentId: string) => boolean;
}

export interface SpaceWorkspaceService {
  ensureWorkspace: (spaceId: string) => Promise<SpaceWorkspacePayload>;
  getWorkspace: (spaceId: string) => Promise<SpaceWorkspacePayload>;
  setWorkspace: (spaceId: string, workspaceRoot?: string | null) => Promise<SpaceWorkspacePayload>;
}

export interface SpaceChangeSetService {
  createChangeSet: (input: {
    spaceId: string;
    principalId: string;
    title?: string;
    description?: string;
    adapter?: "filesystem" | "git";
    targetBranch?: string;
    expiresInSeconds?: number;
  }) => Promise<any> | any;
  listChangeSets: (input: {
    spaceId: string;
    principalId: string;
    statuses?: Array<
      "draft"
      | "uploaded"
      | "pending_review"
      | "approved"
      | "applied"
      | "rejected"
      | "expired"
    >;
    limit?: number;
    offset?: number;
  }) => Array<any>;
  uploadFileInit: (input: {
    spaceId: string;
    changeSetId: string;
    principalId: string;
    relativePath: string;
  }) => Promise<any> | any;
  uploadFileComplete: (input: {
    spaceId: string;
    changeSetId: string;
    principalId: string;
    uploadId: string;
    contentBase64?: string;
    sourcePath?: string;
    expectedSha256?: string;
  }) => Promise<any> | any;
  submitChangeSet: (input: {
    spaceId: string;
    changeSetId: string;
    principalId: string;
  }) => any;
  reviewChangeSet: (input: {
    spaceId: string;
    changeSetId: string;
    principalId: string;
    decision: "approved" | "rejected";
    comment?: string;
  }) => Promise<any> | any;
  applyChangeSet: (input: {
    spaceId: string;
    changeSetId: string;
    principalId: string;
  }) => Promise<any> | any;
  getChangeSetDiff: (spaceId: string, changeSetId: string) => Promise<any> | any;
}

export interface SpaceQuotaService {
  getQuota: (spaceId: string, principalId?: string) => any;
  updateQuotaPolicy: (input: {
    spaceId: string;
    updatedBy: string;
    maxStagingBytes?: number;
    maxOpenChangeSets?: number;
    maxAppliedChangeSetsPerMonth?: number;
    tokenBudget?: number;
    maxParticipantStagingBytes?: number;
    maxUploadsPerDay?: number;
    maxOpenChangeSetsPerParticipant?: number;
    maxToolCallsPerHour?: number;
  }) => any;
  getUsage: (
    spaceId: string,
    principalId?: string,
    options?: {
      includeAgentSessions?: boolean;
      includeGlobalLifetime?: boolean;
    },
  ) => any;
  resetAgentUsageSession: (spaceId: string, agentId: string, principalId: string) => any;
}

export interface SpaceTurnTraceService {
  getTurnTrace: (input: {
    spaceId: string;
    turnId: string;
    limit?: number;
    offset?: number;
  }) => Promise<any> | any;
}

export interface SpaceArtifactService {
  listArtifacts: (input: {
    spaceId: string;
    turnId?: string;
    limit?: number;
    offset?: number;
  }) => Promise<any> | any;
  getArtifact: (input: {
    spaceId: string;
    artifactId: string;
  }) => Promise<any> | any;
}

export interface SpaceToolPolicyService {
  getEffectiveTools: (input: {
    spaceId: string;
    principalId?: string;
    deviceId?: string;
    agentId?: string;
  }) => Promise<any> | any;
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

export interface MessageRouterOptions {
  spaceManager: SpaceManager;
  /** Optional space admin service for room lifecycle and agent assignments. */
  spaceAdminService?: SpaceAdminService;
  /** Optional gateway admin service for local client discovery and provider config. */
  gatewayAdminService?: GatewayAdminService;
  /** Optional gateway destructive reset service. */
  gatewayResetService?: GatewayResetService;
  /** Optional connector control-plane service. */
  connectorAdminService?: ConnectorAdminService;
  /** Optional profile CRUD service. */
  profileAdminService?: ProfileAdminService;
  /** Optional gateway-wide allow/deny policy service. */
  gatewayPolicyService?: GatewayPolicyService;
  /** Optional gateway skill catalog service. */
  gatewaySkillCatalogService?: GatewaySkillCatalogService;
  /** Optional gateway knowledge base service for doc/reference metadata. */
  gatewayKnowledgeBaseService?: GatewayKnowledgeBaseService;
  /** Optional runtime capability grant service (principal/device scoped). */
  gatewayCapabilityAccessService?: GatewayCapabilityAccessService;
  /** Optional preset/template configurator service. */
  spaceConfiguratorService?: SpaceConfiguratorService;
  /** Optional usage snapshot read service. */
  usageSnapshotService?: UsageSnapshotService;
  /** Optional scheduler control-plane service. */
  schedulerService?: SchedulerService;
  /** Optional cross-space context transfer service. */
  spaceContextService?: SpaceContextService;
  /** Optional zero-trust sharing service for invite/access controls. */
  spaceSharingService?: SpaceSharingService;
  /** Optional persisted turn history read service. */
  turnHistoryService?: TurnHistoryService;
  /** Optional orchestration journal read service. */
  orchestrationJournalService?: OrchestrationJournalService;
  /** Optional per-space workspace service. */
  spaceWorkspaceService?: SpaceWorkspaceService;
  /** Optional staged collaboration changeset service. */
  spaceChangeSetService?: SpaceChangeSetService;
  /** Optional quota policy and usage service. */
  spaceQuotaService?: SpaceQuotaService;
  /** Optional turn-trace observability service. */
  spaceTurnTraceService?: SpaceTurnTraceService;
  /** Optional artifact read service. */
  spaceArtifactService?: SpaceArtifactService;
  /** Optional effective-tool policy resolver. */
  spaceToolPolicyService?: SpaceToolPolicyService;
  /** Optional MCP endpoint/discovery/binding service. */
  spaceMcpService?: SpaceMcpService;
  /** Optional device lifecycle service for auth.register/rotate/revoke/list operations. */
  deviceIdentityService?: DeviceIdentityService;
  /** Optional orchestrator command service. */
  orchestratorCommandService?: OrchestratorCommandService;
  /** Optional sync announce/query/pull service. */
  gatewaySyncService?: GatewaySyncService;
  /** Optional speech session state machine service. */
  speechSessionService?: SpeechSessionService;
  /** Optional durable approval-resolution sink used by the run ledger. */
  onFeedbackResolved?: (input: {
    turnId: string;
    status: "approved" | "rejected" | "revised" | "deferred";
    resolution?: string;
  }) => void;
  /**
   * Optional signer for short-lived HTTP principal bearer tokens.
   * Used by authenticated WebSocket callers that need to call strict HTTP surfaces.
   */
  issueHttpPrincipalToken?: (input: {
    principalId: string;
    deviceId?: string;
    ttlSeconds?: number;
  }) => Promise<AuthIssueHttpPrincipalTokenResponsePayload> | AuthIssueHttpPrincipalTokenResponsePayload;
  capabilities: CapabilityRegistry;
  logger: Logger;
  /** Send a message to a connected client session (used for adapter invocation). */
  sendToClient?: (clientId: string, msg: GatewayMessage) => void;
  /** Broadcast to all clients subscribed to a space UID topic. */
  broadcastToSpace?: (spaceUid: string, msg: GatewayMessage) => void;
  /** Timeout for adapter invocation round-trips. Default: 30000ms */
  adapterInvocationTimeoutMs?: number;
  /** Enables session-replacement reset/broadcast behavior for main-agent and assignment runtime swaps. */
  agentSessionReplacementEnabled?: boolean;
}

interface PendingAdapterInvocation {
  clientId: string;
  providerId: string;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class MessageRouter {
  private spaceManager: SpaceManager;
  private spaceAdminService: SpaceAdminService | null;
  private gatewayAdminService: GatewayAdminService | null;
  private gatewayResetService: GatewayResetService | null;
  private connectorAdminService: ConnectorAdminService | null;
  private profileAdminService: ProfileAdminService | null;
  private gatewayPolicyService: GatewayPolicyService | null;
  private gatewaySkillCatalogService: GatewaySkillCatalogService | null;
  private gatewayKnowledgeBaseService: GatewayKnowledgeBaseService | null;
  private gatewayCapabilityAccessService: GatewayCapabilityAccessService | null;
  private spaceConfiguratorService: SpaceConfiguratorService | null;
  private usageSnapshotService: UsageSnapshotService | null;
  private schedulerService: SchedulerService | null;
  private spaceContextService: SpaceContextService | null;
  private spaceSharingService: SpaceSharingService | null;
  private turnHistoryService: TurnHistoryService | null;
  private orchestrationJournalService: OrchestrationJournalService | null;
  private spaceWorkspaceService: SpaceWorkspaceService | null;
  private spaceChangeSetService: SpaceChangeSetService | null;
  private spaceQuotaService: SpaceQuotaService | null;
  private spaceTurnTraceService: SpaceTurnTraceService | null;
  private spaceArtifactService: SpaceArtifactService | null;
  private spaceToolPolicyService: SpaceToolPolicyService | null;
  private spaceMcpService: SpaceMcpService | null;
  private deviceIdentityService: DeviceIdentityService | null;
  private orchestratorCommandService: OrchestratorCommandService | null;
  private gatewaySyncService: GatewaySyncService | null;
  private speechSessionService: SpeechSessionService | null;
  private onFeedbackResolved:
    | ((input: {
      turnId: string;
      status: "approved" | "rejected" | "revised" | "deferred";
      resolution?: string;
    }) => void)
    | null;
  private issueHttpPrincipalToken:
    | ((input: {
      principalId: string;
      deviceId?: string;
      ttlSeconds?: number;
    }) => Promise<AuthIssueHttpPrincipalTokenResponsePayload> | AuthIssueHttpPrincipalTokenResponsePayload)
    | null;
  private capabilities: CapabilityRegistry;
  private logger: Logger;
  private sendToClient: (clientId: string, msg: GatewayMessage) => void;
  private broadcastToSpace: (spaceUid: string, msg: GatewayMessage) => void;
  private adapterInvocationTimeoutMs: number;
  private agentSessionReplacementEnabled: boolean;
  /** providerId -> adapter client session id */
  private adapterProviderOwners = new Map<string, string>();
  /** adapter client session id -> provider ids */
  private adapterProvidersByClient = new Map<string, Set<string>>();
  /** invocationId -> pending invocation callbacks */
  private pendingAdapterInvocations = new Map<string, PendingAdapterInvocation>();
  /** spaceId -> immutable spaceUid cache */
  private spaceUidBySpaceId = new Map<string, string>();
  /** immutable spaceUid -> mutable spaceId cache */
  private spaceIdBySpaceUid = new Map<string, string>();

  constructor(options: MessageRouterOptions) {
    this.spaceManager = options.spaceManager;
    this.spaceAdminService = options.spaceAdminService ?? null;
    this.gatewayAdminService = options.gatewayAdminService ?? null;
    this.gatewayResetService = options.gatewayResetService ?? null;
    this.connectorAdminService = options.connectorAdminService ?? null;
    this.profileAdminService = options.profileAdminService ?? null;
    this.gatewayPolicyService = options.gatewayPolicyService ?? null;
    this.gatewaySkillCatalogService = options.gatewaySkillCatalogService ?? null;
    this.gatewayKnowledgeBaseService = options.gatewayKnowledgeBaseService ?? null;
    this.gatewayCapabilityAccessService = options.gatewayCapabilityAccessService ?? null;
    this.spaceConfiguratorService = options.spaceConfiguratorService ?? null;
    this.usageSnapshotService = options.usageSnapshotService ?? null;
    this.schedulerService = options.schedulerService ?? null;
    this.spaceContextService = options.spaceContextService ?? null;
    this.spaceSharingService = options.spaceSharingService ?? null;
    this.turnHistoryService = options.turnHistoryService ?? null;
    this.orchestrationJournalService = options.orchestrationJournalService ?? null;
    this.spaceWorkspaceService = options.spaceWorkspaceService ?? null;
    this.spaceChangeSetService = options.spaceChangeSetService ?? null;
    this.spaceQuotaService = options.spaceQuotaService ?? null;
    this.spaceTurnTraceService = options.spaceTurnTraceService ?? null;
    this.spaceArtifactService = options.spaceArtifactService ?? null;
    this.spaceToolPolicyService = options.spaceToolPolicyService ?? null;
    this.spaceMcpService = options.spaceMcpService ?? null;
    this.deviceIdentityService = options.deviceIdentityService ?? null;
    this.orchestratorCommandService = options.orchestratorCommandService ?? null;
    this.gatewaySyncService = options.gatewaySyncService ?? null;
    this.speechSessionService = options.speechSessionService ?? null;
    this.onFeedbackResolved = options.onFeedbackResolved ?? null;
    this.issueHttpPrincipalToken = options.issueHttpPrincipalToken ?? null;
    this.capabilities = options.capabilities;
    this.logger = options.logger;
    this.sendToClient = options.sendToClient ?? (() => {});
    this.broadcastToSpace = options.broadcastToSpace ?? (() => {});
    this.adapterInvocationTimeoutMs = options.adapterInvocationTimeoutMs ?? 30_000;
    this.agentSessionReplacementEnabled = options.agentSessionReplacementEnabled ?? true;
  }

  /**
   * Clear adapter registrations and pending invocations for a disconnected client.
   */
  onClientDisconnected(clientId: string): void {
    const providers = this.adapterProvidersByClient.get(clientId);
    if (providers) {
      for (const providerId of providers) {
        this.capabilities.deregister(providerId);
        this.adapterProviderOwners.delete(providerId);
      }
      this.adapterProvidersByClient.delete(clientId);
    }

    for (const [invocationId, pending] of this.pendingAdapterInvocations) {
      if (pending.clientId !== clientId) continue;
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Adapter client disconnected during invocation: ${pending.providerId}`));
      this.pendingAdapterInvocations.delete(invocationId);
    }
  }

  /**
   * Handle an incoming WebSocket message. Returns a response message
   * or null (for fire-and-forget / streaming responses).
   */
  async handle(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    this.logger.debug("Routing message", {
      type: msg.type,
      id: msg.id,
      clientId: client.id,
    });

    try {
      const accessError = await this.authorizeSpaceAccess(client, msg);
      if (accessError) {
        return accessError;
      }

      const routed = (() => {
        switch (msg.type) {
          case MessageTypes.EXECUTE_TURN:
            return this.handleExecuteTurn(client, msg);

          case MessageTypes.RESUME_FEEDBACK:
            return this.handleResumeFeedback(client, msg);

          case MessageTypes.CAPABILITY_INVOKE:
            return this.handleCapabilityInvoke(client, msg);

          case MessageTypes.SPACE_CREATE:
            return this.handleSpaceCreate(client, msg);

          case MessageTypes.SPACE_GET:
            return this.handleSpaceGet(client, msg);

          case MessageTypes.SPACE_LIST:
            return this.handleSpaceList(client, msg);

          case MessageTypes.SPACE_ADD_AGENT:
            return this.handleSpaceAddAgent(client, msg);

          case MessageTypes.SPACE_REMOVE_AGENT:
            return this.handleSpaceRemoveAgent(client, msg);

          case MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT:
            return this.handleSpaceUpdateAgentAssignment(client, msg);

          case MessageTypes.SPACE_SET_ORCHESTRATOR:
            return this.handleSpaceSetOrchestrator(client, msg);

          case MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS:
            return this.handleSpaceListAgentAssignments(client, msg);

          case MessageTypes.SPACE_GET_MCP_ENDPOINT:
            return this.handleSpaceGetMcpEndpoint(client, msg);

          case MessageTypes.SPACE_SET_MCP_ENDPOINT:
            return this.handleSpaceSetMcpEndpoint(client, msg);

          case MessageTypes.SPACE_CLEAR_MCP_ENDPOINT:
            return this.handleSpaceClearMcpEndpoint(client, msg);

          case MessageTypes.SPACE_DISCOVER_MCP_AGENTS:
            return this.handleSpaceDiscoverMcpAgents(client, msg);

          case MessageTypes.SPACE_APPROVE_MCP_AGENT:
            return this.handleSpaceApproveMcpAgent(client, msg);

          case MessageTypes.SPACE_ADD_SKILL:
            return this.handleSpaceAddSkill(client, msg);

          case MessageTypes.SPACE_REMOVE_SKILL:
            return this.handleSpaceRemoveSkill(client, msg);

          case MessageTypes.SPACE_LIST_SKILLS:
            return this.handleSpaceListSkills(client, msg);

          case MessageTypes.SPACE_GET_WORKSPACE:
            return this.handleSpaceGetWorkspace(client, msg);

          case MessageTypes.SPACE_SET_WORKSPACE:
            return this.handleSpaceSetWorkspace(client, msg);

          case MessageTypes.SPACE_ADD_RESOURCE:
            return this.handleSpaceAddResource(client, msg);

          case MessageTypes.SPACE_REMOVE_RESOURCE:
            return this.handleSpaceRemoveResource(client, msg);

          case MessageTypes.SPACE_LIST_RESOURCES:
            return this.handleSpaceListResources(client, msg);

          case MessageTypes.SPACE_LIST_TURNS:
            return this.handleSpaceListTurns(client, msg);

          case MessageTypes.SPACE_LIST_ORCHESTRATION_JOURNAL:
            return this.handleSpaceListOrchestrationJournal(client, msg);

          case MessageTypes.PROFILE_CREATE:
            return this.handleProfileCreate(client, msg);

          case MessageTypes.PROFILE_GET:
            return this.handleProfileGet(client, msg);

          case MessageTypes.PROFILE_LIST:
            return this.handleProfileList(client, msg);

          case MessageTypes.PROFILE_UPDATE:
            return this.handleProfileUpdate(client, msg);

          case MessageTypes.PROFILE_ARCHIVE:
            return this.handleProfileArchive(client, msg);

          case MessageTypes.PRESET_LIST:
            return this.handlePresetList(client, msg);

          case MessageTypes.PRESET_GET:
            return this.handlePresetGet(client, msg);

          case MessageTypes.PRESET_APPLY_TO_SPACE:
            return this.handlePresetApplyToSpace(client, msg);

          case MessageTypes.PRESET_SAVE_AGENT:
            return this.handlePresetSaveAgent(client, msg);

          case MessageTypes.PRESET_ARCHIVE_AGENT:
            return this.handlePresetArchiveAgent(client, msg);

          case MessageTypes.SPACE_PREVIEW_TEMPLATE:
            return this.handleSpacePreviewTemplate(client, msg);

          case MessageTypes.SPACE_CREATE_FROM_TEMPLATE:
            return this.handleSpaceCreateFromTemplate(client, msg);

          case MessageTypes.SPACE_SAVE_TEMPLATE:
            return this.handleSpaceSaveTemplate(client, msg);

          case MessageTypes.GATEWAY_DISCOVER_LOCAL_AGENTS:
            return this.handleGatewayDiscoverLocalAgents(client, msg);

          case MessageTypes.GATEWAY_LIST_PROVIDER_CONFIGS:
            return this.handleGatewayListProviderConfigs(client, msg);

          case MessageTypes.GATEWAY_GET_MAIN_AGENT:
            return this.handleGatewayGetMainAgent(client, msg);

          case MessageTypes.GATEWAY_SET_MAIN_AGENT:
            return this.handleGatewaySetMainAgent(client, msg);

          case MessageTypes.GATEWAY_LIST_AVAILABLE_MODELS:
            return this.handleGatewayListAvailableModels(client, msg);

          case MessageTypes.GATEWAY_LIST_PROVIDER_CATALOGS:
            return this.handleGatewayListProviderCatalogs(client, msg);

          case MessageTypes.GATEWAY_CREATE_INTEGRATION_REQUEST:
            return this.handleGatewayCreateIntegrationRequest(client, msg);

          case MessageTypes.GATEWAY_LIST_INTEGRATION_REQUESTS:
            return this.handleGatewayListIntegrationRequests(client, msg);

          case MessageTypes.GATEWAY_GET_PROVIDER_TELEMETRY:
            return this.handleGatewayGetProviderTelemetry(client, msg);

          case MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY:
            return this.handleGatewayGetLocalUsageTelemetry(client, msg);

          case MessageTypes.GATEWAY_GET_PROVIDER_SETTINGS:
            return this.handleGatewayGetProviderSettings(client, msg);

          case MessageTypes.GATEWAY_UPDATE_PROVIDER_SETTINGS:
            return this.handleGatewayUpdateProviderSettings(client, msg);

          case MessageTypes.GATEWAY_SET_PROVIDER_CONFIG:
            return this.handleGatewaySetProviderConfig(client, msg);

          case MessageTypes.GATEWAY_REMOVE_PROVIDER_CONFIG:
            return this.handleGatewayRemoveProviderConfig(client, msg);

          case MessageTypes.GATEWAY_FACTORY_RESET:
            return this.handleGatewayFactoryReset(client, msg);

          case MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE:
            return this.handleGatewayProvisionLocalProfile(client, msg);

          case MessageTypes.GATEWAY_PUT_SECRET_REF:
            return this.handleGatewayPutSecretRef(client, msg);

          case MessageTypes.GATEWAY_LIST_SECRET_REFS:
            return this.handleGatewayListSecretRefs(client, msg);

          case MessageTypes.GATEWAY_DELETE_SECRET_REF:
            return this.handleGatewayDeleteSecretRef(client, msg);

          case MessageTypes.GATEWAY_LIST_CONNECTOR_FAMILIES:
            return this.handleGatewayListConnectorFamilies(client, msg);

          case MessageTypes.GATEWAY_LIST_CONNECTORS:
            return this.handleGatewayListConnectors(client, msg);

          case MessageTypes.GATEWAY_UPSERT_CONNECTOR:
            return this.handleGatewayUpsertConnector(client, msg);

          case MessageTypes.GATEWAY_REMOVE_CONNECTOR:
            return this.handleGatewayRemoveConnector(client, msg);

          case MessageTypes.GATEWAY_LIST_CONNECTOR_BINDINGS:
            return this.handleGatewayListConnectorBindings(client, msg);

          case MessageTypes.GATEWAY_UPSERT_CONNECTOR_BINDING:
            return this.handleGatewayUpsertConnectorBinding(client, msg);

          case MessageTypes.GATEWAY_REMOVE_CONNECTOR_BINDING:
            return this.handleGatewayRemoveConnectorBinding(client, msg);

          case MessageTypes.GATEWAY_GET_CONNECTOR_POLICY:
            return this.handleGatewayGetConnectorPolicy(client, msg);

          case MessageTypes.GATEWAY_UPDATE_CONNECTOR_POLICY:
            return this.handleGatewayUpdateConnectorPolicy(client, msg);

          case MessageTypes.GATEWAY_TEST_CONNECTOR:
            return this.handleGatewayTestConnector(client, msg);

          case MessageTypes.GATEWAY_GET_POLICY:
            return this.handleGatewayGetPolicy(client, msg);

          case MessageTypes.GATEWAY_UPDATE_POLICY:
            return this.handleGatewayUpdatePolicy(client, msg);

          case MessageTypes.GATEWAY_SKILL_LIST:
            return this.handleGatewaySkillList(client, msg);

          case MessageTypes.GATEWAY_SKILL_GET:
            return this.handleGatewaySkillGet(client, msg);

          case MessageTypes.GATEWAY_SKILL_UPSERT:
            return this.handleGatewaySkillUpsert(client, msg);

          case MessageTypes.GATEWAY_SKILL_DELETE:
            return this.handleGatewaySkillDelete(client, msg);

          case MessageTypes.GATEWAY_KB_LIST_ENTRIES:
            return this.handleGatewayKnowledgeBaseListEntries(client, msg);

          case MessageTypes.GATEWAY_KB_UPSERT_ENTRY:
            return this.handleGatewayKnowledgeBaseUpsertEntry(client, msg);

          case MessageTypes.GATEWAY_KB_DELETE_ENTRY:
            return this.handleGatewayKnowledgeBaseDeleteEntry(client, msg);

          case MessageTypes.GATEWAY_LIST_CAPABILITY_GRANTS:
            return this.handleGatewayListCapabilityGrants(client, msg);

          case MessageTypes.GATEWAY_GRANT_CAPABILITY:
            return this.handleGatewayGrantCapability(client, msg);

          case MessageTypes.GATEWAY_REVOKE_CAPABILITY:
            return this.handleGatewayRevokeCapability(client, msg);

          case MessageTypes.USAGE_GET_SNAPSHOT:
            return this.handleUsageGetSnapshot(client, msg);

          case MessageTypes.SCHEDULER_CREATE_JOB:
            return this.handleSchedulerCreateJob(client, msg);

          case MessageTypes.SCHEDULER_GET_JOB:
            return this.handleSchedulerGetJob(client, msg);

          case MessageTypes.SCHEDULER_LIST_JOBS:
            return this.handleSchedulerListJobs(client, msg);

          case MessageTypes.SCHEDULER_UPDATE_JOB:
            return this.handleSchedulerUpdateJob(client, msg);

          case MessageTypes.SCHEDULER_DELETE_JOB:
            return this.handleSchedulerDeleteJob(client, msg);

          case MessageTypes.SCHEDULER_LINK_SPACE:
            return this.handleSchedulerLinkSpace(client, msg);

          case MessageTypes.SCHEDULER_UNLINK_SPACE:
            return this.handleSchedulerUnlinkSpace(client, msg);

          case MessageTypes.SCHEDULER_LIST_RUNS:
            return this.handleSchedulerListRuns(client, msg);

          case MessageTypes.SCHEDULER_RUN_NOW:
            return this.handleSchedulerRunNow(client, msg);

          case MessageTypes.ORCHESTRATOR_COMMAND:
            return this.handleOrchestratorCommand(client, msg);

          case MessageTypes.ORCHESTRATOR_GET_COMMAND:
            return this.handleOrchestratorGetCommand(client, msg);

          case MessageTypes.SPACE_LINK:
            return this.handleSpaceLink(client, msg);

          case MessageTypes.SPACE_UNLINK:
            return this.handleSpaceUnlink(client, msg);

          case MessageTypes.SPACE_SHARE_CONTEXT:
            return this.handleSpaceShareContext(client, msg);

          case MessageTypes.SPACE_PULL_SHARED_CONTEXT:
            return this.handleSpacePullSharedContext(client, msg);

          case MessageTypes.SPACE_SHARE_CREATE_INVITE:
            return this.handleSpaceShareCreateInvite(client, msg);

          case MessageTypes.SPACE_SHARE_JOIN:
            return this.handleSpaceShareJoin(client, msg);

          case MessageTypes.SPACE_SHARE_REVOKE:
            return this.handleSpaceShareRevoke(client, msg);

          case MessageTypes.SPACE_SHARE_LIST_PARTICIPANTS:
            return this.handleSpaceShareListParticipants(client, msg);

          case MessageTypes.SPACE_CREATE_CHANGESET:
            return this.handleSpaceCreateChangeSet(client, msg);

          case MessageTypes.SPACE_LIST_CHANGESETS:
            return this.handleSpaceListChangeSets(client, msg);

          case MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_INIT:
            return this.handleSpaceUploadChangeSetFileInit(client, msg);

          case MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_COMPLETE:
            return this.handleSpaceUploadChangeSetFileComplete(client, msg);

          case MessageTypes.SPACE_SUBMIT_CHANGESET:
            return this.handleSpaceSubmitChangeSet(client, msg);

          case MessageTypes.SPACE_REVIEW_CHANGESET:
            return this.handleSpaceReviewChangeSet(client, msg);

          case MessageTypes.SPACE_APPLY_CHANGESET:
            return this.handleSpaceApplyChangeSet(client, msg);

          case MessageTypes.SPACE_GET_CHANGESET_DIFF:
            return this.handleSpaceGetChangeSetDiff(client, msg);

          case MessageTypes.SPACE_GET_QUOTA:
            return this.handleSpaceGetQuota(client, msg);

          case MessageTypes.SPACE_UPDATE_QUOTA_POLICY:
            return this.handleSpaceUpdateQuotaPolicy(client, msg);

          case MessageTypes.SPACE_GET_USAGE:
            return this.handleSpaceGetUsage(client, msg);

          case MessageTypes.SPACE_GET_TURN_TRACE:
            return this.handleSpaceGetTurnTrace(client, msg);

          case MessageTypes.SPACE_LIST_ARTIFACTS:
            return this.handleSpaceListArtifacts(client, msg);

          case MessageTypes.SPACE_GET_ARTIFACT:
            return this.handleSpaceGetArtifact(client, msg);

          case MessageTypes.SPACE_RESET:
            return this.handleSpaceReset(client, msg);

          case MessageTypes.SPACE_RESET_AGENT_USAGE_SESSION:
            return this.handleSpaceResetAgentUsageSession(client, msg);

          case MessageTypes.SPACE_GET_EFFECTIVE_TOOLS:
            return this.handleSpaceGetEffectiveTools(client, msg);

          case MessageTypes.AUTH_REGISTER_DEVICE:
            return this.handleAuthRegisterDevice(client, msg);

          case MessageTypes.AUTH_ROTATE_DEVICE_KEY:
            return this.handleAuthRotateDeviceKey(client, msg);

          case MessageTypes.AUTH_REVOKE_DEVICE:
            return this.handleAuthRevokeDevice(client, msg);

          case MessageTypes.AUTH_LIST_DEVICES:
            return this.handleAuthListDevices(client, msg);

          case MessageTypes.AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN:
            return this.handleAuthIssueHttpPrincipalToken(client, msg);

          case MessageTypes.SYNC_ANNOUNCE:
            return this.handleSyncAnnounce(client, msg);

          case MessageTypes.SYNC_QUERY_RESOURCES:
            return this.handleSyncQueryResources(client, msg);

          case MessageTypes.SYNC_PULL_RESOURCES:
            return this.handleSyncPullResources(client, msg);

          case MessageTypes.SPEECH_START:
            return this.handleSpeechStart(client, msg);

          case MessageTypes.SPEECH_AUDIO_CHUNK:
            return this.handleSpeechAudioChunk(client, msg);

          case MessageTypes.SPEECH_CONTROL:
            return this.handleSpeechControl(client, msg);

          case MessageTypes.CAPABILITIES_REGISTER:
            return this.handleCapabilitiesRegister(client, msg);

          case MessageTypes.CAPABILITIES_DEREGISTER:
            return this.handleCapabilitiesDeregister(client, msg);

          case MessageTypes.CAPABILITY_RESULT:
            return this.handleCapabilityResult(client, msg);

          case MessageTypes.CAPABILITY_ERROR:
            return this.handleCapabilityError(client, msg);

          case MessageTypes.AUTHENTICATE:
            return this.errorResponse(
              msg.id,
              "INVALID_ARGUMENT",
              "authenticate is handled by GatewayServer transport-level auth flow",
            );

          // Inter-agent messaging
          case MessageTypes.AGENT_MESSAGE:
            return this.handleAgentMessage(client, msg);

          case MessageTypes.AGENT_POKE:
            return this.handleAgentPoke(client, msg);

          // Task dependencies
          case MessageTypes.TASK_DEPENDENCY:
            return this.handleTaskDependency(client, msg);

          default:
            return this.errorResponse(msg.id, "INVALID_ARGUMENT", `Unknown message type: ${msg.type}`);
        }
      })();

      return await routed;
    } catch (err) {
      if (isGatewayErrorLike(err)) {
        return this.errorResponse(msg.id, err.code, err.message);
      }

      const message = err instanceof Error ? err.message : "Internal error";
      this.logger.error("Handler error", err instanceof Error ? err : undefined, {
        type: msg.type,
        id: msg.id,
      });
      return this.errorResponse(msg.id, "INTERNAL", message, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  private async handleExecuteTurn(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    const payload = msg.payload as ExecuteTurnPayload;
    const spaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
    const input = typeof payload?.input === "string" ? payload.input : "";
    const targetAgentId = normalizeString(payload?.targetAgentId);

    if (!spaceUid || !normalizeString(input)) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceUid and input are required");
    }

    const spaceId = await this.resolveSpaceId(spaceUid);
    if (!spaceId) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Space not found for UID: ${spaceUid}`);
    }

    const executionOrigin = this.resolveExecutionOrigin(spaceId, client.publicKey);
    const { turnId } = await this.spaceManager.executeTurn(
      spaceId,
      input,
      targetAgentId,
      {
        principalId: client.publicKey,
        deviceId: client.deviceId,
        executionOrigin,
      },
    );
    const canonicalSpaceUid = await this.resolveSpaceUid(spaceId);

    // Turn events stream via EventBus → pub/sub, so we return an ack
    return this.response(msg.id, MessageTypes.TURN_EVENT, {
      spaceId,
      spaceUid: canonicalSpaceUid,
      turnId,
      eventType: "started",
      data: { turnId },
    } satisfies TurnEventPayload);
  }

  private async handleResumeFeedback(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    const payload = msg.payload as ResumeFeedbackPayload;
    const spaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
    const turnId = normalizeString(payload?.turnId);
    const response = normalizeString(payload?.response) as ResumeFeedbackPayload["response"] | undefined;
    const revision = normalizeString(payload?.revision);

    if (!spaceUid || !turnId || !response) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceUid, turnId, and response are required",
      );
    }

    const spaceId = await this.resolveSpaceId(spaceUid);
    if (!spaceId) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Space not found for UID: ${spaceUid}`);
    }

    await this.spaceManager.resumeFeedback(
      spaceId,
      turnId,
      response,
      revision,
    );
    this.onFeedbackResolved?.({
      turnId,
      status: response === "approve"
        ? "approved"
        : response === "reject"
          ? "rejected"
          : response === "revise"
            ? "revised"
            : "deferred",
      resolution: revision,
    });
    const canonicalSpaceUid = await this.resolveSpaceUid(spaceId);

    return this.response(msg.id, MessageTypes.TURN_EVENT, {
      spaceId,
      spaceUid: canonicalSpaceUid,
      turnId,
      eventType: "started",
      data: { resumed: true },
    } satisfies TurnEventPayload);
  }

  private async handleCapabilityInvoke(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    const payload = msg.payload as CapabilityInvokePayload;

    if (!payload.capability || !payload.method) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "capability and method are required",
      );
    }

    const result = await this.capabilities.invoke({
      capability: payload.capability as CapabilityType,
      operation: payload.method,
      args: payload.params ?? {},
      targetProvider: payload.targetProvider,
    }, {
      principalId: client.publicKey,
      deviceId: client.deviceId,
    });

    return this.response(msg.id, "capability_result", result);
  }

  private async handleSpaceCreate(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceCreatePayload;
    if (!payload?.resourceId || !payload?.name) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "resourceId and name are required");
    }
    if (payload.workspaceRoot !== undefined && !this.spaceWorkspaceService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space workspace service unavailable");
    }

    const space = await this.spaceAdminService.createSpace({
      idempotencyKey: payload.idempotencyKey,
      spaceId: payload.spaceId,
      resourceId: payload.resourceId,
      spaceType: payload.spaceType,
      name: payload.name,
      goal: payload.goal,
      turnModel: payload.turnModel as any,
      templateId: payload.templateId,
      templateRevision: payload.templateRevision,
      capabilities: payload.capabilities,
      capabilityOverrides: payload.capabilityOverrides,
      visibility: payload.visibility,
      turnModelConfig: payload.turnModelConfig as any,
      maxTurns: payload.maxTurns,
      moderatorProfileId: payload.moderatorProfileId,
      initialAgents: Array.isArray(payload.initialAgents)
        ? payload.initialAgents.map((agent) => ({
          agentId: agent.agentId,
          profileId: agent.profileId,
          securityScope: agent.securityScope as any,
          role: agent.role,
          turnOrder: agent.turnOrder,
          isPrimary: agent.isPrimary,
        }))
        : undefined,
    });
    if (this.spaceWorkspaceService) {
      if (payload.workspaceRoot !== undefined) {
        await this.spaceWorkspaceService.setWorkspace(space.id, payload.workspaceRoot);
      } else {
        await this.spaceWorkspaceService.ensureWorkspace(space.id);
      }
    }

    return this.response(msg.id, MessageTypes.SPACE_CREATE, {
      space: await this.decorateSpaceSummary(space as SpaceSummary),
    });
  }

  private async handleSpaceGet(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceGetPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const space = await this.spaceAdminService.getSpace(payload.spaceId);
    if (!space) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Space not found: ${payload.spaceId}`);
    }

    return this.response(msg.id, MessageTypes.SPACE_GET, {
      space: await this.decorateSpaceSummary(space as SpaceSummary),
    });
  }

  private async handleSpaceList(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = (msg.payload ?? {}) as SpaceListPayload;
    const spaces = await this.spaceAdminService.listSpaces({
      statuses: parseSpaceStatuses(payload.statuses),
      resourceId: payload.resourceId,
      limit: payload.limit,
    });

    if (!this.spaceSharingService) {
      return this.response(msg.id, MessageTypes.SPACE_LIST, {
        spaces: await this.decorateSpaceListSummaries(spaces as SpaceSummary[]),
      });
    }

    const principalId = client.publicKey?.trim();
    const visibleSpaces = spaces.filter((space) => {
      const decision = this.spaceSharingService!.evaluateAccess({
        spaceId: space.id,
        principalId,
        action: "read",
      });
      return decision.allowed;
    });

    return this.response(msg.id, MessageTypes.SPACE_LIST, {
      spaces: await this.decorateSpaceListSummaries(visibleSpaces as SpaceSummary[]),
    });
  }

  private async handleSpaceAddAgent(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceAddAgentPayload;
    if (!payload?.spaceId || !payload?.agentId || !payload?.profileId) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId, agentId, and profileId are required",
      );
    }

    const assignment = await this.spaceAdminService.addAgent({
      idempotencyKey: payload.idempotencyKey,
      spaceId: payload.spaceId,
      agentId: payload.agentId,
      profileId: payload.profileId,
      securityScope: payload.securityScope as any,
      role: payload.role,
      turnOrder: payload.turnOrder,
      isPrimary: payload.isPrimary,
    });

    this.spaceManager.invalidateCache(payload.spaceId);

    const space = await this.spaceAdminService.getSpace(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_ADD_AGENT, {
      assignment,
      space: space ? await this.decorateSpaceSummary(space as SpaceSummary) : space,
    });
  }

  private async handleSpaceRemoveAgent(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceRemoveAgentPayload;
    if (!payload?.spaceId || !payload?.agentId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and agentId are required");
    }

    const removed = await this.spaceAdminService.removeAgent(
      payload.spaceId,
      payload.agentId,
      payload.idempotencyKey,
    );

    if (removed && this.spaceMcpService) {
      this.spaceMcpService.removeBinding(payload.spaceId, payload.agentId);
    }

    this.spaceManager.invalidateCache(payload.spaceId);

    const space = await this.spaceAdminService.getSpace(payload.spaceId);
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_REMOVE_AGENT, {
      removed,
      spaceId: payload.spaceId,
      spaceUid,
      agentId: payload.agentId,
      space: space ? await this.decorateSpaceSummary(space as SpaceSummary) : space,
    });
  }

  private async handleSpaceUpdateAgentAssignment(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceUpdateAgentAssignmentPayload;
    if (!payload?.spaceId || !payload?.agentId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and agentId are required");
    }

    const previousAssignments = await this.spaceAdminService.listAgentAssignments(payload.spaceId);
    const previousAssignment = previousAssignments.find((entry) => entry.agentId === payload.agentId);
    const assignment = await this.spaceAdminService.updateAgentAssignment({
      idempotencyKey: payload.idempotencyKey,
      spaceId: payload.spaceId,
      agentId: payload.agentId,
      profileId: payload.profileId,
      securityScope: payload.securityScope as any,
      spawnContext: payload.spawnContext,
      contextOverrides: payload.contextOverrides as any,
      role: payload.role,
      turnOrder: payload.turnOrder,
      isPrimary: payload.isPrimary,
    });

    this.spaceManager.invalidateCache(payload.spaceId);

    const profileChanged = previousAssignment
      ? previousAssignment.profileId !== assignment.profileId
      : false;
    const shouldResetSession = profileChanged
      || (this.agentSessionReplacementEnabled && payload.resetSession === true);

    if (shouldResetSession) {
      if (this.spaceQuotaService) {
        try {
          const resetPrincipalId = this.resolveSessionResetPrincipal(client);
          this.spaceQuotaService.resetAgentUsageSession(
            payload.spaceId,
            payload.agentId,
            resetPrincipalId,
          );
        } catch {
          // Non-fatal — log but don't fail the assignment update
        }
      }

      const spaceUid = await this.resolveSpaceUid(payload.spaceId);
      this.broadcastToSpace(spaceUid, {
        type: MessageTypes.SPACE_AGENT_UPDATED,
        id: randomUUID(),
        ts: new Date().toISOString(),
        payload: {
          spaceId: payload.spaceId,
          spaceUid,
          agentId: payload.agentId,
          oldProfileId: previousAssignment?.profileId ?? assignment.profileId,
          newProfileId: assignment.profileId,
          updatedAt: new Date().toISOString(),
        } satisfies SpaceAgentUpdatedEventPayload,
      });
    }

    const space = await this.spaceAdminService.getSpace(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      assignment,
      space: space ? await this.decorateSpaceSummary(space as SpaceSummary) : space,
    });
  }

  private async handleSpaceSetOrchestrator(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceSetOrchestratorPayload;
    if (!payload?.spaceId || !payload?.profileId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and profileId are required");
    }

    const space = await this.spaceAdminService.setSpaceOrchestrator({
      idempotencyKey: payload.idempotencyKey,
      spaceId: payload.spaceId,
      profileId: payload.profileId,
    });

    return this.response(msg.id, MessageTypes.SPACE_SET_ORCHESTRATOR, {
      space: await this.decorateSpaceSummary(space as SpaceSummary),
    });
  }

  private async handleSpaceListAgentAssignments(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceListAgentAssignmentsPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const assignments = await this.spaceAdminService.listAgentAssignments(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS, {
      assignments: this.decorateAssignments(payload.spaceId, assignments as SpaceAssignmentSummary[]),
    });
  }

  private async handleSpaceGetMcpEndpoint(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceMcpService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
    }

    const payload = msg.payload as SpaceGetMcpEndpointPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const endpoint = this.spaceMcpService.getSpaceEndpoint(payload.spaceId) ?? undefined;
    return this.response(msg.id, MessageTypes.SPACE_GET_MCP_ENDPOINT, {
      spaceId: payload.spaceId,
      endpoint,
      fallbackEnabled: this.spaceMcpService.isConfiguredForSpace(payload.spaceId),
    } satisfies SpaceGetMcpEndpointResponsePayload);
  }

  private async handleSpaceSetMcpEndpoint(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceMcpService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
    }

    const payload = msg.payload as SpaceSetMcpEndpointPayload;
    if (!payload?.spaceId || !payload?.transport || !payload?.endpoint) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId, transport, and endpoint are required",
      );
    }

    const endpoint = await this.spaceMcpService.setSpaceEndpoint(payload);
    this.spaceManager.invalidateCache(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_SET_MCP_ENDPOINT, {
      endpoint,
    } satisfies SpaceSetMcpEndpointResponsePayload);
  }

  private async handleSpaceClearMcpEndpoint(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceMcpService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
    }

    const payload = msg.payload as SpaceClearMcpEndpointPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const cleared = await this.spaceMcpService.clearSpaceEndpoint(payload.spaceId);
    this.spaceManager.invalidateCache(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_CLEAR_MCP_ENDPOINT, {
      spaceId: payload.spaceId,
      cleared,
    } satisfies SpaceClearMcpEndpointResponsePayload);
  }

  private async handleSpaceDiscoverMcpAgents(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceMcpService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
    }

    const payload = msg.payload as SpaceDiscoverMcpAgentsPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const result = await this.spaceMcpService.discoverSpaceAgents(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_DISCOVER_MCP_AGENTS, {
      spaceId: payload.spaceId,
      endpointId: result.endpointId,
      agents: result.agents,
    } satisfies SpaceDiscoverMcpAgentsResponsePayload);
  }

  private async handleSpaceApproveMcpAgent(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceMcpService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
    }

    const payload = msg.payload as SpaceApproveMcpAgentPayload;
    if (!payload?.spaceId || !payload?.remoteAgentId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and remoteAgentId are required");
    }

    const result = await this.spaceMcpService.approveSpaceAgent(payload);
    this.spaceManager.invalidateCache(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_APPROVE_MCP_AGENT, {
      spaceId: payload.spaceId,
      assignment: this.decorateAssignments(
        payload.spaceId,
        [result.assignment as unknown as SpaceAssignmentSummary],
      )[0],
      binding: result.binding,
    } satisfies SpaceApproveMcpAgentResponsePayload);
  }

  private async handleSpaceAddSkill(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceAddSkillPayload;
    if (!payload?.spaceId || !payload?.skillId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and skillId are required");
    }

    const skills = await this.spaceAdminService.addSkillToSpace({
      idempotencyKey: payload.idempotencyKey,
      spaceId: payload.spaceId,
      skillId: payload.skillId,
    });
    const space = await this.spaceAdminService.getSpace(payload.spaceId);
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    return this.response(msg.id, MessageTypes.SPACE_ADD_SKILL, {
      spaceId: payload.spaceId,
      spaceUid,
      skillId: payload.skillId,
      skills,
      space: space ? await this.decorateSpaceSummary(space as SpaceSummary) : space,
    } satisfies SpaceAddSkillResponsePayload);
  }

  private async handleSpaceRemoveSkill(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceRemoveSkillPayload;
    if (!payload?.spaceId || !payload?.skillId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and skillId are required");
    }

    const result = await this.spaceAdminService.removeSkillFromSpace({
      idempotencyKey: payload.idempotencyKey,
      spaceId: payload.spaceId,
      skillId: payload.skillId,
    });
    const space = await this.spaceAdminService.getSpace(payload.spaceId);
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    return this.response(msg.id, MessageTypes.SPACE_REMOVE_SKILL, {
      removed: result.removed,
      spaceId: payload.spaceId,
      spaceUid,
      skillId: payload.skillId,
      skills: result.skills,
      space: space ? await this.decorateSpaceSummary(space as SpaceSummary) : space,
    } satisfies SpaceRemoveSkillResponsePayload);
  }

  private async handleSpaceListSkills(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceListSkillsPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const skills = await this.spaceAdminService.listSpaceSkills(payload.spaceId);
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_LIST_SKILLS, {
      spaceId: payload.spaceId,
      spaceUid,
      skills,
    } satisfies SpaceListSkillsResponsePayload);
  }

  private async handleSpaceGetWorkspace(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceWorkspaceService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space workspace service unavailable");
    }

    const payload = msg.payload as SpaceGetWorkspacePayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const workspace = await this.spaceWorkspaceService.getWorkspace(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_GET_WORKSPACE, {
      workspace,
    } satisfies SpaceGetWorkspaceResponsePayload);
  }

  private async handleSpaceSetWorkspace(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceWorkspaceService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space workspace service unavailable");
    }

    const payload = msg.payload as SpaceSetWorkspacePayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const workspace = await this.spaceWorkspaceService.setWorkspace(
      payload.spaceId,
      payload.workspaceRoot ?? null,
    );
    return this.response(msg.id, MessageTypes.SPACE_SET_WORKSPACE, {
      workspace,
    } satisfies SpaceSetWorkspaceResponsePayload);
  }

  private async handleSpaceAddResource(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceAddResourcePayload;
    if (!payload?.spaceId || !payload?.uri || !payload?.type) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId, uri, and type are required",
      );
    }
    if (this.spaceWorkspaceService) {
      await this.spaceWorkspaceService.ensureWorkspace(payload.spaceId);
    }

    const resource = await this.spaceAdminService.addResource({
      apiVersion: payload.apiVersion,
      idempotencyKey: payload.idempotencyKey,
      resourceId: payload.resourceId,
      spaceId: payload.spaceId,
      uri: payload.uri,
      type: payload.type,
      label: payload.label,
    });

    return this.response(msg.id, MessageTypes.SPACE_ADD_RESOURCE, {
      resource: {
        resourceId: resource.resourceId,
        spaceId: resource.spaceId,
        spaceUid: await this.resolveSpaceUid(resource.spaceId),
        uri: resource.uri,
        type: resource.type,
        label: resource.label,
        addedAt: resource.addedAt.toISOString(),
      },
    } satisfies SpaceAddResourceResponsePayload);
  }

  private async handleSpaceRemoveResource(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceRemoveResourcePayload;
    if (!payload?.spaceId || !payload?.resourceId) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId and resourceId are required",
      );
    }
    if (this.spaceWorkspaceService) {
      await this.spaceWorkspaceService.ensureWorkspace(payload.spaceId);
    }

    const removed = await this.spaceAdminService.removeResource({
      apiVersion: payload.apiVersion,
      idempotencyKey: payload.idempotencyKey,
      spaceId: payload.spaceId,
      resourceId: payload.resourceId,
    });
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    return this.response(msg.id, MessageTypes.SPACE_REMOVE_RESOURCE, {
      removed,
      spaceId: payload.spaceId,
      spaceUid,
      resourceId: payload.resourceId,
    } satisfies SpaceRemoveResourceResponsePayload);
  }

  private async handleSpaceListResources(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
    }

    const payload = msg.payload as SpaceListResourcesPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    if (this.spaceWorkspaceService) {
      await this.spaceWorkspaceService.ensureWorkspace(payload.spaceId);
    }
    const resources = await this.spaceAdminService.listResources(payload.spaceId);
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);
    return this.response(msg.id, MessageTypes.SPACE_LIST_RESOURCES, {
      spaceId: payload.spaceId,
      spaceUid,
      resources: resources.map((resource) => ({
        resourceId: resource.resourceId,
        spaceId: resource.spaceId,
        spaceUid: spaceUid,
        uri: resource.uri,
        type: resource.type,
        label: resource.label,
        addedAt: resource.addedAt.toISOString(),
      })),
    } satisfies SpaceListResourcesResponsePayload);
  }

  private async handleSpaceListTurns(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.turnHistoryService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Turn history service unavailable");
    }

    const payload = (msg.payload ?? {}) as SpaceListTurnsPayload;
    const requestedSpaceId = normalizeString(payload?.spaceId);
    const requestedSpaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
    const resolvedSpaceId = requestedSpaceId
      ?? (requestedSpaceUid ? await this.resolveSpaceId(requestedSpaceUid) : null);
    if (!resolvedSpaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId or spaceUid is required");
    }

    const parsedLimit = parsePaginationInt(payload?.limit, {
      field: "limit",
      defaultValue: 100,
      min: 1,
      max: 500,
    });
    if (!parsedLimit.ok) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", parsedLimit.message);
    }

    const lastSeenTurnId = normalizeString(payload?.lastSeenTurnId);
    let parsedOffset: { ok: true; value: number } | { ok: false; message: string };
    if (lastSeenTurnId) {
      parsedOffset = { ok: true, value: 0 };
    } else {
      parsedOffset = parsePaginationInt(payload?.offset, {
        field: "offset",
        defaultValue: 0,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
      });
      if (!parsedOffset.ok) {
        return this.errorResponse(msg.id, "INVALID_ARGUMENT", parsedOffset.message);
      }
    }

    const history = await this.turnHistoryService.listSpaceTurns({
      spaceId: resolvedSpaceId,
      limit: parsedLimit.value,
      offset: parsedOffset.value,
      lastSeenTurnId,
    });
    const normalizedTurns = Array.isArray(history.turns) ? history.turns : [];
    const total = Number.isFinite(history.total)
      ? Math.max(0, Math.trunc(history.total))
      : normalizedTurns.length;
    const nextOffset = lastSeenTurnId
      ? undefined
      : (
        parsedOffset.value + normalizedTurns.length < total
          ? parsedOffset.value + normalizedTurns.length
          : undefined
      );

    return this.response(msg.id, MessageTypes.SPACE_LIST_TURNS, {
      spaceId: resolvedSpaceId,
      spaceUid: await this.resolveSpaceUid(resolvedSpaceId),
      turns: normalizedTurns,
      total,
      nextOffset,
    } satisfies SpaceListTurnsResponsePayload);
  }

  private async handleSpaceListOrchestrationJournal(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.orchestrationJournalService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Orchestration journal service unavailable");
    }

    const payload = (msg.payload ?? {}) as SpaceListOrchestrationJournalPayload;
    const requestedSpaceId = normalizeString(payload?.spaceId);
    const requestedSpaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
    const resolvedSpaceId = requestedSpaceId
      ?? (requestedSpaceUid ? await this.resolveSpaceId(requestedSpaceUid) : null);
    if (!resolvedSpaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId or spaceUid is required");
    }

    const parsedLimit = parsePaginationInt(payload?.limit, {
      field: "limit",
      defaultValue: 50,
      min: 1,
      max: 500,
    });
    if (!parsedLimit.ok) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", parsedLimit.message);
    }

    const parsedOffset = parsePaginationInt(payload?.offset, {
      field: "offset",
      defaultValue: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    if (!parsedOffset.ok) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", parsedOffset.message);
    }

    const turnId = normalizeString(payload.turnId);
    const history = await this.orchestrationJournalService.listEntries({
      spaceId: resolvedSpaceId,
      turnId,
      limit: parsedLimit.value,
      offset: parsedOffset.value,
    });
    const normalizedEntries = Array.isArray(history.entries) ? history.entries : [];
    const total = Number.isFinite(history.total)
      ? Math.max(0, Math.trunc(history.total))
      : normalizedEntries.length;
    const nextOffset = parsedOffset.value + normalizedEntries.length < total
      ? parsedOffset.value + normalizedEntries.length
      : undefined;
    const spaceUid = await this.resolveSpaceUid(resolvedSpaceId);

    return this.response(msg.id, MessageTypes.SPACE_LIST_ORCHESTRATION_JOURNAL, {
      spaceId: resolvedSpaceId,
      spaceUid,
      entries: normalizedEntries.map((entry) => ({
        eventId: entry.eventId,
        spaceId: resolvedSpaceId,
        spaceUid,
        turnId: normalizeString(entry.turnId),
        seq: entry.seq,
        eventType: entry.eventType,
        actorId: entry.actorId,
        lineageId: normalizeString(entry.lineageId),
        hopCount: entry.hopCount,
        payload: entry.payload,
        createdAt: entry.createdAt,
      })),
      total,
      nextOffset,
    } satisfies SpaceListOrchestrationJournalResponsePayload);
  }

  private async handleGatewayDiscoverLocalAgents(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const agents = await this.gatewayAdminService.discoverLocalAgents();
    return this.response(msg.id, MessageTypes.GATEWAY_DISCOVER_LOCAL_AGENTS, {
      agents,
    } satisfies GatewayDiscoverLocalAgentsResponsePayload);
  }

  private async handleGatewayListProviderConfigs(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const configs = this.gatewayAdminService.listProviderConfigs();
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_PROVIDER_CONFIGS, {
      configs,
    } satisfies GatewayListProviderConfigsResponsePayload);
  }

  private async handleGatewayGetMainAgent(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = (msg.payload ?? {}) as GatewayGetMainAgentPayload;
    const state = await this.gatewayAdminService.getMainAgent({
      apiVersion: normalizeString(payload.apiVersion),
      spaceId: normalizeString(payload.spaceId),
      repairIfMissing: payload.repairIfMissing === undefined ? undefined : payload.repairIfMissing === true,
    });
    if (state.repaired || state.fallbackApplied) {
      this.spaceManager.invalidateCache(state.spaceId);
    }
    return this.response(msg.id, MessageTypes.GATEWAY_GET_MAIN_AGENT, {
      state,
    } satisfies GatewayGetMainAgentResponsePayload);
  }

  private async handleGatewaySetMainAgent(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = (msg.payload ?? {}) as GatewaySetMainAgentPayload;
    const selectionMode = normalizeString(payload.selectionMode);
    if (selectionMode !== "provider_model" && selectionMode !== "profile_template") {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "selectionMode must be either provider_model or profile_template",
      );
    }

    if (selectionMode === "provider_model") {
      if (!normalizeString(payload.providerId) || !normalizeString(payload.modelId)) {
        return this.errorResponse(
          msg.id,
          "INVALID_ARGUMENT",
          "providerId and modelId are required for provider_model selection",
        );
      }
    } else if (!normalizeString(payload.sourceProfileId)) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "sourceProfileId is required for profile_template selection",
      );
    }

    const normalizedSpaceId = normalizeString(payload.spaceId);
    let previousState: GatewayGetMainAgentResponsePayload["state"] | null = null;
    if (this.agentSessionReplacementEnabled) {
      try {
        previousState = await this.gatewayAdminService.getMainAgent({
          apiVersion: normalizeString(payload.apiVersion),
          spaceId: normalizedSpaceId,
          repairIfMissing: false,
        });
      } catch {
        // Non-fatal — current state snapshot is best-effort before swap.
      }
    }

    const state = await this.gatewayAdminService.setMainAgent({
      apiVersion: normalizeString(payload.apiVersion),
      spaceId: normalizedSpaceId,
      selectionMode,
      providerId: normalizeString(payload.providerId),
      modelId: normalizeString(payload.modelId),
      sourceProfileId: normalizeString(payload.sourceProfileId),
      copyPersonality: payload.copyPersonality === undefined ? true : payload.copyPersonality === true,
    });
    this.spaceManager.invalidateCache(state.spaceId);

    if (this.agentSessionReplacementEnabled) {
      if (this.spaceQuotaService) {
        try {
          const resetPrincipalId = this.resolveSessionResetPrincipal(client);
          this.spaceQuotaService.resetAgentUsageSession(
            state.spaceId,
            state.mainAgentId,
            resetPrincipalId,
          );
        } catch {
          // Non-fatal — swap succeeded even if session reset telemetry call fails.
        }
      }

      const spaceUid = normalizeString(state.spaceUid) ?? await this.resolveSpaceUid(state.spaceId);
      this.broadcastToSpace(spaceUid, {
        type: MessageTypes.SPACE_AGENT_UPDATED,
        id: randomUUID(),
        ts: new Date().toISOString(),
        payload: {
          spaceId: state.spaceId,
          spaceUid,
          agentId: state.mainAgentId,
          oldProfileId: previousState?.mainProfileId ?? state.mainProfileId,
          newProfileId: state.mainProfileId,
          updatedAt: new Date().toISOString(),
        } satisfies SpaceAgentUpdatedEventPayload,
      });
    }

    return this.response(msg.id, MessageTypes.GATEWAY_SET_MAIN_AGENT, {
      state,
    } satisfies GatewaySetMainAgentResponsePayload);
  }

  private async handleGatewayListAvailableModels(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayListAvailableModelsPayload;
    const providers = await this.gatewayAdminService.listAvailableModels({
      providerId: normalizeString(payload?.providerId),
    });
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_AVAILABLE_MODELS, {
      providers,
      generatedAt: new Date().toISOString(),
    } satisfies GatewayListAvailableModelsResponsePayload);
  }

  private async handleGatewayListProviderCatalogs(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayListProviderCatalogsPayload;
    const providers = await this.gatewayAdminService.listProviderCatalogs({
      providerId: normalizeString(payload?.providerId),
    });
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_PROVIDER_CATALOGS, {
      providers,
      generatedAt: new Date().toISOString(),
    } satisfies GatewayListProviderCatalogsResponsePayload);
  }

  private async handleGatewayCreateIntegrationRequest(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayCreateIntegrationRequestPayload;
    if (!payload?.integrationClass || !normalizeString(payload?.requestedName)) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "integrationClass and requestedName are required");
    }

    const request = this.gatewayAdminService.createIntegrationRequest(
      payload,
      client.publicKey ?? undefined,
      client.deviceId ?? undefined,
    );
    return this.response(msg.id, MessageTypes.GATEWAY_CREATE_INTEGRATION_REQUEST, {
      request,
    } satisfies GatewayCreateIntegrationRequestResponsePayload);
  }

  private async handleGatewayListIntegrationRequests(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayListIntegrationRequestsPayload;
    const requests = this.gatewayAdminService.listIntegrationRequests({
      integrationClass: payload?.integrationClass,
      limit: payload?.limit,
    });
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_INTEGRATION_REQUESTS, {
      requests,
    } satisfies GatewayListIntegrationRequestsResponsePayload);
  }

  private async handleGatewayGetProviderTelemetry(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayGetProviderTelemetryPayload;
    const providerId = normalizeString(payload?.providerId)?.toLowerCase();
    if (payload?.providerId !== undefined && !providerId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId must be a non-empty string");
    }

    if (providerId) {
      const configuredProviders = new Set(
        this.gatewayAdminService
          .listProviderConfigs()
          .map((entry) => entry.providerId.trim().toLowerCase()),
      );
      if (!configuredProviders.has(providerId)) {
        return this.errorResponse(
          msg.id,
          "INVALID_ARGUMENT",
          `providerId is not configured: ${providerId}`,
        );
      }
    }

    const telemetry = await this.gatewayAdminService.getProviderTelemetry(
      providerId ? { providerId } : undefined,
    );
    return this.response(msg.id, MessageTypes.GATEWAY_GET_PROVIDER_TELEMETRY, {
      telemetry,
      generatedAt: new Date().toISOString(),
    } satisfies GatewayGetProviderTelemetryResponsePayload);
  }

  private async handleGatewayGetLocalUsageTelemetry(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayGetLocalUsageTelemetryPayload;
    const providerId = normalizeString(payload?.providerId)?.toLowerCase();
    if (payload?.providerId !== undefined && !providerId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId must be a non-empty string");
    }

    if (providerId) {
      const configuredProviders = new Set(
        this.gatewayAdminService
          .listProviderConfigs()
          .map((entry) => entry.providerId.trim().toLowerCase()),
      );
      if (!configuredProviders.has(providerId)) {
        return this.errorResponse(
          msg.id,
          "INVALID_ARGUMENT",
          `providerId is not configured: ${providerId}`,
        );
      }
    }

    const telemetry = await this.gatewayAdminService.getLocalUsageTelemetry(
      providerId ? { providerId } : undefined,
    );
    return this.response(msg.id, MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY, {
      telemetry,
      generatedAt: new Date().toISOString(),
    } satisfies GatewayGetLocalUsageTelemetryResponsePayload);
  }

  private async handleGatewayGetProviderSettings(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayGetProviderSettingsPayload;
    if (!payload?.providerId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId is required");
    }

    const settings = this.gatewayAdminService.getProviderSettings(payload.providerId);
    return this.response(msg.id, MessageTypes.GATEWAY_GET_PROVIDER_SETTINGS, {
      settings,
    } satisfies GatewayGetProviderSettingsResponsePayload);
  }

  private async handleGatewayUpdateProviderSettings(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayUpdateProviderSettingsPayload;
    if (!payload?.providerId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId is required");
    }

    const settings = this.gatewayAdminService.updateProviderSettings(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_UPDATE_PROVIDER_SETTINGS, {
      settings,
    } satisfies GatewayUpdateProviderSettingsResponsePayload);
  }

  private async handleGatewaySetProviderConfig(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewaySetProviderConfigPayload;
    if (!payload?.providerId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId is required");
    }

    const config = this.gatewayAdminService.setProviderConfig(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_SET_PROVIDER_CONFIG, {
      config,
    } satisfies GatewaySetProviderConfigResponsePayload);
  }

  private async handleGatewayRemoveProviderConfig(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayRemoveProviderConfigPayload;
    if (!payload?.providerId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId is required");
    }

    this.gatewayAdminService.removeProviderConfig(payload.providerId);
    return this.response(msg.id, MessageTypes.GATEWAY_REMOVE_PROVIDER_CONFIG, {
      providerId: payload.providerId,
    } satisfies GatewayRemoveProviderConfigResponsePayload);
  }

  private async handleGatewayFactoryReset(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayResetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway reset service unavailable");
    }

    const requestedBy = normalizeString(client.publicKey);
    if (!requestedBy) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = (msg.payload ?? {}) as GatewayFactoryResetPayload;
    if (typeof payload.confirmation !== "string" || payload.confirmation.trim().length === 0) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "confirmation is required");
    }

    const result = await this.gatewayResetService.factoryResetGateway({
      apiVersion: normalizeString(payload.apiVersion),
      confirmation: payload.confirmation,
      requestedBy,
      requestedDeviceId: normalizeString(client.deviceId),
    });
    return this.response(msg.id, MessageTypes.GATEWAY_FACTORY_RESET, result satisfies GatewayFactoryResetResponsePayload);
  }

  private async handleGatewayProvisionLocalProfile(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayProvisionLocalProfilePayload;
    if (!payload?.localClientId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "localClientId is required");
    }

    const result = await this.gatewayAdminService.provisionLocalProfile(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE, result);
  }

  private async handleGatewayPutSecretRef(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayPutSecretRefPayload;
    if (!payload?.providerId || !payload?.secret) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId and secret are required");
    }

    const result = this.gatewayAdminService.putSecretRef(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_PUT_SECRET_REF, result);
  }

  private async handleGatewayListSecretRefs(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = (msg.payload ?? {}) as GatewayListSecretRefsPayload;
    const secretRefs = this.gatewayAdminService.listSecretRefs(normalizeString(payload.providerId));
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_SECRET_REFS, {
      secretRefs,
    } satisfies GatewayListSecretRefsResponsePayload);
  }

  private async handleGatewayDeleteSecretRef(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
    }

    const payload = msg.payload as GatewayDeleteSecretRefPayload;
    if (!payload?.secretRef) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "secretRef is required");
    }

    const deleted = this.gatewayAdminService.deleteSecretRef(payload.secretRef);
    return this.response(msg.id, MessageTypes.GATEWAY_DELETE_SECRET_REF, {
      secretRef: payload.secretRef,
      deleted,
    } satisfies GatewayDeleteSecretRefResponsePayload);
  }

  private async handleGatewayListConnectorFamilies(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const families = this.connectorAdminService.listConnectorFamilies();
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_CONNECTOR_FAMILIES, {
      families,
    } satisfies GatewayListConnectorFamiliesResponsePayload);
  }

  private async handleGatewayListConnectors(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = (msg.payload ?? {}) as GatewayListConnectorsPayload;
    const connectors = this.connectorAdminService.listConnectors(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_CONNECTORS, {
      connectors,
    } satisfies GatewayListConnectorsResponsePayload);
  }

  private async handleGatewayUpsertConnector(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = msg.payload as GatewayUpsertConnectorPayload;
    if (!payload?.familyId || !payload?.displayName || !payload?.accountFingerprint || !payload?.label) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "familyId, displayName, accountFingerprint, and label are required",
      );
    }

    const connector = this.connectorAdminService.upsertConnector(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_UPSERT_CONNECTOR, {
      connector,
    } satisfies GatewayUpsertConnectorResponsePayload);
  }

  private async handleGatewayRemoveConnector(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = msg.payload as GatewayRemoveConnectorPayload;
    if (!payload?.connectorId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "connectorId is required");
    }

    const result = this.connectorAdminService.removeConnector(payload.connectorId);
    return this.response(msg.id, MessageTypes.GATEWAY_REMOVE_CONNECTOR, {
      connectorId: payload.connectorId,
      removed: result.removed,
    } satisfies GatewayRemoveConnectorResponsePayload);
  }

  private async handleGatewayListConnectorBindings(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = (msg.payload ?? {}) as GatewayListConnectorBindingsPayload;
    const bindings = this.connectorAdminService.listConnectorBindings(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_CONNECTOR_BINDINGS, {
      bindings,
    } satisfies GatewayListConnectorBindingsResponsePayload);
  }

  private async handleGatewayUpsertConnectorBinding(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = msg.payload as GatewayUpsertConnectorBindingPayload;
    if (!payload?.connectorId || !payload?.bindingType || !payload?.targetType) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "connectorId, bindingType, and targetType are required",
      );
    }

    const binding = this.connectorAdminService.upsertConnectorBinding(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_UPSERT_CONNECTOR_BINDING, {
      binding,
    } satisfies GatewayUpsertConnectorBindingResponsePayload);
  }

  private async handleGatewayRemoveConnectorBinding(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = msg.payload as GatewayRemoveConnectorBindingPayload;
    if (!payload?.bindingId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "bindingId is required");
    }

    const result = this.connectorAdminService.removeConnectorBinding(payload.bindingId);
    return this.response(msg.id, MessageTypes.GATEWAY_REMOVE_CONNECTOR_BINDING, {
      bindingId: payload.bindingId,
      removed: result.removed,
    } satisfies GatewayRemoveConnectorBindingResponsePayload);
  }

  private async handleGatewayGetConnectorPolicy(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = msg.payload as GatewayGetConnectorPolicyPayload;
    if (!payload?.scopeType || !payload?.scopeId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "scopeType and scopeId are required");
    }

    const policy = this.connectorAdminService.getConnectorPolicy(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_GET_CONNECTOR_POLICY, {
      policy,
    } satisfies GatewayGetConnectorPolicyResponsePayload);
  }

  private async handleGatewayUpdateConnectorPolicy(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = msg.payload as GatewayUpdateConnectorPolicyPayload;
    if (!payload?.scopeType || !payload?.scopeId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "scopeType and scopeId are required");
    }

    const updatedBy = payload.updatedBy ?? client.publicKey ?? "system";
    const policy = this.connectorAdminService.updateConnectorPolicy({
      ...payload,
      updatedBy,
    });
    return this.response(msg.id, MessageTypes.GATEWAY_UPDATE_CONNECTOR_POLICY, {
      policy,
    } satisfies GatewayUpdateConnectorPolicyResponsePayload);
  }

  private async handleGatewayTestConnector(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.connectorAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
    }

    const payload = msg.payload as GatewayTestConnectorPayload;
    if (!payload?.connectorId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "connectorId is required");
    }

    const result = this.connectorAdminService.testConnector(payload.connectorId);
    return this.response(msg.id, MessageTypes.GATEWAY_TEST_CONNECTOR, result satisfies GatewayTestConnectorResponsePayload);
  }

  private async handleProfileCreate(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.profileAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Profile admin service unavailable");
    }

    const payload = msg.payload as ProfileCreatePayload;
    if (!payload?.name) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "name is required");
    }

    if (this.gatewayAdminService) {
      this.gatewayAdminService.validateProfileModelSelection({
        providerHint: normalizeString(payload.providerHint),
        modelHint: normalizeString(payload.modelHint),
        modelConfig: payload.modelConfig,
      });
    }

    const result = await this.profileAdminService.createProfile(payload);
    return this.response(msg.id, MessageTypes.PROFILE_CREATE, result satisfies ProfileCreateResponsePayload);
  }

  private async handleProfileGet(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.profileAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Profile admin service unavailable");
    }

    const payload = msg.payload as ProfileGetPayload;
    if (!payload?.profileId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "profileId is required");
    }

    const profile = await this.profileAdminService.getProfile(payload.profileId);
    if (!profile) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Profile not found: ${payload.profileId}`);
    }

    return this.response(msg.id, MessageTypes.PROFILE_GET, {
      profile,
    } satisfies ProfileGetResponsePayload);
  }

  private async handleProfileList(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.profileAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Profile admin service unavailable");
    }

    const payload = (msg.payload ?? {}) as ProfileListPayload;
    const profiles = await this.profileAdminService.listProfiles(payload.includeArchived);
    return this.response(msg.id, MessageTypes.PROFILE_LIST, {
      profiles,
    } satisfies ProfileListResponsePayload);
  }

  private async handleProfileUpdate(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.profileAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Profile admin service unavailable");
    }

    const payload = msg.payload as ProfileUpdatePayload;
    if (!payload?.profileId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "profileId is required");
    }

    const hasProviderHint = Object.prototype.hasOwnProperty.call(payload, "providerHint");
    const hasModelHint = Object.prototype.hasOwnProperty.call(payload, "modelHint");
    const hasModelConfig = Object.prototype.hasOwnProperty.call(payload, "modelConfig");
    if (this.gatewayAdminService && (hasProviderHint || hasModelHint || hasModelConfig)) {
      const existingProfile = await this.profileAdminService.getProfile(payload.profileId);
      if (!existingProfile) {
        return this.errorResponse(msg.id, "NOT_FOUND", `Profile not found: ${payload.profileId}`);
      }
      this.gatewayAdminService.validateProfileModelSelection({
        providerHint: hasProviderHint
          ? normalizeString(payload.providerHint)
          : normalizeString(existingProfile.providerHint),
        modelHint: hasModelHint
          ? normalizeString(payload.modelHint)
          : normalizeString(existingProfile.modelHint),
        modelConfig: hasModelConfig
          ? payload.modelConfig
          : existingProfile.modelConfig,
      });
    }

    const result = await this.profileAdminService.updateProfile(payload);
    return this.response(msg.id, MessageTypes.PROFILE_UPDATE, result satisfies ProfileUpdateResponsePayload);
  }

  private async handleProfileArchive(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.profileAdminService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Profile admin service unavailable");
    }

    const payload = msg.payload as ProfileArchivePayload;
    if (!payload?.profileId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "profileId is required");
    }

    const result = await this.profileAdminService.archiveProfile(payload.profileId);
    return this.response(msg.id, MessageTypes.PROFILE_ARCHIVE, result satisfies ProfileArchiveResponsePayload);
  }

  private async handlePresetList(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceConfiguratorService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space configurator service unavailable");
    }

    const payload = (msg.payload ?? {}) as PresetListPayload;
    const presets = this.spaceConfiguratorService.listPresets(payload, client.publicKey);
    return this.response(msg.id, MessageTypes.PRESET_LIST, {
      presets,
    } satisfies PresetListResponsePayload);
  }

  private async handlePresetGet(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceConfiguratorService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space configurator service unavailable");
    }

    const payload = msg.payload as PresetGetPayload;
    if (!payload?.presetId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "presetId is required");
    }

    const preset = this.spaceConfiguratorService.getPreset(payload.presetId, client.publicKey);
    return this.response(msg.id, MessageTypes.PRESET_GET, {
      preset,
    } satisfies PresetGetResponsePayload);
  }

  private async handlePresetApplyToSpace(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceConfiguratorService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space configurator service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as PresetApplyToSpacePayload;
    if (!payload?.presetId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "presetId is required");
    }
    if (payload.targetSpaceId && payload.workspaceRoot !== undefined) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "workspaceRoot is only supported when creating a new space from a preset",
      );
    }

    let result = await this.spaceConfiguratorService.applyPresetToSpace({
      ...payload,
      principalId: client.publicKey,
    }) as unknown as PresetApplyToSpaceResponsePayload;
    if (this.spaceWorkspaceService && result.createdSpace && result.space) {
      if (payload.workspaceRoot !== undefined) {
        await this.spaceWorkspaceService.setWorkspace(result.space.id, payload.workspaceRoot);
      } else {
        await this.spaceWorkspaceService.ensureWorkspace(result.space.id);
      }
    }
    if (result.space) {
      result = {
        ...result,
        space: await this.decorateSpaceSummary(result.space as unknown as SpaceSummary),
      };
    }

    return this.response(
      msg.id,
      MessageTypes.PRESET_APPLY_TO_SPACE,
      result as unknown as PresetApplyToSpaceResponsePayload,
    );
  }

  private async handlePresetSaveAgent(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceConfiguratorService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space configurator service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as PresetSaveAgentPayload;
    if (!payload?.title) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "title is required");
    }

    const result = await this.spaceConfiguratorService.saveAgentPreset({
      ...payload,
      principalId: client.publicKey,
    });

    return this.response(
      msg.id,
      MessageTypes.PRESET_SAVE_AGENT,
      result as unknown as PresetSaveAgentResponsePayload,
    );
  }

  private async handlePresetArchiveAgent(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceConfiguratorService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space configurator service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as PresetArchiveAgentPayload;
    if (!payload?.presetId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "presetId is required");
    }

    const result = await this.spaceConfiguratorService.archiveAgentPreset({
      ...payload,
      principalId: client.publicKey,
    });

    return this.response(
      msg.id,
      MessageTypes.PRESET_ARCHIVE_AGENT,
      result as unknown as PresetArchiveAgentResponsePayload,
    );
  }

  private async handleSpacePreviewTemplate(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceConfiguratorService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space configurator service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpacePreviewTemplatePayload;
    if (!payload?.templateId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "templateId is required");
    }

    const result = this.spaceConfiguratorService.previewTemplate(payload, client.publicKey);
    return this.response(
      msg.id,
      MessageTypes.SPACE_PREVIEW_TEMPLATE,
      result as unknown as SpacePreviewTemplateResponsePayload,
    );
  }

  private async handleSpaceCreateFromTemplate(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceConfiguratorService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space configurator service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceCreateFromTemplatePayload;
    if (!payload?.templateId || !payload?.resourceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "templateId and resourceId are required");
    }

    let result = await this.spaceConfiguratorService.createFromTemplate(
      payload,
      client.publicKey,
    ) as unknown as SpaceCreateFromTemplateResponsePayload;
    if (this.spaceWorkspaceService && result.space) {
      if (payload.workspaceRoot !== undefined) {
        await this.spaceWorkspaceService.setWorkspace(result.space.id, payload.workspaceRoot);
      } else {
        await this.spaceWorkspaceService.ensureWorkspace(result.space.id);
      }
    }
    if (result.space) {
      result = {
        ...result,
        space: await this.decorateSpaceSummary(result.space as unknown as SpaceSummary),
      };
    }
    return this.response(
      msg.id,
      MessageTypes.SPACE_CREATE_FROM_TEMPLATE,
      result as unknown as SpaceCreateFromTemplateResponsePayload,
    );
  }

  private async handleSpaceSaveTemplate(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceConfiguratorService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space configurator service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceSaveTemplatePayload;
    if (!payload?.title) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "title is required");
    }

    const result = await this.spaceConfiguratorService.saveTemplate({
      ...payload,
      principalId: client.publicKey,
    });
    return this.response(
      msg.id,
      MessageTypes.SPACE_SAVE_TEMPLATE,
      result as unknown as SpaceSaveTemplateResponsePayload,
    );
  }

  private async handleGatewayGetPolicy(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayPolicyService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway policy service unavailable");
    }

    const policy = this.gatewayPolicyService.getPolicy();
    return this.response(msg.id, MessageTypes.GATEWAY_GET_POLICY, {
      policy,
    } satisfies GatewayGetPolicyResponsePayload);
  }

  private async handleGatewayUpdatePolicy(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayPolicyService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway policy service unavailable");
    }

    const payload = (msg.payload ?? {}) as GatewayUpdatePolicyPayload;
    const policy = this.gatewayPolicyService.updatePolicy(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_UPDATE_POLICY, {
      policy,
    } satisfies GatewayUpdatePolicyResponsePayload);
  }

  private async handleGatewaySkillList(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewaySkillCatalogService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway skill catalog service unavailable");
    }

    const payload = (msg.payload ?? {}) as GatewaySkillListPayload;
    const skills = this.gatewaySkillCatalogService.listSkills(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_SKILL_LIST, {
      skills,
    } satisfies GatewaySkillListResponsePayload);
  }

  private async handleGatewaySkillGet(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewaySkillCatalogService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway skill catalog service unavailable");
    }

    const payload = msg.payload as GatewaySkillGetPayload;
    if (!payload?.skillId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "skillId is required");
    }

    const skill = this.gatewaySkillCatalogService.getSkill(payload.skillId);
    if (!skill) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Skill not found: ${payload.skillId}`);
    }

    return this.response(msg.id, MessageTypes.GATEWAY_SKILL_GET, {
      skill,
    } satisfies GatewaySkillGetResponsePayload);
  }

  private async handleGatewaySkillUpsert(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewaySkillCatalogService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway skill catalog service unavailable");
    }

    const payload = msg.payload as GatewaySkillUpsertPayload;
    if (!payload?.name || !payload?.contentMarkdown) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "name and contentMarkdown are required");
    }

    const result = this.gatewaySkillCatalogService.upsertSkill(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_SKILL_UPSERT, result satisfies GatewaySkillUpsertResponsePayload);
  }

  private async handleGatewaySkillDelete(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewaySkillCatalogService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway skill catalog service unavailable");
    }

    const payload = msg.payload as GatewaySkillDeletePayload;
    if (!payload?.skillId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "skillId is required");
    }

    const deleted = this.gatewaySkillCatalogService.deleteSkill(payload.skillId);
    return this.response(msg.id, MessageTypes.GATEWAY_SKILL_DELETE, {
      skillId: payload.skillId,
      deleted,
    } satisfies GatewaySkillDeleteResponsePayload);
  }

  private async handleGatewayKnowledgeBaseListEntries(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayKnowledgeBaseService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway knowledge base service unavailable");
    }

    const payload = (msg.payload ?? {}) as GatewayListKnowledgeBaseEntriesPayload;
    const kinds = Array.isArray(payload.kinds)
      ? payload.kinds.filter((kind): kind is "web" | "file" | "folder" =>
        kind === "web" || kind === "file" || kind === "folder")
      : undefined;
    const tags = Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined;
    const limit = typeof payload.limit === "number" && payload.limit > 0
      ? Math.floor(payload.limit)
      : undefined;

    const entries = this.gatewayKnowledgeBaseService.listEntries({
      apiVersion: payload.apiVersion,
      spaceId: normalizeString(payload.spaceId),
      query: normalizeString(payload.query),
      tags,
      kinds,
      limit,
    });

    return this.response(msg.id, MessageTypes.GATEWAY_KB_LIST_ENTRIES, {
      entries,
    } satisfies GatewayListKnowledgeBaseEntriesResponsePayload);
  }

  private async handleGatewayKnowledgeBaseUpsertEntry(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayKnowledgeBaseService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway knowledge base service unavailable");
    }

    const payload = msg.payload as GatewayUpsertKnowledgeBaseEntryPayload;
    if (!payload?.name || !payload?.kind || !payload?.uri || !payload?.scopeType) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "name, kind, uri, and scopeType are required",
      );
    }

    const entry = this.gatewayKnowledgeBaseService.upsertEntry(payload);
    return this.response(msg.id, MessageTypes.GATEWAY_KB_UPSERT_ENTRY, {
      entry,
    } satisfies GatewayUpsertKnowledgeBaseEntryResponsePayload);
  }

  private async handleGatewayKnowledgeBaseDeleteEntry(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayKnowledgeBaseService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway knowledge base service unavailable");
    }

    const payload = msg.payload as GatewayDeleteKnowledgeBaseEntryPayload;
    if (!payload?.entryId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
    }

    const deleted = this.gatewayKnowledgeBaseService.deleteEntry(payload.entryId);
    return this.response(msg.id, MessageTypes.GATEWAY_KB_DELETE_ENTRY, {
      entryId: payload.entryId,
      deleted,
    } satisfies GatewayDeleteKnowledgeBaseEntryResponsePayload);
  }

  private async handleGatewayListCapabilityGrants(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayCapabilityAccessService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway capability access service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = (msg.payload ?? {}) as GatewayListCapabilityGrantsPayload;
    const principalId = normalizeString(payload.principalId) ?? client.publicKey;
    if (principalId !== client.publicKey) {
      return this.errorResponse(msg.id, "PERMISSION_DENIED", "Cannot list grants for another principal");
    }

    const grants = this.gatewayCapabilityAccessService.listCapabilityGrants({
      principalId,
      deviceId: normalizeString(payload.deviceId),
      includeExpired: payload.includeExpired,
      includeRevoked: payload.includeRevoked,
    });
    return this.response(msg.id, MessageTypes.GATEWAY_LIST_CAPABILITY_GRANTS, {
      grants,
    } satisfies GatewayListCapabilityGrantsResponsePayload);
  }

  private async handleGatewayGrantCapability(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayCapabilityAccessService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway capability access service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = (msg.payload ?? {}) as GatewayGrantCapabilityPayload;
    if (!payload?.capabilityId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "capabilityId is required");
    }

    const principalId = normalizeString(payload.principalId) ?? client.publicKey;
    if (principalId !== client.publicKey) {
      return this.errorResponse(msg.id, "PERMISSION_DENIED", "Cannot grant capability for another principal");
    }

    const grant = this.gatewayCapabilityAccessService.grantCapability({
      principalId,
      deviceId: normalizeString(payload.deviceId) ?? client.deviceId,
      capabilityId: payload.capabilityId,
      reason: payload.reason,
      grantedBy: client.publicKey,
      expiresAt: payload.expiresAt,
    });

    return this.response(msg.id, MessageTypes.GATEWAY_GRANT_CAPABILITY, {
      grant,
    } satisfies GatewayGrantCapabilityResponsePayload);
  }

  private async handleGatewayRevokeCapability(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayCapabilityAccessService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway capability access service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = (msg.payload ?? {}) as GatewayRevokeCapabilityPayload;
    if (!payload?.capabilityId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "capabilityId is required");
    }

    const principalId = normalizeString(payload.principalId) ?? client.publicKey;
    if (principalId !== client.publicKey) {
      return this.errorResponse(msg.id, "PERMISSION_DENIED", "Cannot revoke capability for another principal");
    }

    const result = this.gatewayCapabilityAccessService.revokeCapability({
      principalId,
      deviceId: normalizeString(payload.deviceId) ?? client.deviceId,
      capabilityId: payload.capabilityId,
      reason: payload.reason,
      revokedBy: client.publicKey,
    });

    return this.response(msg.id, MessageTypes.GATEWAY_REVOKE_CAPABILITY, {
      revoked: result.revoked,
      capabilityId: result.capabilityId,
      principalId: result.principalId,
      deviceId: result.deviceId,
      grant: result.grant,
    } satisfies GatewayRevokeCapabilityResponsePayload);
  }

  private async handleUsageGetSnapshot(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.usageSnapshotService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Usage snapshot service unavailable");
    }

    const snapshot = this.usageSnapshotService.getSnapshot();
    return this.response(msg.id, MessageTypes.USAGE_GET_SNAPSHOT, {
      snapshot,
    } satisfies UsageGetSnapshotResponsePayload);
  }

  private async handleSchedulerCreateJob(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SchedulerCreateJobPayload;
    if (!payload?.name?.trim() || !payload?.primarySpaceId?.trim() || !payload?.timezone?.trim()) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "name, primarySpaceId, and timezone are required",
      );
    }
    if (!payload.schedulePreset || !payload.action) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "schedulePreset and action are required");
    }

    const job = await this.schedulerService.createJob({
      ...payload,
      principalId: client.publicKey,
    });

    return this.response(msg.id, MessageTypes.SCHEDULER_CREATE_JOB, {
      job,
    } satisfies SchedulerCreateJobResponsePayload);
  }

  private async handleSchedulerGetJob(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }

    const payload = msg.payload as SchedulerGetJobPayload;
    if (!payload?.jobId?.trim()) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
    }

    const job = await this.schedulerService.getJob({
      ...payload,
      principalId: client.publicKey ?? undefined,
    });
    if (!job) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Scheduler job not found: ${payload.jobId}`);
    }

    return this.response(msg.id, MessageTypes.SCHEDULER_GET_JOB, {
      job,
    } satisfies SchedulerGetJobResponsePayload);
  }

  private async handleSchedulerListJobs(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }

    const payload = (msg.payload ?? {}) as SchedulerListJobsPayload;
    const jobs = await this.schedulerService.listJobs({
      ...payload,
      principalId: client.publicKey ?? undefined,
    });
    return this.response(msg.id, MessageTypes.SCHEDULER_LIST_JOBS, {
      jobs,
    } satisfies SchedulerListJobsResponsePayload);
  }

  private async handleSchedulerUpdateJob(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SchedulerUpdateJobPayload;
    if (!payload?.jobId?.trim()) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
    }

    const job = await this.schedulerService.updateJob({
      ...payload,
      principalId: client.publicKey,
    });

    return this.response(msg.id, MessageTypes.SCHEDULER_UPDATE_JOB, {
      job,
    } satisfies SchedulerUpdateJobResponsePayload);
  }

  private async handleSchedulerDeleteJob(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SchedulerDeleteJobPayload;
    if (!payload?.jobId?.trim()) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
    }

    const result = await this.schedulerService.deleteJob({
      ...payload,
      principalId: client.publicKey,
    });

    return this.response(msg.id, MessageTypes.SCHEDULER_DELETE_JOB, result satisfies SchedulerDeleteJobResponsePayload);
  }

  private async handleSchedulerLinkSpace(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SchedulerLinkSpacePayload;
    if (!payload?.jobId?.trim() || !payload?.spaceId?.trim()) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId and spaceId are required");
    }

    const job = await this.schedulerService.linkSpace({
      ...payload,
      principalId: client.publicKey,
    });

    return this.response(msg.id, MessageTypes.SCHEDULER_LINK_SPACE, {
      job,
    } satisfies SchedulerLinkSpaceResponsePayload);
  }

  private async handleSchedulerUnlinkSpace(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SchedulerUnlinkSpacePayload;
    if (!payload?.jobId?.trim() || !payload?.spaceId?.trim()) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId and spaceId are required");
    }

    const job = await this.schedulerService.unlinkSpace({
      ...payload,
      principalId: client.publicKey,
    });

    return this.response(msg.id, MessageTypes.SCHEDULER_UNLINK_SPACE, {
      job,
    } satisfies SchedulerUnlinkSpaceResponsePayload);
  }

  private async handleSchedulerListRuns(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }

    const payload = msg.payload as SchedulerListRunsPayload;
    if (!payload?.jobId?.trim()) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
    }

    const result = await this.schedulerService.listRuns({
      ...payload,
      principalId: client.publicKey ?? undefined,
    });
    return this.response(msg.id, MessageTypes.SCHEDULER_LIST_RUNS, result satisfies SchedulerListRunsResponsePayload);
  }

  private async handleSchedulerRunNow(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.schedulerService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SchedulerRunNowPayload;
    if (!payload?.jobId?.trim()) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
    }

    const result = await this.schedulerService.runNow({
      ...payload,
      principalId: client.publicKey,
    });
    return this.response(msg.id, MessageTypes.SCHEDULER_RUN_NOW, result satisfies SchedulerRunNowResponsePayload);
  }

  private async handleOrchestratorCommand(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.orchestratorCommandService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Orchestrator command service unavailable");
    }

    const payload = msg.payload as OrchestratorCommandPayload;
    if (!payload?.commandType) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "commandType is required");
    }
    if (!payload?.targetSpaceId?.trim()) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "targetSpaceId is required");
    }

    const command = await this.orchestratorCommandService.submitCommand({
      ...payload,
      principalId: client.publicKey,
      deviceId: client.deviceId,
    });

    // Emit latest lifecycle event to subscribers of the target space.
    const latestEvent = command.events[command.events.length - 1];
    if (latestEvent) {
      const targetSpaceUid = await this.resolveSpaceUid(command.targetSpaceId);
      this.broadcastToSpace(targetSpaceUid, {
        type: MessageTypes.ORCHESTRATOR_EVENT,
        id: randomUUID(),
        ts: new Date().toISOString(),
        payload: {
          commandId: command.commandId,
          correlationId: command.correlationId,
          status: latestEvent.status,
          event: latestEvent.event,
          createdAt: latestEvent.createdAt,
        },
      });
    }

    return this.response(msg.id, MessageTypes.ORCHESTRATOR_COMMAND, {
      command,
    } satisfies OrchestratorCommandResponsePayload);
  }

  private async handleOrchestratorGetCommand(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.orchestratorCommandService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Orchestrator command service unavailable");
    }

    const payload = msg.payload as OrchestratorGetCommandPayload;
    if (!payload?.commandId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "commandId is required");
    }

    const command = this.orchestratorCommandService.getCommand(payload.commandId);
    if (!command) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Orchestrator command not found: ${payload.commandId}`);
    }

    return this.response(msg.id, MessageTypes.ORCHESTRATOR_GET_COMMAND, {
      command,
    } satisfies OrchestratorCommandResponsePayload);
  }

  private async handleSpaceLink(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceContextService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space context service unavailable");
    }

    const payload = msg.payload as SpaceLinkPayload;
    if (!payload?.sourceSpaceId || !payload?.targetSpaceId) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "sourceSpaceId and targetSpaceId are required",
      );
    }

    const link = this.spaceContextService.linkSpaces(
      payload.sourceSpaceId,
      payload.targetSpaceId,
      payload.mode,
    );

    return this.response(msg.id, MessageTypes.SPACE_LINK, {
      link,
    } satisfies SpaceLinkResponsePayload);
  }

  private async handleSpaceUnlink(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceContextService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space context service unavailable");
    }

    const payload = msg.payload as SpaceUnlinkPayload;
    if (!payload?.sourceSpaceId || !payload?.targetSpaceId) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "sourceSpaceId and targetSpaceId are required",
      );
    }

    const removed = this.spaceContextService.unlinkSpaces(
      payload.sourceSpaceId,
      payload.targetSpaceId,
    );

    return this.response(msg.id, MessageTypes.SPACE_UNLINK, {
      removed,
      sourceSpaceId: payload.sourceSpaceId,
      targetSpaceId: payload.targetSpaceId,
    } satisfies SpaceUnlinkResponsePayload);
  }

  private async handleSpaceShareContext(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceContextService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space context service unavailable");
    }

    const payload = msg.payload as SpaceShareContextPayload;
    if (!payload?.sourceSpaceId || !payload?.targetSpaceId || !payload?.artifactId) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "sourceSpaceId, targetSpaceId, and artifactId are required",
      );
    }

    const transfer = this.spaceContextService.shareContext(
      payload.sourceSpaceId,
      payload.targetSpaceId,
      payload.artifactId,
    );

    return this.response(msg.id, MessageTypes.SPACE_SHARE_CONTEXT, {
      transfer,
    } satisfies SpaceShareContextResponsePayload);
  }

  private async handleSpacePullSharedContext(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceContextService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space context service unavailable");
    }

    const payload = msg.payload as SpacePullSharedContextPayload;
    if (!payload?.sourceSpaceId || !payload?.targetSpaceId) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "sourceSpaceId and targetSpaceId are required",
      );
    }

    const result = this.spaceContextService.pullSharedContext(
      payload.sourceSpaceId,
      payload.targetSpaceId,
      payload.limit,
    );

    return this.response(msg.id, MessageTypes.SPACE_PULL_SHARED_CONTEXT, result satisfies SpacePullSharedContextResponsePayload);
  }

  private async handleSpaceShareCreateInvite(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceSharingService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space sharing service unavailable");
    }

    const payload = msg.payload as SpaceShareCreateInvitePayload;
    if (!payload?.spaceId || !payload?.mode) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId and mode are required",
      );
    }

    if (!client.publicKey) {
      return this.errorResponse(
        msg.id,
        "UNAUTHENTICATED",
        "Authenticated principal key is required for sharing operations",
      );
    }

    const invite = this.spaceSharingService.createInvite({
      spaceId: payload.spaceId,
      issuedByPrincipalId: client.publicKey,
      mode: payload.mode,
      expiresInSeconds: payload.expiresInSeconds,
    });
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    return this.response(msg.id, MessageTypes.SPACE_SHARE_CREATE_INVITE, {
      invite: {
        ...invite,
        spaceUid,
      },
    } satisfies SpaceShareCreateInviteResponsePayload);
  }

  private async handleSpaceShareJoin(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceSharingService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space sharing service unavailable");
    }

    const payload = msg.payload as SpaceShareJoinPayload;
    if (!payload?.spaceId || !payload?.inviteToken) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId and inviteToken are required",
      );
    }
    const normalizedIdentityModeHint = normalizeString(payload.identityModeHint);
    let identityModeHint: "device_key" | "strict_apple_id" | undefined;
    if (normalizedIdentityModeHint) {
      if (
        normalizedIdentityModeHint !== "device_key" &&
        normalizedIdentityModeHint !== "strict_apple_id"
      ) {
        return this.errorResponse(
          msg.id,
          "INVALID_ARGUMENT",
          "identityModeHint must be one of: device_key, strict_apple_id",
        );
      }
      identityModeHint = normalizedIdentityModeHint;
    }

    if (!client.publicKey) {
      return this.errorResponse(
        msg.id,
        "UNAUTHENTICATED",
        "Authenticated principal key is required for sharing operations",
      );
    }

    const participant = this.spaceSharingService.joinInvite({
      spaceId: payload.spaceId,
      inviteToken: payload.inviteToken,
      principalId: client.publicKey,
      principalType: "public_key",
      deviceId: payload.deviceId,
      devicePublicKey: payload.devicePublicKey,
      identityModeHint,
      appleIdAssertion: payload.appleIdAssertion,
      joinRoute: payload.joinRoute,
      relaySessionToken: payload.relaySessionToken,
    });
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    return this.response(msg.id, MessageTypes.SPACE_SHARE_JOIN, {
      participant: {
        ...participant,
        spaceUid,
      },
    } satisfies SpaceShareJoinResponsePayload);
  }

  private async handleSpaceShareRevoke(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceSharingService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space sharing service unavailable");
    }

    const payload = msg.payload as SpaceShareRevokePayload;
    if (!payload?.spaceId || (!payload?.inviteId && !payload?.participantId)) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId and either inviteId or participantId are required",
      );
    }

    if (!client.publicKey) {
      return this.errorResponse(
        msg.id,
        "UNAUTHENTICATED",
        "Authenticated principal key is required for sharing operations",
      );
    }

    let revokedInvite = false;
    let revokedParticipant = false;

    if (payload.inviteId) {
      revokedInvite = this.spaceSharingService.revokeInvite({
        spaceId: payload.spaceId,
        inviteId: payload.inviteId,
        requestedByPrincipalId: client.publicKey,
      });
    }

    if (payload.participantId) {
      revokedParticipant = this.spaceSharingService.revokeParticipant({
        spaceId: payload.spaceId,
        participantId: payload.participantId,
        requestedByPrincipalId: client.publicKey,
      });
    }
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    return this.response(msg.id, MessageTypes.SPACE_SHARE_REVOKE, {
      spaceId: payload.spaceId,
      spaceUid,
      inviteId: payload.inviteId,
      participantId: payload.participantId,
      revokedInvite,
      revokedParticipant,
    } satisfies SpaceShareRevokeResponsePayload);
  }

  private async handleSpaceShareListParticipants(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceSharingService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space sharing service unavailable");
    }

    const payload = msg.payload as SpaceShareListParticipantsPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    if (!client.publicKey) {
      return this.errorResponse(
        msg.id,
        "UNAUTHENTICATED",
        "Authenticated principal key is required for sharing operations",
      );
    }

    const participants = this.spaceSharingService.listParticipants({
      spaceId: payload.spaceId,
      requestedByPrincipalId: client.publicKey,
    });
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    return this.response(msg.id, MessageTypes.SPACE_SHARE_LIST_PARTICIPANTS, {
      spaceId: payload.spaceId,
      spaceUid,
      participants: participants.map((participant) => ({
        ...participant,
        spaceUid,
      })),
    } satisfies SpaceShareListParticipantsResponsePayload);
  }

  private async handleSpaceCreateChangeSet(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceChangeSetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceCreateChangeSetPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const changeSet = await this.spaceChangeSetService.createChangeSet({
      spaceId: payload.spaceId,
      principalId: client.publicKey,
      title: payload.title,
      description: payload.description,
      adapter: payload.adapter,
      targetBranch: payload.targetBranch,
      expiresInSeconds: payload.expiresInSeconds,
    });

    return this.response(msg.id, MessageTypes.SPACE_CREATE_CHANGESET, {
      changeSet,
    } satisfies SpaceCreateChangeSetResponsePayload);
  }

  private async handleSpaceListChangeSets(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceChangeSetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceListChangeSetsPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const changeSets = this.spaceChangeSetService.listChangeSets({
      spaceId: payload.spaceId,
      principalId: client.publicKey,
      statuses: payload.statuses,
      limit: payload.limit,
      offset: payload.offset,
    });

    return this.response(msg.id, MessageTypes.SPACE_LIST_CHANGESETS, {
      spaceId: payload.spaceId,
      changeSets,
    } satisfies SpaceListChangeSetsResponsePayload);
  }

  private async handleSpaceUploadChangeSetFileInit(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceChangeSetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceUploadChangeSetFileInitPayload;
    if (!payload?.spaceId || !payload?.changeSetId || !payload?.relativePath) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId, changeSetId, and relativePath are required",
      );
    }

    const result = await this.spaceChangeSetService.uploadFileInit({
      spaceId: payload.spaceId,
      changeSetId: payload.changeSetId,
      principalId: client.publicKey,
      relativePath: payload.relativePath,
    });

    return this.response(msg.id, MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_INIT, result satisfies SpaceUploadChangeSetFileInitResponsePayload);
  }

  private async handleSpaceUploadChangeSetFileComplete(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceChangeSetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceUploadChangeSetFileCompletePayload;
    if (!payload?.spaceId || !payload?.changeSetId || !payload?.uploadId) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId, changeSetId, and uploadId are required",
      );
    }

    const result = await this.spaceChangeSetService.uploadFileComplete({
      spaceId: payload.spaceId,
      changeSetId: payload.changeSetId,
      principalId: client.publicKey,
      uploadId: payload.uploadId,
      contentBase64: payload.contentBase64,
      sourcePath: payload.sourcePath,
      expectedSha256: payload.expectedSha256,
    });

    return this.response(msg.id, MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_COMPLETE, result satisfies SpaceUploadChangeSetFileCompleteResponsePayload);
  }

  private async handleSpaceSubmitChangeSet(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceChangeSetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceSubmitChangeSetPayload;
    if (!payload?.spaceId || !payload?.changeSetId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and changeSetId are required");
    }

    const changeSet = this.spaceChangeSetService.submitChangeSet({
      spaceId: payload.spaceId,
      changeSetId: payload.changeSetId,
      principalId: client.publicKey,
    });

    return this.response(msg.id, MessageTypes.SPACE_SUBMIT_CHANGESET, {
      changeSet,
    } satisfies SpaceSubmitChangeSetResponsePayload);
  }

  private async handleSpaceReviewChangeSet(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceChangeSetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceReviewChangeSetPayload;
    if (!payload?.spaceId || !payload?.changeSetId || !payload?.decision) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, changeSetId, and decision are required");
    }

    const result = await this.spaceChangeSetService.reviewChangeSet({
      spaceId: payload.spaceId,
      changeSetId: payload.changeSetId,
      principalId: client.publicKey,
      decision: payload.decision,
      comment: payload.comment,
    });

    return this.response(msg.id, MessageTypes.SPACE_REVIEW_CHANGESET, result satisfies SpaceReviewChangeSetResponsePayload);
  }

  private async handleSpaceApplyChangeSet(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceChangeSetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceApplyChangeSetPayload;
    if (!payload?.spaceId || !payload?.changeSetId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and changeSetId are required");
    }

    const result = await this.spaceChangeSetService.applyChangeSet({
      spaceId: payload.spaceId,
      changeSetId: payload.changeSetId,
      principalId: client.publicKey,
    });

    return this.response(msg.id, MessageTypes.SPACE_APPLY_CHANGESET, result satisfies SpaceApplyChangeSetResponsePayload);
  }

  private async handleSpaceGetChangeSetDiff(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceChangeSetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
    }

    const payload = msg.payload as SpaceChangeSetDiffPayload;
    if (!payload?.spaceId || !payload?.changeSetId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and changeSetId are required");
    }

    const diff = await this.spaceChangeSetService.getChangeSetDiff(payload.spaceId, payload.changeSetId);
    return this.response(msg.id, MessageTypes.SPACE_GET_CHANGESET_DIFF, diff satisfies SpaceChangeSetDiffResponsePayload);
  }

  private async handleSpaceGetQuota(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceQuotaService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space quota service unavailable");
    }

    const payload = msg.payload as SpaceGetQuotaPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const result = this.spaceQuotaService.getQuota(payload.spaceId, client.publicKey ?? undefined);
    return this.response(msg.id, MessageTypes.SPACE_GET_QUOTA, result satisfies SpaceGetQuotaResponsePayload);
  }

  private async handleSpaceUpdateQuotaPolicy(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceQuotaService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space quota service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceUpdateQuotaPolicyPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const spacePolicy = this.spaceQuotaService.updateQuotaPolicy({
      ...payload,
      updatedBy: client.publicKey,
    });
    return this.response(msg.id, MessageTypes.SPACE_UPDATE_QUOTA_POLICY, {
      spacePolicy,
    } satisfies SpaceUpdateQuotaPolicyResponsePayload);
  }

  private async handleSpaceGetUsage(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceQuotaService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space quota service unavailable");
    }

    const payload = msg.payload as SpaceGetUsagePayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const usage = this.spaceQuotaService.getUsage(
      payload.spaceId,
      client.publicKey ?? undefined,
      {
        includeAgentSessions: payload.includeAgentSessions,
        includeGlobalLifetime: payload.includeGlobalLifetime,
      },
    );
    return this.response(msg.id, MessageTypes.SPACE_GET_USAGE, usage satisfies SpaceGetUsageResponsePayload);
  }

  private async handleSpaceGetTurnTrace(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceTurnTraceService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space turn trace service unavailable");
    }

    const payload = msg.payload as SpaceGetTurnTracePayload;
    if (!payload?.spaceId || !payload?.turnId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and turnId are required");
    }

    const trace = await this.spaceTurnTraceService.getTurnTrace({
      spaceId: payload.spaceId,
      turnId: payload.turnId,
      limit: payload.limit,
      offset: payload.offset,
    });

    return this.response(msg.id, MessageTypes.SPACE_GET_TURN_TRACE, {
      trace,
    } satisfies SpaceGetTurnTraceResponsePayload);
  }

  private async handleSpaceListArtifacts(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceArtifactService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space artifact service unavailable");
    }

    const payload = msg.payload as SpaceListArtifactsPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const result = await this.spaceArtifactService.listArtifacts({
      spaceId: payload.spaceId,
      turnId: payload.turnId,
      limit: payload.limit,
      offset: payload.offset,
    });

    return this.response(msg.id, MessageTypes.SPACE_LIST_ARTIFACTS, result satisfies SpaceListArtifactsResponsePayload);
  }

  private async handleSpaceGetArtifact(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceArtifactService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space artifact service unavailable");
    }

    const payload = msg.payload as SpaceGetArtifactPayload;
    if (!payload?.spaceId || !payload?.artifactId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and artifactId are required");
    }

    const artifact = await this.spaceArtifactService.getArtifact({
      spaceId: payload.spaceId,
      artifactId: payload.artifactId,
    });

    return this.response(msg.id, MessageTypes.SPACE_GET_ARTIFACT, {
      artifact,
    } satisfies SpaceGetArtifactResponsePayload);
  }

  private async handleSpaceReset(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewayResetService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway reset service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceResetPayload;
    const spaceId = normalizeString(payload?.spaceId);
    if (!spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const result = await this.gatewayResetService.resetSpace({
      apiVersion: normalizeString(payload.apiVersion),
      spaceId,
      requestedBy: client.publicKey,
      requestedDeviceId: normalizeString(client.deviceId),
    });

    return this.response(msg.id, MessageTypes.SPACE_RESET, result satisfies SpaceResetResponsePayload);
  }

  private async handleSpaceResetAgentUsageSession(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceQuotaService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space quota service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as SpaceResetAgentUsageSessionPayload;
    if (!payload?.spaceId || !payload?.agentId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and agentId are required");
    }

    const result = this.spaceQuotaService.resetAgentUsageSession(
      payload.spaceId,
      payload.agentId,
      client.publicKey,
    );
    return this.response(
      msg.id,
      MessageTypes.SPACE_RESET_AGENT_USAGE_SESSION,
      result satisfies SpaceResetAgentUsageSessionResponsePayload,
    );
  }

  private async handleSpaceGetEffectiveTools(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceToolPolicyService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Space tool policy service unavailable");
    }

    const payload = msg.payload as SpaceGetEffectiveToolsPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }

    const matrix = await this.spaceToolPolicyService.getEffectiveTools({
      spaceId: payload.spaceId,
      principalId: client.publicKey ?? undefined,
      deviceId: client.deviceId ?? undefined,
      agentId: payload.agentId,
    });

    return this.response(msg.id, MessageTypes.SPACE_GET_EFFECTIVE_TOOLS, {
      matrix,
    } satisfies SpaceGetEffectiveToolsResponsePayload);
  }

  private async handleAuthRegisterDevice(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.deviceIdentityService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Device identity service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as AuthRegisterDevicePayload;
    if (!payload?.deviceId || !payload?.publicKey) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "deviceId and publicKey are required");
    }

    const result = this.deviceIdentityService.registerDevice({
      ...payload,
      principalId: client.publicKey,
    });
    return this.response(msg.id, MessageTypes.AUTH_REGISTER_DEVICE, result satisfies AuthRegisterDeviceResponsePayload);
  }

  private async handleAuthRotateDeviceKey(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.deviceIdentityService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Device identity service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as AuthRotateDeviceKeyPayload;
    if (!payload?.deviceId || !payload?.nextPublicKey) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "deviceId and nextPublicKey are required");
    }

    const device = this.deviceIdentityService.rotateDeviceKey({
      ...payload,
      principalId: client.publicKey,
    });
    return this.response(msg.id, MessageTypes.AUTH_ROTATE_DEVICE_KEY, {
      device,
    } satisfies AuthRotateDeviceKeyResponsePayload);
  }

  private async handleAuthRevokeDevice(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.deviceIdentityService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Device identity service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = msg.payload as AuthRevokeDevicePayload;
    if (!payload?.deviceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "deviceId is required");
    }

    const result = this.deviceIdentityService.revokeDevice({
      ...payload,
      principalId: client.publicKey,
    });
    return this.response(msg.id, MessageTypes.AUTH_REVOKE_DEVICE, {
      deviceId: payload.deviceId,
      revoked: result.revoked,
      device: result.device,
    } satisfies AuthRevokeDeviceResponsePayload);
  }

  private async handleAuthListDevices(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.deviceIdentityService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Device identity service unavailable");
    }
    if (!client.publicKey) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = (msg.payload ?? {}) as AuthListDevicesPayload;
    const devices = this.deviceIdentityService.listDevices(
      client.publicKey,
      payload.includeRevoked ?? true,
    );
    return this.response(msg.id, MessageTypes.AUTH_LIST_DEVICES, {
      devices,
    } satisfies AuthListDevicesResponsePayload);
  }

  private async handleAuthIssueHttpPrincipalToken(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.issueHttpPrincipalToken) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "HTTP principal token issuer unavailable");
    }

    const principalId = normalizeString(client.publicKey);
    if (!principalId) {
      return this.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
    }

    const payload = (msg.payload ?? {}) as AuthIssueHttpPrincipalTokenPayload;
    const ttlSeconds = parseOptionalIssuedTokenTtlSeconds(payload.ttlSeconds);
    if (ttlSeconds === null) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "ttlSeconds must be a positive integer");
    }

    const issued = await this.issueHttpPrincipalToken({
      principalId,
      deviceId: normalizeString(client.deviceId),
      ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
    });
    return this.response(msg.id, MessageTypes.AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN, issued satisfies AuthIssueHttpPrincipalTokenResponsePayload);
  }

  private async handleSyncAnnounce(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewaySyncService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway sync service unavailable");
    }

    const payload = msg.payload as SyncAnnouncePayload;
    if (!payload?.peerId || !payload?.resourceId || !payload?.gatewayVersion) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "peerId, resourceId, and gatewayVersion are required",
      );
    }

    const responsePayload = this.gatewaySyncService.announcePeer(payload);
    return this.response(msg.id, MessageTypes.SYNC_ANNOUNCE, responsePayload satisfies SyncAnnounceResponsePayload);
  }

  private async handleSyncQueryResources(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewaySyncService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway sync service unavailable");
    }

    const payload = msg.payload as SyncQueryResourcesPayload;
    if (!payload?.peerId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "peerId is required");
    }

    const result = this.gatewaySyncService.queryResources(payload);
    return this.response(msg.id, MessageTypes.SYNC_QUERY_RESOURCES, result satisfies SyncQueryResourcesResponsePayload);
  }

  private async handleSyncPullResources(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.gatewaySyncService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway sync service unavailable");
    }

    const payload = msg.payload as SyncPullResourcesPayload;
    if (!payload?.peerId || !payload?.idempotencyKey || !Array.isArray(payload?.refs)) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "peerId, idempotencyKey, and refs[] are required",
      );
    }

    const result = this.gatewaySyncService.pullResources(payload);
    return this.response(msg.id, MessageTypes.SYNC_PULL_RESOURCES, result satisfies SyncPullResourcesResponsePayload);
  }

  private async handleSpeechStart(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.speechSessionService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Speech session service unavailable");
    }

    const payload = msg.payload as SpeechStartPayload;
    if (!payload?.spaceId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
    }
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    const event = this.speechSessionService.startSession({
      ...payload,
      spaceUid,
      principalId: client.publicKey,
      deviceId: client.deviceId,
    });
    await this.broadcastSpeechEvent(event);
    return this.response(msg.id, MessageTypes.SPEECH_START, { event });
  }

  private async handleSpeechAudioChunk(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.speechSessionService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Speech session service unavailable");
    }

    const payload = msg.payload as SpeechAudioChunkPayload;
    const normalizedSequence = typeof payload?.sequence === "number"
      ? payload.sequence
      : typeof payload?.sequenceNo === "number"
        ? payload.sequenceNo
        : undefined;
    if (!payload?.sessionId || typeof normalizedSequence !== "number" || !payload?.audioBase64) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "sessionId, sequence/sequenceNo, and audioBase64 are required",
      );
    }

    const events = await this.speechSessionService.appendAudioChunk({
      ...payload,
      sequence: normalizedSequence,
    });
    for (const event of events) {
      await this.broadcastSpeechEvent(event);
    }

    return this.response(msg.id, MessageTypes.SPEECH_AUDIO_CHUNK, { events });
  }

  private async handleSpeechControl(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.speechSessionService) {
      return this.errorResponse(msg.id, "FAILED_PRECONDITION", "Speech session service unavailable");
    }

    const payload = msg.payload as SpeechControlPayload;
    if (!payload?.sessionId || !payload?.command) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "sessionId and command are required");
    }

    const event = this.speechSessionService.control(payload);
    await this.broadcastSpeechEvent(event);
    return this.response(msg.id, MessageTypes.SPEECH_CONTROL, { event });
  }

  private async authorizeSpaceAccess(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.spaceSharingService) {
      return null;
    }

    const checks = await this.buildSpaceAccessChecks(msg);
    if (checks.length === 0) {
      return null;
    }

    const principalId = client.publicKey?.trim();
    for (const check of checks) {
      const decision = this.spaceSharingService.evaluateAccess({
        spaceId: check.spaceId,
        principalId,
        action: check.action,
      });
      if (!decision.allowed) {
        return this.errorResponse(
          msg.id,
          "PERMISSION_DENIED",
          decision.reason ?? "Access denied for shared space",
        );
      }
    }

    return null;
  }

  private resolveExecutionOrigin(
    spaceId: string,
    principalIdRaw?: string,
  ): "owner" | "guest" | "unknown" {
    const principalId = principalIdRaw?.trim();
    if (!principalId || !this.spaceSharingService?.getActiveParticipant) {
      return "unknown";
    }
    const participant = this.spaceSharingService.getActiveParticipant(spaceId, principalId);
    if (!participant) return "unknown";
    return participant.joinedViaInviteId ? "guest" : "owner";
  }

  private resolveSessionResetPrincipal(client: ClientSession): string {
    const publicKey = normalizeString(client.publicKey);
    if (publicKey) {
      return publicKey;
    }

    const deviceId = normalizeString(client.deviceId);
    if (deviceId) {
      return `device:${deviceId}`;
    }

    return "system:agent-session-replacement";
  }

  private async buildSpaceAccessChecks(
    msg: GatewayMessage,
  ): Promise<Array<{ spaceId: string; action: "read" | "write" }>> {
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    const checks: Array<{ spaceId: string; action: "read" | "write" }> = [];
    const add = (spaceId: unknown, action: "read" | "write") => {
      if (typeof spaceId !== "string") return;
      const normalized = spaceId.trim();
      if (!normalized) return;
      if (checks.some((entry) => entry.spaceId === normalized && entry.action === action)) return;
      checks.push({ spaceId: normalized, action });
    };

    switch (msg.type) {
      case MessageTypes.EXECUTE_TURN:
      case MessageTypes.RESUME_FEEDBACK:
        add(payload.spaceId, "write");
        if (checks.length === 0 && typeof payload.spaceUid === "string") {
          const resolvedSpaceId = await this.resolveSpaceId(payload.spaceUid);
          if (resolvedSpaceId) {
            add(resolvedSpaceId, "write");
          }
        }
        break;
      case MessageTypes.SPACE_ADD_AGENT:
      case MessageTypes.SPACE_REMOVE_AGENT:
      case MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT:
      case MessageTypes.SPACE_SET_ORCHESTRATOR:
      case MessageTypes.SPACE_SET_MCP_ENDPOINT:
      case MessageTypes.SPACE_CLEAR_MCP_ENDPOINT:
      case MessageTypes.SPACE_APPROVE_MCP_AGENT:
      case MessageTypes.SPACE_ADD_SKILL:
      case MessageTypes.SPACE_REMOVE_SKILL:
      case MessageTypes.SPACE_SET_WORKSPACE:
      case MessageTypes.SPACE_ADD_RESOURCE:
      case MessageTypes.SPACE_REMOVE_RESOURCE:
      case MessageTypes.SPACE_SHARE_CREATE_INVITE:
      case MessageTypes.SPACE_SHARE_REVOKE:
      case MessageTypes.SPACE_CREATE_CHANGESET:
      case MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_INIT:
      case MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_COMPLETE:
      case MessageTypes.SPACE_SUBMIT_CHANGESET:
      case MessageTypes.SPACE_REVIEW_CHANGESET:
      case MessageTypes.SPACE_APPLY_CHANGESET:
      case MessageTypes.SPACE_UPDATE_QUOTA_POLICY:
      case MessageTypes.SPACE_RESET:
      case MessageTypes.SPACE_RESET_AGENT_USAGE_SESSION:
      case MessageTypes.SPEECH_START:
        add(payload.spaceId, "write");
        break;
      case MessageTypes.GATEWAY_SET_MAIN_AGENT:
        add(payload.spaceId, "write");
        if (checks.length === 0) {
          add(this.gatewayAdminService?.resolveMainSpaceId?.(), "write");
        }
        break;
      case MessageTypes.SPACE_LIST_TURNS:
      case MessageTypes.SPACE_LIST_ORCHESTRATION_JOURNAL:
        add(payload.spaceId, "read");
        if (checks.length === 0 && typeof payload.spaceUid === "string") {
          const resolvedSpaceId = await this.resolveSpaceId(payload.spaceUid);
          if (resolvedSpaceId) {
            add(resolvedSpaceId, "read");
          }
        }
        break;
      case MessageTypes.SPACE_GET:
      case MessageTypes.SPACE_GET_MCP_ENDPOINT:
      case MessageTypes.SPACE_DISCOVER_MCP_AGENTS:
      case MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS:
      case MessageTypes.SPACE_LIST_SKILLS:
      case MessageTypes.SPACE_GET_WORKSPACE:
      case MessageTypes.SPACE_LIST_RESOURCES:
      case MessageTypes.SPACE_SHARE_LIST_PARTICIPANTS:
      case MessageTypes.SPACE_LIST_CHANGESETS:
      case MessageTypes.SPACE_GET_CHANGESET_DIFF:
      case MessageTypes.SPACE_GET_QUOTA:
      case MessageTypes.SPACE_GET_USAGE:
      case MessageTypes.SPACE_GET_TURN_TRACE:
      case MessageTypes.SPACE_LIST_ARTIFACTS:
      case MessageTypes.SPACE_GET_ARTIFACT:
      case MessageTypes.SPACE_GET_EFFECTIVE_TOOLS:
        add(payload.spaceId, "read");
        break;
      case MessageTypes.GATEWAY_GET_MAIN_AGENT:
        add(payload.spaceId, "read");
        if (checks.length === 0) {
          add(this.gatewayAdminService?.resolveMainSpaceId?.(), "read");
        }
        break;
      case MessageTypes.GATEWAY_KB_LIST_ENTRIES:
        add(payload.spaceId, "read");
        break;
      case MessageTypes.GATEWAY_KB_UPSERT_ENTRY:
        if (payload.scopeType === "space") {
          add(payload.spaceId, "write");
        }
        break;
      case MessageTypes.PRESET_APPLY_TO_SPACE:
        add(payload.targetSpaceId, "write");
        break;
      case MessageTypes.SPACE_LINK:
      case MessageTypes.SPACE_UNLINK:
      case MessageTypes.SPACE_SHARE_CONTEXT:
        add(payload.sourceSpaceId, "write");
        add(payload.targetSpaceId, "write");
        break;
      case MessageTypes.SPACE_PULL_SHARED_CONTEXT:
        add(payload.sourceSpaceId, "read");
        add(payload.targetSpaceId, "write");
        break;
      case MessageTypes.SPACE_SAVE_TEMPLATE:
        add(payload.sourceSpaceId, "read");
        break;
      case MessageTypes.ORCHESTRATOR_COMMAND:
        add(payload.targetSpaceId, "write");
        break;
      case MessageTypes.SCHEDULER_CREATE_JOB:
        add(payload.primarySpaceId, "write");
        if (Array.isArray(payload.relatedSpaceIds)) {
          for (const relatedSpaceId of payload.relatedSpaceIds) {
            add(relatedSpaceId, "write");
          }
        }
        break;
      case MessageTypes.SCHEDULER_UPDATE_JOB:
        add(payload.primarySpaceId, "write");
        if (Array.isArray(payload.relatedSpaceIds)) {
          for (const relatedSpaceId of payload.relatedSpaceIds) {
            add(relatedSpaceId, "write");
          }
        }
        break;
      case MessageTypes.SCHEDULER_LINK_SPACE:
      case MessageTypes.SCHEDULER_UNLINK_SPACE:
        add(payload.spaceId, "write");
        break;
      default:
        break;
    }

    return checks;
  }

  private async handleCapabilitiesRegister(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.isAdapterClient(client)) {
      return this.errorResponse(msg.id, "PERMISSION_DENIED", "capabilities.register is only allowed for adapter clients");
    }

    const payload = msg.payload as CapabilitiesRegisterPayload;
    const providers = payload?.providers;
    if (!Array.isArray(providers) || providers.length === 0) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providers[] is required");
    }

    const registered: string[] = [];

    for (const provider of providers) {
      const validationError = this.validateAdapterProvider(provider);
      if (validationError) {
        return this.errorResponse(msg.id, "INVALID_ARGUMENT", validationError);
      }

      const existingOwner = this.adapterProviderOwners.get(provider.id);
      if (existingOwner && existingOwner !== client.id) {
        this.logger.warn("Adapter provider re-registered by a different client", {
          providerId: provider.id,
          previousClientId: existingOwner,
          nextClientId: client.id,
        });
        this.capabilities.deregister(provider.id);
        this.adapterProvidersByClient.get(existingOwner)?.delete(provider.id);
      } else {
        // Replace in-place to refresh operations/health metadata.
        this.capabilities.deregister(provider.id);
      }

      this.capabilities.register(
        {
          id: provider.id,
          name: provider.name,
          source: "adapter",
          capabilityType: provider.capabilityType as CapabilityType,
          operations: provider.operations,
          available: true,
          lastHealthCheck: new Date(),
        },
        {
          invoke: async (operation, args) => {
            return this.invokeAdapterCapability(provider, operation, args);
          },
        },
      );

      this.adapterProviderOwners.set(provider.id, client.id);
      if (!this.adapterProvidersByClient.has(client.id)) {
        this.adapterProvidersByClient.set(client.id, new Set());
      }
      this.adapterProvidersByClient.get(client.id)!.add(provider.id);
      registered.push(provider.id);
    }

    this.logger.info("Adapter providers registered", {
      clientId: client.id,
      providers: registered,
    });

    return this.response(msg.id, "capabilities_registered", {
      providerIds: registered,
    });
  }

  private async handleCapabilitiesDeregister(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    if (!this.isAdapterClient(client)) {
      return this.errorResponse(msg.id, "PERMISSION_DENIED", "capabilities.deregister is only allowed for adapter clients");
    }

    const payload = msg.payload as CapabilitiesDeregisterPayload;
    if (!Array.isArray(payload?.providerIds) || payload.providerIds.length === 0) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "providerIds[] is required");
    }

    const removed: string[] = [];
    for (const providerId of payload.providerIds) {
      const owner = this.adapterProviderOwners.get(providerId);
      if (!owner || owner !== client.id) continue;
      this.capabilities.deregister(providerId);
      this.adapterProviderOwners.delete(providerId);
      this.adapterProvidersByClient.get(client.id)?.delete(providerId);
      removed.push(providerId);
    }

    return this.response(msg.id, "capabilities_deregistered", {
      providerIds: removed,
    });
  }

  private async handleCapabilityResult(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    const payload = msg.payload as CapabilityResultPayload;
    if (!payload?.invocationId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "invocationId is required");
    }

    const pending = this.pendingAdapterInvocations.get(payload.invocationId);
    if (!pending) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Unknown invocation: ${payload.invocationId}`);
    }
    if (pending.clientId !== client.id) {
      return this.errorResponse(msg.id, "PERMISSION_DENIED", "Invocation does not belong to this client");
    }

    clearTimeout(pending.timeout);
    this.pendingAdapterInvocations.delete(payload.invocationId);
    pending.resolve(payload.data);
    return null;
  }

  private async handleCapabilityError(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    const payload = msg.payload as CapabilityErrorPayload;
    if (!payload?.invocationId) {
      return this.errorResponse(msg.id, "INVALID_ARGUMENT", "invocationId is required");
    }

    const pending = this.pendingAdapterInvocations.get(payload.invocationId);
    if (!pending) {
      return this.errorResponse(msg.id, "NOT_FOUND", `Unknown invocation: ${payload.invocationId}`);
    }
    if (pending.clientId !== client.id) {
      return this.errorResponse(msg.id, "PERMISSION_DENIED", "Invocation does not belong to this client");
    }

    clearTimeout(pending.timeout);
    this.pendingAdapterInvocations.delete(payload.invocationId);
    const codePrefix = payload.code ? `[${payload.code}] ` : "";
    pending.reject(new Error(`${codePrefix}${payload.message}`));
    return null;
  }

  private invokeAdapterCapability(
    provider: AdapterCapabilityProvider,
    operation: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const clientId = this.adapterProviderOwners.get(provider.id);
    if (!clientId) {
      throw new Error(`Adapter provider unavailable: ${provider.id}`);
    }

    const invocationId = randomUUID();
    const payload: AdapterCapabilityInvokePayload = {
      invocationId,
      capability: provider.capabilityType,
      operation,
      args,
      targetProvider: provider.id,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAdapterInvocations.delete(invocationId);
        reject(new Error(`Adapter invocation timeout: ${provider.id}.${operation}`));
      }, this.adapterInvocationTimeoutMs);

      this.pendingAdapterInvocations.set(invocationId, {
        clientId,
        providerId: provider.id,
        resolve,
        reject,
        timeout,
      });

      try {
        this.sendToClient(clientId, {
          type: MessageTypes.CAPABILITY_INVOKE_ADAPTER,
          id: randomUUID(),
          ts: new Date().toISOString(),
          payload,
        });
      } catch (err) {
        clearTimeout(timeout);
        this.pendingAdapterInvocations.delete(invocationId);
        reject(err);
      }
    });
  }

  private isAdapterClient(client: ClientSession): boolean {
    if (!client.clientType) return false;
    return client.clientType === "adapter" || client.clientType.endsWith("-adapter");
  }

  private validateAdapterProvider(provider: AdapterCapabilityProvider | undefined): string | null {
    if (!provider) return "provider is required";
    if (!provider.id) return "provider.id is required";
    if (!provider.name) return "provider.name is required";
    if (!provider.capabilityType) return "provider.capabilityType is required";
    if (!isCapabilityType(provider.capabilityType)) {
      return `Unknown capability type: ${provider.capabilityType}`;
    }
    if (provider.source !== "adapter") {
      return "provider.source must be \"adapter\"";
    }
    if (!Array.isArray(provider.operations) || provider.operations.length === 0) {
      return "provider.operations[] is required";
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Inter-agent messaging
  // ---------------------------------------------------------------------------

  private async handleAgentMessage(
    client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    const payload = msg.payload as AgentMessagePayload;

    if (!payload.spaceId || !payload.fromAgentId || !payload.toAgentId || !payload.content) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId, fromAgentId, toAgentId, and content are required",
      );
    }
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    const outbound: GatewayMessage = {
      type: MessageTypes.AGENT_MESSAGE,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        spaceId: payload.spaceId,
        spaceUid,
        fromAgentId: payload.fromAgentId,
        toAgentId: payload.toAgentId,
        content: payload.content,
        metadata: payload.metadata,
      } satisfies AgentMessagePayload,
    };

    if (payload.toAgentId === "*") {
      // Broadcast to all subscribers of the space
      this.broadcastToSpace(spaceUid, outbound);
    } else {
      // Direct — broadcast to the space (the target agent's client will filter)
      // In a future iteration we could maintain agent→clientId mappings for true
      // point-to-point delivery, but broadcast-with-filter is simpler and correct.
      this.broadcastToSpace(spaceUid, outbound);
    }

    this.logger.debug("Agent message relayed", {
      spaceId: payload.spaceId,
      from: payload.fromAgentId,
      to: payload.toAgentId,
    });

    // Ack to sender
    return this.response(msg.id, MessageTypes.AGENT_MESSAGE, {
      spaceId: payload.spaceId,
      spaceUid,
      fromAgentId: payload.fromAgentId,
      toAgentId: payload.toAgentId,
      content: payload.content,
      metadata: { ...payload.metadata, _ack: true },
    } satisfies AgentMessagePayload);
  }

  private async handleAgentPoke(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    const payload = msg.payload as AgentPokePayload;

    if (!payload.spaceId || !payload.targetAgentId || !payload.reason) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId, targetAgentId, and reason are required",
      );
    }
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    // Broadcast the poke to the space — the target agent's client picks it up
    this.broadcastToSpace(spaceUid, {
      type: MessageTypes.AGENT_POKE,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        ...payload,
        spaceUid,
      } satisfies AgentPokePayload,
    });

    this.logger.info("Agent poked", {
      spaceId: payload.spaceId,
      targetAgentId: payload.targetAgentId,
      reason: payload.reason,
    });

    return this.response(msg.id, MessageTypes.AGENT_POKE, {
      ...payload,
      spaceUid,
    } satisfies AgentPokePayload);
  }

  // ---------------------------------------------------------------------------
  // Task dependencies
  // ---------------------------------------------------------------------------

  private async handleTaskDependency(
    _client: ClientSession,
    msg: GatewayMessage,
  ): Promise<GatewayMessage | null> {
    const payload = msg.payload as TaskDependencyPayload;

    if (!payload.spaceId || !payload.blockedTurnId || !payload.dependsOnTurnId) {
      return this.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "spaceId, blockedTurnId, and dependsOnTurnId are required",
      );
    }
    const spaceUid = await this.resolveSpaceUid(payload.spaceId);

    // Broadcast the dependency declaration to the space so all participants
    // know about the blocking relationship. The SpaceManager or coordinator
    // can listen for these to enforce ordering.
    this.broadcastToSpace(spaceUid, {
      type: MessageTypes.TASK_DEPENDENCY,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        ...payload,
        spaceUid,
      } satisfies TaskDependencyPayload,
    });

    this.logger.info("Task dependency declared", {
      spaceId: payload.spaceId,
      blockedTurnId: payload.blockedTurnId,
      dependsOnTurnId: payload.dependsOnTurnId,
    });

    return this.response(msg.id, MessageTypes.TASK_DEPENDENCY, {
      ...payload,
      spaceUid,
    } satisfies TaskDependencyPayload);
  }

  private async broadcastSpeechEvent(event: SpeechEventPayload): Promise<void> {
    const emittedAt = event.emittedAt ?? event.ts;
    const spaceUid = event.spaceUid || await this.resolveSpaceUid(event.spaceId);
    const normalized: SpeechEventPayload = {
      ...event,
      spaceUid,
      ts: event.ts ?? emittedAt ?? new Date().toISOString(),
      emittedAt: emittedAt ?? event.ts,
      sequenceNo: event.sequenceNo ?? event.sequence,
      message: event.message ?? event.reason,
      type: event.type ?? mapSpeechEventTypeForPayload(event.eventType, event.state),
    };
    this.broadcastToSpace(spaceUid, {
      type: MessageTypes.SPEECH_EVENT,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: normalized,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private decorateAssignments(
    spaceId: string,
    assignments: SpaceAssignmentSummary[],
  ): SpaceAssignmentSummary[] {
    if (!this.spaceMcpService || assignments.length === 0) {
      return assignments;
    }

    const bindings = this.spaceMcpService.listBindings(spaceId);
    if (bindings.length === 0) {
      return assignments;
    }
    const bindingsByAgentId = new Map(bindings.map((binding) => [binding.agentId, binding]));

    return assignments.map((assignment) => {
      const binding = bindingsByAgentId.get(assignment.agentId);
      if (!binding) {
        return assignment;
      }
      return {
        ...assignment,
        runtimeKind: "external_mcp",
        endpointId: binding.endpointId,
        remoteAgentId: binding.remoteAgentId,
        displayName: binding.displayName,
      };
    });
  }

  private async decorateSpaceSummary(space: SpaceSummary): Promise<SpaceSummary> {
    const withAssignments = {
      ...space,
      agents: this.decorateAssignments(space.id, space.agents),
    };

    if (!this.spaceWorkspaceService) {
      return withAssignments;
    }

    const workspace = await this.spaceWorkspaceService.ensureWorkspace(space.id);
    return {
      ...withAssignments,
      workspace,
    };
  }

  private async decorateSpaceListSummaries(spaces: SpaceSummary[]): Promise<SpaceSummary[]> {
    return Promise.all(spaces.map((space) => this.decorateSpaceSummary(space)));
  }

  private cacheSpaceIdentity(spaceIdRaw: string, spaceUidRaw: string): void {
    const spaceId = normalizeString(spaceIdRaw);
    const spaceUid = normalizeUuid(spaceUidRaw) || normalizeString(spaceUidRaw);
    if (!spaceId || !spaceUid) return;
    this.spaceUidBySpaceId.set(spaceId, spaceUid);
    this.spaceIdBySpaceUid.set(spaceUid.toLowerCase(), spaceId);
  }

  private async resolveSpaceId(spaceUidRaw: string): Promise<string | null> {
    const spaceUid = normalizeUuid(spaceUidRaw) || normalizeString(spaceUidRaw);
    if (!spaceUid) return null;

    const cacheKey = spaceUid.toLowerCase();
    const cached = this.spaceIdBySpaceUid.get(cacheKey);
    if (cached) return cached;

    if (!this.spaceAdminService) {
      return spaceUid;
    }

    try {
      const direct = await this.spaceAdminService.getSpace(spaceUid);
      if (direct) {
        this.cacheSpaceIdentity(direct.id, direct.spaceUid ?? spaceUid);
        return direct.id;
      }
    } catch {
      // Fall through to list-based resolution.
    }

    try {
      const spaces = await this.spaceAdminService.listSpaces({ limit: 2_000 });
      const matched = spaces.find((space) => {
        const candidateUid = normalizeUuid(space.spaceUid) || normalizeString(space.spaceUid);
        return candidateUid?.toLowerCase() === cacheKey;
      });
      if (matched) {
        this.cacheSpaceIdentity(matched.id, matched.spaceUid);
        return matched.id;
      }
    } catch {
      // Space lookup is best-effort; caller handles null as NOT_FOUND.
    }

    return null;
  }

  private async resolveSpaceUid(spaceIdRaw: string): Promise<string> {
    const spaceId = spaceIdRaw.trim();
    if (!spaceId) return deterministicUuid("unknown-space", "spaceskit.space.uuid");
    const cached = this.spaceUidBySpaceId.get(spaceId);
    if (cached) return cached;
    const fallback = deterministicUuid(spaceId, "spaceskit.space.uuid");
    if (!this.spaceAdminService || typeof this.spaceAdminService.getSpace !== "function") {
      this.cacheSpaceIdentity(spaceId, fallback);
      return fallback;
    }

    try {
      const space = await this.spaceAdminService.getSpace(spaceId);
      const spaceUid = normalizeUuid(space?.spaceUid);
      if (spaceUid) {
        this.cacheSpaceIdentity(spaceId, spaceUid);
        return spaceUid;
      }
    } catch {
      // UID enrichment is best-effort; publish deterministic UUID on lookup failures.
      this.cacheSpaceIdentity(spaceId, fallback);
      return fallback;
    }
    this.cacheSpaceIdentity(spaceId, fallback);
    return fallback;
  }

  private response(
    replyTo: string,
    type: string,
    payload: unknown,
  ): GatewayMessage {
    return {
      type,
      id: randomUUID(),
      replyTo,
      ts: new Date().toISOString(),
      payload,
    };
  }

  private errorResponse(
    replyTo: string,
    code: string,
    message: string,
    details?: unknown,
    retryable?: boolean,
  ): GatewayMessage {
    return {
      type: MessageTypes.ERROR,
      id: randomUUID(),
      replyTo,
      ts: new Date().toISOString(),
      payload: buildGatewayErrorPayload(code, message, replyTo, details, retryable) satisfies ErrorPayload,
    };
  }
}

const SPACE_STATUSES: SpaceState[] = [
  "created",
  "active",
  "paused",
  "completed",
  "failed",
];

function mapSpeechEventTypeForPayload(
  eventType: string,
  state: SpeechEventPayload["state"],
): string {
  switch (eventType) {
    case "session_started":
      return "started";
    case "transcript_segment":
      return "listening";
    case "session_rerouted":
      return "processing";
    case "transcript_final":
      return "completed";
    case "session_control":
      if (state === "interrupted") return "interrupted";
      if (state === "ended") return "completed";
      return "processing";
    default:
      return "processing";
  }
}

const ROUTED_ERROR_CODES = new Set([
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "FAILED_PRECONDITION",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "CIRCUIT_OPEN",
]);

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalIssuedTokenTtlSeconds(value: unknown): number | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  if (value <= 0) {
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePaginationInt(
  value: unknown,
  options: { field: string; defaultValue: number; min: number; max: number },
): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: options.defaultValue };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: `${options.field} must be an integer` };
  }
  if (value < options.min || value > options.max) {
    return {
      ok: false,
      message: `${options.field} must be between ${options.min} and ${options.max}`,
    };
  }
  return { ok: true, value };
}

function parseSpaceStatuses(raw: unknown): SpaceState[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const statuses = raw
    .filter((value): value is string => typeof value === "string")
    .filter((value): value is SpaceState =>
      (SPACE_STATUSES as string[]).includes(value),
    );

  return statuses.length > 0 ? statuses : undefined;
}

function isGatewayErrorLike(
  err: unknown,
): err is {
  code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "ALREADY_EXISTS"
    | "FAILED_PRECONDITION"
    | "PERMISSION_DENIED"
    | "RATE_LIMITED"
    | "CIRCUIT_OPEN";
  message: string;
} {
  if (typeof err !== "object" || err === null) {
    return false;
  }

  const candidate = err as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string" &&
    ROUTED_ERROR_CODES.has(candidate.code) &&
    typeof candidate.message === "string"
  );
}
