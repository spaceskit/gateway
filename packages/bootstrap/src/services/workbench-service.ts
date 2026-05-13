import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import type {
  CreateSpaceInput,
  SpaceConfig,
  TurnExecutionIdentity,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import {
  WorkbenchArtifactRepository,
  WorkbenchBatchRepository,
  WorkbenchPolicyRepository,
  WorkbenchRunRepository,
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
  WorkbenchExecutionContextPayload,
  WorkbenchExecutionContextStagePayload,
  WorkbenchExecutionModePayload,
  WorkbenchGetPolicyPayload,
  WorkbenchGetQueueItemPayload,
  WorkbenchGetRunPayload,
  WorkbenchLandingResultPayload,
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
  WorkbenchVerificationResultPayload,
  WorkbenchVerificationSuitePayload,
  WorkbenchWorktreeRefPayload,
} from "@spaceskit/server";
import {
  runWorkbenchCommand,
  type RunWorkbenchCommandOptions,
  type WorkbenchCommandEvidence,
} from "./workbench-verification-executor.js";
import {
  resolvePlanningRepoRoot,
  tryParseTaskFile,
  updateCentralTaskFile,
} from "./workbench-task-metadata.js";
import {
  assertWorkbenchAutonomousEligibility,
  assertWorkbenchBatchConflictFree,
  assertWorkbenchNoActiveRunConflict,
  assertWorkbenchParallelCapacity,
  loadWorkbenchQueueItems,
  resolveWorkbenchQueueItems,
} from "./workbench-queue-loader.js";
import {
  executeWorkbenchAgentLoopIfConfigured,
  type WorkbenchAgentLoopContext,
  type WorkbenchExecutionLoopResult,
} from "./workbench-agent-loop.js";
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
  initialRunStateForMode,
  modePatchForRun,
  normalizeExecutionMode,
  normalizeLimit,
  normalizeQueueItemIds,
  normalizeRequired,
  parseJson,
  parseJsonArray,
  sanitizeSlug,
} from "./workbench-service-normalizers.js";

export { WorkbenchServiceError } from "./workbench-service-normalizers.js";

export interface WorkbenchServiceOptions {
  batches: WorkbenchBatchRepository;
  runs: WorkbenchRunRepository;
  artifacts: WorkbenchArtifactRepository;
  policy: WorkbenchPolicyRepository;
  repoRoot: string;
  logger?: Logger;
  now?: () => Date;
  workProjectsRoot?: string;
  workbenchProjectSlug?: string;
  worktreeParentRoot?: string;
  verificationCommandTimeoutMs?: number;
  verificationExecutor?: (options: RunWorkbenchCommandOptions) => Promise<WorkbenchCommandEvidence>;
  spaceAdminService?: {
    createSpace(input: CreateSpaceInput): Promise<SpaceConfig>;
  };
  spaceManager?: {
    executeTurn(
      spaceId: string,
      input: string,
      targetAgentId?: string,
      executionIdentity?: TurnExecutionIdentity,
    ): Promise<{ turnId: string }>;
  };
  eventBus?: {
    on(type: string, listener: (event: unknown) => void): () => void;
  };
  agentTurnCompletionTimeoutMs?: number;
}

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
    const principalId = normalizeRequired(input.principalId, "principalId");
    const name = normalizeRequired(input.name, "name");
    const queueItemIds = normalizeQueueItemIds(input.queueItemIds);
    const policy = this.options.policy.get();
    const executionMode = normalizeExecutionMode(input.executionMode ?? policy.default_execution_mode);
    const items = this.resolveQueueItems(queueItemIds);

    this.assertBatchConflictFree(items);
    if (executionMode === "autonomous") {
      for (const item of items) {
        this.assertAutonomousEligibility(item, policy);
      }
    }

    const row = this.options.batches.create({
      batchId: `wb-batch-${randomUUID()}`,
      name,
      status: "draft",
      executionMode,
      queueItemIdsJson: JSON.stringify(queueItemIds),
      createdByPrincipalId: principalId,
    });

    return this.toBatchPayload(row);
  }

  async listBatches(
    input: WorkbenchListBatchesPayload & { principalId?: string } = {},
  ): Promise<WorkbenchBatchPayload[]> {
    return this.options.batches.list(input.limit ?? 100).map((row) => this.toBatchPayload(row));
  }

  async updateBatch(
    input: WorkbenchUpdateBatchPayload & { principalId: string },
  ): Promise<WorkbenchBatchPayload> {
    normalizeRequired(input.principalId, "principalId");
    const batchId = normalizeRequired(input.batchId, "batchId");
    const existing = this.options.batches.get(batchId);
    if (!existing) {
      throw new WorkbenchServiceError("NOT_FOUND", `Workbench batch not found: ${batchId}`);
    }

    const nextQueueItemIds = input.queueItemIds ? normalizeQueueItemIds(input.queueItemIds) : parseJsonArray(existing.queue_item_ids_json);
    const items = this.resolveQueueItems(nextQueueItemIds);
    this.assertBatchConflictFree(items);

    const policy = this.options.policy.get();
    const nextMode = input.executionMode
      ? normalizeExecutionMode(input.executionMode)
      : (existing.execution_mode as WorkbenchExecutionMode);
    if (nextMode === "autonomous") {
      for (const item of items) {
        this.assertAutonomousEligibility(item, policy);
      }
    }

    const updated = this.options.batches.update(batchId, {
      name: input.name?.trim(),
      queueItemIdsJson: input.queueItemIds ? JSON.stringify(nextQueueItemIds) : undefined,
      executionMode: nextMode,
      status: input.status,
    });
    if (!updated) {
      throw new WorkbenchServiceError("NOT_FOUND", `Workbench batch not found: ${batchId}`);
    }
    return this.toBatchPayload(updated);
  }

  async startRun(
    input: WorkbenchStartRunPayload & { principalId: string },
  ): Promise<WorkbenchRunPayload> {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const queueItem = this.resolveQueueItems([input.queueItemId])[0]!;
    const batch = input.batchId?.trim()
      ? this.requireBatch(input.batchId.trim())
      : null;
    const policy = this.options.policy.get();
    const executionMode = normalizeExecutionMode(
      input.executionMode
      ?? batch?.execution_mode
      ?? policy.default_execution_mode,
    );

    if (executionMode === "autonomous") {
      this.assertAutonomousEligibility(queueItem, policy);
    }
    this.assertParallelCapacity(policy);
    this.assertNoActiveRunConflict(queueItem);

    const runId = `wb-run-${randomUUID()}`;
    const worktree = this.allocateWorktree(queueItem, runId);
    const touchedRepos = [{
      repoId: basename(this.resolveGitRoot()),
      repoPath: this.resolveGitRoot(),
      kind: "meta" as const,
      committed: false,
    }];
    const verificationSuites = queueItem.verificationCommands.map((command, index) => ({
      suiteId: `${runId}-verify-${index + 1}`,
      name: `Verification ${index + 1}`,
      command,
      status: "pending" as const,
    }));

    const { status, currentStage, approvalState } = initialRunStateForMode(executionMode);
    const row = this.options.runs.create({
      runId,
      batchId: batch?.batch_id ?? null,
      queueItemId: queueItem.queueItemId,
      queueItemPath: queueItem.taskFilePath,
      status,
      currentStage,
      executionMode,
      approvalState,
      worktreeJson: JSON.stringify(worktree),
      touchedReposJson: JSON.stringify(touchedRepos),
      verificationSuitesJson: JSON.stringify(verificationSuites),
      verificationResultJson: JSON.stringify({
        status: "pending",
        summary: queueItem.verificationMode === "machine_readable"
          ? "Verification commands are queued."
          : queueItem.executionModeBlockers[0] ?? "No machine-readable verification declared.",
      } satisfies WorkbenchVerificationResultPayload),
      landingResultJson: JSON.stringify({
        status: "not_started",
        summary: executionMode === "supervised"
          ? "Awaiting human approval before execution enters the run queue."
          : "Queued for autonomous execution.",
      } satisfies WorkbenchLandingResultPayload),
      createdByPrincipalId: principalId,
      startedAt: this.now().toISOString(),
    });

    this.updateCentralTaskStatus(queueItem, "in-progress", `Workbench run ${runId} started in ${executionMode} mode.`);
    this.persistRunArtifacts(row, queueItem, worktree, verificationSuites, executionMode);

    if (batch && batch.status === "draft") {
      this.options.batches.update(batch.batch_id, { status: "queued" });
    }

    if (currentStage === "execute") {
      return this.toRunPayload(await this.executeRunIfReady(row.run_id));
    }

    return this.toRunPayload(row);
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
    normalizeRequired(input.principalId, "principalId");
    const runId = normalizeRequired(input.runId, "runId");
    const existing = this.requireRun(runId);
    const updated = this.options.runs.update(runId, {
      status: "cancelled",
      approvalState: existing.approval_state === "pending" ? "rejected" : existing.approval_state,
      currentStage: "report",
      finishedAt: this.now().toISOString(),
      lastErrorCode: "RUN_CANCELLED",
      lastErrorMessage: "Run cancelled by operator.",
    });
    return this.toRunPayload(updated ?? existing);
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
    let run = this.requireRun(runId);
    if (run.current_stage !== "execute" || run.status === "cancelled") {
      return run;
    }

    const suites = parseJson<WorkbenchVerificationSuitePayload[]>(run.verification_suites_json) ?? [];
    const worktree = run.worktree_json ? parseJson<WorkbenchWorktreeRefPayload>(run.worktree_json) : null;
    if (!worktree || suites.length === 0) {
      return run;
    }

    const executionLoop = await this.executeWorkbenchAgentLoopIfConfigured(run, worktree, suites);
    run = executionLoop.row;
    if (!executionLoop.continueToVerification) {
      return run;
    }

    await this.persistDocsPreflightArtifact(run.run_id, worktree.path);
    this.persistGeneratedDocsKnowledgeArtifact(run.run_id, worktree.path);
    this.options.runs.update(run.run_id, {
      status: "running",
      currentStage: "verify",
      verificationResultJson: JSON.stringify({
        status: "pending",
        summary: "Verification commands are running.",
      } satisfies WorkbenchVerificationResultPayload),
    });

    const nextSuites: WorkbenchVerificationSuitePayload[] = [];
    for (const suite of suites) {
      const runningSuite = {
        ...suite,
        status: "running" as const,
        startedAt: this.now().toISOString(),
      };
      nextSuites.push(runningSuite);
      this.options.runs.update(run.run_id, {
        verificationSuitesJson: JSON.stringify([
          ...nextSuites,
          ...suites.slice(nextSuites.length),
        ]),
      });

      const evidence = await this.verificationExecutor({
        command: suite.command,
        cwd: worktree.path,
        timeoutMs: this.verificationCommandTimeoutMs,
        now: this.now,
      });
      const logArtifactId = this.persistVerificationLog(run.run_id, suite, evidence);
      nextSuites[nextSuites.length - 1] = {
        ...runningSuite,
        status: evidence.status,
        completedAt: evidence.completedAt,
        exitCode: evidence.exitCode ?? undefined,
        durationMs: evidence.durationMs,
        logArtifactId,
        summary: evidence.summary,
      };
      this.options.runs.update(run.run_id, {
        verificationSuitesJson: JSON.stringify([
          ...nextSuites,
          ...suites.slice(nextSuites.length),
        ]),
      });
    }

    const failedSuite = nextSuites.find((suite) => suite.status === "failed");
    const completedAt = this.now().toISOString();
    const existingExecutionContext = run.execution_context_json
      ? parseJson<WorkbenchExecutionContextPayload>(run.execution_context_json)
      : null;
    const finalExecutionContext = existingExecutionContext
      ? {
        ...existingExecutionContext,
        stage: failedSuite ? "failed" : "completed",
      } satisfies WorkbenchExecutionContextPayload
      : null;
    const updated = this.options.runs.update(run.run_id, {
      status: failedSuite ? "failed" : "completed",
      currentStage: "report",
      finishedAt: completedAt,
      lastErrorCode: failedSuite ? "VERIFICATION_FAILED" : null,
      lastErrorMessage: failedSuite ? `${failedSuite.name} failed.` : null,
      verificationSuitesJson: JSON.stringify(nextSuites),
      executionContextJson: finalExecutionContext ? JSON.stringify(finalExecutionContext) : undefined,
      verificationResultJson: JSON.stringify({
        status: failedSuite ? "failed" : "passed",
        summary: failedSuite ? `${failedSuite.name} failed.` : "All verification commands passed.",
        completedAt,
      } satisfies WorkbenchVerificationResultPayload),
      landingResultJson: JSON.stringify({
        status: "blocked",
        summary: "Automatic landing is not enabled for this Workbench executor slice.",
        completedAt,
      } satisfies WorkbenchLandingResultPayload),
    });
    const queueItem = this.resolveQueueItems([run.queue_item_id])[0];
    if (queueItem) {
      this.updateCentralTaskStatus(
        queueItem,
        failedSuite ? "blocked" : "review",
        failedSuite
          ? `Workbench run ${run.run_id} failed verification: ${failedSuite.name}.`
          : `Workbench run ${run.run_id} completed verification and is ready for review.`,
      );
    }
    return updated ?? run;
  }

  private executeWorkbenchAgentLoopIfConfigured(
    run: WorkbenchRunRow,
    worktree: WorkbenchWorktreeRefPayload,
    suites: WorkbenchVerificationSuitePayload[],
  ): Promise<WorkbenchExecutionLoopResult> {
    return executeWorkbenchAgentLoopIfConfigured(this.agentLoopContext(), run, worktree, suites);
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
    normalizeRequired(input.principalId, "principalId");
    const runId = normalizeRequired(input.runId, "runId");
    const run = this.requireRun(runId);
    const updated = this.options.runs.update(runId, {
      status: "cancelled",
      currentStage: "report",
      approvalState: "rejected",
      finishedAt: this.now().toISOString(),
      lastErrorCode: "APPROVAL_REJECTED",
      lastErrorMessage: input.reason?.trim() || "Stage rejected by operator.",
    });
    return this.toRunPayload(updated ?? run);
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
    const runId = normalizeRequired(input.runId, "runId");
    this.requireRun(runId);
    return this.options.artifacts.listByRun(runId).map((row) => ({
      artifactId: row.artifact_id,
      runId: row.run_id,
      kind: row.kind,
      title: row.title,
      contentType: row.content_type,
      contentText: row.content_text,
      createdAt: row.created_at,
    }));
  }

  async getPolicy(
    _input: WorkbenchGetPolicyPayload & { principalId?: string } = {},
  ): Promise<WorkbenchPolicyPayload> {
    return this.toPolicyPayload(this.options.policy.get());
  }

  async updatePolicy(
    input: WorkbenchUpdatePolicyPayload & { principalId: string },
  ): Promise<WorkbenchPolicyPayload> {
    normalizeRequired(input.principalId, "principalId");
    const row = this.options.policy.set({
      defaultExecutionMode: input.defaultExecutionMode ? normalizeExecutionMode(input.defaultExecutionMode) : undefined,
      autonomousEnabled: input.autonomousEnabled,
      maxParallelRuns: input.maxParallelRuns,
      requireExplicitAutonomousOptIn: input.requireExplicitAutonomousOptIn,
      requireAiShippableForAutonomous: input.requireAiShippableForAutonomous,
    });
    return this.toPolicyPayload(row);
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
    try {
      updateCentralTaskFile(queueItem.taskFilePath, {
        status,
        updated: this.now().toISOString().slice(0, 10),
        owner: status === "in-progress" ? "agent" : undefined,
        claimedAt: status === "in-progress" ? this.now().toISOString() : undefined,
        claimExpiresAt: status === "in-progress" ? new Date(this.now().getTime() + 2 * 60 * 60 * 1000).toISOString() : undefined,
        logMessage,
        nowIso: this.now().toISOString(),
      });
    } catch (error) {
      this.logger?.warn("Failed to update central Workbench task status", {
        queueItemId: queueItem.queueItemId,
        taskFilePath: queueItem.taskFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    const result = spawnSync("git", ["-C", this.repoRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new WorkbenchServiceError("FAILED_PRECONDITION", `Repo root is not a git checkout: ${this.repoRoot}`);
    }
    return result.stdout.trim();
  }

  private allocateWorktree(
    queueItem: WorkbenchQueueItemPayload,
    runId: string,
  ): WorkbenchWorktreeRefPayload {
    const gitRoot = this.resolveGitRoot();
    const baseBranchName = this.resolveCurrentBranch(gitRoot);
    const slug = sanitizeSlug(queueItem.queueItemId.replace(/\.md$/i, ""));
    const branchName = `workbench/${slug}-${runId.slice(-8)}`;
    const worktreePath = resolve(this.worktreeParentRoot, `${slug}-${runId.slice(-8)}`);
    mkdirSync(dirname(worktreePath), { recursive: true });
    const result = spawnSync("git", ["-C", gitRoot, "worktree", "add", "-b", branchName, worktreePath, "HEAD"], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new WorkbenchServiceError(
        "FAILED_PRECONDITION",
        `Failed to allocate worktree for ${queueItem.queueItemId}: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return {
      path: worktreePath,
      branchName,
      baseBranchName,
      createdAt: this.now().toISOString(),
    };
  }

  private resolveCurrentBranch(gitRoot: string): string {
    const result = spawnSync("git", ["-C", gitRoot, "branch", "--show-current"], {
      encoding: "utf8",
    });
    const branchName = result.status === 0 ? result.stdout.trim() : "";
    return branchName || "main";
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
    return {
      batchId: row.batch_id,
      name: row.name,
      status: row.status,
      executionMode: row.execution_mode,
      queueItemIds: parseJsonArray(row.queue_item_ids_json),
      createdByPrincipalId: row.created_by_principal_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toRunPayload(row: WorkbenchRunRow): WorkbenchRunPayload {
    const queueItem = this.loadQueueItems().find((item) => item.queueItemId === row.queue_item_id);
    const parsedTask = queueItem ? null : tryParseTaskFile(row.queue_item_path);
    const verificationMode = queueItem?.verificationMode
      ?? parsedTask?.verificationMode
      ?? ((parseJson<WorkbenchVerificationSuitePayload[]>(row.verification_suites_json) ?? []).length > 0
        ? "machine_readable"
        : "review_only");
    const executionModeBlockers = queueItem?.executionModeBlockers
      ?? parsedTask?.executionModeBlockers
      ?? (verificationMode === "machine_readable" ? [] : ["No machine-readable verification declared."]);
    return {
      runId: row.run_id,
      batchId: row.batch_id ?? undefined,
      queueItemId: row.queue_item_id,
      queueItemPath: row.queue_item_path,
      status: row.status,
      currentStage: row.current_stage,
      executionMode: row.execution_mode,
      approvalState: row.approval_state,
      worktree: row.worktree_json ? parseJson<WorkbenchWorktreeRefPayload>(row.worktree_json) ?? undefined : undefined,
      touchedRepos: parseJson(row.touched_repos_json) ?? [],
      verificationMode,
      executionModeBlockers,
      verificationSuites: parseJson(row.verification_suites_json) ?? [],
      verificationResult: row.verification_result_json
        ? parseJson<WorkbenchVerificationResultPayload>(row.verification_result_json) ?? undefined
        : undefined,
      landingResult: row.landing_result_json
        ? parseJson<WorkbenchLandingResultPayload>(row.landing_result_json) ?? undefined
        : undefined,
      executionContext: row.execution_context_json
        ? parseJson<WorkbenchExecutionContextPayload>(row.execution_context_json) ?? undefined
        : undefined,
      createdByPrincipalId: row.created_by_principal_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at ?? undefined,
      finishedAt: row.finished_at ?? undefined,
      lastErrorCode: row.last_error_code || undefined,
      lastErrorMessage: row.last_error_message || undefined,
    };
  }

  private toPolicyPayload(row: WorkbenchPolicyRow): WorkbenchPolicyPayload {
    return {
      defaultExecutionMode: row.default_execution_mode,
      autonomousEnabled: row.autonomous_enabled === 1,
      maxParallelRuns: row.max_parallel_runs,
      requireExplicitAutonomousOptIn: row.require_explicit_autonomous_opt_in === 1,
      requireAiShippableForAutonomous: row.require_ai_shippable_for_autonomous === 1,
      updatedAt: row.updated_at,
    };
  }
}
