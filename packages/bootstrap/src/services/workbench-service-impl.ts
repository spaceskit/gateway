import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import type { Logger } from "@spaceskit/observability";
import {
  type WorkbenchBatchRow,
  type WorkbenchExecutionMode,
  type WorkbenchPolicyRow,
  type WorkbenchRunRow,
} from "@spaceskit/persistence";
import type {
  WorkbenchApproveStagePayload,
  WorkbenchArtifactPayload,
  WorkbenchBatchPayload,
  WorkbenchCancelRunPayload,
  WorkbenchCancelScenarioRunPayload,
  WorkbenchCreateBatchPayload,
  WorkbenchExecutionModePayload,
  WorkbenchGetScenarioRunPayload,
  WorkbenchGetPolicyPayload,
  WorkbenchGetQueueItemPayload,
  WorkbenchGetRunPayload,
  WorkbenchListArtifactsPayload,
  WorkbenchListBatchesPayload,
  WorkbenchListQueuePayload,
  WorkbenchListRunsPayload,
  WorkbenchListScenarioRunsPayload,
  WorkbenchListScenariosPayload,
  WorkbenchListScenariosResponsePayload,
  WorkbenchPolicyPayload,
  WorkbenchQueueItemPayload,
  WorkbenchRejectStagePayload,
  WorkbenchRetryRunPayload,
  WorkbenchRunPayload,
  WorkbenchScenarioRunPayload,
  WorkbenchSetModePayload,
  WorkbenchSetModeResponsePayload,
  WorkbenchStartScenarioRunPayload,
  WorkbenchStartRunPayload,
  WorkbenchUpdateBatchPayload,
  WorkbenchUpdatePolicyPayload,
  WorkbenchVerificationSuitePayload,
  WorkbenchVerificationResultPayload,
  WorkbenchWorktreeRefPayload,
} from "@spaceskit/server";
import {
  runWorkbenchCommand,
  type RunWorkbenchCommandOptions,
  type WorkbenchCommandEvidence,
} from "./workbench-verification-executor.js";
import { resolvePlanningRepoRoot } from "./workbench-task-metadata.js";
import {
  assertWorkbenchAutonomousEligibility,
  assertWorkbenchBatchConflictFree,
  assertWorkbenchNoActiveRunConflict,
  assertWorkbenchParallelCapacity,
  loadWorkbenchQueueItems,
  resolveWorkbenchQueueItems,
} from "./workbench-queue-loader.js";
import type { WorkbenchAgentLoopContext } from "./workbench-agent-loop.js";
import {
  createInternalWorkbenchExecutorAdapter,
  type WorkbenchExecutorAdapter,
} from "./workbench-executor-adapter.js";
import { executeWorkbenchRunIfReady } from "./workbench-service-execution.js";
import {
  persistWorkbenchDocsPreflightArtifact,
  persistWorkbenchGeneratedDocsKnowledgeArtifact,
  persistWorkbenchRunArtifacts,
  persistWorkbenchVerificationLog,
} from "./workbench-run-artifacts.js";
export {
  auditWorkbenchOpenBacklog,
  auditWorkbenchPlanningRepo,
} from "./workbench-planning-audit.js";
export type {
  WorkbenchOpenBacklogAuditReport,
  WorkbenchPlanningAuditIssue,
  WorkbenchPlanningAuditReport,
} from "./workbench-planning-audit.js";
import {
  WorkbenchServiceError,
  modePatchForRun,
  normalizeExecutionMode,
  normalizeLimit,
  normalizeRequired,
  parseJson,
  parseJsonArray,
} from "./workbench-service-normalizers.js";
import {
  toWorkbenchBatchPayload,
  toWorkbenchPolicyPayload,
  toWorkbenchRunPayload,
} from "./workbench-service-presenters.js";
import { allocateWorkbenchWorktree, resolveWorkbenchGitRoot } from "./workbench-service-worktree.js";
import { createWorkbenchBatch, updateWorkbenchBatch } from "./workbench-service-batches.js";
import {
  cancelWorkbenchRun,
  listWorkbenchArtifacts,
  rejectWorkbenchStage,
  updateCentralWorkbenchTaskStatus,
  updateWorkbenchPolicy,
} from "./workbench-service-controls.js";
import { startWorkbenchRun } from "./workbench-service-start-run.js";
import type { WorkbenchServiceOptions } from "./workbench-service-types.js";
import {
  cancelWorkbenchScenarioRun,
  getWorkbenchScenarioRun,
  listWorkbenchScenarioRuns,
  listWorkbenchScenariosForProduct,
  startWorkbenchScenarioRun,
} from "./workbench-service-scenarios.js";
import type { WorkbenchScenarioContext } from "./workbench-service-scenarios.js";

export { WorkbenchServiceError } from "./workbench-service-normalizers.js";
export type { WorkbenchServiceOptions } from "./workbench-service-types.js";

export class WorkbenchService {
  private readonly now: () => Date;
  private readonly logger: Logger | null;
  private readonly repoRoot: string;
  private readonly workProjectsRoot: string;
  private readonly workbenchProjectSlug: string;
  private readonly worktreeParentRoot: string;
  private readonly verificationCommandTimeoutMs: number;
  private readonly verificationExecutor: (options: RunWorkbenchCommandOptions) => Promise<WorkbenchCommandEvidence>;
  private readonly agentTurnCompletionTimeoutMs: number;
  private readonly runnerApiEnabled: boolean;
  private readonly workbenchExecutorAutostart: boolean;
  private readonly workbenchExecutorAdapter: WorkbenchExecutorAdapter;
  private readonly activeExecutions = new Map<string, AbortController>();
  private readonly scheduledRunIds = new Set<string>();
  private readonly scheduledRunTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: WorkbenchServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? null;
    this.repoRoot = resolvePlanningRepoRoot(resolve(options.repoRoot), this.logger);
    this.workProjectsRoot = resolve(options.workProjectsRoot ?? "/Users/caruso/Documents/work/projects");
    this.workbenchProjectSlug = options.workbenchProjectSlug ?? "spaces";
    this.worktreeParentRoot = resolve(
      options.worktreeParentRoot
        ?? join(dirname(this.repoRoot), ".spaceskit-workbench", basename(this.repoRoot)),
    );
    this.verificationCommandTimeoutMs = options.verificationCommandTimeoutMs ?? 10 * 60 * 1000;
    this.verificationExecutor = options.verificationExecutor ?? runWorkbenchCommand;
    this.agentTurnCompletionTimeoutMs = options.agentTurnCompletionTimeoutMs ?? 30 * 60 * 1000;
    this.runnerApiEnabled = options.runnerApiEnabled ?? false;
    this.workbenchExecutorAutostart = options.workbenchExecutorAutostart ?? true;
    this.workbenchExecutorAdapter = options.workbenchExecutorAdapter
      ?? createInternalWorkbenchExecutorAdapter((runId, signal) => this.executeRunIfReady(runId, signal));
  }

  async listQueue(
    input: WorkbenchListQueuePayload & { principalId?: string } = {},
  ): Promise<WorkbenchQueueItemPayload[]> {
    const items = this.loadQueueItems();
    const limit = normalizeLimit(input.limit ?? items.length, items.length || 100);
    return items.slice(0, limit);
  }

  async getQueueItem(
    input: WorkbenchGetQueueItemPayload & { principalId?: string },
  ): Promise<WorkbenchQueueItemPayload | null> {
    return this.loadQueueItems().find((item) => item.queueItemId === normalizeRequired(input.queueItemId, "queueItemId")) ?? null;
  }

  async createBatch(
    input: WorkbenchCreateBatchPayload & { principalId: string },
  ): Promise<WorkbenchBatchPayload> {
    return createWorkbenchBatch(this.batchContext(), input);
  }

  async listBatches(
    input: WorkbenchListBatchesPayload & { principalId?: string } = {},
  ): Promise<WorkbenchBatchPayload[]> {
    return this.options.batches.list(input.limit ?? 100).map((row) => this.toBatchPayload(row));
  }

  async updateBatch(
    input: WorkbenchUpdateBatchPayload & { principalId: string },
  ): Promise<WorkbenchBatchPayload> {
    return updateWorkbenchBatch(this.batchContext(), input);
  }

  async startRun(
    input: WorkbenchStartRunPayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    const principalId = normalizeRequired(input.principalId, "principalId");
    return this.runMutationIdempotently(
      "workbench.start_run",
      input.idempotencyKey,
      principalId,
      {
        queueItemId: input.queueItemId,
        batchId: input.batchId,
        executionMode: input.executionMode,
      },
      () => this.startRunWithoutIdempotency({
        ...input,
        principalId,
      }),
    );
  }

  private async startRunWithoutIdempotency(
    input: WorkbenchStartRunPayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    return startWorkbenchRun({
      options: this.options,
      now: this.now,
      resolveGitRoot: () => this.resolveGitRoot(),
      resolveQueueItems: (queueItemIds) => this.resolveQueueItems(queueItemIds),
      requireBatch: (batchId) => this.requireBatch(batchId),
      assertAutonomousEligibility: (queueItem, policy) =>
        this.assertAutonomousEligibility(queueItem, policy),
      assertParallelCapacity: (policy) => this.assertParallelCapacity(policy),
      assertNoActiveRunConflict: (queueItem) => this.assertNoActiveRunConflict(queueItem),
      allocateWorktree: (queueItem, runId) => this.allocateWorktree(queueItem, runId),
      updateCentralTaskStatus: (queueItem, status, logMessage) =>
        this.updateCentralTaskStatus(queueItem, status, logMessage),
      persistRunArtifacts: (row, queueItem, worktree, verificationSuites, executionMode) =>
        this.persistRunArtifacts(row, queueItem, worktree, verificationSuites, executionMode),
      scheduleRun: (runId) => this.scheduleRun(runId),
      toRunPayload: (row) => this.toRunPayload(row),
    }, input);
  }

  async retryRun(
    input: WorkbenchRetryRunPayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const runId = normalizeRequired(input.runId, "runId");
    return this.runMutationIdempotently(
      "workbench.retry_run",
      input.idempotencyKey,
      principalId,
      { runId },
      () => {
        const existing = this.requireRun(runId);
        return this.startRunWithoutIdempotency({
          principalId,
          queueItemId: existing.queue_item_id,
          batchId: existing.batch_id ?? undefined,
          executionMode: existing.execution_mode as WorkbenchExecutionModePayload,
        });
      },
    );
  }

  async cancelRun(
    input: WorkbenchCancelRunPayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const runId = normalizeRequired(input.runId, "runId");
    return this.runMutationIdempotently(
      "workbench.cancel_run",
      input.idempotencyKey,
      principalId,
      { runId },
      () => {
        this.cancelActiveExecution(runId);
        return Promise.resolve(this.toRunPayload(cancelWorkbenchRun({
          runs: this.options.runs,
          requireRun: (id) => this.requireRun(id),
          now: this.now,
          payload: {
            ...input,
            principalId,
            runId,
          },
        })));
      },
    );
  }

  async listRuns(
    input: WorkbenchListRunsPayload & { principalId?: string } = {},
  ): Promise<WorkbenchRunPayload[]> {
    return this.options.runs.list({
      batchId: input.batchId?.trim() || undefined,
      queueItemId: input.queueItemId?.trim() || undefined,
      limit: input.limit ?? 100,
    }).map((row) => this.toRunPayload(row));
  }

  async getRun(
    input: WorkbenchGetRunPayload & { principalId?: string },
  ): Promise<WorkbenchRunPayload | null> {
    const row = this.options.runs.get(normalizeRequired(input.runId, "runId"));
    return row ? this.toRunPayload(row) : null;
  }

  async approveStage(
    input: WorkbenchApproveStagePayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const runId = normalizeRequired(input.runId, "runId");
    return this.runMutationIdempotently(
      "workbench.approve_stage",
      input.idempotencyKey,
      principalId,
      { runId, stage: input.stage },
      () => {
        const run = this.requireRun(runId);
        if (run.approval_state !== "pending") {
          throw new WorkbenchServiceError("FAILED_PRECONDITION", `Run does not require approval: ${runId}`);
        }

        const updated = this.options.runs.update(runId, {
          status: "queued",
          currentStage: "execute",
          approvalState: "approved",
          lastErrorCode: null,
          lastErrorMessage: null,
        });
        const row = updated ?? run;
        this.scheduleRun(row.run_id);
        return Promise.resolve(this.toRunPayload(row));
      },
    );
  }

  async processQueuedRuns(): Promise<WorkbenchRunPayload[]> {
    const readyRuns = this.options.runs.listActive()
      .filter((run) => run.status === "queued" && run.current_stage === "execute");
    const processed: WorkbenchRunPayload[] = [];
    for (const run of readyRuns) {
      processed.push(this.toRunPayload(await this.processRun(run.run_id)));
    }
    return processed;
  }

  async recoverInterruptedRuns(): Promise<void> {
    const activeRuns = this.options.runs.listActive();
    for (const run of activeRuns) {
      if (run.status === "running") {
        this.options.runs.update(run.run_id, {
          status: "failed",
          currentStage: "report",
          finishedAt: this.now().toISOString(),
          lastErrorCode: "WORKBENCH_RUN_INTERRUPTED",
          lastErrorMessage: "Gateway restarted while the Workbench run was active. Retry the run to continue from a fresh executor.",
          verificationResultJson: JSON.stringify({
            status: "failed",
            summary: "Gateway restarted while the Workbench run was active. Retry the run to continue from a fresh executor.",
            completedAt: this.now().toISOString(),
          } satisfies WorkbenchVerificationResultPayload),
        });
      } else if (run.status === "queued" && run.current_stage === "execute") {
        this.scheduleRun(run.run_id);
      }
    }
  }

  private scheduleRun(runId: string): void {
    if (!this.workbenchExecutorAutostart || this.scheduledRunTimers.has(runId) || this.activeExecutions.has(runId)) {
      return;
    }
    this.scheduledRunIds.add(runId);
    const timer = setTimeout(() => {
      if (this.scheduledRunTimers.get(runId) !== timer) return;
      this.scheduledRunTimers.delete(runId);
      if (!this.scheduledRunIds.delete(runId)) return;
      void this.processRun(runId).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.error?.("Workbench executor run failed unexpectedly", { error, runId });
        const existing = this.options.runs.get(runId);
        if (existing && existing.status !== "cancelled") {
          this.options.runs.update(runId, {
            status: "failed",
            currentStage: "report",
            finishedAt: this.now().toISOString(),
            lastErrorCode: "WORKBENCH_EXECUTOR_FAILED",
            lastErrorMessage: message,
          });
        }
      });
    }, 0);
    this.scheduledRunTimers.set(runId, timer);
  }

  private async processRun(runId: string): Promise<WorkbenchRunRow> {
    const existingController = this.activeExecutions.get(runId);
    if (existingController) {
      return this.requireRun(runId);
    }
    const controller = new AbortController();
    this.activeExecutions.set(runId, controller);
    try {
      return await this.workbenchExecutorAdapter.run({
        runId,
        signal: controller.signal,
      });
    } finally {
      if (this.activeExecutions.get(runId) === controller) {
        this.activeExecutions.delete(runId);
      }
    }
  }

  private cancelActiveExecution(runId: string): void {
    const scheduledTimer = this.scheduledRunTimers.get(runId);
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      this.scheduledRunTimers.delete(runId);
    }
    this.scheduledRunIds.delete(runId);
    this.activeExecutions.get(runId)?.abort();
  }

  private async executeRunIfReady(runId: string, signal?: AbortSignal): Promise<WorkbenchRunRow> {
    return executeWorkbenchRunIfReady({
      runs: this.options.runs,
      now: this.now,
      requireRun: (id) => this.requireRun(id),
      agentLoopContext: () => this.agentLoopContext(),
      persistDocsPreflightArtifact: (id, worktreePath) =>
        this.persistDocsPreflightArtifact(id, worktreePath, signal),
      persistGeneratedDocsKnowledgeArtifact: (id, worktreePath) =>
        this.persistGeneratedDocsKnowledgeArtifact(id, worktreePath),
      persistVerificationLog: (id, suite, evidence) =>
        this.persistVerificationLog(id, suite, evidence),
      runVerificationCommand: (suite, worktree, commandSignal) =>
        this.verificationExecutor({
          command: suite.command,
          cwd: worktree.path,
          timeoutMs: this.verificationCommandTimeoutMs,
          now: this.now,
          signal: commandSignal,
        }),
      resolveQueueItems: (queueItemIds) => this.resolveQueueItems(queueItemIds),
      updateCentralTaskStatus: (queueItem, status, logMessage) =>
        this.updateCentralTaskStatus(queueItem, status, logMessage),
    }, runId, signal);
  }

  private agentLoopContext(): WorkbenchAgentLoopContext {
    return {
      runs: this.options.runs,
      artifacts: this.options.artifacts,
      spaceAdminService: this.options.spaceAdminService,
      spaceManager: this.options.spaceManager,
      eventBus: this.options.eventBus,
      agentTurnCompletionTimeoutMs: this.agentTurnCompletionTimeoutMs,
      now: this.now,
      resolveQueueItems: (queueItemIds) => this.resolveQueueItems(queueItemIds),
      updateCentralTaskStatus: (queueItem, status, logMessage) =>
        this.updateCentralTaskStatus(queueItem, status, logMessage),
    };
  }

  private persistVerificationLog(
    runId: string,
    suite: WorkbenchVerificationSuitePayload,
    evidence: WorkbenchCommandEvidence,
  ): string {
    return persistWorkbenchVerificationLog(this.options.artifacts, runId, suite, evidence);
  }

  private persistDocsPreflightArtifact(runId: string, worktreePath: string, signal?: AbortSignal): Promise<void> {
    return persistWorkbenchDocsPreflightArtifact({
      artifacts: this.options.artifacts,
      runId,
      worktreePath,
      verificationCommandTimeoutMs: this.verificationCommandTimeoutMs,
      now: this.now,
      signal,
      verificationExecutor: this.verificationExecutor,
    });
  }

  private persistGeneratedDocsKnowledgeArtifact(runId: string, worktreePath: string): void {
    persistWorkbenchGeneratedDocsKnowledgeArtifact(this.options.artifacts, runId, worktreePath);
  }

  async rejectStage(
    input: WorkbenchRejectStagePayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const runId = normalizeRequired(input.runId, "runId");
    return this.runMutationIdempotently(
      "workbench.reject_stage",
      input.idempotencyKey,
      principalId,
      { runId, stage: input.stage, reason: input.reason },
      () => Promise.resolve(this.toRunPayload(rejectWorkbenchStage({
        runs: this.options.runs,
        requireRun: (id) => this.requireRun(id),
        now: this.now,
        payload: {
          ...input,
          principalId,
          runId,
        },
      }))),
    );
  }

  async setMode(
    input: WorkbenchSetModePayload & { principalId: string },
  ): Promise<WorkbenchSetModeResponsePayload> {
    normalizeRequired(input.principalId, "principalId");
    const executionMode = normalizeExecutionMode(input.executionMode);
    const policy = this.options.policy.get();

    if (input.runId?.trim()) {
      const run = this.requireRun(input.runId.trim());
      const queueItem = this.resolveQueueItems([run.queue_item_id])[0]!;
      if (executionMode === "autonomous") {
        this.assertAutonomousEligibility(queueItem, policy);
      }

      const updated = this.options.runs.update(run.run_id, modePatchForRun(executionMode));
      if (executionMode === "autonomous") {
        const row = updated ?? run;
        this.scheduleRun(row.run_id);
        return { run: this.toRunPayload(row) };
      }
      return { run: this.toRunPayload(updated ?? run) };
    }

    if (input.batchId?.trim()) {
      const batch = this.requireBatch(input.batchId.trim());
      const items = this.resolveQueueItems(parseJsonArray(batch.queue_item_ids_json));
      if (executionMode === "autonomous") {
        for (const item of items) {
          this.assertAutonomousEligibility(item, policy);
        }
      }
      const updated = this.options.batches.update(batch.batch_id, { executionMode });
      return { batch: this.toBatchPayload(updated ?? batch) };
    }

    throw new WorkbenchServiceError("INVALID_ARGUMENT", "Either runId or batchId is required");
  }

  async listArtifacts(
    input: WorkbenchListArtifactsPayload & { principalId?: string },
  ): Promise<WorkbenchArtifactPayload[]> {
    return listWorkbenchArtifacts({
      artifacts: this.options.artifacts,
      requireRun: (runId) => this.requireRun(runId),
      runIdRaw: input.runId,
    });
  }

  async getPolicy(
    _input: WorkbenchGetPolicyPayload & { principalId?: string } = {},
  ): Promise<WorkbenchPolicyPayload> {
    return this.toPolicyPayload(this.options.policy.get());
  }

  async updatePolicy(
    input: WorkbenchUpdatePolicyPayload & { principalId: string },
  ): Promise<WorkbenchPolicyPayload> {
    return this.toPolicyPayload(updateWorkbenchPolicy({
      policy: this.options.policy,
      payload: input,
    }));
  }

  async listScenarios(
    _input: WorkbenchListScenariosPayload & { principalId?: string } = {},
  ): Promise<WorkbenchListScenariosResponsePayload> {
    return listWorkbenchScenariosForProduct(this.scenarioContext());
  }

  async startScenarioRun(
    input: WorkbenchStartScenarioRunPayload & { principalId: string },
  ): Promise<WorkbenchScenarioRunPayload> {
    return startWorkbenchScenarioRun(this.scenarioContext(), input);
  }

  async listScenarioRuns(
    input: WorkbenchListScenarioRunsPayload & { principalId?: string } = {},
  ): Promise<WorkbenchScenarioRunPayload[]> {
    return listWorkbenchScenarioRuns(this.scenarioContext(), input);
  }

  async getScenarioRun(
    input: WorkbenchGetScenarioRunPayload & { principalId?: string },
  ): Promise<WorkbenchScenarioRunPayload | null> {
    return getWorkbenchScenarioRun(this.scenarioContext(), input);
  }

  async cancelScenarioRun(
    input: WorkbenchCancelScenarioRunPayload & { principalId: string },
  ): Promise<WorkbenchScenarioRunPayload> {
    return cancelWorkbenchScenarioRun(this.scenarioContext(), input);
  }

  private async runMutationIdempotently<T>(
    endpoint: string,
    idempotencyKey: string | undefined,
    principalId: string,
    requestPayload: Record<string, unknown>,
    execute: () => Promise<T>,
  ): Promise<T> {
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey || !this.options.loadIdempotencyRecord || !this.options.saveIdempotencyRecord) {
      return execute();
    }

    const requestHash = stableJsonHash(requestPayload);
    const existing = await this.options.loadIdempotencyRecord(principalId, endpoint, normalizedKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new WorkbenchServiceError(
          "FAILED_PRECONDITION",
          `Idempotency key replay with different Workbench payload: ${normalizedKey}`,
        );
      }
      try {
        return JSON.parse(existing.responsePayload) as T;
      } catch {
        throw new WorkbenchServiceError("FAILED_PRECONDITION", "Stored Workbench idempotency response is invalid");
      }
    }

    const result = await execute();
    await this.options.saveIdempotencyRecord({
      principalId,
      endpoint,
      idempotencyKey: normalizedKey,
      requestHash,
      responseType: "workbench_run",
      responsePayload: JSON.stringify(result),
    });
    return result;
  }

  private resolveQueueItems(queueItemIds: string[]): WorkbenchQueueItemPayload[] {
    return resolveWorkbenchQueueItems(queueItemIds, this.loadQueueItems());
  }

  private loadQueueItems(): WorkbenchQueueItemPayload[] {
    return loadWorkbenchQueueItems({
      workProjectsRoot: this.workProjectsRoot,
      workbenchProjectSlug: this.workbenchProjectSlug,
      now: this.now(),
      logger: this.logger,
    });
  }

  private updateCentralTaskStatus(
    queueItem: WorkbenchQueueItemPayload,
    status: "in-progress" | "review" | "blocked",
    logMessage: string,
  ): void {
    updateCentralWorkbenchTaskStatus({
      queueItem,
      status,
      logMessage,
      now: this.now,
      logger: this.logger,
    });
  }

  private assertBatchConflictFree(items: WorkbenchQueueItemPayload[]): void {
    assertWorkbenchBatchConflictFree(items);
  }

  private assertNoActiveRunConflict(queueItem: WorkbenchQueueItemPayload): void {
    assertWorkbenchNoActiveRunConflict({
      queueItem,
      runs: this.options.runs,
      resolveQueueItems: (queueItemIds) => this.resolveQueueItems(queueItemIds),
    });
  }

  private assertParallelCapacity(policy: WorkbenchPolicyRow): void {
    assertWorkbenchParallelCapacity(policy, this.options.runs);
  }

  private assertAutonomousEligibility(
    queueItem: WorkbenchQueueItemPayload,
    policy: WorkbenchPolicyRow,
  ): void {
    assertWorkbenchAutonomousEligibility(queueItem, policy);
  }

  private batchContext() {
    return {
      options: this.options,
      resolveQueueItems: (queueItemIds: string[]) => this.resolveQueueItems(queueItemIds),
      assertBatchConflictFree: (items: WorkbenchQueueItemPayload[]) =>
        this.assertBatchConflictFree(items),
      assertAutonomousEligibility: (
        queueItem: WorkbenchQueueItemPayload,
        policy: WorkbenchPolicyRow,
      ) => this.assertAutonomousEligibility(queueItem, policy),
      toBatchPayload: (row: WorkbenchBatchRow) => this.toBatchPayload(row),
    };
  }

  private requireBatch(batchId: string): WorkbenchBatchRow {
    const row = this.options.batches.get(batchId);
    if (!row) {
      throw new WorkbenchServiceError("NOT_FOUND", `Workbench batch not found: ${batchId}`);
    }
    return row;
  }

  private requireRun(runId: string): WorkbenchRunRow {
    const row = this.options.runs.get(runId);
    if (!row) {
      throw new WorkbenchServiceError("NOT_FOUND", `Workbench run not found: ${runId}`);
    }
    return row;
  }

  private resolveGitRoot(): string {
    return resolveWorkbenchGitRoot(this.repoRoot);
  }

  private allocateWorktree(
    queueItem: WorkbenchQueueItemPayload,
    runId: string,
  ): WorkbenchWorktreeRefPayload {
    return allocateWorkbenchWorktree({
      repoRoot: this.repoRoot,
      worktreeParentRoot: this.worktreeParentRoot,
      queueItem,
      runId,
      now: this.now,
    });
  }

  private persistRunArtifacts(
    row: WorkbenchRunRow,
    queueItem: WorkbenchQueueItemPayload,
    worktree: WorkbenchWorktreeRefPayload,
    verificationSuites: WorkbenchVerificationSuitePayload[],
    executionMode: WorkbenchExecutionMode,
  ): void {
    persistWorkbenchRunArtifacts({
      artifacts: this.options.artifacts,
      workProjectsRoot: this.workProjectsRoot,
      workbenchProjectSlug: this.workbenchProjectSlug,
      row,
      queueItem,
      worktree,
      verificationSuites,
      executionMode,
    });
  }

  private toBatchPayload(row: WorkbenchBatchRow): WorkbenchBatchPayload {
    return toWorkbenchBatchPayload(row);
  }

  private toRunPayload(row: WorkbenchRunRow): WorkbenchRunPayload {
    return toWorkbenchRunPayload(row, this.loadQueueItems());
  }

  private toPolicyPayload(row: WorkbenchPolicyRow): WorkbenchPolicyPayload {
    return toWorkbenchPolicyPayload(row, {
      runnerAvailable: this.runnerApiEnabled,
      scenarioDiscoveryAvailable: this.runnerApiEnabled,
    });
  }

  private scenarioContext(): WorkbenchScenarioContext {
    return {
      scenarioRuns: this.options.scenarioRuns,
      repoRoot: this.repoRoot,
      runnerApiEnabled: this.runnerApiEnabled,
      now: this.now,
      scenarioRunner: this.options.scenarioRunner,
    };
  }
}

function stableJsonHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableJsonValue(value))).digest("hex");
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = stableJsonValue(record[key]);
      if (entry !== undefined) normalized[key] = entry;
    }
    return normalized;
  }
  return value;
}
