import { randomUUID } from "node:crypto";
import type { EventBus, SpaceAdminService } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  OrchestrationJournalRepository,
  SchedulerJobRepository,
  SchedulerJobRow,
  SchedulerJobRunRepository,
  SchedulerJobRunRow,
  SchedulerRunStatus,
  SchedulerRunTrigger,
  SpaceRepository,
} from "@spaceskit/persistence";
import type {
  SchedulerEvalConfigPayload,
  SchedulerEvalRunPayload,
  SchedulerExecutionTargetPayload,
  SchedulerJobRunPayload,
} from "@spaceskit/server";
import type { OrchestratorCommandService } from "./orchestrator-command-service.js";
import {
  applyRecommendationConfig,
  nextEvalSelfImproveState,
  resolveTemplateId,
} from "./scheduler-eval-results.js";
import { buildSchedulerEvalRun } from "./scheduler-eval-run-builder.js";
import { SchedulerServiceError } from "./scheduler-errors.js";
import { computeNextRunFromJob, ensurePrimarySpaceState } from "./scheduler-job-state.js";
import { normalizeOptionalString } from "./scheduler-normalizers.js";
import {
  parseAction,
  parseEvalConfig,
  parseEvalSelfImproveState,
  parseExecutionTarget,
  toRunPayload,
} from "./scheduler-payloads.js";
import type { SpaceConfiguratorService } from "./space-configurator-service.js";

const RUN_RETENTION_LIMIT = 200;

interface SchedulerRunResult {
  status: Exclude<SchedulerRunStatus, "running">;
  commandId?: string;
  errorCode?: string;
  errorMessage?: string;
  result?: Record<string, unknown>;
  evalRun?: SchedulerEvalRunPayload;
  evalConfigJson?: string | null;
  evalSelfImproveStateJson?: string | null;
}

export interface SchedulerRunExecutorOptions {
  jobs: SchedulerJobRepository;
  runs: SchedulerJobRunRepository;
  spaces: SpaceRepository;
  eventBus?: Pick<EventBus, "on"> | null;
  orchestrationJournal?: Pick<OrchestrationJournalRepository, "list"> | null;
  spaceAdminService: Pick<SpaceAdminService, "getSpace">;
  spaceTemplateService?: Pick<SpaceConfiguratorService, "createFromTemplate"> | null;
  orchestratorCommandService: Pick<OrchestratorCommandService, "submitCommand">;
  logger?: Logger | null;
  now: () => Date;
  executionTimeoutMs: number;
}

export class SchedulerRunExecutor {
  constructor(private readonly options: SchedulerRunExecutorOptions) {}

  async executeScheduledRun(job: SchedulerJobRow, scheduledFor: string): Promise<void> {
    const nowIso = this.options.now().toISOString();
    const nextRunAt = computeNextRunFromJob(job, scheduledFor);
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

  async executeManualRun(job: SchedulerJobRow): Promise<SchedulerJobRunPayload> {
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
        startedAt: this.options.now().toISOString(),
        finishedAt: this.options.now().toISOString(),
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
      startedAt: this.options.now().toISOString(),
    });

    if (!run) {
      const skippedRun = this.options.runs.create({
        runId: `run-${randomUUID()}`,
        jobId: effective.job_id,
        trigger: "manual",
        status: "skipped",
        startedAt: this.options.now().toISOString(),
        finishedAt: this.options.now().toISOString(),
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

  async recordSkippedOverlap(
    job: SchedulerJobRow,
    trigger: SchedulerRunTrigger,
    scheduledFor: string,
  ): Promise<void> {
    const nowIso = this.options.now().toISOString();
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

    const nextRunAt = computeNextRunFromJob(job, scheduledFor);
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
  ): Promise<SchedulerRunResult> {
    if (!job.primary_space_id) {
      return {
        status: "failed",
        errorCode: "PRIMARY_SPACE_MISSING",
        errorMessage: "Primary execution space is missing.",
      };
    }

    const action = parseAction(job);
    const executionTarget = parseExecutionTarget(job.execution_target_json);
    const evalConfig = parseEvalConfig(job.eval_config_json);
    const initialSelfImproveState = parseEvalSelfImproveState(
      job.eval_self_improve_state_json,
      evalConfig,
    );
    const executionSpace = await this.resolveExecutionSpace(job, run, executionTarget, evalConfig);
    const evalObserver = evalConfig
      ? this.createEvalObserver(executionSpace.spaceId)
      : null;
    try {
      const commandPromise = this.options.orchestratorCommandService.submitCommand({
        commandType: "run_space_prompt",
        targetSpaceId: executionSpace.spaceId,
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
            executionTarget: executionTarget.mode,
            evalDefinitionId: evalConfig?.evalDefinitionId,
          },
        },
      });

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new SchedulerServiceError(
            "FAILED_PRECONDITION",
            `Scheduler job execution timed out after ${this.options.executionTimeoutMs}ms`,
          ));
        }, this.options.executionTimeoutMs);
      });

      const command = await Promise.race([commandPromise, timeoutPromise]);
      const rootTurnId = normalizeOptionalString(command.result?.turnId);
      const evalRun = evalConfig
        ? buildSchedulerEvalRun({
          job,
          run,
          evalConfig,
          selfImproveState: initialSelfImproveState,
          executionSpace,
          rootTurnId,
          observedEvents: evalObserver?.events ?? [],
          orchestrationJournal: this.options.orchestrationJournal ?? null,
        })
        : undefined;

      if (command.status === "failed") {
        return {
          status: "failed",
          commandId: command.commandId,
          errorCode: command.error?.code ?? "ORCHESTRATOR_FAILED",
          errorMessage: command.error?.message ?? "Orchestrator command failed.",
          result: command.result,
          evalRun,
        };
      }

      return {
        status: "completed",
        commandId: command.commandId,
        result: command.result,
        evalRun,
        evalConfigJson: evalRun?.recommendations.some((recommendation) => recommendation.status === "applied")
          ? JSON.stringify(applyRecommendationConfig(evalConfig, evalRun.recommendations))
          : undefined,
        evalSelfImproveStateJson: evalRun
          ? JSON.stringify(nextEvalSelfImproveState(initialSelfImproveState, evalConfig, evalRun))
          : undefined,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      this.options.logger?.warn("Scheduler job execution failed", {
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
    } finally {
      evalObserver?.dispose();
    }
  }

  private finalizeRun(
    jobId: string,
    runId: string,
    result: SchedulerRunResult,
  ): SchedulerJobRunRow {
    const finishedAt = this.options.now().toISOString();
    const run = this.options.runs.update(runId, {
      status: result.status,
      commandId: result.commandId,
      finishedAt,
      errorCode: result.errorCode ?? "",
      errorMessage: result.errorMessage ?? "",
      resultJson: result.result ? JSON.stringify(result.result) : null,
      evalRunJson: result.evalRun ? JSON.stringify(result.evalRun) : null,
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
      ...(result.evalConfigJson !== undefined ? { evalConfigJson: result.evalConfigJson } : {}),
      ...(result.evalSelfImproveStateJson !== undefined
        ? { evalSelfImproveStateJson: result.evalSelfImproveStateJson }
        : {}),
    });
    this.options.runs.pruneToLatest(jobId, RUN_RETENTION_LIMIT);
    return finalRun;
  }

  private async resolveExecutionSpace(
    job: SchedulerJobRow,
    run: SchedulerJobRunRow,
    executionTarget: SchedulerExecutionTargetPayload,
    evalConfig: SchedulerEvalConfigPayload | null,
  ): Promise<{ spaceId: string; spaceUid?: string; name?: string }> {
    if (executionTarget.mode !== "new_space") {
      const space = job.primary_space_id
        ? await this.options.spaceAdminService.getSpace(job.primary_space_id).catch(() => null)
        : null;
      return {
        spaceId: job.primary_space_id ?? "",
        spaceUid: normalizeOptionalString(space?.spaceUid),
        name: normalizeOptionalString(space?.name),
      };
    }

    if (!this.options.spaceTemplateService) {
      throw new SchedulerServiceError(
        "FAILED_PRECONDITION",
        "Space template service is unavailable for new-space scheduler runs.",
      );
    }

    const templateId = resolveTemplateId(evalConfig?.flowVariantId);
    const created = await this.options.spaceTemplateService.createFromTemplate({
      templateId,
      spaceId: `space-eval-${run.run_id.slice(4)}`,
      resourceId: `scheduler:${job.job_id}:run:${run.run_id}`,
      name: `${job.name} • ${run.run_id}`,
      goal: parseAction(job).promptText,
      visibility: "shared",
      idempotencyKey: `scheduler:${job.job_id}:${run.run_id}:space`,
    }, job.created_by_principal_id);

    return {
      spaceId: created.space.id,
      spaceUid: normalizeOptionalString((created.space as { spaceUid?: string }).spaceUid),
      name: normalizeOptionalString((created.space as { name?: string }).name),
    };
  }

  private createEvalObserver(spaceId: string): {
    events: Array<Record<string, unknown>>;
    dispose: () => void;
  } {
    if (!this.options.eventBus) {
      return { events: [], dispose: () => {} };
    }

    const events: Array<Record<string, unknown>> = [];
    const unsubscribers = [
      this.options.eventBus.on("space.orchestrator_event", (event) => {
        if ((event as { spaceId?: string }).spaceId !== spaceId) return;
        events.push({ ...event, observedType: "space.orchestrator_event" });
      }),
      this.options.eventBus.on("context.summarizing", (event) => {
        if ((event as { spaceId?: string }).spaceId !== spaceId) return;
        events.push({ ...event, observedType: "context.summarizing" });
      }),
      this.options.eventBus.on("context.summarized", (event) => {
        if ((event as { spaceId?: string }).spaceId !== spaceId) return;
        events.push({ ...event, observedType: "context.summarized" });
      }),
    ];

    return {
      events,
      dispose: () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      },
    };
  }

  private ensurePrimarySpaceState(job: SchedulerJobRow): boolean {
    return ensurePrimarySpaceState({
      job,
      jobs: this.options.jobs,
      spaces: this.options.spaces,
    });
  }
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
