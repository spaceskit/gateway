import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  WorkbenchBatchRow,
  WorkbenchPolicyRow,
  WorkbenchRunRow,
} from "@spaceskit/persistence";
import type {
  WorkbenchQueueItemPayload,
  WorkbenchRunPayload,
  WorkbenchStartRunPayload,
  WorkbenchVerificationResultPayload,
  WorkbenchVerificationSuitePayload,
  WorkbenchWorktreeRefPayload,
  WorkbenchLandingResultPayload,
} from "@spaceskit/server";
import type { WorkbenchExecutionMode } from "@spaceskit/persistence";
import {
  initialRunStateForMode,
  normalizeExecutionMode,
  normalizeRequired,
} from "./workbench-service-normalizers.js";
import type { WorkbenchServiceOptions } from "./workbench-service-types.js";

interface WorkbenchStartRunContext {
  options: WorkbenchServiceOptions;
  now: () => Date;
  resolveGitRoot(): string;
  resolveQueueItems(queueItemIds: string[]): WorkbenchQueueItemPayload[];
  requireBatch(batchId: string): WorkbenchBatchRow;
  assertAutonomousEligibility(queueItem: WorkbenchQueueItemPayload, policy: WorkbenchPolicyRow): void;
  assertParallelCapacity(policy: WorkbenchPolicyRow): void;
  assertNoActiveRunConflict(queueItem: WorkbenchQueueItemPayload): void;
  allocateWorktree(queueItem: WorkbenchQueueItemPayload, runId: string): WorkbenchWorktreeRefPayload;
  updateCentralTaskStatus(
    queueItem: WorkbenchQueueItemPayload,
    status: "in-progress" | "review" | "blocked",
    logMessage: string,
  ): void;
  persistRunArtifacts(
    row: WorkbenchRunRow,
    queueItem: WorkbenchQueueItemPayload,
    worktree: WorkbenchWorktreeRefPayload,
    verificationSuites: WorkbenchVerificationSuitePayload[],
    executionMode: WorkbenchExecutionMode,
  ): void;
  executeRunIfReady(runId: string): Promise<WorkbenchRunRow>;
  toRunPayload(row: WorkbenchRunRow): WorkbenchRunPayload;
}

export async function startWorkbenchRun(
  context: WorkbenchStartRunContext,
  input: WorkbenchStartRunPayload & { principalId: string },
): Promise<WorkbenchRunPayload> {
  const principalId = normalizeRequired(input.principalId, "principalId");
  const queueItem = context.resolveQueueItems([input.queueItemId])[0]!;
  const batch = input.batchId?.trim()
    ? context.requireBatch(input.batchId.trim())
    : null;
  const policy = context.options.policy.get();
  const executionMode = normalizeExecutionMode(
    input.executionMode
    ?? batch?.execution_mode
    ?? policy.default_execution_mode,
  );

  if (executionMode === "autonomous") {
    context.assertAutonomousEligibility(queueItem, policy);
  }
  context.assertParallelCapacity(policy);
  context.assertNoActiveRunConflict(queueItem);

  const runId = `wb-run-${randomUUID()}`;
  const worktree = context.allocateWorktree(queueItem, runId);
  const touchedRepos = [{
    repoId: basename(context.resolveGitRoot()),
    repoPath: context.resolveGitRoot(),
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
  const row = context.options.runs.create({
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
    startedAt: context.now().toISOString(),
  });

  context.updateCentralTaskStatus(queueItem, "in-progress", `Workbench run ${runId} started in ${executionMode} mode.`);
  context.persistRunArtifacts(row, queueItem, worktree, verificationSuites, executionMode);

  if (batch && batch.status === "draft") {
    context.options.batches.update(batch.batch_id, { status: "queued" });
  }

  if (currentStage === "execute") {
    return context.toRunPayload(await context.executeRunIfReady(row.run_id));
  }

  return context.toRunPayload(row);
}
