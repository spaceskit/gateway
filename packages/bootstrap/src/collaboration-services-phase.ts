import type { BootstrapState } from "./bootstrap-state.js";
import {
  evaluateCrossSpaceBoundaryPolicy,
  evaluateSyncBoundaryPolicy,
} from "./services/share-boundary-policy.js";
import { DeviceIdentityService } from "./services/device-identity-service.js";
import { GatewayExternalConnectivityService } from "./services/gateway-external-connectivity-service.js";
import { MemoryLifecycleService } from "./services/memory-lifecycle-service.js";
import { CliExecutionAuditService } from "./services/cli-execution-audit-service.js";
import { SpaceArtifactService } from "./services/space-artifact-service.js";
import { SpaceChangeSetService } from "./services/space-changeset-service.js";
import { SpaceConfiguratorService } from "./services/space-configurator-service.js";
import { SpaceContextService } from "./services/space-context-service.js";
import { SpaceMemoryPolicyService } from "./services/space-memory-policy-service.js";
import { SpaceQuotaService } from "./services/space-quota-service.js";
import { SpaceSharingService } from "./services/space-sharing-service.js";
import { DefaultGatewaySyncService } from "./services/sync-service.js";
import { SpaceToolPolicyService } from "./services/space-tool-policy-service.js";
import { SpaceTurnTraceService } from "./services/space-turn-trace-service.js";
import {
  parseJsonRecord,
  parseSharingIdentityPolicyFromSpaceConfig,
} from "./turn-helpers.js";
import { seedArchetypeTemplates } from "./seed/archetype-templates.js";

export function initializeCollaborationServices(state: BootstrapState): void {
  const { config, logger } = state;

  const spaceContextService = (
    state.spaceLinkRepo
    && state.spaceContextTransferRepo
    && state.artifactRepo
    && state.spaceRepo
  )
    ? new SpaceContextService({
      links: state.spaceLinkRepo,
      transfers: state.spaceContextTransferRepo,
      artifacts: state.artifactRepo,
      spaces: state.spaceRepo,
      evaluateSharePolicy: (context) => evaluateCrossSpaceBoundaryPolicy({
        globalFlags: state.gatewayPolicyService?.getPolicy().globalFlags,
        sourceSpaceId: context.sourceSpaceId,
        targetSpaceId: context.targetSpaceId,
        artifactId: context.artifactId,
        operation: "share",
        artifactType: context.artifactType,
        title: context.title,
        tags: context.tags,
        isGeneratedBasic: context.isGeneratedBasic,
      }),
      evaluateImportPolicy: (context) => evaluateCrossSpaceBoundaryPolicy({
        globalFlags: state.gatewayPolicyService?.getPolicy().globalFlags,
        sourceSpaceId: context.sourceSpaceId,
        targetSpaceId: context.targetSpaceId,
        artifactId: context.artifactId,
        operation: "import",
        artifactType: context.artifactType,
        title: context.title,
        tags: context.tags,
        isGeneratedBasic: context.isGeneratedBasic,
      }),
    })
    : null;

  const spaceSharingService = (
    state.spaceShareInviteRepo
    && state.spaceParticipantRepo
    && state.spaceRepo
  )
    ? new SpaceSharingService({
      invites: state.spaceShareInviteRepo,
      participants: state.spaceParticipantRepo,
      spaces: state.spaceRepo,
      defaultInviteTtlSeconds: parseInt(Bun.env.SPACESKIT_SHARE_INVITE_TTL_SECONDS ?? "86400", 10),
      sharingIdentityPolicy: {
        mode: config.shareIdentityMode,
        allowDeviceKeyFallback: config.shareAllowDeviceKeyFallback,
      },
      resolveSpaceSharingIdentityPolicy: (spaceId: string) => {
        const row = state.spaceRepo?.getById(spaceId);
        if (!row?.space_config_json) return undefined;
        return parseSharingIdentityPolicyFromSpaceConfig(parseJsonRecord(row.space_config_json));
      },
      relayBaseUrl: config.shareRelayBaseUrl,
      fallbackGatewayUrl: config.shareFallbackGatewayUrl,
    })
    : null;

  const spaceTurnTraceService = state.eventLogRepo
    ? new SpaceTurnTraceService({
      eventLog: state.eventLogRepo,
      orchestrationJournal: state.orchestrationJournalRepo ?? undefined,
      turns: state.turnRepo ?? undefined,
    })
    : null;
  const spaceArtifactService = state.artifactRepo && state.spaceRepo
    ? new SpaceArtifactService({
      artifacts: state.artifactRepo,
      spaces: state.spaceRepo,
    })
    : null;
  const cliExecutionAuditService = state.artifactRepo && state.spaceRepo
    ? new CliExecutionAuditService({
      artifacts: state.artifactRepo,
      spaces: state.spaceRepo,
      eventBus: state.eventBus,
      logger: logger.child({ module: "cli-execution-audit" }),
    })
    : null;

  const spaceQuotaService = (
    state.spaceRepo
    && state.spaceQuotaPolicyRepo
    && state.participantQuotaPolicyRepo
    && state.spaceUsageCounterRepo
    && state.participantUsageCounterRepo
    && state.spaceChangeSetRepo
    && state.spaceChangeSetFileRepo
    && state.usageRepo
    && state.agentUsageSessionRepo
  )
    ? new SpaceQuotaService({
      spaces: state.spaceRepo,
      spaceQuotaPolicies: state.spaceQuotaPolicyRepo,
      participantQuotaPolicies: state.participantQuotaPolicyRepo,
      spaceUsageCounters: state.spaceUsageCounterRepo,
      participantUsageCounters: state.participantUsageCounterRepo,
      changeSets: state.spaceChangeSetRepo,
      changeSetFiles: state.spaceChangeSetFileRepo,
      usageAnalytics: state.usageRepo,
      agentUsageSessions: state.agentUsageSessionRepo,
      onAgentUsageSessionReset: (spaceId, agentId) => {
        state.spaceManager?.resetAgentSession(spaceId, agentId);
      },
    })
    : null;

  const spaceChangeSetService = (
    config.collabChangesetsEnabled
    && state.spaceRepo
    && state.spaceParticipantRepo
    && state.spaceChangeSetRepo
    && state.spaceChangeSetFileRepo
    && state.spaceChangeSetReviewRepo
    && state.spaceWorkspaceService
  )
    ? new SpaceChangeSetService({
      spaces: state.spaceRepo,
      participants: state.spaceParticipantRepo,
      changeSets: state.spaceChangeSetRepo,
      changeSetFiles: state.spaceChangeSetFileRepo,
      changeSetReviews: state.spaceChangeSetReviewRepo,
      workspaceResolver: state.spaceWorkspaceService,
      quotaService: spaceQuotaService ?? undefined,
    })
    : null;

  const spaceToolPolicyService = (
    config.toolPolicyV2Enabled
    && state.spaceToolPolicyRepo
  )
    ? new SpaceToolPolicyService({
      capabilities: state.capabilities,
      spaceAdminService: state.spaceAdminService,
      toolPolicies: state.spaceToolPolicyRepo,
      gatewayProfile: config.gatewayProfile,
      gatewayPolicyService: state.gatewayPolicyService ?? undefined,
      gatewayCapabilityAccessService: state.gatewayCapabilityAccessService ?? undefined,
      spaceMcpService: state.spaceMcpService,
    })
    : null;

  const gatewayExternalConnectivityService = new GatewayExternalConnectivityService({
    repo: state.gatewayExternalConnectivityRepo ?? undefined,
    gatewayProfile: config.gatewayProfile,
    gatewayHost: config.host,
    gatewayPort: config.port,
    logger: logger.child({ module: "external-connectivity" }),
  });

  const deviceIdentityService = state.deviceIdentityRepo
    ? new DeviceIdentityService({
      repository: state.deviceIdentityRepo,
      requirePreRegistered: Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE === "true",
      onDeviceRevoked: ({ principalId, deviceId }) => {
        state.server?.disconnectSessionsByDevice(deviceId, principalId);
      },
    })
    : null;

  const spaceTemplateService = new SpaceConfiguratorService({
    templates: state.spaceTemplateRepo,
    spaceAdminService: state.spaceAdminService,
    profileRepo: state.profileRepo,
    defaultProfileId: config.mainProfileId,
    defaultAgentId: config.mainAgentId,
  });

  if (state.db) {
    try {
      const seedResult = seedArchetypeTemplates({
        templateRepo: state.spaceTemplateRepo,
        profileRepo: state.profileRepo,
        db: state.db.db,
      });
      logger.info(`Archetype seed complete: ${seedResult.profilesCreated} profiles created, ${seedResult.templatesCreated} templates created`);
    } catch (err) {
      logger.warn(`Archetype seed failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const resolveSyncPeerSecret = (peerId: string): string | undefined => {
    const normalizedPeerKey = peerId.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return Bun.env[`SPACESKIT_SYNC_SECRET_${normalizedPeerKey}`]
      ?? Bun.env.SPACESKIT_SYNC_SHARED_SECRET
      ?? undefined;
  };

  const gatewaySyncService = state.syncRuntimeRepo && state.artifactRepo
    ? new DefaultGatewaySyncService(state.syncRuntimeRepo, state.artifactRepo, {
      spaceRepo: state.spaceRepo ?? undefined,
      localPeerId: Bun.env.SPACESKIT_SYNC_LOCAL_PEER_ID ?? config.mainSpaceResourceId,
      resolvePeerSecret: resolveSyncPeerSecret,
      autoPullOnAnnounce: Bun.env.SPACESKIT_SYNC_AUTO_PULL_ON_ANNOUNCE === "true",
      autoPullTargetSpaceId: Bun.env.SPACESKIT_SYNC_AUTO_PULL_TARGET_SPACE_ID ?? config.mainSpaceId,
      evaluateQueryPolicy: (input) => evaluateSyncBoundaryPolicy({
        globalFlags: state.gatewayPolicyService?.getPolicy().globalFlags,
        peerId: input.peerId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        operation: "query",
        artifactType: input.artifactType,
        title: input.title,
        tags: input.tags,
        isGeneratedBasic: input.isGeneratedBasic,
      }),
      evaluatePullPolicy: (input) => evaluateSyncBoundaryPolicy({
        globalFlags: state.gatewayPolicyService?.getPolicy().globalFlags,
        peerId: input.peerId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        operation: "pull",
        artifactType: input.artifactType,
        title: input.title,
        tags: input.tags,
        isGeneratedBasic: input.isGeneratedBasic,
      }),
      logger: logger.child({ module: "sync" }),
    })
    : null;

  const spaceMemoryPolicyService = (
    state.spaceRepo
    && state.gatewayMemoryDefaultsRepo
    && state.spaceReplaySessionRepo
    && state.turnRepo
    && state.eventLogRepo
    && state.orchestrationJournalRepo
    && state.artifactRepo
  )
    ? new SpaceMemoryPolicyService({
      spaces: state.spaceRepo,
      gatewayDefaults: state.gatewayMemoryDefaultsRepo,
      replaySessions: state.spaceReplaySessionRepo,
      turns: state.turnRepo,
      eventLog: state.eventLogRepo,
      orchestrationJournal: state.orchestrationJournalRepo,
      artifacts: state.artifactRepo,
      experiences: state.experienceRepo ?? undefined,
      personalityInsights: state.personalityInsightRepo ?? undefined,
      agentNotes: state.spaceAgentNotesRepo ?? undefined,
      agentUsageSessions: state.agentUsageSessionRepo ?? undefined,
      logger: logger.child({ module: "space-memory-policy" }),
    })
    : null;

  const memoryLifecycleService = (
    state.experienceRepo
    || state.personalityInsightRepo
    || state.spaceAgentNotesRepo
    || state.userProfileRepo
    || state.memoryRegistry.getDefault()
  )
    ? new MemoryLifecycleService({
      experiences: state.experienceRepo ?? undefined,
      insights: state.personalityInsightRepo ?? undefined,
      profiles: state.profileRepo ?? undefined,
      notes: state.spaceAgentNotesRepo ?? undefined,
      userProfiles: state.userProfileRepo ?? undefined,
      memoryProvider: state.memoryRegistry.getDefault() ?? undefined,
    })
    : null;

  Object.assign(state, {
    deviceIdentityService,
    gatewayExternalConnectivityService,
    cliExecutionAuditService,
    gatewaySyncService,
    memoryLifecycleService,
    spaceArtifactService,
    spaceChangeSetService,
    spaceContextService,
    spaceMemoryPolicyService,
    spaceQuotaService,
    spaceSharingService,
    spaceTemplateService,
    spaceToolPolicyService,
    spaceTurnTraceService,
  });
}
