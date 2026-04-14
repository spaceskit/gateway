import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { WorkbenchExecutionMode } from "./workbench-batches.js";

export type WorkbenchRunStatus =
  | "queued"
  | "awaiting_review"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkbenchRunStage =
  | "intake"
  | "plan"
  | "execute"
  | "verify"
  | "review_gate"
  | "land"
  | "report";

export type WorkbenchApprovalState = "pending" | "approved" | "rejected" | "not_required";

export interface WorkbenchRunRow {
  run_id: string;
  batch_id: string | null;
  queue_item_id: string;
  queue_item_path: string;
  status: WorkbenchRunStatus;
  current_stage: WorkbenchRunStage;
  execution_mode: WorkbenchExecutionMode;
  approval_state: WorkbenchApprovalState;
  worktree_json: string | null;
  touched_repos_json: string;
  verification_suites_json: string;
  verification_result_json: string | null;
  landing_result_json: string | null;
  execution_context_json: string | null;
  last_error_code: string;
  last_error_message: string;
  created_by_principal_id: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateWorkbenchRunInput {
  runId: string;
  batchId?: string | null;
  queueItemId: string;
  queueItemPath: string;
  status: WorkbenchRunStatus;
  currentStage: WorkbenchRunStage;
  executionMode: WorkbenchExecutionMode;
  approvalState: WorkbenchApprovalState;
  worktreeJson?: string | null;
  touchedReposJson?: string;
  verificationSuitesJson?: string;
  verificationResultJson?: string | null;
  landingResultJson?: string | null;
  executionContextJson?: string | null;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdByPrincipalId: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UpdateWorkbenchRunInput {
  status?: WorkbenchRunStatus;
  currentStage?: WorkbenchRunStage;
  executionMode?: WorkbenchExecutionMode;
  approvalState?: WorkbenchApprovalState;
  worktreeJson?: string | null;
  touchedReposJson?: string;
  verificationSuitesJson?: string;
  verificationResultJson?: string | null;
  landingResultJson?: string | null;
  executionContextJson?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface ListWorkbenchRunsQuery {
  batchId?: string;
  queueItemId?: string;
  limit?: number;
}

export class WorkbenchRunRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateWorkbenchRunInput): WorkbenchRunRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO workbench_runs(
        run_id,
        batch_id,
        queue_item_id,
        queue_item_path,
        status,
        current_stage,
        execution_mode,
        approval_state,
        worktree_json,
        touched_repos_json,
        verification_suites_json,
        verification_result_json,
        landing_result_json,
        execution_context_json,
        last_error_code,
        last_error_message,
        created_by_principal_id,
        created_at,
        updated_at,
        started_at,
        finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runId,
      input.batchId ?? null,
      input.queueItemId,
      input.queueItemPath,
      input.status,
      input.currentStage,
      input.executionMode,
      input.approvalState,
      input.worktreeJson ?? null,
      input.touchedReposJson ?? "[]",
      input.verificationSuitesJson ?? "[]",
      input.verificationResultJson ?? null,
      input.landingResultJson ?? null,
      input.executionContextJson ?? null,
      input.lastErrorCode ?? "",
      input.lastErrorMessage ?? "",
      input.createdByPrincipalId,
      now,
      now,
      input.startedAt ?? now,
      input.finishedAt ?? null,
    );
    return this.get(input.runId)!;
  }

  get(runId: string): WorkbenchRunRow | undefined {
    return this.db.query(`
      SELECT * FROM workbench_runs
      WHERE run_id = ?
    `).get(runId) as WorkbenchRunRow | undefined ?? undefined;
  }

  list(query: ListWorkbenchRunsQuery = {}): WorkbenchRunRow[] {
    const conditions: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (query.batchId) {
      conditions.push("batch_id = ?");
      values.push(query.batchId);
    }
    if (query.queueItemId) {
      conditions.push("queue_item_id = ?");
      values.push(query.queueItemId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(normalizeLimit(query.limit ?? 100));

    return this.db.query(`
      SELECT * FROM workbench_runs
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...values) as WorkbenchRunRow[];
  }

  listActive(): WorkbenchRunRow[] {
    return this.db.query(`
      SELECT * FROM workbench_runs
      WHERE status IN ('queued', 'awaiting_review', 'running')
      ORDER BY updated_at DESC
    `).all() as WorkbenchRunRow[];
  }

  update(runId: string, patch: UpdateWorkbenchRunInput): WorkbenchRunRow | undefined {
    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (patch.status !== undefined) {
      assignments.push("status = ?");
      values.push(patch.status);
    }
    if (patch.currentStage !== undefined) {
      assignments.push("current_stage = ?");
      values.push(patch.currentStage);
    }
    if (patch.executionMode !== undefined) {
      assignments.push("execution_mode = ?");
      values.push(patch.executionMode);
    }
    if (patch.approvalState !== undefined) {
      assignments.push("approval_state = ?");
      values.push(patch.approvalState);
    }
    if (patch.worktreeJson !== undefined) {
      assignments.push("worktree_json = ?");
      values.push(patch.worktreeJson ?? null);
    }
    if (patch.touchedReposJson !== undefined) {
      assignments.push("touched_repos_json = ?");
      values.push(patch.touchedReposJson);
    }
    if (patch.verificationSuitesJson !== undefined) {
      assignments.push("verification_suites_json = ?");
      values.push(patch.verificationSuitesJson);
    }
    if (patch.verificationResultJson !== undefined) {
      assignments.push("verification_result_json = ?");
      values.push(patch.verificationResultJson ?? null);
    }
    if (patch.landingResultJson !== undefined) {
      assignments.push("landing_result_json = ?");
      values.push(patch.landingResultJson ?? null);
    }
    if (patch.executionContextJson !== undefined) {
      assignments.push("execution_context_json = ?");
      values.push(patch.executionContextJson ?? null);
    }
    if (patch.lastErrorCode !== undefined) {
      assignments.push("last_error_code = ?");
      values.push(patch.lastErrorCode ?? "");
    }
    if (patch.lastErrorMessage !== undefined) {
      assignments.push("last_error_message = ?");
      values.push(patch.lastErrorMessage ?? "");
    }
    if (patch.startedAt !== undefined) {
      assignments.push("started_at = ?");
      values.push(patch.startedAt ?? null);
    }
    if (patch.finishedAt !== undefined) {
      assignments.push("finished_at = ?");
      values.push(patch.finishedAt ?? null);
    }

    if (assignments.length === 0) {
      return this.get(runId);
    }

    assignments.push("updated_at = ?");
    values.push(new Date().toISOString(), runId);

    this.db.query(`
      UPDATE workbench_runs
      SET ${assignments.join(", ")}
      WHERE run_id = ?
    `).run(...values);

    return this.get(runId);
  }
}

function normalizeLimit(limit: number, fallback = 100): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}
