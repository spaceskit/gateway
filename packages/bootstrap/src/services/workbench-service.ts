import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
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
  type WorkbenchApprovalState,
  type WorkbenchBatchRow,
  type WorkbenchExecutionMode,
  type WorkbenchPolicyRow,
  type WorkbenchRunRow,
  type WorkbenchRunStage,
  type WorkbenchRunStatus,
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
  WorkbenchVerificationModePayload,
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
  validateGoalContractMarkdown,
  type GoalContractIssue,
} from "./planning-goal-contract.js";

type WorkbenchServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED";

interface ParsedTaskMetadata {
  title: string;
  delegation: string;
  hasExplicitDelegationMetadata: boolean;
  parallelKeys: string[];
  aiShippable: boolean;
  hasExplicitAiShippableMetadata: boolean;
  products: string[];
  verificationMode: WorkbenchVerificationModePayload;
  verificationCommands: string[];
  executionModeBlockers: string[];
  malformedVerificationBlock: boolean;
  verificationBlockerMessage?: string;
  goalContractErrors: GoalContractIssue[];
  goalContractWarnings: GoalContractIssue[];
}

type WorkbenchExecutionAgent = NonNullable<CreateSpaceInput["initialAgents"]>[number];

interface WorkbenchAgentTurnPaused {
  kind: "paused";
  stage: Extract<WorkbenchExecutionContextStagePayload, "planning" | "implementation">;
  turnId: string;
  reason: string;
}

interface WorkbenchExecutionLoopResult {
  row: WorkbenchRunRow;
  continueToVerification: boolean;
}

const WORKBENCH_PLANNING_AGENTS: WorkbenchExecutionAgent[] = [
  { agentId: "plan-coordinator", profileId: "plan-coordinator-opus", role: "global_coordinator", isPrimary: true, turnOrder: 0 },
  { agentId: "plan-codex-architect", profileId: "plan-codex-architect", role: "participant", isPrimary: false, turnOrder: 1 },
  { agentId: "plan-opus-reviewer", profileId: "plan-opus-reviewer", role: "participant", isPrimary: false, turnOrder: 2 },
  { agentId: "plan-gemini-constraints", profileId: "plan-gemini-constraints", role: "participant", isPrimary: false, turnOrder: 3 },
  { agentId: "plan-lmstudio-maintainer", profileId: "plan-lmstudio-maintainer", role: "participant", isPrimary: false, turnOrder: 4 },
  { agentId: "plan-apple-continuity", profileId: "plan-apple-continuity", role: "participant", isPrimary: false, turnOrder: 5 },
];

const WORKBENCH_IMPLEMENTATION_AGENTS: WorkbenchExecutionAgent[] = [
  { agentId: "code-lead", profileId: "code-lead-codex", role: "global_coordinator", isPrimary: true, turnOrder: 6 },
  { agentId: "code-opus-reviewer", profileId: "code-opus-reviewer", role: "participant", isPrimary: false, turnOrder: 7 },
  { agentId: "code-gemini-integrator", profileId: "code-gemini-integrator", role: "participant", isPrimary: false, turnOrder: 8 },
  { agentId: "code-lmstudio-maintainer", profileId: "code-lmstudio-maintainer", role: "participant", isPrimary: false, turnOrder: 9 },
  { agentId: "code-apple-continuity", profileId: "code-apple-continuity", role: "participant", isPrimary: false, turnOrder: 10 },
];

const WORKBENCH_PLANNING_AGENT_IDS = WORKBENCH_PLANNING_AGENTS.map((agent) => agent.agentId);
const WORKBENCH_IMPLEMENTATION_AGENT_IDS = WORKBENCH_IMPLEMENTATION_AGENTS.map((agent) => agent.agentId);

export interface WorkbenchPlanningAuditIssue {
  queueIndex?: number;
  queueItemId: string;
  taskFilePath?: string;
  message: string;
  code?: string;
}

export interface WorkbenchPlanningAuditReport {
  repoRoot: string;
  queuePath: string;
  executableQueueItemCount: number;
  nonExecutableRows: WorkbenchPlanningAuditIssue[];
  missingMachineReadableVerification: WorkbenchPlanningAuditIssue[];
  malformedVerificationBlocks: WorkbenchPlanningAuditIssue[];
  goalContractErrors: WorkbenchPlanningAuditIssue[];
  goalContractWarnings: WorkbenchPlanningAuditIssue[];
}

export interface WorkbenchOpenBacklogAuditReport extends WorkbenchPlanningAuditReport {
  openTaskCount: number;
  unqueuedOpenTasks: WorkbenchPlanningAuditIssue[];
  missingExplicitDelegationMetadata: WorkbenchPlanningAuditIssue[];
  missingExplicitAiShippableMetadata: WorkbenchPlanningAuditIssue[];
}

export class WorkbenchServiceError extends Error {
  readonly code: WorkbenchServiceErrorCode;

  constructor(code: WorkbenchServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WorkbenchServiceOptions {
  batches: WorkbenchBatchRepository;
  runs: WorkbenchRunRepository;
  artifacts: WorkbenchArtifactRepository;
  policy: WorkbenchPolicyRepository;
  repoRoot: string;
  logger?: Logger;
  now?: () => Date;
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
  private readonly worktreeParentRoot: string;
  private readonly verificationCommandTimeoutMs: number;
  private readonly verificationExecutor: (options: RunWorkbenchCommandOptions) => Promise<WorkbenchCommandEvidence>;
  private readonly agentTurnCompletionTimeoutMs: number;

  constructor(private readonly options: WorkbenchServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? null;
    this.repoRoot = resolvePlanningRepoRoot(resolve(options.repoRoot), this.logger);
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
    const queuePath = join(this.repoRoot, "_planning", "WHAT-TO-DO-NEXT.md");
    if (!existsSync(queuePath)) {
      this.logger?.warn("Workbench queue file not found", { queuePath });
      return [];
    }
    const markdown = readFileSync(queuePath, "utf8");
    const taskPaths = this.indexTaskFiles();
    const items: WorkbenchQueueItemPayload[] = [];
    for (const row of parseQueueTable(markdown)) {
      const taskFilePath = taskPaths.get(row.item.toLowerCase());
      if (!taskFilePath) {
        this.logger?.warn("Skipping non-executable workbench queue row", {
          queueItemId: row.item,
          queueIndex: row.queueIndex,
          queuePath,
        });
        continue;
      }
      const taskMetadata = parseTaskFile(taskFilePath);
      items.push({
        queueItemId: row.item,
        queueIndex: row.queueIndex,
        title: taskMetadata.title,
        type: row.type,
        status: row.status,
        nextAction: row.nextAction,
        taskFilePath,
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

  private indexTaskFiles(): Map<string, string> {
    return indexTaskFiles(this.repoRoot);
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
    const queuePath = join(this.repoRoot, "_planning", "WHAT-TO-DO-NEXT.md");
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

function parseQueueTable(markdown: string): Array<{
  queueIndex: number;
  item: string;
  type: string;
  status: string;
  nextAction: string;
}> {
  const activeSection = extractSection(markdown, "Active Queue");
  if (!activeSection) return [];
  const rows = activeSection
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line));

  return rows.map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 5) {
      throw new WorkbenchServiceError("FAILED_PRECONDITION", `Malformed active queue row: ${line}`);
    }
    const queueIndex = Number.parseInt(cells[0]!, 10);
    const item = stripCodeTicks(cells[1]!);
    return {
      queueIndex,
      item,
      type: cells[2]!,
      status: cells[3]!,
      nextAction: cells[4]!,
    };
  });
}

function isWorkbenchAgentTurnPaused(value: unknown): value is WorkbenchAgentTurnPaused {
  if (!value || typeof value !== "object") return false;
  const candidate = value as WorkbenchAgentTurnPaused;
  return candidate.kind === "paused"
    && (candidate.stage === "planning" || candidate.stage === "implementation")
    && typeof candidate.turnId === "string"
    && typeof candidate.reason === "string";
}

function parseTaskFile(taskFilePath: string): ParsedTaskMetadata {
  const content = readFileSync(taskFilePath, "utf8");
  const metadata = collectMetadata(content);
  const title = extractTaskTitle(content) ?? basename(taskFilePath, ".md");
  const products = splitMetadataList(metadata.get("products"));
  const parallelKeys = splitMetadataList(metadata.get("parallel"));
  const verification = extractMachineReadableVerification(content);
  const hasExplicitDelegationMetadata = metadata.has("delegation");
  const hasExplicitAiShippableMetadata = metadata.has("ai-shippable") || metadata.has("ai shippable");
  const delegation = (metadata.get("delegation") ?? "supervised").trim().toLowerCase();
  const aiShippable = (metadata.get("ai-shippable") ?? metadata.get("ai shippable") ?? "no").trim().toLowerCase() === "yes";
  const goalContract = validateGoalContractMarkdown({
    markdown: content,
    expectedGoalId: basename(taskFilePath, ".md"),
    metadata: {
      owner: metadata.get("owner"),
      status: metadata.get("status"),
      delegation,
      aiShippable,
      products,
    },
    verificationCommands: verification.commands,
  });
  const executionModeBlockers = collectExecutionModeBlockers({
    delegation,
    aiShippable,
    verificationMode: verification.mode,
    verificationBlockerMessage: verification.blockerMessage,
  }).concat(goalContract.errors.map((issue) => `Goal contract: ${issue.message}`));
  return {
    title,
    delegation,
    hasExplicitDelegationMetadata,
    parallelKeys: parallelKeys.length > 0 ? parallelKeys : products,
    aiShippable,
    hasExplicitAiShippableMetadata,
    products,
    verificationMode: verification.mode,
    verificationCommands: verification.commands,
    executionModeBlockers,
    malformedVerificationBlock: verification.malformed,
    verificationBlockerMessage: verification.blockerMessage,
    goalContractErrors: goalContract.errors,
    goalContractWarnings: goalContract.warnings,
  };
}

function collectMetadata(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split("\n")) {
    const bullet = line.match(/^\s*-\s+([^:]+):\s*(.+)\s*$/);
    if (bullet) {
      result.set(normalizeMetadataKey(bullet[1]!), bullet[2]!.trim());
      continue;
    }
    const bold = line.match(/^\s*\*\*([^*]+)\*\*:\s*(.+)\s*$/);
    if (bold) {
      result.set(normalizeMetadataKey(bold[1]!), bold[2]!.trim());
    }
  }
  return result;
}

function normalizeMetadataKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractTaskTitle(content: string): string | null {
  const match = content.match(/^#\s+(?:Task:\s+)?(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function extractMachineReadableVerification(content: string): {
  mode: WorkbenchVerificationModePayload;
  commands: string[];
  malformed: boolean;
  blockerMessage?: string;
} {
  const section = extractSection(content, "Verification Commands (Machine-Readable)");
  if (!section) {
    return {
      mode: "review_only",
      commands: [],
      malformed: false,
      blockerMessage: "No machine-readable verification declared.",
    };
  }
  const commands = section
    .split("\n")
    .map((line) => line.match(/^\s*\d+\.\s+`([^`]+)`/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => match[1]!);
  if (commands.length === 0) {
    return {
      mode: "review_only",
      commands: [],
      malformed: true,
      blockerMessage: "Machine-readable verification block is malformed.",
    };
  }
  return {
    mode: "machine_readable",
    commands,
    malformed: false,
  };
}

function extractSection(content: string, headingTitle: string): string | null {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("## ") && line.slice(3).trim() === headingTitle);
  if (headingIndex === -1) return null;
  const sectionLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("## ")) break;
    sectionLines.push(line);
  }
  return sectionLines.join("\n").trim() || null;
}

function collectExecutionModeBlockers(input: {
  delegation: string;
  aiShippable: boolean;
  verificationMode: WorkbenchVerificationModePayload;
  verificationBlockerMessage?: string;
}): string[] {
  const blockers: string[] = [];
  if (!input.aiShippable) {
    blockers.push("AI-Shippable is not set to yes.");
  }
  if (input.delegation !== "autonomous") {
    blockers.push("Delegation is not autonomous.");
  }
  if (input.verificationMode !== "machine_readable") {
    blockers.push(input.verificationBlockerMessage ?? "No machine-readable verification declared.");
  }
  return blockers;
}

function tryParseTaskFile(taskFilePath: string): ParsedTaskMetadata | null {
  if (!existsSync(taskFilePath)) return null;
  try {
    return parseTaskFile(taskFilePath);
  } catch {
    return null;
  }
}

function splitMetadataList(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[|,]/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function walkMarkdownFiles(root: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function itemsConflict(left: WorkbenchQueueItemPayload, right: WorkbenchQueueItemPayload): boolean {
  if (left.queueItemId === right.queueItemId) return true;
  if (left.parallelKeys.includes("independent") || right.parallelKeys.includes("independent")) {
    return false;
  }
  const leftKeys = left.parallelKeys.length > 0 ? left.parallelKeys : left.products;
  const rightKeys = right.parallelKeys.length > 0 ? right.parallelKeys : right.products;
  return leftKeys.some((key) => rightKeys.includes(key));
}

function modePatchForRun(executionMode: WorkbenchExecutionMode) {
  if (executionMode === "supervised") {
    return {
      executionMode,
      status: "awaiting_review" as WorkbenchRunStatus,
      currentStage: "review_gate" as WorkbenchRunStage,
      approvalState: "pending" as WorkbenchApprovalState,
    };
  }
  return {
    executionMode,
    status: "queued" as WorkbenchRunStatus,
    currentStage: "execute" as WorkbenchRunStage,
    approvalState: "not_required" as WorkbenchApprovalState,
  };
}

function initialRunStateForMode(executionMode: WorkbenchExecutionMode): {
  status: WorkbenchRunStatus;
  currentStage: WorkbenchRunStage;
  approvalState: WorkbenchApprovalState;
} {
  return modePatchForRun(executionMode);
}

function normalizeRequired(value: string | undefined | null, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new WorkbenchServiceError("INVALID_ARGUMENT", `${fieldName} is required`);
  }
  return normalized;
}

function normalizeQueueItemIds(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    throw new WorkbenchServiceError("INVALID_ARGUMENT", "queueItemIds is required");
  }
  return Array.from(new Set(values.map((value) => normalizeRequired(value, "queueItemId"))));
}

function normalizeExecutionMode(value: string): WorkbenchExecutionMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "supervised" || normalized === "autonomous") {
    return normalized;
  }
  throw new WorkbenchServiceError("INVALID_ARGUMENT", `Unsupported executionMode: ${value}`);
}

function normalizeLimit(limit: number, fallback = 100): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function stripCodeTicks(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseJsonArray(raw: string): string[] {
  const value = parseJson<unknown>(raw);
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function auditWorkbenchPlanningRepo(
  startPath: string,
  logger: Logger | null = null,
): WorkbenchPlanningAuditReport {
  const repoRoot = resolvePlanningRepoRoot(resolve(startPath), logger);
  const queuePath = join(repoRoot, "_planning", "WHAT-TO-DO-NEXT.md");
  if (!existsSync(queuePath)) {
    return {
      repoRoot,
      queuePath,
      executableQueueItemCount: 0,
      nonExecutableRows: [],
      missingMachineReadableVerification: [],
      malformedVerificationBlocks: [],
      goalContractErrors: [],
      goalContractWarnings: [],
    };
  }

  const taskPaths = indexTaskFiles(repoRoot);
  const nonExecutableRows: WorkbenchPlanningAuditIssue[] = [];
  const missingMachineReadableVerification: WorkbenchPlanningAuditIssue[] = [];
  const malformedVerificationBlocks: WorkbenchPlanningAuditIssue[] = [];
  const goalContractErrors: WorkbenchPlanningAuditIssue[] = [];
  const goalContractWarnings: WorkbenchPlanningAuditIssue[] = [];

  for (const row of parseQueueTable(readFileSync(queuePath, "utf8"))) {
    const taskFilePath = taskPaths.get(row.item.toLowerCase());
    if (!taskFilePath) {
      nonExecutableRows.push({
        queueIndex: row.queueIndex,
        queueItemId: row.item,
        message: "Queue row is not an executable task file.",
      });
      continue;
    }

    const taskMetadata = parseTaskFile(taskFilePath);
    if (taskMetadata.verificationMode !== "machine_readable") {
      missingMachineReadableVerification.push({
        queueIndex: row.queueIndex,
        queueItemId: row.item,
        taskFilePath,
        message: taskMetadata.verificationBlockerMessage ?? "No machine-readable verification declared.",
      });
    }
    if (taskMetadata.malformedVerificationBlock) {
      malformedVerificationBlocks.push({
        queueIndex: row.queueIndex,
        queueItemId: row.item,
        taskFilePath,
        message: taskMetadata.verificationBlockerMessage ?? "Machine-readable verification block is malformed.",
      });
    }
    for (const issue of taskMetadata.goalContractErrors) {
      goalContractErrors.push({
        queueIndex: row.queueIndex,
        queueItemId: row.item,
        taskFilePath,
        message: issue.message,
        code: issue.code,
      });
    }
    for (const issue of taskMetadata.goalContractWarnings) {
      goalContractWarnings.push({
        queueIndex: row.queueIndex,
        queueItemId: row.item,
        taskFilePath,
        message: issue.message,
        code: issue.code,
      });
    }
  }

  return {
    repoRoot,
    queuePath,
    executableQueueItemCount: parseQueueTable(readFileSync(queuePath, "utf8"))
      .filter((row) => taskPaths.has(row.item.toLowerCase()))
      .length,
    nonExecutableRows,
    missingMachineReadableVerification,
    malformedVerificationBlocks,
    goalContractErrors,
    goalContractWarnings,
  };
}

export function auditWorkbenchOpenBacklog(
  startPath: string,
  logger: Logger | null = null,
): WorkbenchOpenBacklogAuditReport {
  const activeAudit = auditWorkbenchPlanningRepo(startPath, logger);
  const queueRows = existsSync(activeAudit.queuePath)
    ? parseQueueTable(readFileSync(activeAudit.queuePath, "utf8"))
    : [];
  const queuedTaskIds = new Set(queueRows.map((row) => row.item.toLowerCase()));
  const openTaskPaths = Array.from(indexOpenTaskFiles(activeAudit.repoRoot).entries())
    .sort(([left], [right]) => left.localeCompare(right));

  const unqueuedOpenTasks: WorkbenchPlanningAuditIssue[] = [];
  const missingMachineReadableVerification: WorkbenchPlanningAuditIssue[] = [];
  const malformedVerificationBlocks: WorkbenchPlanningAuditIssue[] = [];
  const goalContractErrors: WorkbenchPlanningAuditIssue[] = [];
  const goalContractWarnings: WorkbenchPlanningAuditIssue[] = [];
  const missingExplicitDelegationMetadata: WorkbenchPlanningAuditIssue[] = [];
  const missingExplicitAiShippableMetadata: WorkbenchPlanningAuditIssue[] = [];

  for (const [taskFileName, taskFilePath] of openTaskPaths) {
    const queueItemId = basename(taskFilePath);
    const taskMetadata = parseTaskFile(taskFilePath);
    if (!queuedTaskIds.has(taskFileName)) {
      unqueuedOpenTasks.push({
        queueItemId,
        taskFilePath,
        message: "Open task file is not present in the active Workbench queue.",
      });
    }
    if (!taskMetadata.hasExplicitDelegationMetadata) {
      missingExplicitDelegationMetadata.push({
        queueItemId,
        taskFilePath,
        message: "Open task is missing explicit Delegation metadata.",
      });
    }
    if (!taskMetadata.hasExplicitAiShippableMetadata) {
      missingExplicitAiShippableMetadata.push({
        queueItemId,
        taskFilePath,
        message: "Open task is missing explicit AI-Shippable metadata.",
      });
    }
    if (taskMetadata.verificationMode !== "machine_readable") {
      missingMachineReadableVerification.push({
        queueItemId,
        taskFilePath,
        message: taskMetadata.verificationBlockerMessage ?? "No machine-readable verification declared.",
      });
    }
    if (taskMetadata.malformedVerificationBlock) {
      malformedVerificationBlocks.push({
        queueItemId,
        taskFilePath,
        message: taskMetadata.verificationBlockerMessage ?? "Machine-readable verification block is malformed.",
      });
    }
    for (const issue of taskMetadata.goalContractErrors) {
      goalContractErrors.push({
        queueItemId,
        taskFilePath,
        message: issue.message,
        code: issue.code,
      });
    }
    for (const issue of taskMetadata.goalContractWarnings) {
      goalContractWarnings.push({
        queueItemId,
        taskFilePath,
        message: issue.message,
        code: issue.code,
      });
    }
  }

  return {
    ...activeAudit,
    openTaskCount: openTaskPaths.length,
    unqueuedOpenTasks,
    missingMachineReadableVerification,
    malformedVerificationBlocks,
    goalContractErrors,
    goalContractWarnings,
    missingExplicitDelegationMetadata,
    missingExplicitAiShippableMetadata,
  };
}

function resolvePlanningRepoRoot(startPath: string, logger: Logger | null): string {
  let current = startPath;
  while (true) {
    if (existsSync(join(current, "_planning", "WHAT-TO-DO-NEXT.md"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  logger?.warn("Workbench repo root has no planning queue; falling back to configured path", {
    repoRoot: startPath,
  });
  return startPath;
}

function indexTaskFiles(repoRoot: string): Map<string, string> {
  const root = join(repoRoot, "_planning", "backlog", "tasks");
  const map = new Map<string, string>();
  if (!existsSync(root)) return map;
  for (const filePath of walkMarkdownFiles(root)) {
    if (filePath.includes(`${join("_planning", "backlog", "tasks", "done")}`)) continue;
    map.set(basename(filePath).toLowerCase(), filePath);
  }
  return map;
}

function indexOpenTaskFiles(repoRoot: string): Map<string, string> {
  const root = join(repoRoot, "_planning", "backlog", "tasks");
  const map = new Map<string, string>();
  if (!existsSync(root)) return map;
  for (const filePath of walkMarkdownFiles(root)) {
    if (!isOpenTaskFile(filePath, root)) continue;
    map.set(basename(filePath).toLowerCase(), filePath);
  }
  return map;
}

function isOpenTaskFile(filePath: string, tasksRoot: string): boolean {
  const fileName = basename(filePath).toLowerCase();
  if (fileName === "readme.md" || fileName.startsWith("_template-")) return false;
  return !filePath.startsWith(join(tasksRoot, "done"));
}
