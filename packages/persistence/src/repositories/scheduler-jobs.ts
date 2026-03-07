import type { Database, SQLQueryBindings } from "bun:sqlite";

export type SchedulerJobStatus = "active" | "paused" | "invalid";
export type SchedulerActionType = "space_prompt";

export interface SchedulerJobRow {
  job_id: string;
  name: string;
  status: SchedulerJobStatus;
  enabled: number;
  cron_expression: string;
  schedule_preset_json: string;
  timezone: string;
  action_type: SchedulerActionType;
  prompt_text: string;
  target_agent_id: string;
  primary_space_id: string | null;
  invalid_reason: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string;
  last_error_code: string;
  last_error_message: string;
  created_by_principal_id: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSchedulerJobInput {
  jobId: string;
  name: string;
  status?: SchedulerJobStatus;
  enabled?: boolean;
  cronExpression: string;
  schedulePresetJson: string;
  timezone: string;
  actionType?: SchedulerActionType;
  promptText: string;
  targetAgentId?: string;
  primarySpaceId?: string | null;
  invalidReason?: string;
  nextRunAt?: string | null;
  createdByPrincipalId: string;
}

export interface ListSchedulerJobsQuery {
  statuses?: SchedulerJobStatus[];
  limit?: number;
}

export interface UpdateSchedulerJobInput {
  name?: string;
  status?: SchedulerJobStatus;
  enabled?: boolean;
  cronExpression?: string;
  schedulePresetJson?: string;
  timezone?: string;
  promptText?: string;
  targetAgentId?: string | null;
  primarySpaceId?: string | null;
  invalidReason?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export class SchedulerJobRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateSchedulerJobInput): SchedulerJobRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO scheduler_jobs(
        job_id,
        name,
        status,
        enabled,
        cron_expression,
        schedule_preset_json,
        timezone,
        action_type,
        prompt_text,
        target_agent_id,
        primary_space_id,
        invalid_reason,
        next_run_at,
        created_by_principal_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.jobId,
      input.name,
      input.status ?? "active",
      (input.enabled ?? true) ? 1 : 0,
      input.cronExpression,
      input.schedulePresetJson,
      input.timezone,
      input.actionType ?? "space_prompt",
      input.promptText,
      input.targetAgentId ?? "",
      input.primarySpaceId ?? null,
      input.invalidReason ?? "",
      input.nextRunAt ?? null,
      input.createdByPrincipalId,
      now,
      now,
    );
    return this.get(input.jobId)!;
  }

  get(jobId: string): SchedulerJobRow | undefined {
    return this.db.query(`
      SELECT * FROM scheduler_jobs WHERE job_id = ?
    `).get(jobId) as SchedulerJobRow | undefined ?? undefined;
  }

  list(query: ListSchedulerJobsQuery = {}): SchedulerJobRow[] {
    const statuses = normalizeStatuses(query.statuses);
    const limit = normalizeLimit(query.limit);

    if (statuses.length > 0) {
      const placeholders = statuses.map(() => "?").join(", ");
      return this.db.query(`
        SELECT * FROM scheduler_jobs
        WHERE status IN (${placeholders})
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(...statuses, limit) as SchedulerJobRow[];
    }

    return this.db.query(`
      SELECT * FROM scheduler_jobs
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as SchedulerJobRow[];
  }

  listDue(nowIso: string, limit = 100): SchedulerJobRow[] {
    const normalizedLimit = normalizeLimit(limit, 100);
    return this.db.query(`
      SELECT * FROM scheduler_jobs
      WHERE enabled = 1
        AND status = 'active'
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC
      LIMIT ?
    `).all(nowIso, normalizedLimit) as SchedulerJobRow[];
  }

  update(jobId: string, patch: UpdateSchedulerJobInput): SchedulerJobRow | undefined {
    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (patch.name !== undefined) {
      assignments.push("name = ?");
      values.push(patch.name);
    }
    if (patch.status !== undefined) {
      assignments.push("status = ?");
      values.push(patch.status);
    }
    if (patch.enabled !== undefined) {
      assignments.push("enabled = ?");
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.cronExpression !== undefined) {
      assignments.push("cron_expression = ?");
      values.push(patch.cronExpression);
    }
    if (patch.schedulePresetJson !== undefined) {
      assignments.push("schedule_preset_json = ?");
      values.push(patch.schedulePresetJson);
    }
    if (patch.timezone !== undefined) {
      assignments.push("timezone = ?");
      values.push(patch.timezone);
    }
    if (patch.promptText !== undefined) {
      assignments.push("prompt_text = ?");
      values.push(patch.promptText);
    }
    if (patch.targetAgentId !== undefined) {
      assignments.push("target_agent_id = ?");
      values.push(patch.targetAgentId ?? "");
    }
    if (patch.primarySpaceId !== undefined) {
      assignments.push("primary_space_id = ?");
      values.push(patch.primarySpaceId ?? null);
    }
    if (patch.invalidReason !== undefined) {
      assignments.push("invalid_reason = ?");
      values.push(patch.invalidReason ?? "");
    }
    if (patch.nextRunAt !== undefined) {
      assignments.push("next_run_at = ?");
      values.push(patch.nextRunAt ?? null);
    }
    if (patch.lastRunAt !== undefined) {
      assignments.push("last_run_at = ?");
      values.push(patch.lastRunAt ?? null);
    }
    if (patch.lastRunStatus !== undefined) {
      assignments.push("last_run_status = ?");
      values.push(patch.lastRunStatus ?? "");
    }
    if (patch.lastErrorCode !== undefined) {
      assignments.push("last_error_code = ?");
      values.push(patch.lastErrorCode ?? "");
    }
    if (patch.lastErrorMessage !== undefined) {
      assignments.push("last_error_message = ?");
      values.push(patch.lastErrorMessage ?? "");
    }

    if (assignments.length === 0) {
      return this.get(jobId);
    }

    assignments.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(jobId);

    this.db.query(`
      UPDATE scheduler_jobs
      SET ${assignments.join(", ")}
      WHERE job_id = ?
    `).run(...values);

    return this.get(jobId);
  }

  delete(jobId: string): boolean {
    return this.db.query(`
      DELETE FROM scheduler_jobs
      WHERE job_id = ?
    `).run(jobId).changes > 0;
  }
}

function normalizeStatuses(statuses: SchedulerJobStatus[] | undefined): SchedulerJobStatus[] {
  if (!Array.isArray(statuses)) return [];
  return Array.from(new Set(statuses.filter((status) => (
    status === "active" || status === "paused" || status === "invalid"
  ))));
}

function normalizeLimit(limit: number | undefined, fallback = 200): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(limit), 1), 500);
}
