// Database initialization
export { initDatabase } from "./database.js";
export type { DatabaseManager, DatabaseOptions, GenerationResetInfo } from "./database.js";

// Schema
export { migrations, seedStatements } from "./schema.js";
export type { Migration } from "./schema.js";

// Repositories
export { SpaceRepository } from "./repositories/spaces.js";
export type { SpaceRow, CreateSpaceInput, ListSpacesOptions } from "./repositories/spaces.js";

export { SpaceAgentAssignmentRepository } from "./repositories/space-agent-assignments.js";
export type {
  SpaceAgentAssignmentRow,
  UpsertSpaceAgentAssignmentInput,
} from "./repositories/space-agent-assignments.js";

export { SpaceSkillRepository } from "./repositories/space-skills.js";
export type {
  SpaceSkillRow,
  UpsertSpaceSkillInput,
} from "./repositories/space-skills.js";

export { SpaceResourceRepository } from "./repositories/space-resources.js";
export type {
  SpaceResourceRow,
  SpaceResourceType,
  UpsertSpaceResourceInput,
} from "./repositories/space-resources.js";

export { SpaceWorkspaceRepository } from "./repositories/space-workspaces.js";
export type {
  SpaceWorkspaceRow,
  UpsertSpaceWorkspaceInput,
} from "./repositories/space-workspaces.js";

export { SpaceMcpEndpointRepository } from "./repositories/space-mcp-endpoints.js";
export type {
  SpaceMcpTransport,
  SpaceMcpEndpointHealth,
  SpaceMcpEndpointRow,
  UpsertSpaceMcpEndpointInput,
  UpdateSpaceMcpEndpointHealthInput,
} from "./repositories/space-mcp-endpoints.js";

export { SpaceExternalAgentBindingRepository } from "./repositories/space-external-agent-bindings.js";
export type {
  SpaceExternalAgentBindingRow,
  UpsertSpaceExternalAgentBindingInput,
} from "./repositories/space-external-agent-bindings.js";

export { IdempotencyRepository } from "./repositories/idempotency.js";
export type { IdempotencyRecordRow, CreateIdempotencyRecordInput } from "./repositories/idempotency.js";

export { GatewayPolicyRepository } from "./repositories/gateway-policy.js";
export type { GatewayPolicyRow, SetGatewayPolicyInput } from "./repositories/gateway-policy.js";

export { AuditEventsRepository } from "./repositories/audit-events.js";
export type { AuditEventRow, CreateAuditEventInput } from "./repositories/audit-events.js";

export { ConnectorFamilyRepository } from "./repositories/connector-families.js";
export type {
  ConnectorKind,
  ConnectorRuntime,
  ConnectorTrustClass,
  ConnectorFamilyRow,
  UpsertConnectorFamilyInput,
} from "./repositories/connector-families.js";

export { ConnectorInstanceRepository } from "./repositories/connector-instances.js";
export type {
  ConnectorInstanceStatus,
  ConnectorInstanceRow,
  UpsertConnectorInstanceInput,
} from "./repositories/connector-instances.js";

export { ConnectorBindingRepository } from "./repositories/connector-bindings.js";
export type {
  ConnectorBindingType,
  ConnectorBindingTarget,
  ConnectorBindingRow,
  UpsertConnectorBindingInput,
} from "./repositories/connector-bindings.js";

export { ConnectorPolicyRepository } from "./repositories/connector-policy.js";
export type {
  ConnectorPolicyScopeType,
  ConnectorPolicyRow,
  UpsertConnectorPolicyInput,
} from "./repositories/connector-policy.js";

export { ConnectorSecretRefRepository } from "./repositories/connector-secret-refs.js";
export type {
  ConnectorSecretRefRow,
  UpsertConnectorSecretRefInput,
} from "./repositories/connector-secret-refs.js";

export { ProviderSecretRefRepository } from "./repositories/provider-secret-refs.js";
export type {
  ProviderSecretRefRow,
  UpsertProviderSecretRefInput,
} from "./repositories/provider-secret-refs.js";

export { ProviderConfigRepository } from "./repositories/provider-configs.js";
export type {
  ProviderConfigRow,
  UpsertProviderConfigInput,
} from "./repositories/provider-configs.js";

export { KnowledgeBaseEntryRepository } from "./repositories/knowledge-base.js";
export type {
  KnowledgeBaseEntryKind,
  KnowledgeBaseEntryScopeType,
  KnowledgeBaseEntryRow,
  UpsertKnowledgeBaseEntryInput,
  ListKnowledgeBaseEntriesQuery,
} from "./repositories/knowledge-base.js";

export { GatewayCapabilityGrantRepository } from "./repositories/gateway-capability-grants.js";
export type {
  GatewayCapabilityGrantLevel,
  GatewayCapabilityGrantRow,
  UpsertGatewayCapabilityGrantInput,
  RevokeGatewayCapabilityGrantInput,
  ListGatewayCapabilityGrantsQuery,
  ListEffectiveGatewayCapabilityGrantsQuery,
} from "./repositories/gateway-capability-grants.js";
export { GLOBAL_SCOPE } from "./repositories/gateway-capability-grants.js";

export { GatewayLinkedSkillIndexRepository } from "./repositories/gateway-linked-skill-index.js";
export type {
  GatewayLinkedSkillSyncState,
  GatewayLinkedSkillIndexRow,
  UpsertGatewayLinkedSkillIndexInput,
} from "./repositories/gateway-linked-skill-index.js";

export { AccessGrantRepository } from "./repositories/access-grants.js";
export type {
  AccessGrantMode,
  AccessGrantRow,
  AccessGrantTargetKind,
  UpsertAccessGrantInput,
  RevokeAccessGrantInput,
  ListEffectiveAccessGrantsQuery,
} from "./repositories/access-grants.js";
export { ACCESS_GRANT_GLOBAL_SCOPE } from "./repositories/access-grants.js";

export { ToolApprovalGrantRepository } from "./repositories/tool-approval-grants.js";
export type {
  ToolApprovalGrantMode,
  ToolApprovalGrantRow,
  UpsertToolApprovalGrantInput,
  RevokeToolApprovalGrantInput,
  ListToolApprovalGrantsQuery,
  ListEffectiveToolApprovalGrantsQuery,
} from "./repositories/tool-approval-grants.js";
export { TOOL_APPROVAL_GLOBAL_SCOPE } from "./repositories/tool-approval-grants.js";

export { TurnRepository } from "./repositories/turns.js";
export type { TurnRow, CreateTurnInput, SpaceAgentTurnAggregate } from "./repositories/turns.js";

export { RunRepository } from "./repositories/runs.js";
export type { RunStatus, RunRow, CreateRunInput, UpdateRunStatusInput } from "./repositories/runs.js";

export { RunStepRepository } from "./repositories/run-steps.js";
export type {
  RunStepKind,
  RunStepStatus,
  RunStepRow,
  CreateRunStepInput,
  UpdateRunStepStatusInput,
} from "./repositories/run-steps.js";

export { InvocationRecordRepository } from "./repositories/invocation-records.js";
export type {
  IntegrationClass,
  InvocationRecordStatus,
  InvocationRecordRow,
  CreateInvocationRecordInput,
  UpdateInvocationRecordInput,
} from "./repositories/invocation-records.js";

export { ApprovalRequestRepository } from "./repositories/approval-requests.js";
export type {
  ApprovalRequestStatus,
  ApprovalRequestRow,
  CreateApprovalRequestInput,
} from "./repositories/approval-requests.js";

export { ConciergeEscalationRequestRepository } from "./repositories/concierge-escalation-requests.js";
export type {
  ConciergeEscalationAllowedResponse,
  ConciergeEscalationDeliveryChannel,
  ConciergeEscalationFallbackPolicy,
  ConciergeEscalationRequestRow,
  ConciergeEscalationResponseMode,
  ConciergeEscalationStatus,
  ConciergeEscalationUrgency,
  CreateConciergeEscalationRequestInput,
  UpdateConciergeEscalationRequestInput,
} from "./repositories/concierge-escalation-requests.js";

export { UsageRecordRepository } from "./repositories/usage-records.js";
export type { UsageRecordRow, CreateUsageRecordInput } from "./repositories/usage-records.js";

export { IntegrationRequestRepository } from "./repositories/integration-requests.js";
export type {
  IntegrationRequestStatus,
  IntegrationRequestClass,
  IntegrationRequestRow,
  CreateIntegrationRequestInput,
} from "./repositories/integration-requests.js";

export { EventLogRepository } from "./repositories/event-log.js";
export type { EventLogRow, CreateEventLogInput, ListEventLogQuery } from "./repositories/event-log.js";

export { AgentUsageSessionRepository } from "./repositories/agent-usage-sessions.js";
export type {
  AgentUsageSessionStatus,
  AgentUsageSessionRow,
  EnsureAgentUsageSessionInput,
  ResetAgentUsageSessionInput,
  AgentUsageSessionResetResult,
} from "./repositories/agent-usage-sessions.js";

export { UsageAnalyticsRepository } from "./repositories/usage-analytics.js";
export type { AgentTokenAggregate, TokenAggregate, ProviderTokenAggregate } from "./repositories/usage-analytics.js";

export { VoiceUsageRepository } from "./repositories/voice-usage.js";
export type {
  VoiceUsageChannel,
  VoiceUsageSource,
  CreateVoiceUsageEventInput,
  VoiceUsageAggregate,
  VoiceUsageSourceAggregate,
  VoiceUsageProviderChannelAggregate,
} from "./repositories/voice-usage.js";

export { VoiceProviderConfigRepository } from "./repositories/voice-provider-configs.js";
export type {
  VoiceProviderConfigRow,
  UpsertVoiceProviderConfigInput,
} from "./repositories/voice-provider-configs.js";

export { ProfileRepository } from "./repositories/profiles.js";
export type {
  ProfileRow,
  ProfileRevisionRow,
  ProfileModelConfig,
  CreateProfileInput,
  UpdateProfileInput,
} from "./repositories/profiles.js";

export { PersonaRepository } from "./repositories/personas.js";
export type {
  PersonaRow,
  PersonaRevisionRow,
  CreatePersonaInput,
  UpdatePersonaInput,
} from "./repositories/personas.js";

export { ArtifactRepository } from "./repositories/artifacts.js";
export type { ArtifactRow, CreateArtifactInput } from "./repositories/artifacts.js";

export { PersonalityInsightRepository } from "./repositories/personality-insights.js";
export type {
  PersonalityInsightStatusRowValue,
  PersonalityInsightRow,
  CreatePersonalityInsightInput,
} from "./repositories/personality-insights.js";

export { SpaceAgentNotesRepository } from "./repositories/space-agent-notes.js";
export type {
  SpaceAgentNoteRow,
  UpsertSpaceAgentNoteInput,
} from "./repositories/space-agent-notes.js";

export { SpaceReplaySessionRepository } from "./repositories/space-replay-sessions.js";
export type {
  SpaceReplaySessionPrivacyMode,
  SpaceReplaySessionStatus,
  SpaceReplaySessionRow,
  CreateSpaceReplaySessionInput,
} from "./repositories/space-replay-sessions.js";

export { GatewayMemoryDefaultsRepository } from "./repositories/gateway-memory-defaults.js";
export type {
  GatewayMemoryDefaultExperienceCaptureRowValue,
  GatewayMemoryDefaultPrivacyModeRowValue,
  GatewayMemoryDefaultsRow,
  SetGatewayMemoryDefaultsInput,
} from "./repositories/gateway-memory-defaults.js";

export { GatewayWorkspaceDefaultsRepository } from "./repositories/gateway-workspace-defaults.js";
export type {
  GatewayWorkspaceDefaultsRow,
  SetGatewayWorkspaceDefaultsInput,
} from "./repositories/gateway-workspace-defaults.js";

export { GatewayExternalConnectivityRepository } from "./repositories/gateway-external-connectivity.js";
export type {
  GatewayExternalConnectivityModeRowValue,
  GatewayExternalConnectivityRow,
  SetGatewayExternalConnectivityInput,
} from "./repositories/gateway-external-connectivity.js";

export { UserProfileRepository } from "./repositories/user-profiles.js";
export type {
  UserProfileRow,
  UpsertUserProfileInput,
  UserPreferencesFallbackRow,
} from "./repositories/user-profiles.js";

export { GatewaySkillDraftRepository } from "./repositories/gateway-skill-drafts.js";
export type {
  GatewaySkillDraftRow,
  UpsertGatewaySkillDraftInput,
} from "./repositories/gateway-skill-drafts.js";

export { TaskRecordRepository } from "./repositories/task-records.js";
export type {
  TaskState,
  TaskRecordRow,
  TaskProgress,
  CreateTaskRecordInput,
  UpdateTaskRecordInput,
} from "./repositories/task-records.js";

export { SafetyProfileRepository } from "./repositories/safety-profiles.js";
export type {
  SafetyProfileRow,
  UpsertSafetyProfileInput,
} from "./repositories/safety-profiles.js";

export { ToolAccessPolicyRepository } from "./repositories/tool-access-policies.js";
export type {
  ToolAccessPolicyScopeType,
  ToolAccessPolicyRow,
  UpsertToolAccessPolicyInput,
} from "./repositories/tool-access-policies.js";

export { SpaceLinkRepository } from "./repositories/space-links.js";
export type { SpaceLinkRow, UpsertSpaceLinkInput } from "./repositories/space-links.js";

export { SpaceContextTransferRepository } from "./repositories/space-context-transfers.js";
export type {
  SpaceContextTransferRow,
  CreateSpaceContextTransferInput,
} from "./repositories/space-context-transfers.js";

export { SpaceShareInviteRepository } from "./repositories/space-share-invites.js";
export type {
  SpaceShareAccessMode,
  SpaceShareInviteStatus,
  SpaceShareInviteRow,
  CreateSpaceShareInviteInput,
} from "./repositories/space-share-invites.js";

export { SpaceParticipantRepository } from "./repositories/space-participants.js";
export type {
  SpaceParticipantStatus,
  SpaceParticipantRow,
  UpsertSpaceParticipantInput,
} from "./repositories/space-participants.js";

export { SpaceChangeSetRepository } from "./repositories/space-changesets.js";
export type {
  ChangeSetStatus,
  ChangeSetAdapter,
  SpaceChangeSetRow,
  CreateSpaceChangeSetInput,
  UpdateSpaceChangeSetInput,
  ListSpaceChangeSetsQuery,
} from "./repositories/space-changesets.js";

export { SpaceChangeSetFileRepository } from "./repositories/space-changeset-files.js";
export type {
  ChangeSetFileType,
  SpaceChangeSetFileRow,
  UpsertSpaceChangeSetFileInput,
} from "./repositories/space-changeset-files.js";

export { SpaceChangeSetReviewRepository } from "./repositories/space-changeset-reviews.js";
export type {
  ChangeSetReviewDecision,
  SpaceChangeSetReviewRow,
  CreateSpaceChangeSetReviewInput,
} from "./repositories/space-changeset-reviews.js";

export { SpaceQuotaPolicyRepository } from "./repositories/space-quota-policies.js";
export type {
  SpaceQuotaPolicyRow,
  UpsertSpaceQuotaPolicyInput,
} from "./repositories/space-quota-policies.js";

export { ParticipantQuotaPolicyRepository } from "./repositories/participant-quota-policies.js";
export type {
  ParticipantQuotaPolicyRow,
  UpsertParticipantQuotaPolicyInput,
} from "./repositories/participant-quota-policies.js";

export { SpaceUsageCounterRepository } from "./repositories/space-usage-counters.js";
export type {
  SpaceUsageCounterRow,
  UpdateSpaceUsageCounterInput,
} from "./repositories/space-usage-counters.js";

export { ParticipantUsageCounterRepository } from "./repositories/participant-usage-counters.js";
export type {
  ParticipantUsageCounterRow,
  UpdateParticipantUsageCounterInput,
} from "./repositories/participant-usage-counters.js";

export { SpaceToolPolicyRepository } from "./repositories/space-tool-policies.js";
export type {
  SpaceToolPolicyRow,
  UpsertSpaceToolPolicyInput,
} from "./repositories/space-tool-policies.js";

export { OrchestratorCommandRepository } from "./repositories/orchestrator-commands.js";
export type {
  OrchestratorCommandStatus,
  OrchestratorCommandRow,
  OrchestratorCommandEventRow,
  CreateOrchestratorCommandInput,
} from "./repositories/orchestrator-commands.js";

export { OrchestrationJournalRepository } from "./repositories/orchestration-journal.js";
export type {
  OrchestrationJournalRow,
  CreateOrchestrationJournalInput,
  ListOrchestrationJournalQuery,
} from "./repositories/orchestration-journal.js";

export { SyncRuntimeRepository } from "./repositories/sync-runtime.js";
export type {
  SyncPeerRow,
  UpsertSyncPeerInput,
  SyncPullReceiptRow,
  CreateSyncPullReceiptInput,
} from "./repositories/sync-runtime.js";

export { ExperienceRepository } from "./repositories/experiences.js";
export type {
  ExperienceRow,
  CreateExperienceInput,
  AgentObservationRow,
  CreateObservationInput,
} from "./repositories/experiences.js";

export { SpaceTemplateRepository } from "./repositories/space-templates.js";
export type {
  SpaceTemplateRow,
  SpaceTemplateRevisionRow,
  UpsertSpaceTemplateInput,
} from "./repositories/space-templates.js";

export { DeviceIdentityRepository } from "./repositories/device-identities.js";
export type {
  DeviceIdentityStatus,
  DeviceIdentityRow,
  CreateDeviceIdentityInput,
} from "./repositories/device-identities.js";

export { SpacePresetApplicationRepository } from "./repositories/space-preset-applications.js";
export type {
  SpacePresetApplicationRow,
  CreateSpacePresetApplicationInput,
} from "./repositories/space-preset-applications.js";

export { GatewaySkillCatalogRepository } from "./repositories/gateway-skill-catalog.js";
export type {
  GatewaySkillStatus,
  GatewaySkillCatalogRow,
  UpsertGatewaySkillCatalogInput,
  ListGatewaySkillCatalogQuery,
} from "./repositories/gateway-skill-catalog.js";

export { AgentPresetRepository } from "./repositories/agent-presets.js";
export type {
  AgentPresetRow,
  AgentPresetRevisionRow,
  UpsertAgentPresetInput,
} from "./repositories/agent-presets.js";

export { SchedulerJobRepository } from "./repositories/scheduler-jobs.js";
export type {
  SchedulerJobStatus,
  SchedulerActionType,
  SchedulerJobRow,
  CreateSchedulerJobInput,
  ListSchedulerJobsQuery,
  UpdateSchedulerJobInput,
} from "./repositories/scheduler-jobs.js";

export { SchedulerJobSpaceRepository } from "./repositories/scheduler-job-spaces.js";
export type {
  SchedulerJobSpaceRow,
} from "./repositories/scheduler-job-spaces.js";

export { SchedulerJobRunRepository } from "./repositories/scheduler-job-runs.js";
export type {
  SchedulerRunStatus,
  SchedulerRunTrigger,
  SchedulerJobRunRow,
  CreateSchedulerJobRunInput,
  UpdateSchedulerJobRunInput,
} from "./repositories/scheduler-job-runs.js";

export { OnboardingProfileRepository } from "./repositories/onboarding-profiles.js";
export type {
  OnboardingProfileRow,
} from "./repositories/onboarding-profiles.js";
