import type { Database } from "bun:sqlite";

export type RunStatus =
  | "created"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "canceled";

export interface RunRow {
  run_id: string;
  space_id: string;
  compatibility_turn_id: string;
  status: RunStatus;
  trigger_source: string;
  requested_by_principal_id: string;
  requested_by_device_id: string;
  target_agent_id: string;
  input_text: string;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  error_code: string;
  error_message: string;
}

export interface CreateRunInput {
  runId: string;
  spaceId: string;
  compatibilityTurnId?: string;
  status?: RunStatus;
  triggerSource?: string;
  requestedByPrincipalId?: string;
  requestedByDeviceId?: string;
  targetAgentId?: string;
  inputText?: string;
  createdAt?: string;
}

export interface UpdateRunStatusInput {
  status: RunStatus;
  completedAt?: string | null;
  errorCode?: string;
  errorMessage?: string;
}

export class RunRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateRunInput): RunRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const status = input.status ?? "created";
    this.db.query(`
      INSERT INTO runs(
        run_id,
        space_id,
        compatibility_turn_id,
        status,
        trigger_source,
        requested_by_principal_id,
        requested_by_device_id,
        target_agent_id,
        input_text,
        created_at,
        started_at,
        completed_at,
        error_code,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', '')
    `).run(
      input.runId,
      input.spaceId,
      input.compatibilityTurnId ?? "",
      status,
      input.triggerSource ?? "space_input",
      input.requestedByPrincipalId ?? "",
      input.requestedByDeviceId ?? "",
      input.targetAgentId ?? "",
      input.inputText ?? "",
      createdAt,
      createdAt,
    );
    return this.getById(input.runId)!;
  }

  getById(runId: string): RunRow | undefined {
    return this.db.query(`
      SELECT * FROM runs WHERE run_id = ?
    `).get(runId) as RunRow | undefined ?? undefined;
  }

  getByCompatibilityTurnId(turnId: string): RunRow | undefined {
    return this.db.query(`
      SELECT * FROM runs
      WHERE compatibility_turn_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(turnId) as RunRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string, limit = 100): RunRow[] {
    return this.db.query(`
      SELECT * FROM runs
      WHERE space_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(spaceId, normalizeLimit(limit)) as RunRow[];
  }

  setStatus(runId: string, input: UpdateRunStatusInput): RunRow | undefined {
    const completedAt = input.completedAt === undefined
      ? (input.status === "completed" || input.status === "failed" || input.status === "canceled"
          ? new Date().toISOString()
          : null)
      : input.completedAt;
    this.db.query(`
      UPDATE runs
      SET status = ?,
          completed_at = ?,
          error_code = ?,
          error_message = ?
      WHERE run_id = ?
    `).run(
      input.status,
      completedAt,
      input.errorCode ?? "",
      input.errorMessage ?? "",
      runId,
    );
    return this.getById(runId);
  }
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(1000, Math.floor(value)));
}
