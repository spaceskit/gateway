import type { Database, SQLQueryBindings } from "bun:sqlite";

export type WorkbenchScenarioRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type WorkbenchScenarioOverallStatus = "passed" | "failed" | "blocked" | "skipped";

export interface WorkbenchScenarioRunRow {
  scenario_run_id: string;
  status: WorkbenchScenarioRunStatus;
  config_json: string;
  overall_status: WorkbenchScenarioOverallStatus | null;
  summary: string;
  report_artifact_id: string | null;
  created_by_principal_id: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  last_error_code: string;
  last_error_message: string;
}

export interface CreateWorkbenchScenarioRunInput {
  scenarioRunId: string;
  status: WorkbenchScenarioRunStatus;
  configJson: string;
  createdByPrincipalId: string;
  startedAt?: string | null;
}

export interface UpdateWorkbenchScenarioRunInput {
  status?: WorkbenchScenarioRunStatus;
  overallStatus?: WorkbenchScenarioOverallStatus | null;
  summary?: string;
  reportArtifactId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface ListWorkbenchScenarioRunsQuery {
  status?: WorkbenchScenarioRunStatus;
  limit?: number;
}

export class WorkbenchScenarioRunRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateWorkbenchScenarioRunInput): WorkbenchScenarioRunRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO workbench_scenario_runs(
        scenario_run_id,
        status,
        config_json,
        created_by_principal_id,
        created_at,
        updated_at,
        started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.scenarioRunId,
      input.status,
      input.configJson,
      input.createdByPrincipalId,
      now,
      now,
      input.startedAt ?? now,
    );
    return this.get(input.scenarioRunId)!;
  }

  get(scenarioRunId: string): WorkbenchScenarioRunRow | undefined {
    return this.db.query(`
      SELECT * FROM workbench_scenario_runs
      WHERE scenario_run_id = ?
    `).get(scenarioRunId) as WorkbenchScenarioRunRow | undefined ?? undefined;
  }

  list(query: ListWorkbenchScenarioRunsQuery = {}): WorkbenchScenarioRunRow[] {
    const conditions: string[] = [];
    const values: SQLQueryBindings[] = [];
    if (query.status) {
      conditions.push("status = ?");
      values.push(query.status);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(normalizeLimit(query.limit ?? 100));
    return this.db.query(`
      SELECT * FROM workbench_scenario_runs
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...values) as WorkbenchScenarioRunRow[];
  }

  update(
    scenarioRunId: string,
    patch: UpdateWorkbenchScenarioRunInput,
  ): WorkbenchScenarioRunRow | undefined {
    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];
    if (patch.status !== undefined) {
      assignments.push("status = ?");
      values.push(patch.status);
    }
    if (patch.overallStatus !== undefined) {
      assignments.push("overall_status = ?");
      values.push(patch.overallStatus);
    }
    if (patch.summary !== undefined) {
      assignments.push("summary = ?");
      values.push(patch.summary);
    }
    if (patch.reportArtifactId !== undefined) {
      assignments.push("report_artifact_id = ?");
      values.push(patch.reportArtifactId);
    }
    if (patch.startedAt !== undefined) {
      assignments.push("started_at = ?");
      values.push(patch.startedAt);
    }
    if (patch.finishedAt !== undefined) {
      assignments.push("finished_at = ?");
      values.push(patch.finishedAt);
    }
    if (patch.durationMs !== undefined) {
      assignments.push("duration_ms = ?");
      values.push(patch.durationMs);
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
      return this.get(scenarioRunId);
    }
    assignments.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(scenarioRunId);
    this.db.query(`
      UPDATE workbench_scenario_runs
      SET ${assignments.join(", ")}
      WHERE scenario_run_id = ?
    `).run(...values);
    return this.get(scenarioRunId);
  }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}
