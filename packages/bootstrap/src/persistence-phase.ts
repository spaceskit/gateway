import {
  AccessGrantRepository,
  AgentUsageSessionRepository,
  ApprovalRequestRepository,
  AppleNotificationRepository,
  ArtifactRepository,
  AuditEventsRepository,
  AuthKeyRepository,
  ConciergeEscalationRequestRepository,
  ConnectorBindingRepository,
  ConnectorFamilyRepository,
  ConnectorInstanceRepository,
  ConnectorPolicyRepository,
  ConnectorSecretRefRepository,
  DeviceIdentityRepository,
  InviteTokenRepository,
  EventLogRepository,
  ExperienceRepository,
  GatewayCapabilityGrantRepository,
  GatewayExternalConnectivityRepository,
  GatewayLinkedSkillIndexRepository,
  GatewayMemoryDefaultsRepository,
  GatewayPolicyRepository,
  GatewayRuntimeDefaultsRepository,
  GatewaySkillCatalogRepository,
  GatewaySkillDraftRepository,
  GatewayWorkspaceDefaultsRepository,
  IdempotencyRepository,
  IntegrationRequestRepository,
  InvocationRecordRepository,
  KnowledgeBaseEntryRepository,
  OrchestratorCommandRepository,
  OrchestrationJournalRepository,
  ParticipantQuotaPolicyRepository,
  ParticipantUsageCounterRepository,
  PersonaRepository,
  PersonalityInsightRepository,
  ProfileRepository,
  ProviderConfigRepository,
  ProviderSecretRefRepository,
  RunRepository,
  RunStepRepository,
  SafetyProfileRepository,
  SchedulerJobRepository,
  SchedulerJobRunRepository,
  SchedulerJobSpaceRepository,
  WorkbenchArtifactRepository,
  WorkbenchBatchRepository,
  WorkbenchPolicyRepository,
  WorkbenchRunRepository,
  SpaceAgentAssignmentRepository,
  SpaceChangeSetFileRepository,
  SpaceChangeSetRepository,
  SpaceChangeSetReviewRepository,
  SpaceContextTransferRepository,
  SpaceExternalAgentBindingRepository,
  SpaceAgentNotesRepository,
  SpaceLinkRepository,
  SpaceMcpEndpointRepository,
  SpaceParticipantRepository,
  SpaceQuotaPolicyRepository,
  SpaceReplaySessionRepository,
  SpaceRepository,
  SpaceResourceRepository,
  SpaceShareInviteRepository,
  SpaceSkillRepository,
  SpaceTemplateRepository,
  SpaceToolPolicyRepository,
  SpaceUsageCounterRepository,
  SpaceWorkspaceRepository,
  SyncRuntimeRepository,
  ToolAccessPolicyRepository,
  ToolApprovalGrantRepository,
  TurnRepository,
  UsageAnalyticsRepository,
  UsageRecordRepository,
  UserProfileRepository,
  VoiceProviderConfigRepository,
  VoiceUsageRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { RuntimeLedgerService } from "./services/runtime-ledger-service.js";
import { acquireDbExclusiveLock, loadOrCreateGatewayUuid } from "./startup-guards.js";
import type { BootstrapState } from "./bootstrap-state.js";

export async function initializePersistence(state: BootstrapState): Promise<void> {
  let {
    db = null,
    spaceRepo = null,
    spaceAssignmentRepo = null,
    spaceMcpEndpointRepo = null,
    spaceExternalAgentBindingRepo = null,
    spaceResourceRepo = null,
    spaceWorkspaceRepo = null,
    spaceSkillRepo = null,
    artifactRepo = null,
    spaceLinkRepo = null,
    spaceContextTransferRepo = null,
    spaceShareInviteRepo = null,
    spaceParticipantRepo = null,
    spaceChangeSetRepo = null,
    spaceChangeSetFileRepo = null,
    spaceChangeSetReviewRepo = null,
    spaceQuotaPolicyRepo = null,
    participantQuotaPolicyRepo = null,
    spaceUsageCounterRepo = null,
    participantUsageCounterRepo = null,
    spaceToolPolicyRepo = null,
    spaceTemplateRepo = null,
    orchestrationJournalRepo = null,
    eventLogRepo = null,
    agentUsageSessionRepo = null,
    toolApprovalGrantRepo = null,
    deviceIdentityRepo = null,
    authKeyRepo = null,
    inviteTokenRepo = null,
    orchestratorCommandRepo = null,
    schedulerJobRepo = null,
    schedulerJobSpaceRepo = null,
    schedulerJobRunRepo = null,
    workbenchBatchRepo = null,
    workbenchRunRepo = null,
    workbenchArtifactRepo = null,
    workbenchPolicyRepo = null,
    idempotencyRepo = null,
    gatewayPolicyRepo = null,
    auditEventsRepo = null,
    connectorFamilyRepo = null,
    connectorInstanceRepo = null,
    connectorBindingRepo = null,
    connectorPolicyRepo = null,
    connectorSecretRefRepo = null,
    accessGrantRepo = null,
    providerConfigRepo = null,
    providerSecretRefRepo = null,
    knowledgeBaseRepo = null,
    gatewaySkillCatalogRepo = null,
    gatewayLinkedSkillIndexRepo = null,
    skillDraftRepo = null,
    safetyProfileRepo = null,
    toolAccessPolicyRepo = null,
    gatewayCapabilityGrantRepo = null,
    syncRuntimeRepo = null,
    turnRepo = null,
    runRepo = null,
    runStepRepo = null,
    invocationRecordRepo = null,
    approvalRequestRepo = null,
    appleNotificationRepo = null,
    conciergeEscalationRequestRepo = null,
    usageRecordRepo = null,
    integrationRequestRepo = null,
    usageRepo = null,
    voiceUsageRepo = null,
    voiceProviderConfigRepo = null,
    profileRepo = null,
    personaRepo = null,
    experienceRepo = null,
    personalityInsightRepo = null,
    spaceAgentNotesRepo = null,
    spaceReplaySessionRepo = null,
    gatewayMemoryDefaultsRepo = null,
    gatewayRuntimeDefaultsRepo = null,
    userProfileRepo = null,
    gatewayWorkspaceDefaultsRepo = null,
    gatewayExternalConnectivityRepo = null,
    runtimeLedgerService = null,
  } = state;

  try {
    db = initDatabase({
      path: state.config.dbPath,
      runtimeGeneration: state.config.runtimeGeneration,
    });

    acquireDbExclusiveLock(db, state.config.dbPath, state.logger);
    if (db.generationResetInfo) {
      state.logger.warn("Runtime generation changed — ephemeral data cleared", {
        from: db.generationResetInfo.previousGeneration,
        to: db.generationResetInfo.newGeneration,
      });
    }

    state.gatewayUuid = loadOrCreateGatewayUuid(db, state.resolvedGatewayUuidSeed);
    spaceRepo = new SpaceRepository(db.db);
    spaceAssignmentRepo = new SpaceAgentAssignmentRepository(db.db);
    spaceMcpEndpointRepo = new SpaceMcpEndpointRepository(db.db);
    spaceExternalAgentBindingRepo = new SpaceExternalAgentBindingRepository(db.db);
    spaceResourceRepo = new SpaceResourceRepository(db.db);
    spaceWorkspaceRepo = new SpaceWorkspaceRepository(db.db);
    spaceSkillRepo = new SpaceSkillRepository(db.db);
    artifactRepo = new ArtifactRepository(db.db);
    spaceLinkRepo = new SpaceLinkRepository(db.db);
    spaceContextTransferRepo = new SpaceContextTransferRepository(db.db);
    spaceShareInviteRepo = new SpaceShareInviteRepository(db.db);
    spaceParticipantRepo = new SpaceParticipantRepository(db.db);
    spaceChangeSetRepo = new SpaceChangeSetRepository(db.db);
    spaceChangeSetFileRepo = new SpaceChangeSetFileRepository(db.db);
    spaceChangeSetReviewRepo = new SpaceChangeSetReviewRepository(db.db);
    spaceQuotaPolicyRepo = new SpaceQuotaPolicyRepository(db.db);
    participantQuotaPolicyRepo = new ParticipantQuotaPolicyRepository(db.db);
    spaceUsageCounterRepo = new SpaceUsageCounterRepository(db.db);
    participantUsageCounterRepo = new ParticipantUsageCounterRepository(db.db);
    spaceToolPolicyRepo = new SpaceToolPolicyRepository(db.db);
    spaceTemplateRepo = new SpaceTemplateRepository(db.db);
    orchestrationJournalRepo = new OrchestrationJournalRepository(db.db);
    eventLogRepo = new EventLogRepository(db.db);
    agentUsageSessionRepo = new AgentUsageSessionRepository(db.db);
    toolApprovalGrantRepo = new ToolApprovalGrantRepository(db.db);
    deviceIdentityRepo = new DeviceIdentityRepository(db.db);
    authKeyRepo = new AuthKeyRepository(db.db);
    inviteTokenRepo = new InviteTokenRepository(db.db);
    orchestratorCommandRepo = new OrchestratorCommandRepository(db.db);
    schedulerJobRepo = new SchedulerJobRepository(db.db);
    schedulerJobSpaceRepo = new SchedulerJobSpaceRepository(db.db);
    schedulerJobRunRepo = new SchedulerJobRunRepository(db.db);
    workbenchBatchRepo = new WorkbenchBatchRepository(db.db);
    workbenchRunRepo = new WorkbenchRunRepository(db.db);
    workbenchArtifactRepo = new WorkbenchArtifactRepository(db.db);
    workbenchPolicyRepo = new WorkbenchPolicyRepository(db.db);
    idempotencyRepo = new IdempotencyRepository(db.db);
    gatewayPolicyRepo = new GatewayPolicyRepository(db.db);
    auditEventsRepo = new AuditEventsRepository(db.db);
    connectorFamilyRepo = new ConnectorFamilyRepository(db.db);
    connectorInstanceRepo = new ConnectorInstanceRepository(db.db);
    connectorBindingRepo = new ConnectorBindingRepository(db.db);
    connectorPolicyRepo = new ConnectorPolicyRepository(db.db);
    connectorSecretRefRepo = new ConnectorSecretRefRepository(db.db);
    accessGrantRepo = new AccessGrantRepository(db.db);
    providerConfigRepo = new ProviderConfigRepository(db.db);
    providerSecretRefRepo = new ProviderSecretRefRepository(db.db);
    knowledgeBaseRepo = new KnowledgeBaseEntryRepository(db.db);
    gatewaySkillCatalogRepo = new GatewaySkillCatalogRepository(db.db);
    gatewayLinkedSkillIndexRepo = new GatewayLinkedSkillIndexRepository(db.db);
    skillDraftRepo = new GatewaySkillDraftRepository(db.db);
    safetyProfileRepo = new SafetyProfileRepository(db.db);
    toolAccessPolicyRepo = new ToolAccessPolicyRepository(db.db);
    gatewayCapabilityGrantRepo = new GatewayCapabilityGrantRepository(db.db);
    syncRuntimeRepo = new SyncRuntimeRepository(db.db);
    turnRepo = new TurnRepository(db.db);
    runRepo = new RunRepository(db.db);
    runStepRepo = new RunStepRepository(db.db);
    invocationRecordRepo = new InvocationRecordRepository(db.db);
    approvalRequestRepo = new ApprovalRequestRepository(db.db);
    appleNotificationRepo = new AppleNotificationRepository(db.db);
    conciergeEscalationRequestRepo = new ConciergeEscalationRequestRepository(db.db);
    usageRecordRepo = new UsageRecordRepository(db.db);
    integrationRequestRepo = new IntegrationRequestRepository(db.db);
    usageRepo = new UsageAnalyticsRepository(db.db);
    voiceUsageRepo = new VoiceUsageRepository(db.db);
    voiceProviderConfigRepo = new VoiceProviderConfigRepository(db.db);
    profileRepo = new ProfileRepository(db.db);
    personaRepo = new PersonaRepository(db.db);
    experienceRepo = new ExperienceRepository(db.db);
    personalityInsightRepo = new PersonalityInsightRepository(db.db);
    spaceAgentNotesRepo = new SpaceAgentNotesRepository(db.db);
    spaceReplaySessionRepo = new SpaceReplaySessionRepository(db.db);
    gatewayMemoryDefaultsRepo = new GatewayMemoryDefaultsRepository(db.db);
    gatewayRuntimeDefaultsRepo = new GatewayRuntimeDefaultsRepository(db.db);
    userProfileRepo = new UserProfileRepository(db.db);
    gatewayWorkspaceDefaultsRepo = new GatewayWorkspaceDefaultsRepository(db.db);
    gatewayExternalConnectivityRepo = new GatewayExternalConnectivityRepository(db.db);

    runtimeLedgerService = new RuntimeLedgerService({
      runs: runRepo,
      runSteps: runStepRepo,
      invocationRecords: invocationRecordRepo,
      approvalRequests: approvalRequestRepo,
      usageRecords: usageRecordRepo,
      classifyIntegrationClass: (providerId?: string) =>
        state.executionAdapterFactory.classify(providerId ?? "openai"),
    });

    const journalCutoffIso = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString();
    const startupPruned = orchestrationJournalRepo.pruneBefore(journalCutoffIso);
    if (startupPruned > 0) {
      state.logger.info("Pruned orchestration journal entries on startup", { deleted: startupPruned });
    }
    state.logger.info("Database initialized");
  } catch (err) {
    const errMsg = String(err instanceof Error ? err.message : err);
    if (errMsg.includes("Another gateway process is using this database")) {
      throw err;
    }
    const fallbackAllowed = state.config.gatewayProfile === "embedded" && state.config.allowPersistenceFallback;
    if (!fallbackAllowed) {
      state.logger.error(
        "Database initialization failed and persistence fallback is disabled for this gateway profile",
        err,
      );
      throw err instanceof Error
        ? err
        : new Error("Database initialization failed and persistence fallback is disabled");
    }
    state.logger.warn(
      "Database initialization failed — continuing without persistence because SPACESKIT_ALLOW_PERSISTENCE_FALLBACK=true",
      { error: err instanceof Error ? err.message : String(err) },
    );
  }

  Object.assign(state, {
    db,
    spaceRepo,
    spaceAssignmentRepo,
    spaceMcpEndpointRepo,
    spaceExternalAgentBindingRepo,
    spaceResourceRepo,
    spaceWorkspaceRepo,
    spaceSkillRepo,
    artifactRepo,
    spaceLinkRepo,
    spaceContextTransferRepo,
    spaceShareInviteRepo,
    spaceParticipantRepo,
    spaceChangeSetRepo,
    spaceChangeSetFileRepo,
    spaceChangeSetReviewRepo,
    spaceQuotaPolicyRepo,
    participantQuotaPolicyRepo,
    spaceUsageCounterRepo,
    participantUsageCounterRepo,
    spaceToolPolicyRepo,
    spaceTemplateRepo,
    orchestrationJournalRepo,
    eventLogRepo,
    agentUsageSessionRepo,
    toolApprovalGrantRepo,
    deviceIdentityRepo,
    authKeyRepo,
    inviteTokenRepo,
    orchestratorCommandRepo,
    schedulerJobRepo,
    schedulerJobSpaceRepo,
    schedulerJobRunRepo,
    workbenchBatchRepo,
    workbenchRunRepo,
    workbenchArtifactRepo,
    workbenchPolicyRepo,
    idempotencyRepo,
    gatewayPolicyRepo,
    auditEventsRepo,
    connectorFamilyRepo,
    connectorInstanceRepo,
    connectorBindingRepo,
    connectorPolicyRepo,
    connectorSecretRefRepo,
    accessGrantRepo,
    providerConfigRepo,
    providerSecretRefRepo,
    knowledgeBaseRepo,
    gatewaySkillCatalogRepo,
    gatewayLinkedSkillIndexRepo,
    skillDraftRepo,
    safetyProfileRepo,
    toolAccessPolicyRepo,
    gatewayCapabilityGrantRepo,
    syncRuntimeRepo,
    turnRepo,
    runRepo,
    runStepRepo,
    invocationRecordRepo,
    approvalRequestRepo,
    appleNotificationRepo,
    conciergeEscalationRequestRepo,
    usageRecordRepo,
    integrationRequestRepo,
    usageRepo,
    voiceUsageRepo,
    voiceProviderConfigRepo,
    profileRepo,
    personaRepo,
    experienceRepo,
    personalityInsightRepo,
    spaceAgentNotesRepo,
    spaceReplaySessionRepo,
    gatewayMemoryDefaultsRepo,
    gatewayRuntimeDefaultsRepo,
    userProfileRepo,
    gatewayWorkspaceDefaultsRepo,
    gatewayExternalConnectivityRepo,
    runtimeLedgerService,
  });
}
