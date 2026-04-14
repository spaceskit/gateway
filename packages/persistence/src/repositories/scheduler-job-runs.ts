import type { Database, SQLQueryBindings } from "bun:sqlite";

export type SchedulerRunStatus = "running" | "completed" | "failed" | "skipped";
export type SchedulerRunTrigger = "scheduled" | "manual";

export interface SchedulerJobRunRow {
  run_id: string;
  job_id: string;
  trigger: SchedulerRunTrigger;
  status: SchedulerRunStatus;
  command_id: string;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  skip_reason: string;
  error_code: string;
  error_message: string;
  result_json: string | null;
  eval_run_json: string | null;
  created_at: string;
}

export interface CreateSchedulerJobRunInput {
  runId: string;
  jobId: string;
  trigger: SchedulerRunTrigger;
  status: SchedulerRunStatus;
  commandId?: string;
  scheduledFor?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  skipReason?: string;
  errorCode?: string;
  errorMessage?: string;
  resultJson?: string | null;
  evalRunJson?: string | null;
}

export interface UpdateSchedulerJobRunInput {
  status?: SchedulerRunStatus;
  commandId?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  skipReason?: string;
  errorCode?: string;
  errorMessage?: string;
  resultJson?: string | null;
  evalRunJson?: string | null;
}

export class SchedulerJobRunRepository {
  constructor(private readonly db: Database) {
    this.ensureCanonicalColumns();
  }

  create(input: CreateSchedulerJobRunInput): SchedulerJobRunRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO scheduler_job_runs(
        run_id,
        job_id,
        trigger,
        status,
        command_id,
        scheduled_for,
        started_at,
        finished_at,
        skip_reason,
        error_code,
        error_message,
        result_json,
        eval_run_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runId,
      input.jobId,
      input.trigger,
      input.status,
      input.commandId ?? "",
      input.scheduledFor ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      input.skipReason ?? "",
      input.errorCode ?? "",
      input.errorMessage ?? "",
      input.resultJson ?? null,
      input.evalRunJson ?? null,
      now,
    );
    return this.get(input.runId)!;
  }

  get(runId: string): SchedulerJobRunRow | undefined {
    return this.db.query(`
      SELECT * FROM scheduler_job_runs
      WHERE run_id = ?
    `).get(runId) as SchedulerJobRunRow | undefined ?? undefined;
  }

  update(runId: string, patch: UpdateSchedulerJobRunInput): SchedulerJobRunRow | undefined {
    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (patch.status !== undefined) {
      assignments.push("status = ?");
      values.push(patch.status);
    }
    if (patch.commandId !== undefined) {
      assignments.push("command_id = ?");
      values.push(patch.commandId);
    }
    if (patch.startedAt !== undefined) {
      assignments.push("started_at = ?");
      values.push(patch.startedAt ?? null);
    }
    if (patch.finishedAt !== undefined) {
      assignments.push("finished_at = ?");
      values.push(patch.finishedAt ?? null);
    }
    if (patch.skipReason !== undefined) {
      assignments.push("skip_reason = ?");
      values.push(patch.skipReason);
    }
    if (patch.errorCode !== undefined) {
      assignments.push("error_code = ?");
      values.push(patch.errorCode);
    }
    if (patch.errorMessage !== undefined) {
      assignments.push("error_message = ?");
      values.push(patch.errorMessage);
    }
    if (patch.resultJson !== undefined) {
      assignments.push("result_json = ?");
      values.push(patch.resultJson ?? null);
    }
    if (patch.evalRunJson !== undefined) {
      assignments.push("eval_run_json = ?");
      values.push(patch.evalRunJson ?? null);
    }

    if (assignments.length === 0) {
      return this.get(runId);
    }

    values.push(runId);

    this.db.query(`
      UPDATE scheduler_job_runs
      SET ${assignments.join(", ")}
      WHERE run_id = ?
    `).run(...values);

    return this.get(runId);
  }

  listByJob(jobId: string, limit: number, offset: number): SchedulerJobRunRow[] {
    const normalizedLimit = normalizeLimit(limit, 50);
    const normalizedOffset = normalizeOffset(offset);
    return this.db.query(`
      SELECT * FROM scheduler_job_runs
      WHERE job_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(jobId, normalizedLimit, normalizedOffset) as SchedulerJobRunRow[];
  }

  countByJob(jobId: string): number {
    const row = this.db.query(`
      SELECT COUNT(*) as count
      FROM scheduler_job_runs
      WHERE job_id = ?
    `).get(jobId) as { count: number };
    return row.count;
  }

  getRunningByJob(jobId: string): SchedulerJobRunRow | undefined {
    return this.db.query(`
      SELECT * FROM scheduler_job_runs
      WHERE job_id = ? AND status = 'running'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(jobId) as SchedulerJobRunRow | undefined ?? undefined;
  }

  /**
   * Atomically creates a "running" run only if no other run with status='running'
   * exists for this job. Returns the created row, or undefined if a running run
   * already exists (i.e., the lock was not acquired).
   */
  tryClaimRunning(input: CreateSchedulerJobRunInput): SchedulerJobRunRow | undefined {
    const now = new Date().toISOString();
    const result = this.db.query(`
      INSERT INTO scheduler_job_runs(
        run_id, job_id, trigger, status, command_id,
        scheduled_for, started_at, finished_at,
        skip_reason, error_code, error_message, result_json, eval_run_json, created_at
      )
      SELECT ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM scheduler_job_runs
        WHERE job_id = ? AND status = 'running'
      )
    `).run(
      input.runId,
      input.jobId,
      input.trigger,
      input.commandId ?? "",
      input.scheduledFor ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      input.skipReason ?? "",
      input.errorCode ?? "",
      input.errorMessage ?? "",
      input.resultJson ?? null,
      input.evalRunJson ?? null,
      now,
      input.jobId,
    );
    if (result.changes === 0) return undefined;
    return this.get(input.runId);
  }

  pruneToLatest(jobId: string, keep: number): number {
    const normalizedKeep = Math.max(1, Math.min(5000, Math.floor(keep)));
    return this.db.query(`
      DELETE FROM scheduler_job_runs
      WHERE run_id IN (
        SELECT run_id FROM scheduler_job_runs
        WHERE job_id = ?
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?
      )
    `).run(jobId, normalizedKeep).changes;
  }

  private ensureCanonicalColumns(): void {
    const columnNames = new Set(
      this.db
        .query("PRAGMA table_info(scheduler_job_runs)")
        .all()
        .map((row: any) => String(row.name)),
    );
    if (!columnNames.has("eval_run_json")) {
      this.db.exec(
        "ALTER TABLE scheduler_job_runs ADD COLUMN eval_run_json TEXT",
      );
    }
  }
}

function normalizeLimit(limit: number | undefined, fallback = 50): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(limit), 1), 500);
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(Math.floor(offset), 0);
}
