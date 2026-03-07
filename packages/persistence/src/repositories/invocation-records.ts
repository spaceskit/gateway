import type { Database } from "bun:sqlite";

export type IntegrationClass = "cloud" | "executor" | "local_runtime";
export type InvocationRecordStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export interface InvocationRecordRow {
  invocation_id: string;
  run_id: string;
  step_id: string;
  space_id: string;
  integration_id: string;
  integration_class: IntegrationClass;
  status: InvocationRecordStatus;
  provider_id: string;
  model_id: string;
  request_json: string;
  response_json: string | null;
  usage_json: string;
  error_message: string;
  created_at: string;
  started_at: string;
  completed_at: string | null;
}

export interface CreateInvocationRecordInput {
  invocationId: string;
  runId: string;
  stepId: string;
  spaceId: string;
  integrationId?: string;
  integrationClass: IntegrationClass;
  status?: InvocationRecordStatus;
  providerId?: string;
  modelId?: string;
  requestJson?: string;
  responseJson?: string | null;
  usageJson?: string;
  errorMessage?: string;
  createdAt?: string;
}

export interface UpdateInvocationRecordInput {
  status: InvocationRecordStatus;
  responseJson?: string | null;
  usageJson?: string;
  errorMessage?: string;
  completedAt?: string | null;
}

export class InvocationRecordRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateInvocationRecordInput): InvocationRecordRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO invocation_records(
        invocation_id,
        run_id,
        step_id,
        space_id,
        integration_id,
        integration_class,
        status,
        provider_id,
        model_id,
        request_json,
        response_json,
        usage_json,
        error_message,
        created_at,
        started_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.invocationId,
      input.runId,
      input.stepId,
      input.spaceId,
      input.integrationId ?? "",
      input.integrationClass,
      input.status ?? "running",
      input.providerId ?? "",
      input.modelId ?? "",
      input.requestJson ?? "{}",
      input.responseJson ?? null,
      input.usageJson ?? "{}",
      input.errorMessage ?? "",
      createdAt,
      createdAt,
    );
    return this.getById(input.invocationId)!;
  }

  getById(invocationId: string): InvocationRecordRow | undefined {
    return this.db.query(`
      SELECT * FROM invocation_records WHERE invocation_id = ?
    `).get(invocationId) as InvocationRecordRow | undefined ?? undefined;
  }

  listByRun(runId: string): InvocationRecordRow[] {
    return this.db.query(`
      SELECT * FROM invocation_records
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as InvocationRecordRow[];
  }

  setStatus(invocationId: string, input: UpdateInvocationRecordInput): InvocationRecordRow | undefined {
    const completedAt = input.completedAt === undefined
      ? (input.status === "completed" || input.status === "failed" || input.status === "canceled"
          ? new Date().toISOString()
          : null)
      : input.completedAt;
    this.db.query(`
      UPDATE invocation_records
      SET status = ?,
          response_json = COALESCE(?, response_json),
          usage_json = COALESCE(?, usage_json),
          error_message = COALESCE(?, error_message),
          completed_at = ?
      WHERE invocation_id = ?
    `).run(
      input.status,
      input.responseJson ?? null,
      input.usageJson ?? null,
      input.errorMessage ?? null,
      completedAt,
      invocationId,
    );
    return this.getById(invocationId);
  }
}
