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
  /** Legacy single-slug configuration; superseded by workbenchProjectSlugs when both are set. */
  workbenchProjectSlug?: string;
  /**
   * Harness project slugs served by this workbench, in queue order.
   * The special single entry "all" discovers every slug under workProjectsRoot
   * with a tasks/ subdirectory (skipping `_`-prefixed directories) at load time.
   * Resolution order: workbenchProjectSlugs > workbenchProjectSlug > ["spaces"].
   */
  workbenchProjectSlugs?: string[];
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
