import type { Database } from "bun:sqlite";

export type AccessGrantTargetKind = "dangerous_capability" | "tool_selector";
export type AccessGrantMode = "time_window" | "durable";

export interface AccessGrantRow {
  principal_id: string;
  device_id: string;
  space_id: string;
  target_kind: AccessGrantTargetKind;
  target_id: string;
  mode: AccessGrantMode;
  source: string;
  reason: string;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  updated_at: string;
}

export interface UpsertAccessGrantInput {
  principalId: string;
  deviceId: string;
  spaceId: string;
  targetKind: AccessGrantTargetKind;
  targetId: string;
  mode: AccessGrantMode;
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt?: string;
  expiresAt?: string | null;
}

export interface ListEffectiveAccessGrantsQuery {
  principalId?: string;
  deviceId?: string;
  spaceId: string;
  targetKind?: AccessGrantTargetKind;
  targetIds?: string[];
  nowIso?: string;
}

export interface RevokeAccessGrantInput {
  principalId: string;
  deviceId: string;
  spaceId: string;
  targetKind: AccessGrantTargetKind;
  targetId: string;
  reason: string;
  revokedBy: string;
  source: string;
}

export const ACCESS_GRANT_GLOBAL_SCOPE = "*";

export class AccessGrantRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  upsert(input: UpsertAccessGrantInput): AccessGrantRow {
    const grantedAt = input.grantedAt ?? new Date().toISOString();
    const updatedAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO access_grants (
        principal_id,
        device_id,
        space_id,
        target_kind,
        target_id,
        mode,
        source,
        reason,
        granted_by,
        granted_at,
        expires_at,
        revoked_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(principal_id, device_id, space_id, target_kind, target_id) DO UPDATE SET
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
      input.targetKind,
      input.targetId,
      input.mode,
      input.source,
      input.reason,
      input.grantedBy,
      grantedAt,
      input.expiresAt ?? null,
      updatedAt,
    );
    return this.get(
      input.principalId,
      input.deviceId,
      input.spaceId,
      input.targetKind,
      input.targetId,
    )!;
  }

  revoke(input: RevokeAccessGrantInput): AccessGrantRow | null {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE access_grants
      SET revoked_at = ?,
          updated_at = ?,
          reason = ?,
          granted_by = ?,
          source = ?
      WHERE principal_id = ?
        AND device_id = ?
        AND space_id = ?
        AND target_kind = ?
        AND target_id = ?
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
      input.targetKind,
      input.targetId,
    );
    return this.get(
      input.principalId,
      input.deviceId,
      input.spaceId,
      input.targetKind,
      input.targetId,
    );
  }

  get(
    principalId: string,
    deviceId: string,
    spaceId: string,
    targetKind: AccessGrantTargetKind,
    targetId: string,
  ): AccessGrantRow | null {
    return this.db.query(`
      SELECT *
      FROM access_grants
      WHERE principal_id = ?
        AND device_id = ?
        AND space_id = ?
        AND target_kind = ?
        AND target_id = ?
      LIMIT 1
    `).get(principalId, deviceId, spaceId, targetKind, targetId) as AccessGrantRow | null;
  }

  listEffective(query: ListEffectiveAccessGrantsQuery): AccessGrantRow[] {
    const now = query.nowIso ?? new Date().toISOString();
    const principalId = query.principalId?.trim();
    const deviceId = query.deviceId?.trim() || ACCESS_GRANT_GLOBAL_SCOPE;
    const targetKindClause = query.targetKind ? "AND target_kind = ?" : "";
    const targetIdValues = (query.targetIds ?? []).map((value) => value.trim()).filter(Boolean);
    const targetIdClause = targetIdValues.length > 0
      ? `AND target_id IN (${targetIdValues.map(() => "?").join(", ")})`
      : "";

    const baseParams: Array<string> = [];
    if (!principalId) {
      baseParams.push(ACCESS_GRANT_GLOBAL_SCOPE, ACCESS_GRANT_GLOBAL_SCOPE, query.spaceId, now);
      if (query.targetKind) baseParams.push(query.targetKind);
      baseParams.push(...targetIdValues);
      return this.db.query(`
        SELECT *
        FROM access_grants
        WHERE principal_id = ?
          AND device_id = ?
          AND space_id = ?
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
          ${targetKindClause}
          ${targetIdClause}
        ORDER BY target_kind ASC, target_id ASC
      `).all(...baseParams) as AccessGrantRow[];
    }

    const params: Array<string> = [
      query.spaceId,
      now,
      ACCESS_GRANT_GLOBAL_SCOPE,
      ACCESS_GRANT_GLOBAL_SCOPE,
      principalId,
      ACCESS_GRANT_GLOBAL_SCOPE,
      principalId,
      deviceId,
    ];
    if (query.targetKind) params.push(query.targetKind);
    params.push(...targetIdValues);
    return this.db.query(`
      SELECT *
      FROM access_grants
      WHERE space_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND (
          (principal_id = ? AND device_id = ?)
          OR (principal_id = ? AND device_id = ?)
          OR (principal_id = ? AND device_id = ?)
        )
        ${targetKindClause}
        ${targetIdClause}
      ORDER BY target_kind ASC, target_id ASC
    `).all(...params) as AccessGrantRow[];
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS access_grants (
        principal_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        space_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        granted_by TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_id, device_id, space_id, target_kind, target_id)
      );
      CREATE INDEX IF NOT EXISTS idx_access_grants_effective
        ON access_grants (space_id, principal_id, device_id, target_kind, target_id, revoked_at, expires_at);
    `);
  }
}
