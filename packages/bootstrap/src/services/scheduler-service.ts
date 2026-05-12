import { randomUUID } from "node:crypto";
import type { Logger } from "@spaceskit/observability";
import {
  type SchedulerJobRow,
  type SchedulerJobStatus,
} from "@spaceskit/persistence";
import type {
  SchedulerCreateJobPayload,
  SchedulerDeleteJobPayload,
  SchedulerDeleteJobResponsePayload,
  SchedulerEvalDefinitionPayload,
  SchedulerGetJobResponsePayload,
  SchedulerJobPayload,
  SchedulerLinkSpacePayload,
  SchedulerListEvalDefinitionsResponsePayload,
  SchedulerListJobsPayload,
  SchedulerListJobsResponsePayload,
  SchedulerListRunsPayload,
  SchedulerListRunsResponsePayload,
  SchedulerRunNowPayload,
  SchedulerRunNowResponsePayload,
  SchedulerUnlinkSpacePayload,
  SchedulerUpdateJobPayload,
} from "@spaceskit/server";
import {
  assertSchedulerReadAccess,
  assertSchedulerWriteAccess,
  canReadAllSchedulerSpaces,
} from "./scheduler-access.js";
import { computeNextRun } from "./scheduler-cron.js";
import {
  buildEvalSelfImproveState,
  mergeEvalSelfImproveState,
} from "./scheduler-eval-results.js";
import { SchedulerServiceError } from "./scheduler-errors.js";
import { SchedulerEvalCatalogService } from "./scheduler-eval-catalog-service.js";
import { computeNextRunFromJob, ensurePrimarySpaceState } from "./scheduler-job-state.js";
import { SchedulerJobPresenter } from "./scheduler-job-presenter.js";
import {
  normalizeLimit,
  normalizeNullableSpaceId,
  normalizeNonEmpty,
  normalizeOffset,
  normalizeSpaceIds,
  normalizeStatus,
  normalizeStatuses,
} from "./scheduler-normalizers.js";
import {
  compilePresetToCron,
  parseAction,
  parseEvalConfig,
  parseEvalSelfImproveState,
  parseSchedulePreset,
  toRunPayload,
  validateAction,
  validateCalendarBinding,
  validateEvalConfig,
  validateExecutionTarget,
  validateSchedulePreset,
  validateTimezone,
} from "./scheduler-payloads.js";
import { SchedulerRunExecutor } from "./scheduler-run-executor.js";
import type { SchedulerServiceOptions } from "./scheduler-service-options.js";
import type { SpaceSharingService } from "./space-sharing-service.js";
export { SchedulerServiceError } from "./scheduler-errors.js";
export type { SchedulerServiceOptions } from "./scheduler-service-options.js";

const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_EXECUTION_TIMEOUT_MS = 300_000;

export class SchedulerService {
  private readonly now: () => Date;
  private readonly logger: Logger | null;
  private readonly spaceSharingService: SpaceSharingService | null;
  private readonly evalCatalogService: Pick<SchedulerEvalCatalogService, "getDefinition" | "listDefinitions">;
  private readonly runExecutor: SchedulerRunExecutor;
  private readonly jobPresenter: SchedulerJobPresenter;

  constructor(private readonly options: SchedulerServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? null;
    this.spaceSharingService = options.spaceSharingService ?? null;
    this.evalCatalogService = options.evalCatalogService ?? new SchedulerEvalCatalogService();
    this.jobPresenter = new SchedulerJobPresenter({
      jobSpaces: options.jobSpaces,
      spaceAdminService: options.spaceAdminService,
    });
    this.runExecutor = new SchedulerRunExecutor({
      jobs: options.jobs,
      runs: options.runs,
      spaces: options.spaces,
      eventBus: options.eventBus ?? null,
      orchestrationJournal: options.orchestrationJournal ?? null,
      spaceAdminService: options.spaceAdminService,
      spaceTemplateService: options.spaceTemplateService ?? null,
      orchestratorCommandService: options.orchestratorCommandService,
      logger: this.logger,
      now: this.now,
      executionTimeoutMs: options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
    });
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
        await this.runExecutor.recordSkippedOverlap(job, "scheduled", scheduledFor);
        executed += 1;
        continue;
      }
      await this.runExecutor.executeScheduledRun(job, scheduledFor);
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
    const executionTarget = validateExecutionTarget(input.executionTarget);
    const calendarBinding = validateCalendarBinding(input.calendarBinding);
    const evalConfig = await validateEvalConfig(input.evalConfig, this.evalCatalogService);
    const evalSelfImproveState = buildEvalSelfImproveState(evalConfig);

    this.assertSpaceExists(primarySpaceId);
    for (const relatedSpaceId of relatedSpaceIds) {
      this.assertSpaceExists(relatedSpaceId);
    }
    assertSchedulerWriteAccess(this.spaceSharingService, [primarySpaceId, ...relatedSpaceIds], principalId);

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
      executionTargetJson: JSON.stringify(executionTarget),
      calendarBindingJson: calendarBinding ? JSON.stringify(calendarBinding) : null,
      evalConfigJson: evalConfig ? JSON.stringify(evalConfig) : null,
      evalSelfImproveStateJson: evalSelfImproveState ? JSON.stringify(evalSelfImproveState) : null,
      primarySpaceId,
      invalidReason: "",
      nextRunAt,
      createdByPrincipalId: principalId,
    });

    for (const relatedSpaceId of relatedSpaceIds) {
      if (relatedSpaceId === primarySpaceId) continue;
      this.options.jobSpaces.upsert(created.job_id, relatedSpaceId);
    }

    return this.jobPresenter.toSchedulerJobPayload(created);
  }

  async getJob(
    input: { jobId: string; principalId?: string },
  ): Promise<SchedulerGetJobResponsePayload["job"] | null> {
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const row = this.options.jobs.get(jobId);
    if (!row) return null;

    assertSchedulerReadAccess(this.spaceSharingService, this.jobPresenter.involvedSpaceIds(row), input.principalId);
    const primaryMissing = this.ensurePrimarySpaceState(row);
    const effective = primaryMissing ? this.options.jobs.get(jobId) ?? row : row;
    return this.jobPresenter.toSchedulerJobPayload(effective);
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
      if (!canReadAllSchedulerSpaces(this.spaceSharingService, this.jobPresenter.involvedSpaceIds(effective), input.principalId)) {
        continue;
      }
      jobs.push(await this.jobPresenter.toSchedulerJobPayload(effective));
    }
    return jobs;
  }

  async listEvalDefinitions(): Promise<SchedulerListEvalDefinitionsResponsePayload["definitions"]> {
    return this.evalCatalogService.listDefinitions() as Promise<SchedulerEvalDefinitionPayload[]>;
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
      executionTargetJson?: string;
      calendarBindingJson?: string | null;
      evalConfigJson?: string | null;
      evalSelfImproveStateJson?: string | null;
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

    if (input.executionTarget !== undefined) {
      patch.executionTargetJson = JSON.stringify(validateExecutionTarget(input.executionTarget));
    }

    if (input.calendarBinding !== undefined) {
      const calendarBinding = validateCalendarBinding(input.calendarBinding);
      patch.calendarBindingJson = calendarBinding ? JSON.stringify(calendarBinding) : null;
    }

    if (input.evalConfig !== undefined) {
      const evalConfig = await validateEvalConfig(input.evalConfig, this.evalCatalogService);
      patch.evalConfigJson = evalConfig ? JSON.stringify(evalConfig) : null;
      const nextSelfImproveState = mergeEvalSelfImproveState(
        parseEvalSelfImproveState(existing.eval_self_improve_state_json, parseEvalConfig(existing.eval_config_json)),
        evalConfig,
      );
      patch.evalSelfImproveStateJson = nextSelfImproveState
        ? JSON.stringify(nextSelfImproveState)
        : null;
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
      ...this.jobPresenter.involvedSpaceIds(existing),
      ...(requestedPrimarySpaceId ? [requestedPrimarySpaceId] : []),
      ...nextRelatedSpaceIds,
    ]));
    assertSchedulerWriteAccess(this.spaceSharingService, accessSpaceIds, principalId);

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
    return this.jobPresenter.toSchedulerJobPayload(effective);
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

    assertSchedulerWriteAccess(this.spaceSharingService, this.jobPresenter.involvedSpaceIds(existing), principalId);
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
    assertSchedulerWriteAccess(this.spaceSharingService, Array.from(new Set([...this.jobPresenter.involvedSpaceIds(job), spaceId])), principalId);

    if (spaceId !== job.primary_space_id) {
      this.options.jobSpaces.upsert(jobId, spaceId);
    }

    return this.jobPresenter.toSchedulerJobPayload(this.options.jobs.get(jobId) ?? job);
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

    assertSchedulerWriteAccess(this.spaceSharingService, Array.from(new Set([...this.jobPresenter.involvedSpaceIds(job), spaceId])), principalId);
    this.options.jobSpaces.delete(jobId, spaceId);
    return this.jobPresenter.toSchedulerJobPayload(this.options.jobs.get(jobId) ?? job);
  }

  async listRuns(
    input: SchedulerListRunsPayload & { principalId?: string },
  ): Promise<SchedulerListRunsResponsePayload> {
    const jobId = normalizeNonEmpty(input.jobId, "jobId");
    const job = this.options.jobs.get(jobId);
    if (!job) {
      throw new SchedulerServiceError("NOT_FOUND", `Scheduler job not found: ${jobId}`);
    }
    assertSchedulerReadAccess(this.spaceSharingService, this.jobPresenter.involvedSpaceIds(job), input.principalId);

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

    assertSchedulerWriteAccess(this.spaceSharingService, this.jobPresenter.involvedSpaceIds(row), principalId);
    const primaryMissing = this.ensurePrimarySpaceState(row);
    const effective = primaryMissing ? this.options.jobs.get(jobId) ?? row : row;
    const run = await this.runExecutor.executeManualRun(effective);
    const refreshed = this.options.jobs.get(jobId) ?? effective;
    return {
      run,
      job: await this.jobPresenter.toSchedulerJobPayload(refreshed),
    };
  }

  private ensurePrimarySpaceState(job: SchedulerJobRow): boolean {
    return ensurePrimarySpaceState({
      job,
      jobs: this.options.jobs,
      spaces: this.options.spaces,
    });
  }

  private computeNextRunFromRow(job: SchedulerJobRow, referenceIso: string): string | null {
    return computeNextRunFromJob(job, referenceIso);
  }

  private assertSpaceExists(spaceId: string): void {
    const row = this.options.spaces.getById(spaceId);
    if (!row) {
      throw new SchedulerServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }

}
