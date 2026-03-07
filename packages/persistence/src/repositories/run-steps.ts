import type { Database } from "bun:sqlite";

export type RunStepKind =
  | "model_invocation"
  | "executor_invocation"
  | "local_runtime_invocation"
  | "tool_invocation"
  | "approval_wait"
  | "artifact_write"
  | "summary"
  | "output_stream";

export type RunStepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "canceled";

export interface RunStepRow {
  step_id: string;
  run_id: string;
  space_id: string;
  agent_id: string;
  sequence_no: number;
  kind: RunStepKind;
  status: RunStepStatus;
  title: string;
  detail_text: string;
  tool_name: string;
  provider_id: string;
  model_id: string;
  payload_json: string;
  output_json: string | null;
  error_message: string;
  created_at: string;
  started_at: string;
  completed_at: string | null;
}

export interface CreateRunStepInput {
  stepId: string;
  runId: string;
  spaceId: string;
  agentId?: string;
  sequenceNo?: number;
  kind: RunStepKind;
  status?: RunStepStatus;
  title?: string;
  detailText?: string;
  toolName?: string;
  providerId?: string;
  modelId?: string;
  payloadJson?: string;
  outputJson?: string | null;
  errorMessage?: string;
  createdAt?: string;
}

export interface UpdateRunStepStatusInput {
  status: RunStepStatus;
  title?: string;
  detailText?: string;
  providerId?: string;
  modelId?: string;
  outputJson?: string | null;
  errorMessage?: string;
  completedAt?: string | null;
}

export class RunStepRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateRunStepInput): RunStepRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO run_steps(
        step_id,
        run_id,
        space_id,
        agent_id,
        sequence_no,
        kind,
        status,
        title,
        detail_text,
        tool_name,
        provider_id,
        model_id,
        payload_json,
        output_json,
        error_message,
        created_at,
        started_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.stepId,
      input.runId,
      input.spaceId,
      input.agentId ?? "",
      normalizeSequence(input.sequenceNo),
      input.kind,
      input.status ?? "running",
      input.title ?? "",
      input.detailText ?? "",
      input.toolName ?? "",
      input.providerId ?? "",
      input.modelId ?? "",
      input.payloadJson ?? "{}",
      input.outputJson ?? null,
      input.errorMessage ?? "",
      createdAt,
      createdAt,
    );
    return this.getById(input.stepId)!;
  }

  getById(stepId: string): RunStepRow | undefined {
    return this.db.query(`
      SELECT * FROM run_steps WHERE step_id = ?
    `).get(stepId) as RunStepRow | undefined ?? undefined;
  }

  listByRun(runId: string): RunStepRow[] {
    return this.db.query(`
      SELECT * FROM run_steps
      WHERE run_id = ?
      ORDER BY sequence_no ASC, created_at ASC
    `).all(runId) as RunStepRow[];
  }

  setStatus(stepId: string, input: UpdateRunStepStatusInput): RunStepRow | undefined {
    const completedAt = input.completedAt === undefined
      ? (input.status === "completed" || input.status === "failed" || input.status === "canceled"
          ? new Date().toISOString()
          : null)
      : input.completedAt;
    this.db.query(`
      UPDATE run_steps
      SET status = ?,
          title = COALESCE(?, title),
          detail_text = COALESCE(?, detail_text),
          provider_id = COALESCE(?, provider_id),
          model_id = COALESCE(?, model_id),
          output_json = COALESCE(?, output_json),
          error_message = COALESCE(?, error_message),
          completed_at = ?
      WHERE step_id = ?
    `).run(
      input.status,
      input.title ?? null,
      input.detailText ?? null,
      input.providerId ?? null,
      input.modelId ?? null,
      input.outputJson ?? null,
      input.errorMessage ?? null,
      completedAt,
      stepId,
    );
    return this.getById(stepId);
  }
}

function normalizeSequence(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
