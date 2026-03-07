import { randomUUID } from "node:crypto";
import { deterministicUuid, normalizeUuid } from "../utils/uuid.js";
import type { Logger } from "@spaceskit/observability";
import {
  SchedulerJobRepository,
  SchedulerJobRunRepository,
  SchedulerJobSpaceRepository,
  SpaceRepository,
  type SchedulerJobRow,
  type SchedulerJobStatus,
  type SchedulerJobRunRow,
  type SchedulerRunStatus,
  type SchedulerRunTrigger,
} from "@spaceskit/persistence";
import type { SpaceAdminService } from "@spaceskit/core";
import type {
  SchedulerActionPayload,
  SchedulerCreateJobPayload,
  SchedulerDeleteJobPayload,
  SchedulerDeleteJobResponsePayload,
  SchedulerGetJobResponsePayload,
  SchedulerJobPayload,
  SchedulerJobRunPayload,
  SchedulerLinkSpacePayload,
  SchedulerListJobsPayload,
  SchedulerListJobsResponsePayload,
  SchedulerListRunsPayload,
  SchedulerListRunsResponsePayload,
  SchedulerLinkedSpacePayload,
  SchedulerRunNowPayload,
  SchedulerRunNowResponsePayload,
  SchedulerSchedulePresetPayload,
  SchedulerUnlinkSpacePayload,
  SchedulerUpdateJobPayload,
} from "@spaceskit/server";
import type { OrchestratorCommandService } from "./orchestrator-command-service.js";
import type { SpaceSharingService } from "./space-sharing-service.js";

const RUN_RETENTION_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 200;
const FORMATTER_CACHE_MAX_SIZE = 50;
const DEFAULT_EXECUTION_TIMEOUT_MS = 300_000;

type SchedulerServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED";

export class SchedulerServiceError extends Error {
  readonly code: SchedulerServiceErrorCode;

  constructor(code: SchedulerServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SchedulerServiceOptions {
  jobs: SchedulerJobRepository;
  jobSpaces: SchedulerJobSpaceRepository;
  runs: SchedulerJobRunRepository;
  spaces: SpaceRepository;
  spaceAdminService: Pick<SpaceAdminService, "getSpace">;
  orchestratorCommandService: Pick<OrchestratorCommandService, "submitCommand">;
  spaceSharingService?: SpaceSharingService | null;
  logger?: Logger;
  now?: () => Date;
  executionTimeoutMs?: number;
}

interface CronMatcher {
  expression: string;
  minute: FieldMatcher;
  hour: FieldMatcher;
  dayOfMonth: FieldMatcher;
  month: FieldMatcher;
  dayOfWeek: FieldMatcher;
}

interface FieldMatcher {
  matches: (value: number) => boolean;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

const dayOfWeekByName: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export class SchedulerService {
  private readonly now: () => Date;
  private readonly logger: Logger | null;
  private readonly spaceSharingService: SpaceSharingService | null;
  private readonly executionTimeoutMs: number;

  constructor(private readonly options: SchedulerServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? null;
    this.spaceSharingService = options.spaceSharingService ?? null;
    this.executionTimeoutMs = options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  }

  async reconcileSchedulesOnStartup(): Promise<void> {
    const now = this.now().toISOString();
    const jobs = this.options.jobs.list({ limit: 500 });
    for (const job of jobs) {
      const primaryMissing = this.ensurePrimarySpaceState(job);
      if (primaryMissing) {
        continue;
      }
      if (job.status !== "active" || job.enabled !== 1) {
        continue;
      }
      const nextRunAt = this.computeNextRunFromRow(job, now);
      this.options.jobs.update(job.job_id, { nextRunAt });
    }
  }

  async runDueJobsTick(limit = 100): Promise<number> {
    const due = this.options.jobs.listDue(this.now().toISOString(), limit);
    if (due.length === 0) return 0;
    this.logger?.debug("Scheduler due jobs found", { count: due.length });

    let executed = 0;
    for (const job of due) {
      const primaryMissing = this.ensurePrimarySpaceState(job);
      if (primaryMissing) continue;

      const scheduledFor = job.next_run_at ?? this.now().toISOString();
      if (this.options.runs.getRunningByJob(job.job_id)) {
        await this.recordSkippedOverlap(job, "scheduled", scheduledFor);
        executed += 1;
        continue;
      }
      await this.executeScheduledRun(job, scheduledFor);
      executed += 1;
    }
    this.logger?.debug("Scheduler tick completed", { executed });
    return executed;
  }

  async createJob(
    input: SchedulerCreateJobPayload & { principalId: string },
  ): Promise<SchedulerJobPayload> {
    const principalId = normalizeNonEmpty(input.principalId, "principalId");
    const name = normalizeNonEmpty(input.name, "name");
    const primarySpaceId = normalizeNonEmpty(input.primarySpaceId, "primarySpaceId");
    const timezone = validateTimezone(input.timezone);
    const schedulePreset = validateSchedulePreset(input.schedulePreset);
    const action = validateAction(input.action);
    const relatedSpaceIds = normalizeSpaceIds(input.relatedSpaceIds ?? []);

    this.assertSpaceExists(primarySpaceId);
    for (const relatedSpaceId of relatedSpaceIds) {
      this.assertSpaceExists(relatedSpaceId);
    }
    this.assertWriteAccess([primarySpaceId, ...relatedSpaceIds], principalId);

    const cronExpression = compilePresetToCron(schedulePreset);
    const nextRunAt = computeNextRun(cronExpression, timezone, this.now().toISOString());
    const jobId = `sched-${randomUUID()}`;
    const created = this.options.jobs.create({
      jobId,
      name,
      status: "active",
      enabled: true,
      cronExpression,
      schedulePresetJson: JSON.stringify(schedulePreset),
      timezone,
      actionType: "space_prompt",
      promptText: action.promptText,
      targetAgentId: action.targetAgentId,
      primarySpaceId,
      invalidReason: "",
      nextRunAt,
      createdByPrincipalId: principalId,
    });

    for (const relatedSpaceId of relatedSpaceIds) {
      if (relatedSpaceId === primarySpaceId) continue;
      this.options.jobSpaces.upsert(created.job_id, relatedSpaceId);
    }

    return this.toSchedulerJobPayload(created);
  }

  async getJob(
    input: { jobId: string; principalId?: string },
  ): Promise<SchedulerGetJobResponsePayload["job"] | null> {
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const row = this.options.jobs.get(jobId);
    if (!row) return null;

    this.assertReadAccess(this.involvedSpaceIds(row), input.principalId);
    const primaryMissing = this.ensurePrimarySpaceState(row);
    const effective = primaryMissing ? this.options.jobs.get(jobId) ?? row : row;
    return this.toSchedulerJobPayload(effective);
  }

  async listJobs(
    input: SchedulerListJobsPayload & { principalId?: string } = {},
  ): Promise<SchedulerListJobsResponsePayload["jobs"]> {
    const statuses = normalizeStatuses(input.statuses);
    const limit = normalizeLimit(input.limit, DEFAULT_LIST_LIMIT);
    const rows = this.options.jobs.list({ statuses, limit });
    const jobs: SchedulerJobPayload[] = [];
    for (const row of rows) {
      const primaryMissing = this.ensurePrimarySpaceState(row);
      const effective = primaryMissing ? this.options.jobs.get(row.job_id) ?? row : row;
      if (!this.canReadAllSpaces(this.involvedSpaceIds(effective), input.principalId)) {
        continue;
      }
      jobs.push(await this.toSchedulerJobPayload(effective));
    }
    return jobs;
  }

  async updateJob(
    input: SchedulerUpdateJobPayload & { principalId: string },
  ): Promise<SchedulerJobPayload> {
    const principalId = normalizeNonEmpty(input.principalId, "principalId");
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const existing = this.options.jobs.get(jobId);
    if (!existing) {
      throw new SchedulerServiceError("NOT_FOUND", `Scheduler job not found: ${jobId}`);
    }

    const requestedPrimarySpaceId = input.primarySpaceId === undefined
      ? existing.primary_space_id
      : normalizeNullableSpaceId(input.primarySpaceId);
    if (requestedPrimarySpaceId) {
      this.assertSpaceExists(requestedPrimarySpaceId);
    }

    const patch: {
      name?: string;
      status?: SchedulerJobStatus;
      enabled?: boolean;
      cronExpression?: string;
      schedulePresetJson?: string;
      timezone?: string;
      promptText?: string;
      targetAgentId?: string | null;
      primarySpaceId?: string | null;
      invalidReason?: string;
      nextRunAt?: string | null;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
    } = {};

    if (input.name !== undefined) {
      patch.name = normalizeNonEmpty(input.name, "name");
    }

    let schedulePreset = parseSchedulePreset(existing.schedule_preset_json);
    if (input.schedulePreset !== undefined) {
      schedulePreset = validateSchedulePreset(input.schedulePreset);
      patch.schedulePresetJson = JSON.stringify(schedulePreset);
    }

    let timezone = existing.timezone;
    if (input.timezone !== undefined) {
      timezone = validateTimezone(input.timezone);
      patch.timezone = timezone;
    }

    if (input.schedulePreset !== undefined || input.timezone !== undefined) {
      patch.cronExpression = compilePresetToCron(schedulePreset);
      patch.nextRunAt = computeNextRun(patch.cronExpression, timezone, this.now().toISOString());
    }

    let action = parseAction(existing);
    if (input.action !== undefined) {
      action = validateAction(input.action);
      patch.promptText = action.promptText;
      patch.targetAgentId = action.targetAgentId ?? null;
    }

    if (input.status !== undefined) {
      const status = normalizeStatus(input.status);
      patch.status = status;
      patch.enabled = status === "active";
      if (status !== "active") {
        patch.nextRunAt = null;
      } else {
        patch.invalidReason = "";
        patch.nextRunAt = computeNextRun(
          patch.cronExpression ?? existing.cron_expression,
          patch.timezone ?? existing.timezone,
          this.now().toISOString(),
        );
      }
    }

    if (input.primarySpaceId !== undefined) {
      patch.primarySpaceId = requestedPrimarySpaceId ?? null;
    }

    const nextRelatedSpaceIds = input.relatedSpaceIds !== undefined
      ? normalizeSpaceIds(input.relatedSpaceIds)
      : this.options.jobSpaces.listByJob(jobId).map((entry) => entry.space_id);
    for (const relatedSpaceId of nextRelatedSpaceIds) {
      this.assertSpaceExists(relatedSpaceId);
    }

    const accessSpaceIds = Array.from(new Set([
      ...this.involvedSpaceIds(existing),
      ...(requestedPrimarySpaceId ? [requestedPrimarySpaceId] : []),
      ...nextRelatedSpaceIds,
    ]));
    this.assertWriteAccess(accessSpaceIds, principalId);

    if (!requestedPrimarySpaceId) {
      patch.status = "invalid";
      patch.enabled = false;
      patch.invalidReason = "primary_space_missing";
      patch.nextRunAt = null;
      patch.lastErrorCode = "PRIMARY_SPACE_MISSING";
      patch.lastErrorMessage = "Primary execution space is missing.";
    }

    const updated = this.options.jobs.update(jobId, patch);
    if (!updated) {
      throw new SchedulerServiceError("NOT_FOUND", `Scheduler job not found: ${jobId}`);
    }

    if (input.relatedSpaceIds !== undefined) {
      const normalizedRelated = nextRelatedSpaceIds.filter((spaceId) => spaceId !== requestedPrimarySpaceId);
      this.options.jobSpaces.replaceForJob(jobId, normalizedRelated);
    }

    const primaryMissing = this.ensurePrimarySpaceState(updated);
    const effective = primaryMissing ? this.options.jobs.get(jobId) ?? updated : updated;
    return this.toSchedulerJobPayload(effective);
  }

  async deleteJob(
    input: SchedulerDeleteJobPayload & { principalId: string },
  ): Promise<SchedulerDeleteJobResponsePayload> {
    const principalId = normalizeNonEmpty(input.principalId, "principalId");
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const existing = this.options.jobs.get(jobId);
    if (!existing) {
      return { jobId, deleted: false };
    }

    this.assertWriteAccess(this.involvedSpaceIds(existing), principalId);
    const deleted = this.options.jobs.delete(jobId);
    return { jobId, deleted };
  }

  async linkSpace(
    input: SchedulerLinkSpacePayload & { principalId: string },
  ): Promise<SchedulerJobPayload> {
    const principalId = normalizeNonEmpty(input.principalId, "principalId");
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const spaceId = normalizeNonEmpty(input.spaceId, "spaceId");
    const job = this.options.jobs.get(jobId);
    if (!job) {
      throw new SchedulerServiceError("NOT_FOUND", `Scheduler job not found: ${jobId}`);
    }
    this.assertSpaceExists(spaceId);
    this.assertWriteAccess(Array.from(new Set([...this.involvedSpaceIds(job), spaceId])), principalId);

    if (spaceId !== job.primary_space_id) {
      this.options.jobSpaces.upsert(jobId, spaceId);
    }

    return this.toSchedulerJobPayload(this.options.jobs.get(jobId) ?? job);
  }

  async unlinkSpace(
    input: SchedulerUnlinkSpacePayload & { principalId: string },
  ): Promise<SchedulerJobPayload> {
    const principalId = normalizeNonEmpty(input.principalId, "principalId");
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const spaceId = normalizeNonEmpty(input.spaceId, "spaceId");
    const job = this.options.jobs.get(jobId);
    if (!job) {
      throw new SchedulerServiceError("NOT_FOUND", `Scheduler job not found: ${jobId}`);
    }

    if (job.primary_space_id === spaceId) {
      throw new SchedulerServiceError(
        "FAILED_PRECONDITION",
        "Cannot unlink the primary space from a scheduler job. Reassign primary first.",
      );
    }

    this.assertWriteAccess(Array.from(new Set([...this.involvedSpaceIds(job), spaceId])), principalId);
    this.options.jobSpaces.delete(jobId, spaceId);
    return this.toSchedulerJobPayload(this.options.jobs.get(jobId) ?? job);
  }

  async listRuns(
    input: SchedulerListRunsPayload & { principalId?: string },
  ): Promise<SchedulerListRunsResponsePayload> {
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const job = this.options.jobs.get(jobId);
    if (!job) {
      throw new SchedulerServiceError("NOT_FOUND", `Scheduler job not found: ${jobId}`);
    }
    this.assertReadAccess(this.involvedSpaceIds(job), input.principalId);

    const limit = normalizeLimit(input.limit, 50);
    const offset = normalizeOffset(input.offset);
    const rows = this.options.runs.listByJob(jobId, limit, offset);
    const total = this.options.runs.countByJob(jobId);
    const nextOffset = offset + rows.length;

    return {
      runs: rows.map(toRunPayload),
      total,
      nextOffset: nextOffset < total ? nextOffset : undefined,
    };
  }

  async runNow(
    input: SchedulerRunNowPayload & { principalId: string },
  ): Promise<SchedulerRunNowResponsePayload> {
    const principalId = normalizeNonEmpty(input.principalId, "principalId");
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const row = this.options.jobs.get(jobId);
    if (!row) {
      throw new SchedulerServiceError("NOT_FOUND", `Scheduler job not found: ${jobId}`);
    }

    this.assertWriteAccess(this.involvedSpaceIds(row), principalId);
    const primaryMissing = this.ensurePrimarySpaceState(row);
    const effective = primaryMissing ? this.options.jobs.get(jobId) ?? row : row;
    const run = await this.executeManualRun(effective);
    const refreshed = this.options.jobs.get(jobId) ?? effective;
    return {
      run,
      job: await this.toSchedulerJobPayload(refreshed),
    };
  }

  private async executeScheduledRun(job: SchedulerJobRow, scheduledFor: string): Promise<void> {
    const nowIso = this.now().toISOString();
    const nextRunAt = this.computeNextRunFromRow(job, scheduledFor);
    this.options.jobs.update(job.job_id, { nextRunAt });

    const runId = `run-${randomUUID()}`;
    const run = this.options.runs.tryClaimRunning({
      runId,
      jobId: job.job_id,
      trigger: "scheduled",
      status: "running",
      scheduledFor,
      startedAt: nowIso,
    });

    if (!run) {
      await this.recordSkippedOverlap(job, "scheduled", scheduledFor);
      return;
    }

    try {
      const result = await this.executeRunCommand(job, run);
      this.finalizeRun(job.job_id, run.run_id, result);
    } catch (error) {
      const normalized = normalizeError(error);
      this.finalizeRun(job.job_id, run.run_id, {
        status: "failed",
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });
    }
  }

  private async executeManualRun(job: SchedulerJobRow): Promise<SchedulerJobRunPayload> {
    const primarySpaceMissing = this.ensurePrimarySpaceState(job);
    const effective = primarySpaceMissing ? this.options.jobs.get(job.job_id) ?? job : job;

    if (effective.status === "invalid") {
      throw new SchedulerServiceError(
        "FAILED_PRECONDITION",
        "Scheduler job is invalid. Reassign a valid primary space before running.",
      );
    }

    if (this.options.runs.getRunningByJob(effective.job_id)) {
      const skippedRun = this.options.runs.create({
        runId: `run-${randomUUID()}`,
        jobId: effective.job_id,
        trigger: "manual",
        status: "skipped",
        startedAt: this.now().toISOString(),
        finishedAt: this.now().toISOString(),
        skipReason: "overlap_disallowed",
        errorCode: "",
        errorMessage: "",
      });

      this.options.jobs.update(effective.job_id, {
        lastRunAt: skippedRun.finished_at ?? skippedRun.created_at,
        lastRunStatus: "skipped",
        lastErrorCode: "",
        lastErrorMessage: "",
      });
      this.options.runs.pruneToLatest(effective.job_id, RUN_RETENTION_LIMIT);
      return toRunPayload(skippedRun);
    }

    const run = this.options.runs.tryClaimRunning({
      runId: `run-${randomUUID()}`,
      jobId: effective.job_id,
      trigger: "manual",
      status: "running",
      startedAt: this.now().toISOString(),
    });

    if (!run) {
      const skippedRun = this.options.runs.create({
        runId: `run-${randomUUID()}`,
        jobId: effective.job_id,
        trigger: "manual",
        status: "skipped",
        startedAt: this.now().toISOString(),
        finishedAt: this.now().toISOString(),
        skipReason: "overlap_disallowed",
        errorCode: "",
        errorMessage: "",
      });
      this.options.jobs.update(effective.job_id, {
        lastRunAt: skippedRun.finished_at ?? skippedRun.created_at,
        lastRunStatus: "skipped",
        lastErrorCode: "",
        lastErrorMessage: "",
      });
      this.options.runs.pruneToLatest(effective.job_id, RUN_RETENTION_LIMIT);
      return toRunPayload(skippedRun);
    }

    try {
      const result = await this.executeRunCommand(effective, run);
      const finalized = this.finalizeRun(effective.job_id, run.run_id, result);
      return toRunPayload(finalized);
    } catch (error) {
      const normalized = normalizeError(error);
      const finalized = this.finalizeRun(effective.job_id, run.run_id, {
        status: "failed",
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });
      return toRunPayload(finalized);
    }
  }

  private async recordSkippedOverlap(
    job: SchedulerJobRow,
    trigger: SchedulerRunTrigger,
    scheduledFor: string,
  ): Promise<void> {
    const nowIso = this.now().toISOString();
    const run = this.options.runs.create({
      runId: `run-${randomUUID()}`,
      jobId: job.job_id,
      trigger,
      status: "skipped",
      scheduledFor,
      startedAt: nowIso,
      finishedAt: nowIso,
      skipReason: "overlap_disallowed",
    });

    const nextRunAt = this.computeNextRunFromRow(job, scheduledFor);
    this.options.jobs.update(job.job_id, {
      nextRunAt,
      lastRunAt: run.finished_at ?? nowIso,
      lastRunStatus: "skipped",
      lastErrorCode: "",
      lastErrorMessage: "",
    });
    this.options.runs.pruneToLatest(job.job_id, RUN_RETENTION_LIMIT);
  }

  private async executeRunCommand(
    job: SchedulerJobRow,
    run: SchedulerJobRunRow,
  ): Promise<{
    status: Exclude<SchedulerRunStatus, "running">;
    commandId?: string;
    errorCode?: string;
    errorMessage?: string;
    result?: Record<string, unknown>;
  }> {
    if (!job.primary_space_id) {
      return {
        status: "failed",
        errorCode: "PRIMARY_SPACE_MISSING",
        errorMessage: "Primary execution space is missing.",
      };
    }

    const action = parseAction(job);
    try {
      const commandPromise = this.options.orchestratorCommandService.submitCommand({
        commandType: "run_space_prompt",
        targetSpaceId: job.primary_space_id,
        targetAgentId: action.targetAgentId,
        principalId: job.created_by_principal_id,
        correlationId: `scheduler:${job.job_id}:${run.run_id}`,
        idempotencyKey: `scheduler:${job.job_id}:${run.run_id}`,
        payload: {
          promptText: action.promptText,
          targetAgentId: action.targetAgentId,
          metadata: {
            source: "scheduler",
            jobId: job.job_id,
            runId: run.run_id,
            trigger: run.trigger,
          },
        },
      });

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new SchedulerServiceError(
            "FAILED_PRECONDITION",
            `Scheduler job execution timed out after ${this.executionTimeoutMs}ms`,
          ));
        }, this.executionTimeoutMs);
      });

      const command = await Promise.race([commandPromise, timeoutPromise]);

      if (command.status === "failed") {
        return {
          status: "failed",
          commandId: command.commandId,
          errorCode: command.error?.code ?? "ORCHESTRATOR_FAILED",
          errorMessage: command.error?.message ?? "Orchestrator command failed.",
          result: command.result,
        };
      }

      return {
        status: "completed",
        commandId: command.commandId,
        result: command.result,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      this.logger?.warn("Scheduler job execution failed", {
        jobId: job.job_id,
        runId: run.run_id,
        code: normalized.code,
        message: normalized.message,
      });
      return {
        status: "failed",
        errorCode: normalized.code,
        errorMessage: normalized.message,
      };
    }
  }

  private finalizeRun(
    jobId: string,
    runId: string,
    result: {
      status: Exclude<SchedulerRunStatus, "running">;
      commandId?: string;
      errorCode?: string;
      errorMessage?: string;
      result?: Record<string, unknown>;
    },
  ): SchedulerJobRunRow {
    const finishedAt = this.now().toISOString();
    const run = this.options.runs.update(runId, {
      status: result.status,
      commandId: result.commandId,
      finishedAt,
      errorCode: result.errorCode ?? "",
      errorMessage: result.errorMessage ?? "",
      resultJson: result.result ? JSON.stringify(result.result) : null,
    });

    const finalRun = run ?? this.options.runs.get(runId);
    if (!finalRun) {
      throw new SchedulerServiceError("FAILED_PRECONDITION", `Scheduler run not found: ${runId}`);
    }

    this.options.jobs.update(jobId, {
      lastRunAt: finalRun.finished_at ?? finishedAt,
      lastRunStatus: result.status,
      lastErrorCode: result.errorCode ?? "",
      lastErrorMessage: result.errorMessage ?? "",
    });
    this.options.runs.pruneToLatest(jobId, RUN_RETENTION_LIMIT);
    return finalRun;
  }

  private ensurePrimarySpaceState(job: SchedulerJobRow): boolean {
    const primarySpaceId = job.primary_space_id?.trim() || "";
    if (!primarySpaceId) {
      this.options.jobs.update(job.job_id, {
        status: "invalid",
        enabled: false,
        invalidReason: "primary_space_missing",
        nextRunAt: null,
        lastErrorCode: "PRIMARY_SPACE_MISSING",
        lastErrorMessage: "Primary execution space is missing.",
      });
      return true;
    }

    if (!this.options.spaces.getById(primarySpaceId)) {
      this.options.jobs.update(job.job_id, {
        primarySpaceId: null,
        status: "invalid",
        enabled: false,
        invalidReason: "primary_space_missing",
        nextRunAt: null,
        lastErrorCode: "PRIMARY_SPACE_MISSING",
        lastErrorMessage: "Primary execution space was deleted.",
      });
      return true;
    }

    return false;
  }

  private computeNextRunFromRow(job: SchedulerJobRow, referenceIso: string): string | null {
    return computeNextRun(job.cron_expression, job.timezone, referenceIso);
  }

  private assertSpaceExists(spaceId: string): void {
    const row = this.options.spaces.getById(spaceId);
    if (!row) {
      throw new SchedulerServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }

  private involvedSpaceIds(job: SchedulerJobRow): string[] {
    const linked = this.options.jobSpaces.listByJob(job.job_id).map((entry) => entry.space_id);
    const all = [
      ...(job.primary_space_id ? [job.primary_space_id] : []),
      ...linked,
    ];
    return normalizeSpaceIds(all);
  }

  private canReadAllSpaces(spaceIds: string[], principalId?: string): boolean {
    if (!this.spaceSharingService) return true;
    for (const spaceId of spaceIds) {
      const decision = this.spaceSharingService.evaluateAccess({
        spaceId,
        principalId,
        action: "read",
      });
      if (!decision.allowed) {
        return false;
      }
    }
    return true;
  }

  private assertReadAccess(spaceIds: string[], principalId?: string): void {
    if (!this.spaceSharingService) return;
    for (const spaceId of spaceIds) {
      const decision = this.spaceSharingService.evaluateAccess({
        spaceId,
        principalId,
        action: "read",
      });
      if (!decision.allowed) {
        throw new SchedulerServiceError(
          "PERMISSION_DENIED",
          decision.reason ?? "Access denied for scheduler job",
        );
      }
    }
  }

  private assertWriteAccess(spaceIds: string[], principalId?: string): void {
    if (!this.spaceSharingService) return;
    for (const spaceId of spaceIds) {
      const decision = this.spaceSharingService.evaluateAccess({
        spaceId,
        principalId,
        action: "write",
      });
      if (!decision.allowed) {
        throw new SchedulerServiceError(
          "PERMISSION_DENIED",
          decision.reason ?? "Write access denied for scheduler job",
        );
      }
    }
  }

  private async toSchedulerJobPayload(row: SchedulerJobRow): Promise<SchedulerJobPayload> {
    const linkedSpaceRows = this.options.jobSpaces.listByJob(row.job_id);
    const linkedIds = normalizeSpaceIds([
      ...(row.primary_space_id ? [row.primary_space_id] : []),
      ...linkedSpaceRows.map((entry) => entry.space_id),
    ]);

    const linkedSpaces: SchedulerLinkedSpacePayload[] = [];
    const linkedAtBySpaceId = new Map(linkedSpaceRows.map((entry) => [entry.space_id, entry.linked_at]));
    for (const spaceId of linkedIds) {
      const space = await this.options.spaceAdminService.getSpace(spaceId).catch(() => null);
      const fallbackUid = deterministicUuid(spaceId, "spaceskit.space.uuid");
      linkedSpaces.push({
        spaceId,
        spaceUid: normalizeUuid(space?.spaceUid) ?? fallbackUid,
        name: normalizeOptionalString(space?.name) ?? spaceId,
        isPrimary: row.primary_space_id === spaceId,
        linkedAt: row.primary_space_id === spaceId
          ? row.created_at
          : linkedAtBySpaceId.get(spaceId) ?? row.updated_at,
      });
    }

    const schedulePreset = parseSchedulePreset(row.schedule_preset_json);
    const action = parseAction(row);
    return {
      jobId: row.job_id,
      name: row.name,
      status: row.status,
      enabled: row.enabled === 1,
      cronExpression: row.cron_expression,
      schedulePreset,
      timezone: row.timezone,
      action,
      primarySpaceId: row.primary_space_id ?? undefined,
      invalidReason: normalizeOptionalString(row.invalid_reason),
      nextRunAt: row.next_run_at ?? undefined,
      lastRunAt: row.last_run_at ?? undefined,
      lastRunStatus: normalizeRunStatus(row.last_run_status),
      lastErrorCode: normalizeOptionalString(row.last_error_code),
      lastErrorMessage: normalizeOptionalString(row.last_error_message),
      createdByPrincipalId: row.created_by_principal_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      linkedSpaces,
    };
  }
}

function normalizeNonEmpty(value: string | undefined | null, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNullableSpaceId(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSpaceIds(spaceIds: string[]): string[] {
  return Array.from(
    new Set(
      spaceIds
        .map((spaceId) => spaceId.trim())
        .filter((spaceId) => spaceId.length > 0),
    ),
  );
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.floor(limit), 1), 500);
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

function normalizeStatuses(statuses: SchedulerListJobsPayload["statuses"]): SchedulerJobStatus[] | undefined {
  if (!Array.isArray(statuses) || statuses.length === 0) return undefined;
  const normalized = statuses
    .map((status) => normalizeStatus(status))
    .filter(Boolean) as SchedulerJobStatus[];
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function normalizeStatus(status: unknown): SchedulerJobStatus {
  if (status === "active" || status === "paused" || status === "invalid") return status;
  throw new SchedulerServiceError("INVALID_ARGUMENT", `Unsupported scheduler status: ${String(status)}`);
}

function normalizeRunStatus(status: unknown): SchedulerJobRunPayload["status"] | undefined {
  if (status === "running" || status === "completed" || status === "failed" || status === "skipped") {
    return status;
  }
  return undefined;
}

function validateTimezone(timezone: string | undefined): string {
  const normalized = normalizeNonEmpty(timezone, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid timezone: ${normalized}`);
  }
}

function validateSchedulePreset(
  preset: SchedulerSchedulePresetPayload | undefined,
): SchedulerSchedulePresetPayload {
  if (!preset) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", "schedulePreset is required");
  }

  const minute = parseInteger(preset.minute, "schedulePreset.minute", 0, 59);
  switch (preset.kind) {
    case "hourly": {
      const intervalHours = parseInteger(
        preset.intervalHours ?? 1,
        "schedulePreset.intervalHours",
        1,
        23,
      );
      return {
        kind: "hourly",
        minute,
        intervalHours,
      };
    }

    case "daily": {
      const hour = parseInteger(preset.hour, "schedulePreset.hour", 0, 23);
      return {
        kind: "daily",
        minute,
        hour,
      };
    }

    case "weekly": {
      const hour = parseInteger(preset.hour, "schedulePreset.hour", 0, 23);
      const days = Array.isArray(preset.daysOfWeek)
        ? Array.from(
          new Set(
            preset.daysOfWeek.map((value) => parseInteger(value, "schedulePreset.daysOfWeek", 0, 6)),
          ),
        ).sort((a, b) => a - b)
        : [];
      if (days.length === 0) {
        throw new SchedulerServiceError("INVALID_ARGUMENT", "schedulePreset.daysOfWeek is required for weekly jobs");
      }
      return {
        kind: "weekly",
        minute,
        hour,
        daysOfWeek: days,
      };
    }

    default:
      throw new SchedulerServiceError(
        "INVALID_ARGUMENT",
        `Unsupported scheduler preset kind: ${String((preset as { kind?: unknown }).kind)}`,
      );
  }
}

function validateAction(action: SchedulerActionPayload | undefined): SchedulerActionPayload {
  if (!action || action.type !== "space_prompt") {
    throw new SchedulerServiceError("INVALID_ARGUMENT", "Only action.type=space_prompt is supported");
  }
  const promptText = normalizeNonEmpty(action.promptText, "action.promptText");
  const targetAgentId = normalizeOptionalString(action.targetAgentId);
  return {
    type: "space_prompt",
    promptText,
    targetAgentId,
  };
}

function compilePresetToCron(preset: SchedulerSchedulePresetPayload): string {
  switch (preset.kind) {
    case "hourly": {
      const minute = parseInteger(preset.minute, "schedulePreset.minute", 0, 59);
      const intervalHours = parseInteger(preset.intervalHours ?? 1, "schedulePreset.intervalHours", 1, 23);
      const hour = intervalHours === 1 ? "*" : `*/${intervalHours}`;
      return `${minute} ${hour} * * *`;
    }
    case "daily": {
      const minute = parseInteger(preset.minute, "schedulePreset.minute", 0, 59);
      const hour = parseInteger(preset.hour, "schedulePreset.hour", 0, 23);
      return `${minute} ${hour} * * *`;
    }
    case "weekly": {
      const minute = parseInteger(preset.minute, "schedulePreset.minute", 0, 59);
      const hour = parseInteger(preset.hour, "schedulePreset.hour", 0, 23);
      const days = (preset.daysOfWeek ?? [])
        .map((value) => parseInteger(value, "schedulePreset.daysOfWeek", 0, 6))
        .sort((a, b) => a - b);
      if (days.length === 0) {
        throw new SchedulerServiceError("INVALID_ARGUMENT", "schedulePreset.daysOfWeek is required for weekly jobs");
      }
      return `${minute} ${hour} * * ${Array.from(new Set(days)).join(",")}`;
    }
  }
}

function parseSchedulePreset(raw: string): SchedulerSchedulePresetPayload {
  try {
    const parsed = JSON.parse(raw) as SchedulerSchedulePresetPayload;
    return validateSchedulePreset(parsed);
  } catch {
    throw new SchedulerServiceError("FAILED_PRECONDITION", "Scheduler job has invalid schedule preset JSON");
  }
}

function parseAction(row: SchedulerJobRow): SchedulerActionPayload {
  return validateAction({
    type: "space_prompt",
    promptText: row.prompt_text,
    targetAgentId: normalizeOptionalString(row.target_agent_id),
  });
}

function parseInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new SchedulerServiceError(
      "INVALID_ARGUMENT",
      `${field} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

function toRunPayload(row: SchedulerJobRunRow): SchedulerJobRunPayload {
  return {
    runId: row.run_id,
    jobId: row.job_id,
    trigger: row.trigger,
    status: row.status,
    commandId: normalizeOptionalString(row.command_id),
    scheduledFor: row.scheduled_for ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    skipReason: normalizeOptionalString(row.skip_reason),
    errorCode: normalizeOptionalString(row.error_code),
    errorMessage: normalizeOptionalString(row.error_message),
    result: parseResultJson(row.result_json),
  };
}

function parseResultJson(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed result payloads
  }
  return undefined;
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof SchedulerServiceError) {
    return { code: error.code, message: error.message };
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return {
        code: candidate.code,
        message: candidate.message,
      };
    }
  }
  if (error instanceof Error) {
    return { code: "INTERNAL", message: error.message };
  }
  return { code: "INTERNAL", message: "Unknown scheduler error" };
}

function computeNextRun(cronExpression: string, timezone: string, referenceIso: string): string | null {
  const matcher = parseCronExpression(cronExpression);
  const reference = new Date(referenceIso);
  if (Number.isNaN(reference.getTime())) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid reference time: ${referenceIso}`);
  }

  const cursor = new Date(reference.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  // 2-year ceiling to avoid unbounded loops for malformed expressions.
  const maxIterations = 2 * 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i += 1) {
    const parts = getZonedParts(cursor, timezone);
    if (
      matcher.minute.matches(parts.minute)
      && matcher.hour.matches(parts.hour)
      && matcher.dayOfMonth.matches(parts.day)
      && matcher.month.matches(parts.month)
      && matcher.dayOfWeek.matches(parts.dayOfWeek)
    ) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return null;
}

function parseCronExpression(expression: string): CronMatcher {
  const normalized = expression.trim();
  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron expression: ${expression}`);
  }

  return {
    expression: normalized,
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dayOfMonth: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    dayOfWeek: parseField(fields[4], 0, 6),
  };
}

function parseField(token: string, min: number, max: number): FieldMatcher {
  const trimmed = token.trim();
  if (trimmed === "*") {
    return { matches: () => true };
  }

  if (trimmed.startsWith("*/")) {
    const rawStep = Number.parseInt(trimmed.slice(2), 10);
    if (!Number.isInteger(rawStep) || rawStep <= 0) {
      throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron step value: ${token}`);
    }
    return {
      matches: (value) => (value - min) % rawStep === 0,
    };
  }

  const allowedValues = new Set<number>();
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    if (piece.includes("-")) {
      const [startRaw, endRaw] = piece.split("-", 2);
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
        throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron range value: ${piece}`);
      }
      for (let value = start; value <= end; value += 1) {
        assertRange(value, min, max, piece);
        allowedValues.add(value);
      }
      continue;
    }

    const value = Number.parseInt(piece, 10);
    if (!Number.isInteger(value)) {
      throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron field value: ${piece}`);
    }
    assertRange(value, min, max, piece);
    allowedValues.add(value);
  }

  if (allowedValues.size === 0) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron field: ${token}`);
  }

  return {
    matches: (value) => allowedValues.has(value),
  };
}

function assertRange(value: number, min: number, max: number, token: string): void {
  if (value < min || value > max) {
    throw new SchedulerServiceError(
      "INVALID_ARGUMENT",
      `Cron value out of range (${min}-${max}): ${token}`,
    );
  }
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = getFormatter(timezone);
  const parts = formatter.formatToParts(date);

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let weekdayShort = "";

  for (const part of parts) {
    switch (part.type) {
      case "year":
        year = Number.parseInt(part.value, 10);
        if (Number.isNaN(year)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse year "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "month":
        month = Number.parseInt(part.value, 10);
        if (Number.isNaN(month)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse month "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "day":
        day = Number.parseInt(part.value, 10);
        if (Number.isNaN(day)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse day "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "hour":
        hour = Number.parseInt(part.value, 10);
        if (Number.isNaN(hour)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse hour "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "minute":
        minute = Number.parseInt(part.value, 10);
        if (Number.isNaN(minute)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse minute "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "weekday":
        weekdayShort = part.value.slice(0, 3).toLowerCase();
        break;
      default:
        break;
    }
  }

  const dayOfWeek = dayOfWeekByName[weekdayShort];
  if (dayOfWeek === undefined) {
    throw new SchedulerServiceError(
      "FAILED_PRECONDITION",
      `Failed to resolve weekday "${weekdayShort}" for timezone ${timezone}. Intl.DateTimeFormat returned an unrecognized weekday name.`,
    );
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek,
  };
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  if (formatterCache.size >= FORMATTER_CACHE_MAX_SIZE) {
    const oldest = formatterCache.keys().next().value;
    if (oldest !== undefined) {
      formatterCache.delete(oldest);
    }
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}
