/**
 * Space context transfer repository — audit trail for share/import flow.
 */

import type { Database } from "bun:sqlite";

export interface SpaceContextTransferRow {
  transfer_id: string;
  source_space_id: string;
  target_space_id: string;
  artifact_id: string;
  status: string;
  denial_reason: string;
  created_at: string;
  applied_at: string | null;
}

export interface CreateSpaceContextTransferInput {
  transferId: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  artifactId: string;
  status: "shared" | "imported" | "denied";
  denialReason?: string;
}

export class SpaceContextTransferRepository {
  constructor(private db: Database) {}

  create(input: CreateSpaceContextTransferInput): SpaceContextTransferRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_context_transfers(
        transfer_id, source_space_id, target_space_id, artifact_id,
        status, denial_reason, created_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.transferId,
      input.sourceSpaceId,
      input.targetSpaceId,
      input.artifactId,
      input.status,
      input.denialReason ?? "",
      now,
      input.status === "imported" ? now : null,
    );

    return this.getById(input.transferId)!;
  }

  getById(transferId: string): SpaceContextTransferRow | undefined {
    return this.db.query(`
      SELECT * FROM space_context_transfers WHERE transfer_id = ?
    `).get(transferId) as SpaceContextTransferRow | undefined ?? undefined;
  }

  listShared(sourceSpaceId: string, targetSpaceId: string, limit = 200): SpaceContextTransferRow[] {
    return this.db.query(`
      SELECT * FROM space_context_transfers
      WHERE source_space_id = ? AND target_space_id = ? AND status = 'shared'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(sourceSpaceId, targetSpaceId, limit) as SpaceContextTransferRow[];
  }

  markImported(transferId: string): void {
    this.db.query(`
      UPDATE space_context_transfers
      SET status = 'imported', denial_reason = '', applied_at = ?
      WHERE transfer_id = ?
    `).run(new Date().toISOString(), transferId);
  }

  markDenied(transferId: string, reason: string): void {
    this.db.query(`
      UPDATE space_context_transfers
      SET status = 'denied', denial_reason = ?, applied_at = NULL
      WHERE transfer_id = ?
    `).run(reason, transferId);
  }
}

