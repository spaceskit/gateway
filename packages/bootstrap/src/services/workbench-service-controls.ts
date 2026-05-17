import type { Logger } from "@spaceskit/observability";
import type {
  WorkbenchArtifactRepository,
  WorkbenchPolicyRepository,
  WorkbenchRunRepository,
  WorkbenchRunRow,
} from "@spaceskit/persistence";
import type {
  WorkbenchArtifactPayload,
  WorkbenchCancelRunPayload,
  WorkbenchQueueItemPayload,
  WorkbenchRejectStagePayload,
  WorkbenchUpdatePolicyPayload,
} from "@spaceskit/server";
import { updateCentralTaskFile } from "./workbench-task-metadata.js";
import {
  WorkbenchServiceError,
  normalizeExecutionMode,
  normalizeRequired,
} from "./workbench-service-normalizers.js";

export function cancelWorkbenchRun(input: {
  runs: WorkbenchRunRepository;
  requireRun(runId: string): WorkbenchRunRow;
  now: () => Date;
  payload: WorkbenchCancelRunPayload & { principalId: string };
}): WorkbenchRunRow {
  normalizeRequired(input.payload.principalId, "principalId");
  const runId = normalizeRequired(input.payload.runId, "runId");
  const existing = input.requireRun(runId);
  return input.runs.update(runId, {
    status: "cancelled",
    approvalState: existing.approval_state === "pending" ? "rejected" : existing.approval_state,
    currentStage: "report",
    finishedAt: input.now().toISOString(),
    lastErrorCode: "RUN_CANCELLED",
    lastErrorMessage: "Run cancelled by operator.",
  }) ?? existing;
}

export function rejectWorkbenchStage(input: {
  runs: WorkbenchRunRepository;
  requireRun(runId: string): WorkbenchRunRow;
  now: () => Date;
  payload: WorkbenchRejectStagePayload & { principalId: string };
}): WorkbenchRunRow {
  normalizeRequired(input.payload.principalId, "principalId");
  const runId = normalizeRequired(input.payload.runId, "runId");
  const run = input.requireRun(runId);
  return input.runs.update(runId, {
    status: "cancelled",
    currentStage: "report",
    approvalState: "rejected",
    finishedAt: input.now().toISOString(),
    lastErrorCode: "APPROVAL_REJECTED",
    lastErrorMessage: input.payload.reason?.trim() || "Stage rejected by operator.",
  }) ?? run;
}

export function listWorkbenchArtifacts(input: {
  artifacts: WorkbenchArtifactRepository;
  requireRun(runId: string): WorkbenchRunRow;
  runIdRaw: string;
}): WorkbenchArtifactPayload[] {
  const runId = normalizeRequired(input.runIdRaw, "runId");
  input.requireRun(runId);
  return input.artifacts.listByRun(runId).map((row) => ({
    artifactId: row.artifact_id,
    runId: row.run_id,
    kind: row.kind,
    title: row.title,
    contentType: row.content_type,
    contentText: row.content_text,
    createdAt: row.created_at,
  }));
}

export function updateWorkbenchPolicy(input: {
  policy: WorkbenchPolicyRepository;
  payload: WorkbenchUpdatePolicyPayload & { principalId: string };
}) {
  normalizeRequired(input.payload.principalId, "principalId");
  return input.policy.set({
    defaultExecutionMode: input.payload.defaultExecutionMode
      ? normalizeExecutionMode(input.payload.defaultExecutionMode)
      : undefined,
    autonomousEnabled: input.payload.autonomousEnabled,
    maxParallelRuns: input.payload.maxParallelRuns,
    requireExplicitAutonomousOptIn: input.payload.requireExplicitAutonomousOptIn,
    requireAiShippableForAutonomous: input.payload.requireAiShippableForAutonomous,
  });
}

export function updateCentralWorkbenchTaskStatus(input: {
  queueItem: WorkbenchQueueItemPayload;
  status: "in-progress" | "review" | "blocked";
  logMessage: string;
  now: () => Date;
  logger: Logger | null;
}): void {
  try {
    updateCentralTaskFile(input.queueItem.taskFilePath, {
      status: input.status,
      updated: input.now().toISOString().slice(0, 10),
      owner: input.status === "in-progress" ? "agent" : undefined,
      claimedAt: input.status === "in-progress" ? input.now().toISOString() : undefined,
      claimExpiresAt: input.status === "in-progress"
        ? new Date(input.now().getTime() + 2 * 60 * 60 * 1000).toISOString()
        : undefined,
      logMessage: input.logMessage,
      nowIso: input.now().toISOString(),
    });
  } catch (error) {
    input.logger?.warn("Failed to update central Workbench task status", {
      queueItemId: input.queueItem.queueItemId,
      taskFilePath: input.queueItem.taskFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

