/**
 * Space participants repository — tracks principal-level access mode for shared spaces.
 */

import type { Database } from "bun:sqlite";
import type { SpaceShareAccessMode } from "./space-share-invites.js";

export type SpaceParticipantStatus = "active" | "revoked";

export interface SpaceParticipantRow {
  participant_id: string;
  space_id: string;
  principal_id: string;
  principal_type: string;
  mode: string;
  status: string;
  joined_via_invite_id: string | null;
  device_id: string | null;
  device_public_key: string | null;
  joined_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface UpsertSpaceParticipantInput {
  participantId: string;
  spaceId: string;
  principalId: string;
  principalType?: string;
  mode: SpaceShareAccessMode;
  joinedViaInviteId?: string | null;
  deviceId?: string | null;
  devicePublicKey?: string | null;
}

export class SpaceParticipantRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertSpaceParticipantInput): SpaceParticipantRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_participants(
        participant_id,
        space_id,
        principal_id,
        principal_type,
        mode,
        status,
        joined_via_invite_id,
        device_id,
        device_public_key,
        joined_at,
        updated_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(space_id, principal_id) DO UPDATE SET
        mode = excluded.mode,
        status = 'active',
        joined_via_invite_id = excluded.joined_via_invite_id,
        device_id = excluded.device_id,
        device_public_key = excluded.device_public_key,
        updated_at = excluded.updated_at,
        revoked_at = NULL
    `).run(
      input.participantId,
      input.spaceId,
      input.principalId,
      input.principalType ?? "public_key",
      input.mode,
      input.joinedViaInviteId ?? null,
      input.deviceId ?? null,
      input.devicePublicKey ?? null,
      now,
      now,
    );

    return this.getBySpaceAndPrincipal(input.spaceId, input.principalId)!;
  }

  getById(participantId: string): SpaceParticipantRow | undefined {
    return this.db.query(`
      SELECT * FROM space_participants WHERE participant_id = ?
    `).get(participantId) as SpaceParticipantRow | undefined ?? undefined;
  }

  getBySpaceAndPrincipal(spaceId: string, principalId: string): SpaceParticipantRow | undefined {
    return this.db.query(`
      SELECT * FROM space_participants
      WHERE space_id = ? AND principal_id = ?
    `).get(spaceId, principalId) as SpaceParticipantRow | undefined ?? undefined;
  }

  getActiveByPrincipal(spaceId: string, principalId: string): SpaceParticipantRow | undefined {
    return this.db.query(`
      SELECT * FROM space_participants
      WHERE space_id = ? AND principal_id = ? AND status = 'active'
      LIMIT 1
    `).get(spaceId, principalId) as SpaceParticipantRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string, limit = 200): SpaceParticipantRow[] {
    return this.db.query(`
      SELECT * FROM space_participants
      WHERE space_id = ?
      ORDER BY joined_at ASC
      LIMIT ?
    `).all(spaceId, limit) as SpaceParticipantRow[];
  }

  listActiveBySpace(spaceId: string, limit = 200): SpaceParticipantRow[] {
    return this.db.query(`
      SELECT * FROM space_participants
      WHERE space_id = ?
        AND status = 'active'
      ORDER BY joined_at ASC
      LIMIT ?
    `).all(spaceId, limit) as SpaceParticipantRow[];
  }

  countActiveBySpace(spaceId: string): number {
    const row = this.db.query(`
      SELECT COUNT(*) AS count
      FROM space_participants
      WHERE space_id = ?
        AND status = 'active'
    `).get(spaceId) as { count: number };
    return row.count;
  }

  revoke(spaceId: string, participantId: string): boolean {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE space_participants
      SET status = 'revoked',
          revoked_at = ?,
          updated_at = ?
      WHERE participant_id = ?
        AND space_id = ?
        AND status = 'active'
    `).run(now, now, participantId, spaceId).changes > 0;
  }
}

