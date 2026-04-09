import { MessageTypes, type GatewayMessage } from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { MessageRouter } from "../message-router.js";
import { handleAuthIssueHttpPrincipalToken, handleAuthListDevices, handleAuthRegisterDevice, handleAuthRevokeDevice, handleAuthRotateDeviceKey, handleSpeechAudioChunk, handleSpeechControl, handleSpeechStart, handleSyncAnnounce, handleSyncPullResources, handleSyncQueryResources } from "./transport-handlers.js";
import { handleGatewayGetExternalConnectivity, handleGatewayGetToolPolicy, handleGatewayGetWorkspaceDefaults, handleGatewaySetExternalConnectivity, handleGatewaySetWorkspaceDefaults, handleGatewayUpdateToolPolicy, handleSpaceGetEffectiveToolAccess, handleSpaceGetEffectiveTools, handleSpaceGetToolPolicy, handleSpaceReset, handleSpaceResetAgentUsageSession, handleSpaceUpdateToolPolicy } from "./policy-handlers.js";
import { handleExecuteTurn, handleCancelTurn, handleResumeFeedback, handleCapabilityInvoke } from "./turn-handlers.js";
import { handleSpaceAddAgent, handleSpaceArchive, handleSpaceCreate, handleSpaceDelete, handleSpaceEndIncognitoSession, handleSpaceGet, handleSpaceGetMemoryPolicy, handleSpaceList, handleSpaceListAgentAssignments, handleSpaceRemoveAgent, handleSpaceSetMemoryPolicy, handleSpaceSetOrchestrator, handleSpaceSetThinkingCapturePolicy, handleSpaceUpdateAgentAssignment } from "./space-admin-handlers.js";
import { handleSpaceAddResource, handleSpaceAddSkill, handleSpaceApproveMcpAgent, handleSpaceClearMcpEndpoint, handleSpaceDiscoverMcpAgents, handleSpaceGetMcpEndpoint, handleSpaceGetWorkspace, handleSpaceListOrchestrationJournal, handleSpaceListResources, handleSpaceListSkills, handleSpaceListTurns, handleSpaceRemoveResource, handleSpaceRemoveSkill, handleSpaceSetMcpEndpoint, handleSpaceSetWorkspace } from "./space-resource-handlers.js";
import { handleGatewayDiscoverLocalAgents, handleGatewayGetConciergeAgent, handleGatewayGetMainAgent, handleGatewayListAvailableModels, handleGatewayListProviderCatalogs, handleGatewayListProviderConfigs, handleGatewaySetConciergeAgent, handleGatewaySetMainAgent } from "./gateway-agent-handlers.js";
import { handleGatewayCreateIntegrationRequest, handleGatewayDeleteSecretRef, handleGatewayFactoryReset, handleGatewayGetLocalUsageTelemetry, handleGatewayGetProviderSettings, handleGatewayGetProviderTelemetry, handleGatewayListIntegrationRequests, handleGatewayListInterconnectors, handleGatewayListSecretRefs, handleGatewayProvisionLocalProfile, handleGatewayPutSecretRef, handleGatewayRemoveProviderConfig, handleGatewayRescanInterconnectors, handleGatewaySetProviderConfig, handleGatewayUpdateProviderSettings, handleToolGet, handleToolList, handleToolListGrants, handleToolRegister, handleToolRemove, handleToolRevokeGrant, handleToolScaffold, handleToolSetEnabled } from "./gateway-control-handlers.js";
import { handleConnectorSubmitInboundEvent, handleGatewayGetConnectorPolicy, handleGatewayListConnectorBindings, handleGatewayListConnectorFamilies, handleGatewayListConnectors, handleGatewayRemoveConnector, handleGatewayRemoveConnectorBinding, handleGatewayTestConnector, handleGatewayUpdateConnectorPolicy, handleGatewayUpsertConnector, handleGatewayUpsertConnectorBinding } from "./gateway-connector-handlers.js";
import { handleIdentityArchiveAgentDefinition, handleIdentityArchivePersona, handleIdentityCreateAgentDefinition, handleIdentityCreatePersona, handleIdentityGetAgentDefinition, handleIdentityGetPersona, handleIdentityListAgentDefinitions, handleIdentityListPersonas, handleIdentityPreviewCompiledInstructions, handleIdentityPreviewRuntimeSystemPrompt, handleIdentityPreviewSystemPromptMatrix, handleIdentityUpdateAgentDefinition, handleIdentityUpdatePersona, handleSpaceArchiveTemplate, handleSpaceCreateFromTemplate, handleSpaceGetTemplate, handleSpaceListTemplates, handleSpacePreviewTemplate, handleSpaceSaveTemplate } from "./identity-template-handlers.js";
import { handleGatewayGetPolicy, handleGatewayGrantCapability, handleGatewayKnowledgeBaseDeleteEntry, handleGatewayKnowledgeBaseListEntries, handleGatewayKnowledgeBaseUpsertEntry, handleGatewayListCapabilityGrants, handleGatewayRevokeCapability, handleGatewaySkillDelete, handleGatewaySkillGet, handleGatewaySkillList, handleGatewaySkillUpsert, handleGatewayUpdatePolicy, handleUsageGetSnapshot, handleLibraryListEntries, handleLibraryGetEntry, handleLibrarySaveSkill, handleLibraryImportEntry, handleLibraryArchiveEntry, handleLibrarySetEntryEnabled, handleLibraryDeleteEntry, handleLibraryScanEntries, handleLibraryListSkillDrafts, handleLibraryGetSkillDraft, handleLibraryCreateSkillDraft, handleLibraryDeleteSkillDraft } from "./gateway-governance-handlers.js";
import { handleOrchestratorCommand, handleOrchestratorGetCommand, handleSchedulerCreateJob, handleSchedulerDeleteJob, handleSchedulerGetJob, handleSchedulerLinkSpace, handleSchedulerListJobs, handleSchedulerListRuns, handleSchedulerRunNow, handleSchedulerUnlinkSpace, handleSchedulerUpdateJob } from "./scheduler-handlers.js";
import { handleSpaceLink, handleSpacePullSharedContext, handleSpaceShareContext, handleSpaceShareCreateInvite, handleSpaceShareJoin, handleSpaceShareListParticipants, handleSpaceShareRevoke, handleSpaceUnlink } from "./space-sharing-handlers.js";
import {
  handleSpaceAcceptInsight,
  handleSpaceApplyChangeSet,
  handleSpaceCreateChangeSet,
  handleSpaceDeleteMemory,
  handleSpaceDismissInsight,
  handleSpaceGetArtifact,
  handleSpaceGetDebugArtifact,
  handleSpaceGetChangeSetDiff,
  handleSpaceGetExperience,
  handleSpaceGetInsight,
  handleSpaceGetQuota,
  handleSpaceGetSpaceAgentNotes,
  handleSpaceGetTurnTrace,
  handleSpaceGetUsage,
  handleSpaceGetUserProfile,
  handleSpaceListActivityLog,
  handleSpaceListArtifacts,
  handleSpaceListChangeSets,
  handleSpaceListExperiences,
  handleSpaceListInsights,
  handleSpaceListMemories,
  handleSpaceRejectInsight,
  handleSpaceReviewChangeSet,
  handleSpaceSubmitChangeSet,
  handleSpaceUpdateMemoryImportance,
  handleSpaceUpdateQuotaPolicy,
  handleSpaceUpdateSpaceAgentNotes,
  handleSpaceUpdateUserProfile,
  handleSpaceUploadChangeSetFileComplete,
  handleSpaceUploadChangeSetFileInit,
} from "./changeset-handlers.js";
import { handleCapabilitiesDeregister, handleCapabilitiesRegister, handleCapabilityError, handleCapabilityResult } from "./adapter-capability-handlers.js";
import { handleAgentMessage, handleAgentPoke, handleConciergeActionResult, handleSessionListResumable, handleSessionResume, handleTaskDependency } from "./realtime-collaboration-handlers.js";
import {
  handleConciergeCallAnswer,
  handleConciergeCallAudioChunk,
  handleConciergeCallControl,
  handleConciergeCallEnd,
  handleConciergeCallHandoffAccept,
  handleConciergeCallHandoffPrepare,
  handleConciergeCallRegisterPush,
  handleConciergeCallSetMuted,
  handleConciergeCallStart,
} from "./concierge-call-handlers.js";

export async function routeMessage(
  router: MessageRouter,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  switch (msg.type) {
    case MessageTypes.EXECUTE_TURN:
      return handleExecuteTurn(router.turnHandlerContext(), client, msg);
    case MessageTypes.CANCEL_TURN:
      return handleCancelTurn(router.turnHandlerContext(), client, msg);
    case MessageTypes.RESUME_FEEDBACK:
      return handleResumeFeedback(router.turnHandlerContext(), client, msg);
    case MessageTypes.CAPABILITY_INVOKE:
      return handleCapabilityInvoke(router.turnHandlerContext(), client, msg);
    case MessageTypes.SPACE_CREATE:
      return handleSpaceCreate(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET:
      return handleSpaceGet(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST:
      return handleSpaceList(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_ARCHIVE:
      return handleSpaceArchive(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_DELETE:
      return handleSpaceDelete(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_ADD_AGENT:
      return handleSpaceAddAgent(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_REMOVE_AGENT:
      return handleSpaceRemoveAgent(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT:
      return handleSpaceUpdateAgentAssignment(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_SET_ORCHESTRATOR:
      return handleSpaceSetOrchestrator(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_SET_THINKING_CAPTURE_POLICY:
      return handleSpaceSetThinkingCapturePolicy(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_MEMORY_POLICY:
      return handleSpaceGetMemoryPolicy(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_SET_MEMORY_POLICY:
      return handleSpaceSetMemoryPolicy(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_END_INCOGNITO_SESSION:
      return handleSpaceEndIncognitoSession(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS:
      return handleSpaceListAgentAssignments(router.spaceAdminHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_MCP_ENDPOINT:
      return handleSpaceGetMcpEndpoint(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_SET_MCP_ENDPOINT:
      return handleSpaceSetMcpEndpoint(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_CLEAR_MCP_ENDPOINT:
      return handleSpaceClearMcpEndpoint(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_DISCOVER_MCP_AGENTS:
      return handleSpaceDiscoverMcpAgents(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_APPROVE_MCP_AGENT:
      return handleSpaceApproveMcpAgent(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_ADD_SKILL:
      return handleSpaceAddSkill(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_REMOVE_SKILL:
      return handleSpaceRemoveSkill(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_SKILLS:
      return handleSpaceListSkills(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_WORKSPACE:
      return handleSpaceGetWorkspace(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_SET_WORKSPACE:
      return handleSpaceSetWorkspace(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_ADD_RESOURCE:
      return handleSpaceAddResource(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_REMOVE_RESOURCE:
      return handleSpaceRemoveResource(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_RESOURCES:
      return handleSpaceListResources(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_TURNS:
      return handleSpaceListTurns(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_ORCHESTRATION_JOURNAL:
      return handleSpaceListOrchestrationJournal(router.spaceResourceHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_LIST_AGENT_DEFINITIONS:
      return handleIdentityListAgentDefinitions(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_GET_AGENT_DEFINITION:
      return handleIdentityGetAgentDefinition(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_CREATE_AGENT_DEFINITION:
      return handleIdentityCreateAgentDefinition(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_UPDATE_AGENT_DEFINITION:
      return handleIdentityUpdateAgentDefinition(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_ARCHIVE_AGENT_DEFINITION:
      return handleIdentityArchiveAgentDefinition(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_LIST_PERSONAS:
      return handleIdentityListPersonas(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_GET_PERSONA:
      return handleIdentityGetPersona(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_CREATE_PERSONA:
      return handleIdentityCreatePersona(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_UPDATE_PERSONA:
      return handleIdentityUpdatePersona(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_ARCHIVE_PERSONA:
      return handleIdentityArchivePersona(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_PREVIEW_COMPILED_INSTRUCTIONS:
      return handleIdentityPreviewCompiledInstructions(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_PREVIEW_RUNTIME_SYSTEM_PROMPT:
      return handleIdentityPreviewRuntimeSystemPrompt(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.IDENTITY_PREVIEW_SYSTEM_PROMPT_MATRIX:
      return handleIdentityPreviewSystemPromptMatrix(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_TEMPLATES:
      return handleSpaceListTemplates(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_TEMPLATE:
      return handleSpaceGetTemplate(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.SPACE_PREVIEW_TEMPLATE:
      return handleSpacePreviewTemplate(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.SPACE_CREATE_FROM_TEMPLATE:
      return handleSpaceCreateFromTemplate(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.SPACE_SAVE_TEMPLATE:
      return handleSpaceSaveTemplate(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.SPACE_ARCHIVE_TEMPLATE:
      return handleSpaceArchiveTemplate(router.identityTemplateHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_DISCOVER_LOCAL_AGENTS:
      return handleGatewayDiscoverLocalAgents(router.gatewayAgentHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_PROVIDER_CONFIGS:
      return handleGatewayListProviderConfigs(router.gatewayAgentHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_MAIN_AGENT:
      return handleGatewayGetMainAgent(router.gatewayAgentHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_CONCIERGE_AGENT:
      return handleGatewayGetConciergeAgent(router.gatewayAgentHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SET_MAIN_AGENT:
      return handleGatewaySetMainAgent(router.gatewayAgentHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SET_CONCIERGE_AGENT:
      return handleGatewaySetConciergeAgent(router.gatewayAgentHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_AVAILABLE_MODELS:
      return handleGatewayListAvailableModels(router.gatewayAgentHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_PROVIDER_CATALOGS:
      return handleGatewayListProviderCatalogs(router.gatewayAgentHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_INTERCONNECTORS:
      return handleGatewayListInterconnectors(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.TOOL_LIST:
      return handleToolList(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.TOOL_GET:
      return handleToolGet(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.TOOL_SCAFFOLD:
      return handleToolScaffold(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.TOOL_REGISTER:
      return handleToolRegister(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.TOOL_REMOVE:
      return handleToolRemove(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.TOOL_SET_ENABLED:
      return handleToolSetEnabled(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.TOOL_LIST_GRANTS:
      return handleToolListGrants(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.TOOL_REVOKE_GRANT:
      return handleToolRevokeGrant(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_RESCAN_INTERCONNECTORS:
      return handleGatewayRescanInterconnectors(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_CREATE_INTEGRATION_REQUEST:
      return handleGatewayCreateIntegrationRequest(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_INTEGRATION_REQUESTS:
      return handleGatewayListIntegrationRequests(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_PROVIDER_TELEMETRY:
      return handleGatewayGetProviderTelemetry(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY:
      return handleGatewayGetLocalUsageTelemetry(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_PROVIDER_SETTINGS:
      return handleGatewayGetProviderSettings(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_UPDATE_PROVIDER_SETTINGS:
      return handleGatewayUpdateProviderSettings(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SET_PROVIDER_CONFIG:
      return handleGatewaySetProviderConfig(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_REMOVE_PROVIDER_CONFIG:
      return handleGatewayRemoveProviderConfig(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_FACTORY_RESET:
      return handleGatewayFactoryReset(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE:
      return handleGatewayProvisionLocalProfile(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_PUT_SECRET_REF:
      return handleGatewayPutSecretRef(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_SECRET_REFS:
      return handleGatewayListSecretRefs(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_DELETE_SECRET_REF:
      return handleGatewayDeleteSecretRef(router.gatewayControlHandlerContext(), client, msg);
    case MessageTypes.CONNECTOR_SUBMIT_INBOUND_EVENT:
      return handleConnectorSubmitInboundEvent(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_CONNECTOR_FAMILIES:
      return handleGatewayListConnectorFamilies(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_CONNECTORS:
      return handleGatewayListConnectors(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_UPSERT_CONNECTOR:
      return handleGatewayUpsertConnector(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_REMOVE_CONNECTOR:
      return handleGatewayRemoveConnector(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_CONNECTOR_BINDINGS:
      return handleGatewayListConnectorBindings(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_UPSERT_CONNECTOR_BINDING:
      return handleGatewayUpsertConnectorBinding(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_REMOVE_CONNECTOR_BINDING:
      return handleGatewayRemoveConnectorBinding(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_CONNECTOR_POLICY:
      return handleGatewayGetConnectorPolicy(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_UPDATE_CONNECTOR_POLICY:
      return handleGatewayUpdateConnectorPolicy(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_TEST_CONNECTOR:
      return handleGatewayTestConnector(router.gatewayConnectorHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_POLICY:
      return handleGatewayGetPolicy(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_UPDATE_POLICY:
      return handleGatewayUpdatePolicy(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SKILL_LIST:
      return handleGatewaySkillList(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SKILL_GET:
      return handleGatewaySkillGet(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SKILL_UPSERT:
      return handleGatewaySkillUpsert(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SKILL_DELETE:
      return handleGatewaySkillDelete(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_KB_LIST_ENTRIES:
      return handleGatewayKnowledgeBaseListEntries(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_KB_UPSERT_ENTRY:
      return handleGatewayKnowledgeBaseUpsertEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_KB_DELETE_ENTRY:
      return handleGatewayKnowledgeBaseDeleteEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_LIST_CAPABILITY_GRANTS:
      return handleGatewayListCapabilityGrants(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GRANT_CAPABILITY:
      return handleGatewayGrantCapability(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_REVOKE_CAPABILITY:
      return handleGatewayRevokeCapability(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.USAGE_GET_SNAPSHOT:
      return handleUsageGetSnapshot(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_CREATE_JOB:
      return handleSchedulerCreateJob(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_GET_JOB:
      return handleSchedulerGetJob(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_LIST_JOBS:
      return handleSchedulerListJobs(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_UPDATE_JOB:
      return handleSchedulerUpdateJob(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_DELETE_JOB:
      return handleSchedulerDeleteJob(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_LINK_SPACE:
      return handleSchedulerLinkSpace(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_UNLINK_SPACE:
      return handleSchedulerUnlinkSpace(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_LIST_RUNS:
      return handleSchedulerListRuns(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SCHEDULER_RUN_NOW:
      return handleSchedulerRunNow(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.ORCHESTRATOR_COMMAND:
      return handleOrchestratorCommand(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.ORCHESTRATOR_GET_COMMAND:
      return handleOrchestratorGetCommand(router.schedulerHandlerContext(), client, msg);
    case MessageTypes.SPACE_LINK:
      return handleSpaceLink(router.spaceSharingHandlerContext(), client, msg);
    case MessageTypes.SPACE_UNLINK:
      return handleSpaceUnlink(router.spaceSharingHandlerContext(), client, msg);
    case MessageTypes.SPACE_SHARE_CONTEXT:
      return handleSpaceShareContext(router.spaceSharingHandlerContext(), client, msg);
    case MessageTypes.SPACE_PULL_SHARED_CONTEXT:
      return handleSpacePullSharedContext(router.spaceSharingHandlerContext(), client, msg);
    case MessageTypes.SPACE_SHARE_CREATE_INVITE:
      return handleSpaceShareCreateInvite(router.spaceSharingHandlerContext(), client, msg);
    case MessageTypes.SPACE_SHARE_JOIN:
      return handleSpaceShareJoin(router.spaceSharingHandlerContext(), client, msg);
    case MessageTypes.SPACE_SHARE_REVOKE:
      return handleSpaceShareRevoke(router.spaceSharingHandlerContext(), client, msg);
    case MessageTypes.SPACE_SHARE_LIST_PARTICIPANTS:
      return handleSpaceShareListParticipants(router.spaceSharingHandlerContext(), client, msg);
    case MessageTypes.SPACE_CREATE_CHANGESET:
      return handleSpaceCreateChangeSet(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_CHANGESETS:
      return handleSpaceListChangeSets(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_INIT:
      return handleSpaceUploadChangeSetFileInit(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_COMPLETE:
      return handleSpaceUploadChangeSetFileComplete(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_SUBMIT_CHANGESET:
      return handleSpaceSubmitChangeSet(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_REVIEW_CHANGESET:
      return handleSpaceReviewChangeSet(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_APPLY_CHANGESET:
      return handleSpaceApplyChangeSet(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_CHANGESET_DIFF:
      return handleSpaceGetChangeSetDiff(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_QUOTA:
      return handleSpaceGetQuota(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_UPDATE_QUOTA_POLICY:
      return handleSpaceUpdateQuotaPolicy(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_USAGE:
      return handleSpaceGetUsage(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_ACTIVITY_LOG:
      return handleSpaceListActivityLog(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_TURN_TRACE:
      return handleSpaceGetTurnTrace(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_EXPERIENCES:
      return handleSpaceListExperiences(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_EXPERIENCE:
      return handleSpaceGetExperience(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_INSIGHTS:
      return handleSpaceListInsights(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_INSIGHT:
      return handleSpaceGetInsight(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_ACCEPT_INSIGHT:
      return handleSpaceAcceptInsight(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_REJECT_INSIGHT:
      return handleSpaceRejectInsight(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_DISMISS_INSIGHT:
      return handleSpaceDismissInsight(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_SPACE_AGENT_NOTES:
      return handleSpaceGetSpaceAgentNotes(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_UPDATE_SPACE_AGENT_NOTES:
      return handleSpaceUpdateSpaceAgentNotes(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_USER_PROFILE:
      return handleSpaceGetUserProfile(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_UPDATE_USER_PROFILE:
      return handleSpaceUpdateUserProfile(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_MEMORIES:
      return handleSpaceListMemories(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_DELETE_MEMORY:
      return handleSpaceDeleteMemory(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_UPDATE_MEMORY_IMPORTANCE:
      return handleSpaceUpdateMemoryImportance(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_LIST_ARTIFACTS:
      return handleSpaceListArtifacts(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_ARTIFACT:
      return handleSpaceGetArtifact(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_DEBUG_ARTIFACT:
      return handleSpaceGetDebugArtifact(router.changeSetHandlerContext(), client, msg);
    case MessageTypes.SPACE_RESET:
      return handleSpaceReset(router.policyHandlerContext(), client, msg);
    case MessageTypes.SPACE_RESET_AGENT_USAGE_SESSION:
      return handleSpaceResetAgentUsageSession(router.policyHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_EFFECTIVE_TOOLS:
      return handleSpaceGetEffectiveTools(router.policyHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_EFFECTIVE_TOOL_ACCESS:
      return handleSpaceGetEffectiveToolAccess(router.policyHandlerContext(), client, msg);
    case MessageTypes.SPACE_GET_TOOL_POLICY:
      return handleSpaceGetToolPolicy(router.policyHandlerContext(), client, msg);
    case MessageTypes.SPACE_UPDATE_TOOL_POLICY:
      return handleSpaceUpdateToolPolicy(router.policyHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_TOOL_POLICY:
      return handleGatewayGetToolPolicy(router.policyHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_UPDATE_TOOL_POLICY:
      return handleGatewayUpdateToolPolicy(router.policyHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_WORKSPACE_DEFAULTS:
      return handleGatewayGetWorkspaceDefaults(router.policyHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SET_WORKSPACE_DEFAULTS:
      return handleGatewaySetWorkspaceDefaults(router.policyHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_GET_EXTERNAL_CONNECTIVITY:
      return handleGatewayGetExternalConnectivity(router.policyHandlerContext(), client, msg);
    case MessageTypes.GATEWAY_SET_EXTERNAL_CONNECTIVITY:
      return handleGatewaySetExternalConnectivity(router.policyHandlerContext(), client, msg);
    case MessageTypes.AUTH_REGISTER_DEVICE:
      return handleAuthRegisterDevice(router.transportHandlerContext(), client, msg);
    case MessageTypes.AUTH_ROTATE_DEVICE_KEY:
      return handleAuthRotateDeviceKey(router.transportHandlerContext(), client, msg);
    case MessageTypes.AUTH_REVOKE_DEVICE:
      return handleAuthRevokeDevice(router.transportHandlerContext(), client, msg);
    case MessageTypes.AUTH_LIST_DEVICES:
      return handleAuthListDevices(router.transportHandlerContext(), client, msg);
    case MessageTypes.AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN:
      return handleAuthIssueHttpPrincipalToken(router.transportHandlerContext(), client, msg);
    case MessageTypes.SYNC_ANNOUNCE:
      return handleSyncAnnounce(router.transportHandlerContext(), client, msg);
    case MessageTypes.SYNC_QUERY_RESOURCES:
      return handleSyncQueryResources(router.transportHandlerContext(), client, msg);
    case MessageTypes.SYNC_PULL_RESOURCES:
      return handleSyncPullResources(router.transportHandlerContext(), client, msg);
    case MessageTypes.SPEECH_START:
      return handleSpeechStart(router.transportHandlerContext(), client, msg);
    case MessageTypes.SPEECH_AUDIO_CHUNK:
      return handleSpeechAudioChunk(router.transportHandlerContext(), client, msg);
    case MessageTypes.SPEECH_CONTROL:
      return handleSpeechControl(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_START:
      return handleConciergeCallStart(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_ANSWER:
      return handleConciergeCallAnswer(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_END:
      return handleConciergeCallEnd(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_SET_MUTED:
      return handleConciergeCallSetMuted(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_AUDIO_CHUNK:
      return handleConciergeCallAudioChunk(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_CONTROL:
      return handleConciergeCallControl(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_HANDOFF_PREPARE:
      return handleConciergeCallHandoffPrepare(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_HANDOFF_ACCEPT:
      return handleConciergeCallHandoffAccept(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_REGISTER_PUSH:
      return handleConciergeCallRegisterPush(router.transportHandlerContext(), client, msg);
    case MessageTypes.CAPABILITIES_REGISTER:
      return handleCapabilitiesRegister(router.adapterCapabilityHandlerContext(), client, msg);
    case MessageTypes.CAPABILITIES_DEREGISTER:
      return handleCapabilitiesDeregister(router.adapterCapabilityHandlerContext(), client, msg);
    case MessageTypes.CAPABILITY_RESULT:
      return handleCapabilityResult(router.adapterCapabilityHandlerContext(), client, msg);
    case MessageTypes.CAPABILITY_ERROR:
      return handleCapabilityError(router.adapterCapabilityHandlerContext(), client, msg);
    case MessageTypes.AUTHENTICATE:
      return router.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "authenticate is handled by GatewayServer transport-level auth flow",
      );
    case MessageTypes.AGENT_MESSAGE:
      return handleAgentMessage(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.AGENT_POKE:
      return handleAgentPoke(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.TASK_DEPENDENCY:
      return handleTaskDependency(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_ACTION_RESULT:
      return handleConciergeActionResult(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.SESSION_LIST_RESUMABLE:
      return handleSessionListResumable(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.SESSION_RESUME:
      return handleSessionResume(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_LIST_ENTRIES:
      return handleLibraryListEntries(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_GET_ENTRY:
      return handleLibraryGetEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_SAVE_SKILL:
      return handleLibrarySaveSkill(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_IMPORT_ENTRY:
      return handleLibraryImportEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_ARCHIVE_ENTRY:
      return handleLibraryArchiveEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_SET_ENTRY_ENABLED:
      return handleLibrarySetEntryEnabled(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_DELETE_ENTRY:
      return handleLibraryDeleteEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_SCAN_ENTRIES:
      return handleLibraryScanEntries(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_LIST_SKILL_DRAFTS:
      return handleLibraryListSkillDrafts(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_GET_SKILL_DRAFT:
      return handleLibraryGetSkillDraft(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_CREATE_SKILL_DRAFT:
      return handleLibraryCreateSkillDraft(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_DELETE_SKILL_DRAFT:
      return handleLibraryDeleteSkillDraft(router.gatewayGovernanceHandlerContext(), client, msg);
    default:
      return router.errorResponse(msg.id, "INVALID_ARGUMENT", `Unknown message type: ${msg.type}`);
  }
}
