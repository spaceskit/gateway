import type { Database } from "bun:sqlite";

export type GatewayCapabilityGrantLevel = "read" | "write" | "execute";

export interface GatewayCapabilityGrantRow {
  principal_id: string;
  device_id: string;
  capability_id: string;
  level: GatewayCapabilityGrantLevel;
  source: string;
  reason: string;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  updated_at: string;
}

export interface UpsertGatewayCapabilityGrantInput {
  principalId: string;
  deviceId: string;
  capabilityId: string;
  level: GatewayCapabilityGrantLevel;
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt?: string;
  expiresAt?: string | null;
}

export interface RevokeGatewayCapabilityGrantInput {
  principalId: string;
  deviceId: string;
  capabilityId: string;
  reason: string;
  revokedBy: string;
  source: string;
}

export interface ListGatewayCapabilityGrantsQuery {
  principalId?: string;
  deviceId?: string;
  includeRevoked?: boolean;
  includeExpired?: boolean;
}

export interface ListEffectiveGatewayCapabilityGrantsQuery {
  principalId?: string;
  deviceId?: string;
  nowIso?: string;
}

export const GLOBAL_SCOPE = "*";

export class GatewayCapabilityGrantRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertGatewayCapabilityGrantInput): GatewayCapabilityGrantRow {
    const grantedAt = input.grantedAt ?? new Date().toISOString();
    const updatedAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_capability_grants (
        principal_id,
        device_id,
        capability_id,
        level,
        source,
        reason,
        granted_by,
        granted_at,
        expires_at,
        revoked_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(principal_id, device_id, capability_id) DO UPDATE SET
        level = excluded.level,
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
      input.capabilityId,
      input.level,
      input.source,
      input.reason,
      input.grantedBy,
      grantedAt,
      input.expiresAt ?? null,
      updatedAt,
    );

    const row = this.get(input.principalId, input.deviceId, input.capabilityId);
    if (!row) {
      throw new Error("Failed to load upserted gateway capability grant");
    }
    return row;
  }

  revoke(input: RevokeGatewayCapabilityGrantInput): GatewayCapabilityGrantRow | null {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE gateway_capability_grants
      SET revoked_at = ?,
          updated_at = ?,
          reason = ?,
          granted_by = ?,
          source = ?
      WHERE principal_id = ?
        AND device_id = ?
        AND capability_id = ?
        AND revoked_at IS NULL
    `).run(
      now,
      now,
      input.reason,
      input.revokedBy,
      input.source,
      input.principalId,
      input.deviceId,
      input.capabilityId,
    );

    return this.get(input.principalId, input.deviceId, input.capabilityId);
  }

  get(principalId: string, deviceId: string, capabilityId: string): GatewayCapabilityGrantRow | null {
    return this.db.query(`
      SELECT *
      FROM gateway_capability_grants
      WHERE principal_id = ?
        AND device_id = ?
        AND capability_id = ?
      LIMIT 1
    `).get(principalId, deviceId, capabilityId) as GatewayCapabilityGrantRow | null;
  }

  list(query: ListGatewayCapabilityGrantsQuery): GatewayCapabilityGrantRow[] {
    const params: Array<string | number> = [];
    const where: string[] = [];

    if (query.principalId) {
      where.push("(principal_id = ? OR principal_id = ?)");
      params.push(query.principalId, GLOBAL_SCOPE);
    }
    if (query.deviceId) {
      where.push("(device_id = ? OR device_id = ?)");
      params.push(query.deviceId, GLOBAL_SCOPE);
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
      FROM gateway_capability_grants
      ${whereSql}
      ORDER BY principal_id ASC, device_id ASC, capability_id ASC
    `).all(...params) as GatewayCapabilityGrantRow[];
  }

  listEffective(query: ListEffectiveGatewayCapabilityGrantsQuery): GatewayCapabilityGrantRow[] {
    const now = query.nowIso ?? new Date().toISOString();
    const principalId = query.principalId?.trim();
    const deviceId = query.deviceId?.trim();

    if (!principalId) {
      return this.db.query(`
        SELECT *
        FROM gateway_capability_grants
        WHERE principal_id = ?
          AND device_id = ?
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY capability_id ASC
      `).all(
        GLOBAL_SCOPE,
        GLOBAL_SCOPE,
        now,
      ) as GatewayCapabilityGrantRow[];
    }

    if (!deviceId) {
      return this.db.query(`
        SELECT *
        FROM gateway_capability_grants
        WHERE revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
          AND (
            (principal_id = ? AND device_id = ?)
            OR (principal_id = ? AND device_id = ?)
          )
        ORDER BY capability_id ASC
      `).all(
        now,
        GLOBAL_SCOPE,
        GLOBAL_SCOPE,
        principalId,
        GLOBAL_SCOPE,
      ) as GatewayCapabilityGrantRow[];
    }

    return this.db.query(`
      SELECT *
      FROM gateway_capability_grants
      WHERE revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND (
          (principal_id = ? AND device_id = ?)
          OR (principal_id = ? AND device_id = ?)
          OR (principal_id = ? AND device_id = ?)
        )
      ORDER BY capability_id ASC
    `).all(
      now,
      GLOBAL_SCOPE,
      GLOBAL_SCOPE,
      principalId,
      GLOBAL_SCOPE,
      principalId,
      deviceId,
    ) as GatewayCapabilityGrantRow[];
  }
}
