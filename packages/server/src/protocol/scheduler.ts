export type SchedulerJobStatusPayload = "active" | "paused" | "invalid";
export type SchedulerRunStatusPayload = "running" | "completed" | "failed" | "skipped";
export type SchedulerRunTriggerPayload = "scheduled" | "manual";
export type SchedulerScheduleKindPayload = "hourly" | "daily" | "weekly";
export type SchedulerActionTypePayload = "space_prompt";
export type SchedulerExecutionTargetModePayload = "existing_space" | "new_space";
export type SchedulerCalendarSyncStatusPayload = "pending" | "synced" | "error";
export type SchedulerCalendarDriftStatusPayload = "none" | "drifted";
export type SchedulerEvalSummaryModePayload = "checkpoints" | "final_summary";
export type SchedulerEvalRecommendationStatusPayload = "suggested" | "applied";
export type SchedulerEvalRecommendationKindPayload = "flow_variant" | "prompt_pack" | "summary_mode";
export type SchedulerEvalScenarioStatusPayload = "pass" | "fail" | "skip";
export type SchedulerEvalCheckpointStatusPayload = "completed" | "failed" | "observed";

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

export interface SchedulerExecutionTargetPayload {
  mode: SchedulerExecutionTargetModePayload;
}

export interface SchedulerCalendarBindingPayload {
  providerId: string;
  calendarId: string;
  eventId?: string;
  syncStatus?: SchedulerCalendarSyncStatusPayload;
  driftStatus?: SchedulerCalendarDriftStatusPayload;
  driftMessage?: string;
  lastSyncedAt?: string;
}

export interface SchedulerEvalConfigPayload {
  evalDefinitionId: string;
  scenarioIds?: string[];
  promptVariantId?: string;
  promptPackId?: string;
  flowVariantId?: string;
  summaryMode?: SchedulerEvalSummaryModePayload;
  selfImproveEnabled?: boolean;
}

export interface SchedulerEvalSelfImproveStatePayload {
  enabled: boolean;
  appliedRevisionIds: string[];
  lastAppliedRunId?: string;
}

export interface SchedulerEvalCheckpointPayload {
  checkpointId: string;
  kind: string;
  status: SchedulerEvalCheckpointStatusPayload;
  actorId?: string;
  createdAt: string;
  detail?: Record<string, unknown>;
}

export interface SchedulerEvalRecommendationPayload {
  recommendationId: string;
  status: SchedulerEvalRecommendationStatusPayload;
  kind: SchedulerEvalRecommendationKindPayload;
  title: string;
  summary?: string;
  originatingRunId?: string;
  promptVariantId?: string;
  promptPackId?: string;
  flowVariantId?: string;
  appliedRevisionId?: string;
  createdAt: string;
  detail?: Record<string, unknown>;
}

export interface SchedulerEvalScenarioResultPayload {
  scenarioId: string;
  status: SchedulerEvalScenarioStatusPayload;
  checkpointCount: number;
  failureReason?: string;
}

export interface SchedulerEvalArtifactRefPayload {
  kind: "space" | "turn" | "scheduler_run";
  id: string;
  label?: string;
}

export interface SchedulerEvalRunPayload {
  evalRunId: string;
  evalDefinitionId: string;
  scenarioIds: string[];
  promptVariantId?: string;
  promptPackId?: string;
  flowVariantId?: string;
  summaryMode: SchedulerEvalSummaryModePayload;
  selfImproveEnabled: boolean;
  spaceId?: string;
  spaceUid?: string;
  rootTurnId?: string;
  finalSummaryText?: string;
  artifactRefs: SchedulerEvalArtifactRefPayload[];
  checkpoints: SchedulerEvalCheckpointPayload[];
  scenarioResults: SchedulerEvalScenarioResultPayload[];
  recommendations: SchedulerEvalRecommendationPayload[];
}

export interface SchedulerEvalDomainPayload {
  domainId: string;
  description?: string;
  scenarioIds: string[];
}

export interface SchedulerEvalDefinitionPayload {
  evalDefinitionId: string;
  suiteId: string;
  description?: string;
  domainIds: string[];
  scenarioIds: string[];
  domains: SchedulerEvalDomainPayload[];
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
  executionTarget: SchedulerExecutionTargetPayload;
  calendarBinding?: SchedulerCalendarBindingPayload;
  evalConfig?: SchedulerEvalConfigPayload;
  evalSelfImproveState?: SchedulerEvalSelfImproveStatePayload;
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
  evalRun?: SchedulerEvalRunPayload;
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
  executionTarget?: SchedulerExecutionTargetPayload;
  calendarBinding?: SchedulerCalendarBindingPayload;
  evalConfig?: SchedulerEvalConfigPayload;
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

export interface SchedulerListEvalDefinitionsPayload {
  apiVersion?: string;
}

export interface SchedulerListEvalDefinitionsResponsePayload {
  definitions: SchedulerEvalDefinitionPayload[];
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
  executionTarget?: SchedulerExecutionTargetPayload;
  calendarBinding?: SchedulerCalendarBindingPayload | null;
  evalConfig?: SchedulerEvalConfigPayload | null;
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

export interface OrchestratorCommandPayload {
  apiVersion?: string;
  correlationId?: string;
  idempotencyKey?: string;
  commandType:
    | "list_spaces"
    | "create_space"
    | "list_skills"
    | "create_skill"
    | "handoff_space"
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
