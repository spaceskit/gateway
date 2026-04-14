export type WorkbenchExecutionModePayload = "supervised" | "autonomous";
export type WorkbenchBatchStatusPayload = "draft" | "queued" | "running" | "completed" | "cancelled";
export type WorkbenchRunStatusPayload =
  | "queued"
  | "awaiting_review"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkbenchRunStagePayload =
  | "intake"
  | "plan"
  | "execute"
  | "verify"
  | "review_gate"
  | "land"
  | "report";
export type WorkbenchApprovalStatePayload = "pending" | "approved" | "rejected" | "not_required";
export type WorkbenchVerificationModePayload = "machine_readable" | "review_only";
export type WorkbenchVerificationSuiteStatusPayload = "pending" | "running" | "passed" | "failed" | "skipped";
export type WorkbenchVerificationResultStatusPayload = "pending" | "passed" | "failed";
export type WorkbenchLandingStatusPayload = "not_started" | "blocked" | "landed";

export interface WorkbenchExecutionModeEligibilityPayload {
  supervised: boolean;
  autonomous: boolean;
}

export interface WorkbenchQueueItemPayload {
  queueItemId: string;
  queueIndex: number;
  title: string;
  type: string;
  status: string;
  nextAction: string;
  taskFilePath: string;
  delegation: string;
  parallelKeys: string[];
  aiShippable: boolean;
  executionModeEligibility: WorkbenchExecutionModeEligibilityPayload;
  verificationMode: WorkbenchVerificationModePayload;
  executionModeBlockers: string[];
  products: string[];
  verificationCommands: string[];
}

export interface WorkbenchBatchPayload {
  batchId: string;
  name: string;
  status: WorkbenchBatchStatusPayload;
  executionMode: WorkbenchExecutionModePayload;
  queueItemIds: string[];
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchWorktreeRefPayload {
  path: string;
  branchName: string;
  baseBranchName: string;
  createdAt: string;
}

export interface WorkbenchRepoTouchPayload {
  repoId: string;
  repoPath: string;
  kind: "meta" | "submodule";
  committed: boolean;
}

export interface WorkbenchVerificationSuitePayload {
  suiteId: string;
  name: string;
  command: string;
  status: WorkbenchVerificationSuiteStatusPayload;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  durationMs?: number;
  logArtifactId?: string;
  summary?: string;
}

export interface WorkbenchVerificationResultPayload {
  status: WorkbenchVerificationResultStatusPayload;
  summary?: string;
  completedAt?: string;
}

export interface WorkbenchLandingResultPayload {
  status: WorkbenchLandingStatusPayload;
  merged?: boolean;
  summary?: string;
  completedAt?: string;
}

export type WorkbenchExecutionContextStagePayload =
  | "planning"
  | "implementation"
  | "verification"
  | "completed"
  | "failed"
  | "paused";

export interface WorkbenchExecutionContextPayload {
  spaceId: string;
  spaceUid?: string;
  spaceName: string;
  planningTurnId?: string;
  implementationTurnId?: string;
  stage: WorkbenchExecutionContextStagePayload;
}

export interface WorkbenchRunPayload {
  runId: string;
  batchId?: string;
  queueItemId: string;
  queueItemPath: string;
  status: WorkbenchRunStatusPayload;
  currentStage: WorkbenchRunStagePayload;
  executionMode: WorkbenchExecutionModePayload;
  approvalState: WorkbenchApprovalStatePayload;
  worktree?: WorkbenchWorktreeRefPayload;
  touchedRepos: WorkbenchRepoTouchPayload[];
  verificationMode: WorkbenchVerificationModePayload;
  executionModeBlockers: string[];
  verificationSuites: WorkbenchVerificationSuitePayload[];
  verificationResult?: WorkbenchVerificationResultPayload;
  landingResult?: WorkbenchLandingResultPayload;
  executionContext?: WorkbenchExecutionContextPayload;
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

export interface WorkbenchArtifactPayload {
  artifactId: string;
  runId: string;
  kind: string;
  title: string;
  contentType: string;
  contentText: string;
  createdAt: string;
}

export interface WorkbenchPolicyPayload {
  defaultExecutionMode: WorkbenchExecutionModePayload;
  autonomousEnabled: boolean;
  maxParallelRuns: number;
  requireExplicitAutonomousOptIn: boolean;
  requireAiShippableForAutonomous: boolean;
  updatedAt: string;
}

export interface WorkbenchListQueuePayload {
  apiVersion?: string;
  limit?: number;
}

export interface WorkbenchListQueueResponsePayload {
  items: WorkbenchQueueItemPayload[];
}

export interface WorkbenchGetQueueItemPayload {
  apiVersion?: string;
  queueItemId: string;
}

export interface WorkbenchGetQueueItemResponsePayload {
  item: WorkbenchQueueItemPayload;
}

export interface WorkbenchCreateBatchPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  name: string;
  queueItemIds: string[];
  executionMode?: WorkbenchExecutionModePayload;
}

export interface WorkbenchCreateBatchResponsePayload {
  batch: WorkbenchBatchPayload;
}

export interface WorkbenchListBatchesPayload {
  apiVersion?: string;
  limit?: number;
}

export interface WorkbenchListBatchesResponsePayload {
  batches: WorkbenchBatchPayload[];
}

export interface WorkbenchUpdateBatchPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  batchId: string;
  name?: string;
  queueItemIds?: string[];
  executionMode?: WorkbenchExecutionModePayload;
  status?: WorkbenchBatchStatusPayload;
}

export interface WorkbenchUpdateBatchResponsePayload {
  batch: WorkbenchBatchPayload;
}

export interface WorkbenchStartRunPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  queueItemId: string;
  batchId?: string;
  executionMode?: WorkbenchExecutionModePayload;
}

export interface WorkbenchStartRunResponsePayload {
  run: WorkbenchRunPayload;
}

export interface WorkbenchRetryRunPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  runId: string;
}

export interface WorkbenchRetryRunResponsePayload {
  run: WorkbenchRunPayload;
}

export interface WorkbenchCancelRunPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  runId: string;
}

export interface WorkbenchCancelRunResponsePayload {
  run: WorkbenchRunPayload;
}

export interface WorkbenchListRunsPayload {
  apiVersion?: string;
  batchId?: string;
  queueItemId?: string;
  limit?: number;
}

export interface WorkbenchListRunsResponsePayload {
  runs: WorkbenchRunPayload[];
}

export interface WorkbenchGetRunPayload {
  apiVersion?: string;
  runId: string;
}

export interface WorkbenchGetRunResponsePayload {
  run: WorkbenchRunPayload;
}

export interface WorkbenchApproveStagePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  runId: string;
  stage?: WorkbenchRunStagePayload;
}

export interface WorkbenchApproveStageResponsePayload {
  run: WorkbenchRunPayload;
}

export interface WorkbenchRejectStagePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  runId: string;
  stage?: WorkbenchRunStagePayload;
  reason?: string;
}

export interface WorkbenchRejectStageResponsePayload {
  run: WorkbenchRunPayload;
}

export interface WorkbenchSetModePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  runId?: string;
  batchId?: string;
  executionMode: WorkbenchExecutionModePayload;
}

export interface WorkbenchSetModeResponsePayload {
  run?: WorkbenchRunPayload;
  batch?: WorkbenchBatchPayload;
}

export interface WorkbenchListArtifactsPayload {
  apiVersion?: string;
  runId: string;
}

export interface WorkbenchListArtifactsResponsePayload {
  artifacts: WorkbenchArtifactPayload[];
}

export interface WorkbenchGetPolicyPayload {
  apiVersion?: string;
}

export interface WorkbenchGetPolicyResponsePayload {
  policy: WorkbenchPolicyPayload;
}

export interface WorkbenchUpdatePolicyPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  defaultExecutionMode?: WorkbenchExecutionModePayload;
  autonomousEnabled?: boolean;
  maxParallelRuns?: number;
  requireExplicitAutonomousOptIn?: boolean;
  requireAiShippableForAutonomous?: boolean;
}

export interface WorkbenchUpdatePolicyResponsePayload {
  policy: WorkbenchPolicyPayload;
}
