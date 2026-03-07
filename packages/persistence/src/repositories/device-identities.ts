/**
 * Device identity repository — stores per-principal device keys and lifecycle state.
 */

import type { Database } from "bun:sqlite";

export type DeviceIdentityStatus = "active" | "revoked" | "rotated";

export interface DeviceIdentityRow {
  device_id: string;
  principal_id: string;
  public_key: string;
  platform: string;
  key_version: number;
  status: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface CreateDeviceIdentityInput {
  deviceId: string;
  principalId: string;
  publicKey: string;
  platform?: string;
}

export class DeviceIdentityRepository {
  constructor(private db: Database) {}

  create(input: CreateDeviceIdentityInput): DeviceIdentityRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO device_identities(
        device_id,
        principal_id,
        public_key,
        platform,
        key_version,
        status,
        created_at,
        updated_at,
        last_seen_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, 1, 'active', ?, ?, ?, NULL)
    `).run(
      input.deviceId,
      input.principalId,
      input.publicKey,
      input.platform ?? "",
      now,
      now,
      now,
    );

    return this.getByPrincipalAndDevice(input.principalId, input.deviceId)!;
  }

  getByPrincipalAndDevice(principalId: string, deviceId: string): DeviceIdentityRow | undefined {
    return this.db.query(`
      SELECT *
      FROM device_identities
      WHERE principal_id = ?
        AND device_id = ?
      LIMIT 1
    `).get(principalId, deviceId) as DeviceIdentityRow | undefined ?? undefined;
  }

  listByPrincipal(principalId: string, includeRevoked = true): DeviceIdentityRow[] {
    if (includeRevoked) {
      return this.db.query(`
        SELECT *
        FROM device_identities
        WHERE principal_id = ?
        ORDER BY updated_at DESC
      `).all(principalId) as DeviceIdentityRow[];
    }

    return this.db.query(`
      SELECT *
      FROM device_identities
      WHERE principal_id = ?
        AND status != 'revoked'
      ORDER BY updated_at DESC
    `).all(principalId) as DeviceIdentityRow[];
  }

  touchLastSeen(principalId: string, deviceId: string): boolean {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE device_identities
      SET last_seen_at = ?,
          updated_at = ?
      WHERE principal_id = ?
        AND device_id = ?
    `).run(now, now, principalId, deviceId).changes > 0;
  }

  rotateKey(input: {
    principalId: string;
    deviceId: string;
    nextPublicKey: string;
    platform?: string;
  }): DeviceIdentityRow | undefined {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE device_identities
      SET public_key = ?,
          platform = ?,
          key_version = key_version + 1,
          status = 'active',
          revoked_at = NULL,
          last_seen_at = ?,
          updated_at = ?
      WHERE principal_id = ?
        AND device_id = ?
    `).run(
      input.nextPublicKey,
      input.platform ?? "",
      now,
      now,
      input.principalId,
      input.deviceId,
    );

    return this.getByPrincipalAndDevice(input.principalId, input.deviceId);
  }

  revoke(principalId: string, deviceId: string): boolean {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE device_identities
      SET status = 'revoked',
          revoked_at = ?,
          updated_at = ?
      WHERE principal_id = ?
        AND device_id = ?
        AND status != 'revoked'
    `).run(now, now, principalId, deviceId).changes > 0;
  }
}
