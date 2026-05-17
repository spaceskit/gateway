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
  WorkbenchCreateBatchPayload,
  WorkbenchExecutionModePayload,
  WorkbenchGetPolicyPayload,
  WorkbenchGetQueueItemPayload,
  WorkbenchGetRunPayload,
  WorkbenchListArtifactsPayload,
  WorkbenchListBatchesPayload,
  WorkbenchListQueuePayload,
  WorkbenchListRunsPayload,
  WorkbenchPolicyPayload,
  WorkbenchQueueItemPayload,
  WorkbenchRejectStagePayload,
  WorkbenchRetryRunPayload,
  WorkbenchRunPayload,
  WorkbenchSetModePayload,
  WorkbenchSetModeResponsePayload,
  WorkbenchStartRunPayload,
  WorkbenchUpdateBatchPayload,
  WorkbenchUpdatePolicyPayload,
  WorkbenchVerificationSuitePayload,
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
      executeRunIfReady: (runId) => this.executeRunIfReady(runId),
      toRunPayload: (row) => this.toRunPayload(row),
    }, input);
  }

  async retryRun(
    input: WorkbenchRetryRunPayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    const existing = this.requireRun(normalizeRequired(input.runId, "runId"));
    return this.startRun({
      principalId: normalizeRequired(input.principalId, "principalId"),
      queueItemId: existing.queue_item_id,
      batchId: existing.batch_id ?? undefined,
      executionMode: existing.execution_mode as WorkbenchExecutionModePayload,
    });
  }

  async cancelRun(
    input: WorkbenchCancelRunPayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    return this.toRunPayload(cancelWorkbenchRun({
      runs: this.options.runs,
      requireRun: (runId) => this.requireRun(runId),
      now: this.now,
      payload: input,
    }));
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
    normalizeRequired(input.principalId, "principalId");
    const runId = normalizeRequired(input.runId, "runId");
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
    return this.toRunPayload(await this.executeRunIfReady((updated ?? run).run_id));
  }

  private async executeRunIfReady(runId: string): Promise<WorkbenchRunRow> {
    return executeWorkbenchRunIfReady({
      runs: this.options.runs,
      now: this.now,
      requireRun: (id) => this.requireRun(id),
      agentLoopContext: () => this.agentLoopContext(),
      persistDocsPreflightArtifact: (id, worktreePath) =>
        this.persistDocsPreflightArtifact(id, worktreePath),
      persistGeneratedDocsKnowledgeArtifact: (id, worktreePath) =>
        this.persistGeneratedDocsKnowledgeArtifact(id, worktreePath),
      persistVerificationLog: (id, suite, evidence) =>
        this.persistVerificationLog(id, suite, evidence),
      runVerificationCommand: (suite, worktree) =>
        this.verificationExecutor({
          command: suite.command,
          cwd: worktree.path,
          timeoutMs: this.verificationCommandTimeoutMs,
          now: this.now,
        }),
      resolveQueueItems: (queueItemIds) => this.resolveQueueItems(queueItemIds),
      updateCentralTaskStatus: (queueItem, status, logMessage) =>
        this.updateCentralTaskStatus(queueItem, status, logMessage),
    }, runId);
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

  private persistDocsPreflightArtifact(runId: string, worktreePath: string): Promise<void> {
    return persistWorkbenchDocsPreflightArtifact({
      artifacts: this.options.artifacts,
      runId,
      worktreePath,
      verificationCommandTimeoutMs: this.verificationCommandTimeoutMs,
      now: this.now,
      verificationExecutor: this.verificationExecutor,
    });
  }

  private persistGeneratedDocsKnowledgeArtifact(runId: string, worktreePath: string): void {
    persistWorkbenchGeneratedDocsKnowledgeArtifact(this.options.artifacts, runId, worktreePath);
  }

  async rejectStage(
    input: WorkbenchRejectStagePayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    return this.toRunPayload(rejectWorkbenchStage({
      runs: this.options.runs,
      requireRun: (runId) => this.requireRun(runId),
      now: this.now,
      payload: input,
    }));
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
        return { run: this.toRunPayload(await this.executeRunIfReady((updated ?? run).run_id)) };
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
    return toWorkbenchPolicyPayload(row);
  }
}
