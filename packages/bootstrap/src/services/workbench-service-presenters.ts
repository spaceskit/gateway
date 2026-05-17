import type {
  WorkbenchBatchRow,
  WorkbenchPolicyRow,
  WorkbenchRunRow,
} from "@spaceskit/persistence";
import type {
  WorkbenchBatchPayload,
  WorkbenchExecutionContextPayload,
  WorkbenchLandingResultPayload,
  WorkbenchQueueItemPayload,
  WorkbenchPolicyPayload,
  WorkbenchRunPayload,
  WorkbenchVerificationResultPayload,
  WorkbenchVerificationSuitePayload,
  WorkbenchWorktreeRefPayload,
} from "@spaceskit/server";
import { tryParseTaskFile } from "./workbench-task-metadata.js";
import { parseJson, parseJsonArray } from "./workbench-service-normalizers.js";

export function toWorkbenchBatchPayload(row: WorkbenchBatchRow): WorkbenchBatchPayload {
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

export function toWorkbenchRunPayload(
  row: WorkbenchRunRow,
  queueItems: WorkbenchQueueItemPayload[],
): WorkbenchRunPayload {
  const queueItem = queueItems.find((item) => item.queueItemId === row.queue_item_id);
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

export function toWorkbenchPolicyPayload(row: WorkbenchPolicyRow): WorkbenchPolicyPayload {
  return {
    defaultExecutionMode: row.default_execution_mode,
    autonomousEnabled: row.autonomous_enabled === 1,
    maxParallelRuns: row.max_parallel_runs,
    requireExplicitAutonomousOptIn: row.require_explicit_autonomous_opt_in === 1,
    requireAiShippableForAutonomous: row.require_ai_shippable_for_autonomous === 1,
    updatedAt: row.updated_at,
  };
}

