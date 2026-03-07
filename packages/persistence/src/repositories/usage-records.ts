import type { Database } from "bun:sqlite";

export interface UsageRecordRow {
  usage_record_id: string;
  run_id: string;
  step_id: string;
  invocation_id: string;
  space_id: string;
  provider_id: string;
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  token_accuracy: "reported" | "estimated" | "mixed";
  metadata_json: string;
  created_at: string;
}

export interface CreateUsageRecordInput {
  usageRecordId: string;
  runId: string;
  stepId: string;
  invocationId?: string;
  spaceId: string;
  providerId?: string;
  modelId?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  tokenAccuracy?: "reported" | "estimated" | "mixed";
  metadataJson?: string;
  createdAt?: string;
}

export class UsageRecordRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateUsageRecordInput): UsageRecordRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO usage_records(
        usage_record_id,
        run_id,
        step_id,
        invocation_id,
        space_id,
        provider_id,
        model_id,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        estimated_cost_usd,
        token_accuracy,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.usageRecordId,
      input.runId,
      input.stepId,
      input.invocationId ?? "",
      input.spaceId,
      input.providerId ?? "",
      input.modelId ?? "",
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      input.totalTokens ?? 0,
      input.estimatedCostUsd ?? 0,
      input.tokenAccuracy ?? "reported",
      input.metadataJson ?? "{}",
      createdAt,
    );
    return this.getById(input.usageRecordId)!;
  }

  getById(usageRecordId: string): UsageRecordRow | undefined {
    return this.db.query(`
      SELECT * FROM usage_records WHERE usage_record_id = ?
    `).get(usageRecordId) as UsageRecordRow | undefined ?? undefined;
  }

  listByRun(runId: string): UsageRecordRow[] {
    return this.db.query(`
      SELECT * FROM usage_records
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as UsageRecordRow[];
  }
}
