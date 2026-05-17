import type { Database } from "bun:sqlite";

export type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revised"
  | "deferred"
  | "expired";

export interface ApprovalRequestRow {
  approval_request_id: string;
  run_id: string;
  step_id: string;
  space_id: string;
  turn_id: string;
  agent_id: string;
  category: string;
  status: ApprovalRequestStatus;
  description: string;
  context_json: string;
  options_json: string;
  resolution: string;
  created_at: string;
  resolved_at: string | null;
}

export interface CreateApprovalRequestInput {
  approvalRequestId: string;
  runId: string;
  stepId: string;
  spaceId: string;
  turnId?: string;
  agentId?: string;
  category?: string;
  status?: ApprovalRequestStatus;
  description: string;
  contextJson?: string;
  optionsJson?: string;
  resolution?: string;
  createdAt?: string;
}

export class ApprovalRequestRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateApprovalRequestInput): ApprovalRequestRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO approval_requests(
        approval_request_id,
        run_id,
        step_id,
        space_id,
        turn_id,
        agent_id,
        category,
        status,
        description,
        context_json,
        options_json,
        resolution,
        created_at,
        resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.approvalRequestId,
      input.runId,
      input.stepId,
      input.spaceId,
      input.turnId ?? "",
      input.agentId ?? "",
      input.category ?? "",
      input.status ?? "pending",
      input.description,
      input.contextJson ?? "{}",
      input.optionsJson ?? "[]",
      input.resolution ?? "",
      createdAt,
    );
    return this.getById(input.approvalRequestId)!;
  }

  getById(approvalRequestId: string): ApprovalRequestRow | undefined {
    return this.db.query(`
      SELECT * FROM approval_requests WHERE approval_request_id = ?
    `).get(approvalRequestId) as ApprovalRequestRow | undefined ?? undefined;
  }

  listPendingBySpace(spaceId: string, limit = 100): ApprovalRequestRow[] {
    return this.db.query(`
      SELECT * FROM approval_requests
      WHERE space_id = ?
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(spaceId, normalizeLimit(limit)) as ApprovalRequestRow[];
  }

  setStatus(
    approvalRequestId: string,
    status: ApprovalRequestStatus,
    resolution?: string,
  ): ApprovalRequestRow | undefined {
    const resolvedAt = status === "pending" ? null : new Date().toISOString();
    this.db.query(`
      UPDATE approval_requests
      SET status = ?,
          resolution = COALESCE(?, resolution),
          resolved_at = ?
      WHERE approval_request_id = ?
    `).run(status, resolution ?? null, resolvedAt, approvalRequestId);
    return this.getById(approvalRequestId);
  }
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(1000, Math.floor(value)));
}
