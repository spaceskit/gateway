import type {
  CreateSpaceInput,
  SpaceConfig,
  TurnExecutionIdentity,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  WorkbenchArtifactRepository,
  WorkbenchBatchRepository,
  WorkbenchPolicyRepository,
  WorkbenchRunRepository,
  WorkbenchScenarioRunRepository,
} from "@spaceskit/persistence";
import type {
  AggregateReport,
  ExecuteWorkbenchScenarioRunOptions,
} from "@spaceskit/workbench-runner";
import type { RunWorkbenchCommandOptions, WorkbenchCommandEvidence } from "./workbench-verification-executor.js";
import type { WorkbenchExecutorAdapter } from "./workbench-executor-adapter.js";

export interface WorkbenchIdempotencyRecord {
  requestHash: string;
  responseType: string;
  responsePayload: string;
}

export interface SaveWorkbenchIdempotencyRecord extends WorkbenchIdempotencyRecord {
  principalId: string;
  endpoint: string;
  idempotencyKey: string;
}

export interface WorkbenchServiceOptions {
  batches: WorkbenchBatchRepository;
  runs: WorkbenchRunRepository;
  scenarioRuns?: WorkbenchScenarioRunRepository;
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
  runnerApiEnabled?: boolean;
  workbenchExecutorAutostart?: boolean;
  workbenchExecutorAdapter?: WorkbenchExecutorAdapter;
  scenarioRunner?: (options: ExecuteWorkbenchScenarioRunOptions) => Promise<AggregateReport>;
  loadIdempotencyRecord?: (
    principalId: string,
    endpoint: string,
    idempotencyKey: string,
  ) => Promise<WorkbenchIdempotencyRecord | null>;
  saveIdempotencyRecord?: (record: SaveWorkbenchIdempotencyRecord) => Promise<void>;
}
