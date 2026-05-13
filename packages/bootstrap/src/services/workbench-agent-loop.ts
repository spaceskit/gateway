import { randomUUID } from "node:crypto";
import type {
  CreateSpaceInput,
  SpaceConfig,
  TurnExecutionIdentity,
} from "@spaceskit/core";
import type {
  WorkbenchArtifactRepository,
  WorkbenchRunRepository,
  WorkbenchRunRow,
} from "@spaceskit/persistence";
import type {
  WorkbenchExecutionContextPayload,
  WorkbenchExecutionContextStagePayload,
  WorkbenchLandingResultPayload,
  WorkbenchQueueItemPayload,
  WorkbenchVerificationResultPayload,
  WorkbenchVerificationSuitePayload,
  WorkbenchWorktreeRefPayload,
} from "@spaceskit/server";
import {
  WORKBENCH_IMPLEMENTATION_AGENTS,
  WORKBENCH_IMPLEMENTATION_AGENT_IDS,
  WORKBENCH_PLANNING_AGENTS,
  WORKBENCH_PLANNING_AGENT_IDS,
  isWorkbenchAgentTurnPaused,
  parseJson,
  type WorkbenchAgentTurnPaused,
} from "./workbench-service-normalizers.js";

export interface WorkbenchExecutionLoopResult {
  row: WorkbenchRunRow;
  continueToVerification: boolean;
}

export interface WorkbenchSpaceAdminService {
  createSpace(input: CreateSpaceInput): Promise<SpaceConfig>;
}

export interface WorkbenchSpaceManager {
  executeTurn(
    spaceId: string,
    input: string,
    targetAgentId?: string,
    executionIdentity?: TurnExecutionIdentity,
  ): Promise<{ turnId: string }>;
}

export interface WorkbenchEventBus {
  on(type: string, listener: (event: unknown) => void): () => void;
}

export interface WorkbenchAgentLoopContext {
  runs: WorkbenchRunRepository;
  artifacts: WorkbenchArtifactRepository;
  spaceAdminService?: WorkbenchSpaceAdminService;
  spaceManager?: WorkbenchSpaceManager;
  eventBus?: WorkbenchEventBus;
  agentTurnCompletionTimeoutMs: number;
  now: () => Date;
  resolveQueueItems: (queueItemIds: string[]) => WorkbenchQueueItemPayload[];
  updateCentralTaskStatus: (
    queueItem: WorkbenchQueueItemPayload,
    status: "in-progress" | "review" | "blocked",
    logMessage: string,
  ) => void;
}

export async function executeWorkbenchAgentLoopIfConfigured(
  ctx: WorkbenchAgentLoopContext,
  run: WorkbenchRunRow,
  worktree: WorkbenchWorktreeRefPayload,
  suites: WorkbenchVerificationSuitePayload[],
): Promise<WorkbenchExecutionLoopResult> {
  if (!ctx.spaceAdminService || !ctx.spaceManager) {
    return { row: run, continueToVerification: true };
  }

  const existingContext = run.execution_context_json
    ? parseJson<WorkbenchExecutionContextPayload>(run.execution_context_json)
    : null;
  if (existingContext?.implementationTurnId) {
    return { row: run, continueToVerification: true };
  }

  const queueItem = ctx.resolveQueueItems([run.queue_item_id])[0]!;
  const spaceName = `Workbench: ${queueItem.queueItemId}`;
  let executionContext: WorkbenchExecutionContextPayload | null = existingContext;

  try {
    const space = await ctx.spaceAdminService.createSpace({
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
    let row = ctx.runs.update(run.run_id, {
      status: "running",
      currentStage: "plan",
      executionContextJson: JSON.stringify(executionContext),
      verificationResultJson: JSON.stringify({
        status: "pending",
        summary: "Planning agents are discussing the Workbench run.",
      } satisfies WorkbenchVerificationResultPayload),
    }) ?? run;

    const planningTurnId = await executeWorkbenchTurn(ctx, {
      spaceId: space.id,
      input: buildPlanningPrompt(queueItem, worktree, suites),
      expectedAgentCount: countAssignedAgents(space, WORKBENCH_PLANNING_AGENT_IDS),
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
    persistAgentPlanningArtifact(ctx, run.run_id, executionContext, queueItem);
    row = ctx.runs.update(run.run_id, {
      currentStage: "execute",
      executionContextJson: JSON.stringify(executionContext),
      verificationResultJson: JSON.stringify({
        status: "pending",
        summary: "Implementation agents are editing the allocated Workbench worktree.",
      } satisfies WorkbenchVerificationResultPayload),
    }) ?? row;

    const implementationTurnId = await executeWorkbenchTurn(ctx, {
      spaceId: space.id,
      input: buildImplementationPrompt(queueItem, worktree, suites, planningTurnId),
      expectedAgentCount: countAssignedAgents(space, WORKBENCH_IMPLEMENTATION_AGENT_IDS),
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
    row = ctx.runs.update(run.run_id, {
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
      const row = ctx.runs.update(run.run_id, {
        status: "running",
        currentStage: error.stage === "planning" ? "plan" : "execute",
        executionContextJson: JSON.stringify(pausedContext),
        verificationResultJson: JSON.stringify({
          status: "pending",
          summary: `Agent turn paused for approval or input: ${error.reason}`,
        } satisfies WorkbenchVerificationResultPayload),
      }) ?? run;
      persistAgentLoopReportArtifact(ctx, run.run_id, "paused", error.reason);
      return { row, continueToVerification: false };
    }

    const message = error instanceof Error ? error.message : String(error);
    const failedContext = executionContext
      ? { ...executionContext, stage: "failed" as const }
      : undefined;
    const row = ctx.runs.update(run.run_id, {
      status: "failed",
      currentStage: "report",
      finishedAt: ctx.now().toISOString(),
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
        completedAt: ctx.now().toISOString(),
      } satisfies WorkbenchLandingResultPayload),
    }) ?? run;
    const queueItemForFailure = ctx.resolveQueueItems([run.queue_item_id])[0];
    if (queueItemForFailure) {
      ctx.updateCentralTaskStatus(
        queueItemForFailure,
        "blocked",
        `Workbench run ${run.run_id} failed before verification: ${message}`,
      );
    }
    persistAgentLoopReportArtifact(ctx, run.run_id, "failed", message);
    return { row, continueToVerification: false };
  }
}

async function executeWorkbenchTurn(
  ctx: WorkbenchAgentLoopContext,
  input: {
    spaceId: string;
    input: string;
    expectedAgentCount: number;
    executionIdentity: TurnExecutionIdentity;
    stage: Extract<WorkbenchExecutionContextStagePayload, "planning" | "implementation">;
  },
): Promise<string> {
  const result = await ctx.spaceManager!.executeTurn(
    input.spaceId,
    input.input,
    undefined,
    input.executionIdentity,
  );
  await waitForWorkbenchTurn(ctx, input.spaceId, result.turnId, input.stage, input.expectedAgentCount);
  return result.turnId;
}

async function waitForWorkbenchTurn(
  ctx: WorkbenchAgentLoopContext,
  spaceId: string,
  turnId: string,
  stage: Extract<WorkbenchExecutionContextStagePayload, "planning" | "implementation">,
  expectedAgentCount: number,
): Promise<void> {
  const eventBus = ctx.eventBus;
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
    }, ctx.agentTurnCompletionTimeoutMs);

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

function countAssignedAgents(space: SpaceConfig, agentIds: string[]): number {
  const assigned = new Set(space.agents.map((agent) => agent.agentId));
  return Math.max(1, agentIds.filter((agentId) => assigned.has(agentId)).length);
}

function buildPlanningPrompt(
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

function buildImplementationPrompt(
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

function persistAgentPlanningArtifact(
  ctx: WorkbenchAgentLoopContext,
  runId: string,
  executionContext: WorkbenchExecutionContextPayload,
  queueItem: WorkbenchQueueItemPayload,
): void {
  ctx.artifacts.create({
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

function persistAgentLoopReportArtifact(
  ctx: WorkbenchAgentLoopContext,
  runId: string,
  status: "paused" | "failed",
  reason: string,
): void {
  ctx.artifacts.create({
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
