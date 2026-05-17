import type { ToolAccessPolicyScopeType } from "@spaceskit/core";
import type {
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
  GatewayGetExternalConnectivityResponsePayload,
  GatewaySetExternalConnectivityPayload,
  GatewaySetExternalConnectivityResponsePayload,
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
} from "./protocol.js";

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
  listEvalDefinitions: (
    input?: SchedulerListEvalDefinitionsPayload,
  ) => Promise<SchedulerListEvalDefinitionsResponsePayload["definitions"]>;
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

export interface WorkbenchService {
  listQueue: (
    input?: WorkbenchListQueuePayload & { principalId?: string },
  ) => Promise<WorkbenchListQueueResponsePayload["items"]>;
  getQueueItem: (
    input: WorkbenchGetQueueItemPayload & { principalId?: string },
  ) => Promise<WorkbenchGetQueueItemResponsePayload["item"] | null>;
  createBatch: (
    input: WorkbenchCreateBatchPayload & { principalId: string },
  ) => Promise<WorkbenchCreateBatchResponsePayload["batch"]>;
  listBatches: (
    input?: WorkbenchListBatchesPayload & { principalId?: string },
  ) => Promise<WorkbenchListBatchesResponsePayload["batches"]>;
  updateBatch: (
    input: WorkbenchUpdateBatchPayload & { principalId: string },
  ) => Promise<WorkbenchUpdateBatchResponsePayload["batch"]>;
  startRun: (
    input: WorkbenchStartRunPayload & { principalId: string },
  ) => Promise<WorkbenchStartRunResponsePayload["run"]>;
  retryRun: (
    input: WorkbenchRetryRunPayload & { principalId: string },
  ) => Promise<WorkbenchRetryRunResponsePayload["run"]>;
  cancelRun: (
    input: WorkbenchCancelRunPayload & { principalId: string },
  ) => Promise<WorkbenchCancelRunResponsePayload["run"]>;
  listRuns: (
    input?: WorkbenchListRunsPayload & { principalId?: string },
  ) => Promise<WorkbenchListRunsResponsePayload["runs"]>;
  getRun: (
    input: WorkbenchGetRunPayload & { principalId?: string },
  ) => Promise<WorkbenchGetRunResponsePayload["run"] | null>;
  approveStage: (
    input: WorkbenchApproveStagePayload & { principalId: string },
  ) => Promise<WorkbenchApproveStageResponsePayload["run"]>;
  rejectStage: (
    input: WorkbenchRejectStagePayload & { principalId: string },
  ) => Promise<WorkbenchRejectStageResponsePayload["run"]>;
  setMode: (
    input: WorkbenchSetModePayload & { principalId: string },
  ) => Promise<WorkbenchSetModeResponsePayload>;
  listArtifacts: (
    input: WorkbenchListArtifactsPayload & { principalId?: string },
  ) => Promise<WorkbenchListArtifactsResponsePayload["artifacts"]>;
  getPolicy: (
    input?: WorkbenchGetPolicyPayload & { principalId?: string },
  ) => Promise<WorkbenchGetPolicyResponsePayload["policy"]>;
  updatePolicy: (
    input: WorkbenchUpdatePolicyPayload & { principalId: string },
  ) => Promise<WorkbenchUpdatePolicyResponsePayload["policy"]>;
}

export interface GatewayWorkspaceDefaultsService {
  get: () => { space_home_root: string; updated_at: string };
  set: (input: { spaceHomeRoot: string }) => { space_home_root: string; updated_at: string };
}

export interface GatewayExternalConnectivityService {
  getSnapshot: () => Promise<GatewayGetExternalConnectivityResponsePayload>;
  setMode: (
    mode: GatewaySetExternalConnectivityPayload["mode"],
    funnelEnabled?: boolean | null,
  ) => Promise<GatewaySetExternalConnectivityResponsePayload>;
  isExternallyExposed?: () => boolean;
  currentFunnelUrl?: () => string | undefined;
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
