export type SchedulerJobStatusPayload = "active" | "paused" | "invalid";
export type SchedulerRunStatusPayload = "running" | "completed" | "failed" | "skipped";
export type SchedulerRunTriggerPayload = "scheduled" | "manual";
export type SchedulerScheduleKindPayload = "hourly" | "daily" | "weekly";
export type SchedulerActionTypePayload = "space_prompt";

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
