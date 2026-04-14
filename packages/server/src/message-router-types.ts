import type { CapabilityRegistry, SessionContinuityManager, SpaceAdminService, SpaceManager } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { AuthIssueHttpPrincipalTokenResponsePayload, GatewayMessage } from "./protocol.js";
import type {
  ConnectorAdminService,
  ConciergeCallRuntimeService,
  ConciergeEscalationService,
  DeviceIdentityService,
  GatewayAdminService,
  GatewayCapabilityAccessService,
  GatewayExternalConnectivityService,
  GatewayIdentityService,
  GatewayKnowledgeBaseService,
  GatewayLibraryService,
  GatewayPolicyService,
  GatewayResetService,
  GatewaySkillCatalogService,
  GatewaySyncService,
  GatewayWorkspaceDefaultsService,
  OrchestratorCommandService,
  SchedulerService,
  WorkbenchService,
  SpeechSessionService,
  ToolAccessPolicyService,
  UsageSnapshotService,
} from "./message-router-gateway-services.js";
import type {
  OrchestrationJournalService,
  MemoryLifecycleService,
  SpaceArtifactReaderService,
  SpaceChangeSetService,
  SpaceContextService,
  SpaceMemoryPolicyService,
  SpaceMcpService,
  SpaceQuotaService,
  SpaceSharingService,
  SpaceTemplateService,
  SpaceToolPolicyService,
  SpaceTurnTraceService,
  SpaceWorkspaceService,
  TurnHistoryService,
} from "./message-router-space-services.js";

export interface MessageRouterOptions {
  spaceManager: SpaceManager;
  spaceAdminService?: SpaceAdminService;
  gatewayAdminService?: GatewayAdminService;
  gatewayResetService?: GatewayResetService;
  connectorAdminService?: ConnectorAdminService;
  gatewayIdentityService?: GatewayIdentityService;
  gatewayPolicyService?: GatewayPolicyService;
  gatewaySkillCatalogService?: GatewaySkillCatalogService;
  gatewayKnowledgeBaseService?: GatewayKnowledgeBaseService;
  gatewayLibraryService?: GatewayLibraryService;
  gatewayCapabilityAccessService?: GatewayCapabilityAccessService;
  spaceTemplateService?: SpaceTemplateService;
  usageSnapshotService?: UsageSnapshotService;
  schedulerService?: SchedulerService;
  workbenchService?: WorkbenchService;
  spaceContextService?: SpaceContextService;
  spaceSharingService?: SpaceSharingService;
  turnHistoryService?: TurnHistoryService;
  orchestrationJournalService?: OrchestrationJournalService;
  spaceMemoryPolicyService?: SpaceMemoryPolicyService;
  spaceWorkspaceService?: SpaceWorkspaceService;
  spaceChangeSetService?: SpaceChangeSetService;
  spaceQuotaService?: SpaceQuotaService;
  spaceTurnTraceService?: SpaceTurnTraceService;
  memoryLifecycleService?: MemoryLifecycleService;
  spaceArtifactService?: SpaceArtifactReaderService;
  spaceToolPolicyService?: SpaceToolPolicyService;
  spaceMcpService?: SpaceMcpService;
  deviceIdentityService?: DeviceIdentityService;
  orchestratorCommandService?: OrchestratorCommandService;
  gatewaySyncService?: GatewaySyncService;
  speechSessionService?: SpeechSessionService;
  conciergeCallRuntimeService?: ConciergeCallRuntimeService;
  conciergeEscalationService?: ConciergeEscalationService;
  toolAccessPolicyService?: ToolAccessPolicyService;
  gatewayWorkspaceDefaultsService?: GatewayWorkspaceDefaultsService;
  gatewayExternalConnectivityService?: GatewayExternalConnectivityService;
  onFeedbackResolved?: (input: {
    spaceId?: string;
    turnId: string;
    status: "approved" | "rejected" | "revised" | "deferred";
    resolution?: string;
  }) => void;
  issueHttpPrincipalToken?: (input: {
    principalId: string;
    deviceId?: string;
    ttlSeconds?: number;
  }) => Promise<AuthIssueHttpPrincipalTokenResponsePayload> | AuthIssueHttpPrincipalTokenResponsePayload;
  capabilities: CapabilityRegistry;
  logger: Logger;
  sendToClient?: (clientId: string, msg: GatewayMessage) => void;
  broadcastToSpace?: (spaceUid: string, msg: GatewayMessage) => void;
  resolveSpaceUid?: (spaceId: string) => string | undefined | Promise<string | undefined>;
  listAssignmentsByProfileId?: (profileId: string) => Array<{
    spaceId: string;
    agentId: string;
    profileId: string;
  }> | Promise<Array<{
    spaceId: string;
    agentId: string;
    profileId: string;
  }>>;
  adapterInvocationTimeoutMs?: number;
  sessionContinuityManager?: SessionContinuityManager;
  agentSessionReplacementEnabled?: boolean;
}

export interface PendingAdapterInvocation {
  clientId: string;
  providerId: string;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}
