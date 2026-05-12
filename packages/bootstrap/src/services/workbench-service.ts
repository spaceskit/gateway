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
  buildGeneratedDocsKnowledgeArtifact,
  runWorkbenchDocsPreflight,
} from "./workbench-docs-evidence.js";
import {
  centralTasksRoot,
  extractNextAction,
  itemsConflict,
  loadCentralTasks,
  resolvePlanningRepoRoot,
  tryParseTaskFile,
  updateCentralTaskFile,
  type CentralTaskRecord,
} from "./workbench-task-metadata.js";
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
  WORKBENCH_IMPLEMENTATION_AGENTS,
  WORKBENCH_IMPLEMENTATION_AGENT_IDS,
  WORKBENCH_PLANNING_AGENTS,
  WORKBENCH_PLANNING_AGENT_IDS,
  WorkbenchServiceError,
  initialRunStateForMode,
  isWorkbenchAgentTurnPaused,
  modePatchForRun,
  normalizeExecutionMode,
  normalizeLimit,
  normalizeQueueItemIds,
  normalizeRequired,
  parseJson,
  parseJsonArray,
  sanitizeSlug,
  type WorkbenchAgentTurnPaused,
} from "./workbench-service-normalizers.js";

export { WorkbenchServiceError } from "./workbench-service-normalizers.js";

interface WorkbenchExecutionLoopResult {
  row: WorkbenchRunRow;
  continueToVerification: boolean;
}

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

  private async executeWorkbenchAgentLoopIfConfigured(
    run: WorkbenchRunRow,
    worktree: WorkbenchWorktreeRefPayload,
    suites: WorkbenchVerificationSuitePayload[],
  ): Promise<WorkbenchExecutionLoopResult> {
    if (!this.options.spaceAdminService || !this.options.spaceManager) {
      return { row: run, continueToVerification: true };
    }

    const existingContext = run.execution_context_json
      ? parseJson<WorkbenchExecutionContextPayload>(run.execution_context_json)
      : null;
    if (existingContext?.implementationTurnId) {
      return { row: run, continueToVerification: true };
    }

    const queueItem = this.resolveQueueItems([run.queue_item_id])[0]!;
    const spaceName = `Workbench: ${queueItem.queueItemId}`;
    let executionContext: WorkbenchExecutionContextPayload | null = existingContext;

    try {
      const space = await this.options.spaceAdminService.createSpace({
        idempotencyKey: `${run.run_id}:execution-space`,
        resourceId: worktree.path,
        name: spaceName,
        goal: `Execute Workbench run ${run.run_id} for ${queueItem.queueItemId}.`,
        templateId: "workbench/execution-loop",
        turnModel: "sequential_all",
        conversationTopology: "shared_team_chat",
        visibility: "shared",
        turnModelConfig: {
          strategy: "sequential_all",
          masterModeEnabled: false,
          peerReviewEnabled: true,
        },
        initialAgents: [
          ...WORKBENCH_PLANNING_AGENTS,
          ...WORKBENCH_IMPLEMENTATION_AGENTS,
        ],
      });

      executionContext = {
        spaceId: space.id,
        spaceUid: space.spaceUid,
        spaceName: space.name,
        stage: "planning",
      };
      let row = this.options.runs.update(run.run_id, {
        status: "running",
        currentStage: "plan",
        executionContextJson: JSON.stringify(executionContext),
        verificationResultJson: JSON.stringify({
          status: "pending",
          summary: "Planning agents are discussing the Workbench run.",
        } satisfies WorkbenchVerificationResultPayload),
      }) ?? run;

      const planningTurnId = await this.executeWorkbenchTurn({
        spaceId: space.id,
        input: this.buildPlanningPrompt(queueItem, worktree, suites),
        expectedAgentCount: this.countAssignedAgents(space, WORKBENCH_PLANNING_AGENT_IDS),
        executionIdentity: {
          principalId: run.created_by_principal_id,
          executionOrigin: "system",
          mode: "plan",
          effort: "high",
          conversationTopology: "broadcast_team",
          targetAgentIds: WORKBENCH_PLANNING_AGENT_IDS,
        },
        stage: "planning",
      });
      executionContext = {
        ...executionContext,
        planningTurnId,
        stage: "implementation",
      };
      this.persistAgentPlanningArtifact(run.run_id, executionContext, queueItem);
      row = this.options.runs.update(run.run_id, {
        currentStage: "execute",
        executionContextJson: JSON.stringify(executionContext),
        verificationResultJson: JSON.stringify({
          status: "pending",
          summary: "Implementation agents are editing the allocated Workbench worktree.",
        } satisfies WorkbenchVerificationResultPayload),
      }) ?? row;

      const implementationTurnId = await this.executeWorkbenchTurn({
        spaceId: space.id,
        input: this.buildImplementationPrompt(queueItem, worktree, suites, planningTurnId),
        expectedAgentCount: this.countAssignedAgents(space, WORKBENCH_IMPLEMENTATION_AGENT_IDS),
        executionIdentity: {
          principalId: run.created_by_principal_id,
          executionOrigin: "system",
          mode: "execute",
          effort: "high",
          conversationTopology: "shared_team_chat",
          targetAgentIds: WORKBENCH_IMPLEMENTATION_AGENT_IDS,
          replyToTurnId: planningTurnId,
        },
        stage: "implementation",
      });
      executionContext = {
        ...executionContext,
        implementationTurnId,
        stage: "verification",
      };
      row = this.options.runs.update(run.run_id, {
        currentStage: "execute",
        executionContextJson: JSON.stringify(executionContext),
      }) ?? row;
      return { row, continueToVerification: true };
    } catch (error) {
      if (isWorkbenchAgentTurnPaused(error)) {
        const pausedContext = {
          ...(executionContext ?? {
            spaceId: "",
            spaceName: spaceName,
          }),
          stage: "paused" as const,
          ...(error.stage === "planning" ? { planningTurnId: error.turnId } : {}),
          ...(error.stage === "implementation" ? { implementationTurnId: error.turnId } : {}),
        };
        const row = this.options.runs.update(run.run_id, {
          status: "running",
          currentStage: error.stage === "planning" ? "plan" : "execute",
          executionContextJson: JSON.stringify(pausedContext),
          verificationResultJson: JSON.stringify({
            status: "pending",
            summary: `Agent turn paused for approval or input: ${error.reason}`,
          } satisfies WorkbenchVerificationResultPayload),
        }) ?? run;
        this.persistAgentLoopReportArtifact(run.run_id, "paused", error.reason);
        return { row, continueToVerification: false };
      }

      const message = error instanceof Error ? error.message : String(error);
      const failedContext = executionContext
        ? { ...executionContext, stage: "failed" as const }
        : undefined;
      const row = this.options.runs.update(run.run_id, {
        status: "failed",
        currentStage: "report",
        finishedAt: this.now().toISOString(),
        executionContextJson: failedContext ? JSON.stringify(failedContext) : undefined,
        lastErrorCode: "AGENT_TURN_FAILED",
        lastErrorMessage: message,
        verificationResultJson: JSON.stringify({
          status: "failed",
          summary: `Agent execution failed before verification: ${message}`,
        } satisfies WorkbenchVerificationResultPayload),
        landingResultJson: JSON.stringify({
          status: "blocked",
          summary: "Automatic landing is not enabled for this Workbench executor slice.",
          completedAt: this.now().toISOString(),
        } satisfies WorkbenchLandingResultPayload),
      }) ?? run;
      const queueItem = this.resolveQueueItems([run.queue_item_id])[0];
      if (queueItem) {
        this.updateCentralTaskStatus(queueItem, "blocked", `Workbench run ${run.run_id} failed before verification: ${message}`);
      }
      this.persistAgentLoopReportArtifact(run.run_id, "failed", message);
      return { row, continueToVerification: false };
    }
  }

  private async executeWorkbenchTurn(input: {
    spaceId: string;
    input: string;
    expectedAgentCount: number;
    executionIdentity: TurnExecutionIdentity;
    stage: Extract<WorkbenchExecutionContextStagePayload, "planning" | "implementation">;
  }): Promise<string> {
    const result = await this.options.spaceManager!.executeTurn(
      input.spaceId,
      input.input,
      undefined,
      input.executionIdentity,
    );
    await this.waitForWorkbenchTurn(input.spaceId, result.turnId, input.stage, input.expectedAgentCount);
    return result.turnId;
  }

  private async waitForWorkbenchTurn(
    spaceId: string,
    turnId: string,
    stage: Extract<WorkbenchExecutionContextStagePayload, "planning" | "implementation">,
    expectedAgentCount: number,
  ): Promise<void> {
    const eventBus = this.options.eventBus;
    if (!eventBus) return;

    await new Promise<void>((resolve, reject) => {
      let unsubscribeOrchestrator: (() => void) | undefined;
      let unsubscribeTurn: (() => void) | undefined;
      const completedAgentIds = new Set<string>();
      let anonymousCompletionCount = 0;
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribeOrchestrator?.();
        unsubscribeTurn?.();
      };
      const finish = (error?: unknown) => {
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        finish(new Error(`Timed out waiting for ${stage} turn ${turnId} to complete.`));
      }, this.agentTurnCompletionTimeoutMs);

      unsubscribeOrchestrator = eventBus.on("space.orchestrator_event", (event) => {
        const typed = event as { spaceId?: string; turnId?: string; status?: string; eventType?: string };
        if (typed.spaceId !== spaceId || typed.turnId !== turnId) return;
        if (typed.status === "completed" || typed.eventType === "summary.completed") {
          finish();
          return;
        }
        if (typed.status === "failed" || typed.eventType === "summary.failed") {
          finish(new Error(`${stage} turn ${turnId} failed.`));
        }
      });

      unsubscribeTurn = eventBus.on("space.turn_event", (event) => {
        const typed = event as { spaceId?: string; turnId?: string; event?: { type?: string; request?: { description?: string }; error?: { message?: string } } };
        if (typed.spaceId !== spaceId || typed.turnId !== turnId) return;
        const eventType = typed.event?.type;
        if (eventType === "feedback_requested") {
          finish({
            kind: "paused",
            stage,
            turnId,
            reason: typed.event?.request?.description ?? "Agent requested approval or input.",
          } satisfies WorkbenchAgentTurnPaused);
          return;
        }
        if (eventType === "error") {
          finish(new Error(typed.event?.error?.message ?? `${stage} turn ${turnId} failed.`));
          return;
        }
        if (eventType === "turn_completed") {
          const agentId = (event as { agentId?: string }).agentId?.trim();
          if (agentId) {
            completedAgentIds.add(agentId);
          } else {
            anonymousCompletionCount += 1;
          }
          if (completedAgentIds.size + anonymousCompletionCount >= Math.max(1, expectedAgentCount)) {
            finish();
          }
        }
      });
    });
  }

  private countAssignedAgents(space: SpaceConfig, agentIds: string[]): number {
    const assigned = new Set(space.agents.map((agent) => agent.agentId));
    return Math.max(1, agentIds.filter((agentId) => assigned.has(agentId)).length);
  }

  private buildPlanningPrompt(
    queueItem: WorkbenchQueueItemPayload,
    worktree: WorkbenchWorktreeRefPayload,
    suites: WorkbenchVerificationSuitePayload[],
  ): string {
    return [
      "# Workbench Planning Discussion",
      "",
      `Task file: ${queueItem.taskFilePath}`,
      `Allocated worktree: ${worktree.path}`,
      `Queue item: ${queueItem.queueItemId}`,
      "",
      "Discuss the implementation plan, risks, and verification approach. Produce a concise plan artifact for the implementation team.",
      "",
      "Verification commands:",
      ...suites.map((suite) => `- ${suite.command}`),
    ].join("\n");
  }

  private buildImplementationPrompt(
    queueItem: WorkbenchQueueItemPayload,
    worktree: WorkbenchWorktreeRefPayload,
    suites: WorkbenchVerificationSuitePayload[],
    planningTurnId: string,
  ): string {
    return [
      "# Workbench Implementation Turn",
      "",
      `Task file: ${queueItem.taskFilePath}`,
      `Allocated worktree: ${worktree.path}`,
      `Planning turn: ${planningTurnId}`,
      "",
      "Edit only the allocated Workbench worktree. Do not modify the source checkout outside that path.",
      "Follow the task file and the planning discussion. Work autonomously within the existing review gate; do not merge or land changes.",
      "",
      "Verification commands Workbench will run after this turn completes:",
      ...suites.map((suite) => `- ${suite.command}`),
    ].join("\n");
  }

  private persistAgentPlanningArtifact(
    runId: string,
    executionContext: WorkbenchExecutionContextPayload,
    queueItem: WorkbenchQueueItemPayload,
  ): void {
    this.options.artifacts.create({
      artifactId: `wb-artifact-${randomUUID()}`,
      runId,
      kind: "plan",
      title: "Agent Planning Turn",
      contentType: "text/markdown",
      contentText: [
        "# Agent Planning Turn",
        "",
        `- Execution Space: \`${executionContext.spaceName}\``,
        `- Space ID: \`${executionContext.spaceId}\``,
        `- Planning turn: \`${executionContext.planningTurnId ?? ""}\``,
        `- Queue item: \`${queueItem.queueItemId}\``,
      ].join("\n"),
    });
  }

  private persistAgentLoopReportArtifact(
    runId: string,
    status: "paused" | "failed",
    reason: string,
  ): void {
    this.options.artifacts.create({
      artifactId: `wb-artifact-${randomUUID()}`,
      runId,
      kind: "report",
      title: status === "paused" ? "Agent Turn Paused" : "Agent Turn Failed",
      contentType: "text/markdown",
      contentText: [
        `# Agent Turn ${status === "paused" ? "Paused" : "Failed"}`,
        "",
        `- Status: \`${status}\``,
        `- Reason: ${reason}`,
      ].join("\n"),
    });
  }

  private persistVerificationLog(
    runId: string,
    suite: WorkbenchVerificationSuitePayload,
    evidence: WorkbenchCommandEvidence,
  ): string {
    const artifactId = `wb-artifact-${randomUUID()}`;
    this.options.artifacts.create({
      artifactId,
      runId,
      kind: "verification_log",
      title: `${suite.name} Log`,
      contentType: "text/plain",
      contentText: [
        `$ ${evidence.command}`,
        ``,
        `status: ${evidence.status}`,
        `exitCode: ${evidence.exitCode ?? "null"}`,
        `durationMs: ${evidence.durationMs}`,
        `timedOut: ${evidence.timedOut}`,
        ``,
        `# stdout`,
        evidence.stdout || "(empty)",
        ``,
        `# stderr`,
        evidence.stderr || "(empty)",
      ].join("\n"),
    });
    return artifactId;
  }

  private async persistDocsPreflightArtifact(runId: string, worktreePath: string): Promise<void> {
    const preflight = await runWorkbenchDocsPreflight({
      worktreePath,
      timeoutMs: this.verificationCommandTimeoutMs,
      now: this.now,
      verificationExecutor: this.verificationExecutor,
    });
    if (!preflight.check) {
      this.options.artifacts.create({
        artifactId: `wb-artifact-${randomUUID()}`,
        runId,
        kind: "docs",
        title: "Docs Freshness Preflight",
        contentType: "text/markdown",
        contentText: [
          "# Docs Freshness Preflight",
          "",
          "- Status: `not_available`",
          "- Command: `bun run docs:check`",
          "- Blocking: `false`",
        ].join("\n"),
      });
      return;
    }

    const evidence = preflight.evidence!;
    this.options.artifacts.create({
      artifactId: `wb-artifact-${randomUUID()}`,
      runId,
      kind: "docs",
      title: "Docs Freshness Preflight",
      contentType: "text/markdown",
      contentText: [
        "# Docs Freshness Preflight",
        "",
        `- Status: \`${preflight.status}\``,
        `- Command: \`${preflight.check.displayCommand}\``,
        `- Exit code: \`${evidence.exitCode ?? "null"}\``,
        `- Duration: \`${evidence.durationMs}ms\``,
        `- Timed out: \`${evidence.timedOut}\``,
        "- Blocking: `false`",
        "",
        "## stdout",
        "```text",
        evidence.stdout || "(empty)",
        "```",
        "",
        "## stderr",
        "```text",
        evidence.stderr || "(empty)",
        "```",
      ].join("\n"),
    });
  }

  private persistGeneratedDocsKnowledgeArtifact(runId: string, worktreePath: string): void {
    this.options.artifacts.create({
      artifactId: `wb-artifact-${randomUUID()}`,
      runId,
      kind: "knowledge",
      title: "Attached Generated Docs Knowledge",
      contentType: "text/markdown",
      contentText: buildGeneratedDocsKnowledgeArtifact(worktreePath),
    });
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
    const itemsById = new Map(this.loadQueueItems().map((item) => [item.queueItemId, item]));
    return queueItemIds.map((queueItemId) => {
      const item = itemsById.get(queueItemId);
      if (!item) {
        throw new WorkbenchServiceError("NOT_FOUND", `Workbench queue item not found: ${queueItemId}`);
      }
      return item;
    });
  }

  private loadQueueItems(): WorkbenchQueueItemPayload[] {
    const tasks = this.loadCentralTasks();
    const items: WorkbenchQueueItemPayload[] = [];
    for (const [index, task] of tasks.entries()) {
      const taskMetadata = task.metadata;
      items.push({
        queueItemId: taskMetadata.id,
        queueIndex: index + 1,
        title: taskMetadata.title,
        type: task.frontmatter.get("spaces-item-type") ?? taskMetadata.priority ?? "task",
        status: taskMetadata.status,
        nextAction: taskMetadata.summary ?? extractNextAction(task.body) ?? taskMetadata.title,
        taskFilePath: task.path,
        delegation: taskMetadata.delegation,
        parallelKeys: taskMetadata.parallelKeys,
        aiShippable: taskMetadata.aiShippable,
        executionModeEligibility: {
          supervised: true,
          autonomous: taskMetadata.executionModeBlockers.length === 0,
        },
        verificationMode: taskMetadata.verificationMode,
        executionModeBlockers: taskMetadata.executionModeBlockers,
        products: taskMetadata.products,
        verificationCommands: taskMetadata.verificationCommands,
      } satisfies WorkbenchQueueItemPayload);
    }
    return items;
  }

  private loadCentralTasks(): CentralTaskRecord[] {
    return loadCentralTasks(this.workProjectsRoot, this.workbenchProjectSlug, this.now(), this.logger);
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
    for (let index = 0; index < items.length; index += 1) {
      for (let inner = index + 1; inner < items.length; inner += 1) {
        if (itemsConflict(items[index]!, items[inner]!)) {
          throw new WorkbenchServiceError(
            "FAILED_PRECONDITION",
            `Queue items conflict and cannot share a batch: ${items[index]!.queueItemId} vs ${items[inner]!.queueItemId}`,
          );
        }
      }
    }
  }

  private assertNoActiveRunConflict(queueItem: WorkbenchQueueItemPayload): void {
    const activeRuns = this.options.runs.listActive();
    const activeQueueItemIds = Array.from(new Set(activeRuns.map((row) => row.queue_item_id)));
    const activeItems = activeQueueItemIds.length > 0 ? this.resolveQueueItems(activeQueueItemIds) : [];
    const conflict = activeItems.find((item) => itemsConflict(queueItem, item));
    if (conflict) {
      throw new WorkbenchServiceError(
        "FAILED_PRECONDITION",
        `Queue item conflicts with active run: ${queueItem.queueItemId} vs ${conflict.queueItemId}`,
      );
    }
  }

  private assertParallelCapacity(policy: WorkbenchPolicyRow): void {
    const activeRuns = this.options.runs.listActive();
    if (activeRuns.length >= policy.max_parallel_runs) {
      throw new WorkbenchServiceError(
        "FAILED_PRECONDITION",
        `Workbench is at max parallel capacity (${policy.max_parallel_runs})`,
      );
    }
  }

  private assertAutonomousEligibility(
    queueItem: WorkbenchQueueItemPayload,
    policy: WorkbenchPolicyRow,
  ): void {
    if (!policy.autonomous_enabled) {
      throw new WorkbenchServiceError("FAILED_PRECONDITION", "Autonomous execution is disabled by policy");
    }
    if (policy.require_ai_shippable_for_autonomous && !queueItem.aiShippable) {
      throw new WorkbenchServiceError("FAILED_PRECONDITION", `Queue item is not AI-shippable: ${queueItem.queueItemId}`);
    }
    if (queueItem.delegation !== "autonomous") {
      throw new WorkbenchServiceError("FAILED_PRECONDITION", `Queue item does not allow autonomous execution: ${queueItem.queueItemId}`);
    }
    const centralBlocker = queueItem.executionModeBlockers.find((blocker) =>
      blocker.startsWith("Task status is ")
      || blocker.startsWith("Unmet dependencies:")
      || blocker === "Task has an active unexpired claim.");
    if (centralBlocker) {
      throw new WorkbenchServiceError("FAILED_PRECONDITION", centralBlocker);
    }
    if (queueItem.verificationMode !== "machine_readable") {
      throw new WorkbenchServiceError(
        "FAILED_PRECONDITION",
        queueItem.executionModeBlockers.find((blocker) =>
          blocker.includes("machine-readable verification"))
          ?? `Queue item requires review-only execution: ${queueItem.queueItemId}`,
      );
    }
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
    const queuePath = centralTasksRoot(this.workProjectsRoot, this.workbenchProjectSlug);
    this.options.artifacts.create({
      artifactId: `wb-artifact-${randomUUID()}`,
      runId: row.run_id,
      kind: "plan",
      title: "Execution Plan",
      contentType: "text/markdown",
      contentText: [
        `# Workbench Plan`,
        ``,
        `- Queue item: \`${queueItem.queueItemId}\``,
        `- Task file: \`${queueItem.taskFilePath}\``,
        `- Queue source: \`${queuePath}\``,
        `- Requested mode: \`${executionMode}\``,
        `- Next action: ${queueItem.nextAction}`,
      ].join("\n"),
    });
    this.options.artifacts.create({
      artifactId: `wb-artifact-${randomUUID()}`,
      runId: row.run_id,
      kind: "verification",
      title: "Verification Suites",
      contentType: "text/markdown",
      contentText: [
        `# Verification`,
        ``,
        `- Mode: \`${queueItem.verificationMode}\``,
        ...queueItem.executionModeBlockers.map((blocker) => `- Blocker: ${blocker}`),
        ...verificationSuites.map((suite) => `- [${suite.status}] \`${suite.command}\``),
        ...(verificationSuites.length === 0 ? ["- No machine-readable verification commands declared."] : []),
      ].join("\n"),
    });
    this.options.artifacts.create({
      artifactId: `wb-artifact-${randomUUID()}`,
      runId: row.run_id,
      kind: "report",
      title: "Run Report",
      contentType: "text/markdown",
      contentText: [
        `# Run Report`,
        ``,
        `- Run ID: \`${row.run_id}\``,
        `- Stage: \`${row.current_stage}\``,
        `- Status: \`${row.status}\``,
        `- Worktree: \`${worktree.path}\``,
        `- Branch: \`${worktree.branchName}\``,
      ].join("\n"),
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
