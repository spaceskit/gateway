import type { Database } from "bun:sqlite";

export type ToolApprovalGrantMode = "time_window" | "durable";

export interface ToolApprovalGrantRow {
  principal_id: string;
  device_id: string;
  space_id: string;
  tool_id: string;
  mode: ToolApprovalGrantMode;
  source: string;
  reason: string;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  updated_at: string;
}

export interface UpsertToolApprovalGrantInput {
  principalId: string;
  deviceId: string;
  spaceId: string;
  toolId: string;
  mode: ToolApprovalGrantMode;
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt?: string;
  expiresAt?: string | null;
}

export interface RevokeToolApprovalGrantInput {
  principalId: string;
  deviceId: string;
  spaceId: string;
  toolId: string;
  reason: string;
  revokedBy: string;
  source: string;
}

export interface ListToolApprovalGrantsQuery {
  principalId?: string;
  deviceId?: string;
  spaceId?: string;
  toolId?: string;
  includeRevoked?: boolean;
  includeExpired?: boolean;
}

export interface ListEffectiveToolApprovalGrantsQuery {
  principalId: string;
  deviceId?: string;
  spaceId: string;
  toolId?: string;
  nowIso?: string;
}

export const TOOL_APPROVAL_GLOBAL_SCOPE = "*";

export class ToolApprovalGrantRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  upsert(input: UpsertToolApprovalGrantInput): ToolApprovalGrantRow {
    const grantedAt = input.grantedAt ?? new Date().toISOString();
    const updatedAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO tool_approval_grants (
        principal_id,
        device_id,
        space_id,
        tool_id,
        mode,
        source,
        reason,
        granted_by,
        granted_at,
        expires_at,
        revoked_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(principal_id, device_id, space_id, tool_id) DO UPDATE SET
        mode = excluded.mode,
        source = excluded.source,
        reason = excluded.reason,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        expires_at = excluded.expires_at,
        revoked_at = NULL,
        updated_at = excluded.updated_at
    `).run(
      input.principalId,
      input.deviceId,
      input.spaceId,
      input.toolId,
      input.mode,
      input.source,
      input.reason,
      input.grantedBy,
      grantedAt,
      input.expiresAt ?? null,
      updatedAt,
    );

    const row = this.get(input.principalId, input.deviceId, input.spaceId, input.toolId);
    if (!row) {
      throw new Error("Failed to load upserted tool approval grant");
    }
    return row;
  }

  revoke(input: RevokeToolApprovalGrantInput): ToolApprovalGrantRow | null {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE tool_approval_grants
      SET revoked_at = ?,
          updated_at = ?,
          reason = ?,
          granted_by = ?,
          source = ?
      WHERE principal_id = ?
        AND device_id = ?
        AND space_id = ?
        AND tool_id = ?
        AND revoked_at IS NULL
    `).run(
      now,
      now,
      input.reason,
      input.revokedBy,
      input.source,
      input.principalId,
      input.deviceId,
      input.spaceId,
      input.toolId,
    );

    return this.get(input.principalId, input.deviceId, input.spaceId, input.toolId);
  }

  get(principalId: string, deviceId: string, spaceId: string, toolId: string): ToolApprovalGrantRow | null {
    return this.db.query(`
      SELECT *
      FROM tool_approval_grants
      WHERE principal_id = ?
        AND device_id = ?
        AND space_id = ?
        AND tool_id = ?
      LIMIT 1
    `).get(principalId, deviceId, spaceId, toolId) as ToolApprovalGrantRow | null;
  }

  list(query: ListToolApprovalGrantsQuery): ToolApprovalGrantRow[] {
    const params: Array<string | number> = [];
    const where: string[] = [];

    if (query.principalId) {
      where.push("principal_id = ?");
      params.push(query.principalId);
    }
    if (query.deviceId) {
      where.push("(device_id = ? OR device_id = ?)");
      params.push(query.deviceId, TOOL_APPROVAL_GLOBAL_SCOPE);
    }
    if (query.spaceId) {
      where.push("space_id = ?");
      params.push(query.spaceId);
    }
    if (query.toolId) {
      where.push("tool_id = ?");
      params.push(query.toolId);
    }
    if (!query.includeRevoked) {
      where.push("revoked_at IS NULL");
    }
    if (!query.includeExpired) {
      where.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(new Date().toISOString());
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.query(`
      SELECT *
      FROM tool_approval_grants
      ${whereSql}
      ORDER BY space_id ASC, tool_id ASC, principal_id ASC, device_id ASC
    `).all(...params) as ToolApprovalGrantRow[];
  }

  listEffective(query: ListEffectiveToolApprovalGrantsQuery): ToolApprovalGrantRow[] {
    const now = query.nowIso ?? new Date().toISOString();
    const deviceId = query.deviceId?.trim() || TOOL_APPROVAL_GLOBAL_SCOPE;
    let toolFilter = "";
    if (query.toolId?.trim()) {
      toolFilter = "AND tool_id = ?";
    }

    return this.db.query(`
      SELECT *
      FROM tool_approval_grants
      WHERE principal_id = ?
        AND space_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND (
          device_id = ?
          OR device_id = ?
        )
        ${toolFilter}
      ORDER BY tool_id ASC
    `).all(
      query.principalId,
      query.spaceId,
      now,
      deviceId,
      TOOL_APPROVAL_GLOBAL_SCOPE,
      ...(query.toolId?.trim() ? [query.toolId.trim()] : []),
    ) as ToolApprovalGrantRow[];
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_approval_grants (
        principal_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        space_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        granted_by TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_id, device_id, space_id, tool_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tool_approval_grants_effective
        ON tool_approval_grants (principal_id, space_id, tool_id, revoked_at, expires_at);
    `);
  }
}
