import type { Database, SQLQueryBindings } from "bun:sqlite";

export type WorkbenchBatchStatus = "draft" | "queued" | "running" | "completed" | "cancelled";
export type WorkbenchExecutionMode = "supervised" | "autonomous";

export interface WorkbenchBatchRow {
  batch_id: string;
  name: string;
  status: WorkbenchBatchStatus;
  execution_mode: WorkbenchExecutionMode;
  queue_item_ids_json: string;
  created_by_principal_id: string;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkbenchBatchInput {
  batchId: string;
  name: string;
  status?: WorkbenchBatchStatus;
  executionMode: WorkbenchExecutionMode;
  queueItemIdsJson: string;
  createdByPrincipalId: string;
}

export interface UpdateWorkbenchBatchInput {
  name?: string;
  status?: WorkbenchBatchStatus;
  executionMode?: WorkbenchExecutionMode;
  queueItemIdsJson?: string;
}

export class WorkbenchBatchRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateWorkbenchBatchInput): WorkbenchBatchRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO workbench_batches(
        batch_id,
        name,
        status,
        execution_mode,
        queue_item_ids_json,
        created_by_principal_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.batchId,
      input.name,
      input.status ?? "draft",
      input.executionMode,
      input.queueItemIdsJson,
      input.createdByPrincipalId,
      now,
      now,
    );
    return this.get(input.batchId)!;
  }

  get(batchId: string): WorkbenchBatchRow | undefined {
    return this.db.query(`
      SELECT * FROM workbench_batches
      WHERE batch_id = ?
    `).get(batchId) as WorkbenchBatchRow | undefined ?? undefined;
  }

  list(limit = 100): WorkbenchBatchRow[] {
    const normalizedLimit = normalizeLimit(limit);
    return this.db.query(`
      SELECT * FROM workbench_batches
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(normalizedLimit) as WorkbenchBatchRow[];
  }

  update(batchId: string, patch: UpdateWorkbenchBatchInput): WorkbenchBatchRow | undefined {
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
    if (patch.executionMode !== undefined) {
      assignments.push("execution_mode = ?");
      values.push(patch.executionMode);
    }
    if (patch.queueItemIdsJson !== undefined) {
      assignments.push("queue_item_ids_json = ?");
      values.push(patch.queueItemIdsJson);
    }

    if (assignments.length === 0) {
      return this.get(batchId);
    }

    assignments.push("updated_at = ?");
    values.push(new Date().toISOString(), batchId);

    this.db.query(`
      UPDATE workbench_batches
      SET ${assignments.join(", ")}
      WHERE batch_id = ?
    `).run(...values);

    return this.get(batchId);
  }
}

function normalizeLimit(limit: number, fallback = 100): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}
