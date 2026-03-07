/**
 * Space share invite repository — stores zero-trust invite tokens and lifecycle status.
 */

import type { Database } from "bun:sqlite";

export type SpaceShareAccessMode = "read_only" | "collaborator";
export type SpaceShareInviteStatus = "active" | "used" | "revoked" | "expired";

export interface SpaceShareInviteRow {
  invite_id: string;
  space_id: string;
  issued_by_principal_id: string;
  mode: string;
  token_hash: string;
  relay_invite_id: string;
  relay_url: string;
  relay_session_scope_json: string;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSpaceShareInviteInput {
  inviteId: string;
  spaceId: string;
  issuedByPrincipalId: string;
  mode: SpaceShareAccessMode;
  tokenHash: string;
  relayInviteId?: string;
  relayUrl?: string;
  relaySessionScopeJson?: string;
  expiresAt?: string | null;
}

export class SpaceShareInviteRepository {
  constructor(private db: Database) {}

  create(input: CreateSpaceShareInviteInput): SpaceShareInviteRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_share_invites(
        invite_id,
        space_id,
        issued_by_principal_id,
        mode,
        token_hash,
        relay_invite_id,
        relay_url,
        relay_session_scope_json,
        status,
        expires_at,
        last_used_at,
        revoked_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?)
    `).run(
      input.inviteId,
      input.spaceId,
      input.issuedByPrincipalId,
      input.mode,
      input.tokenHash,
      input.relayInviteId ?? "",
      input.relayUrl ?? "",
      input.relaySessionScopeJson ?? "{}",
      input.expiresAt ?? null,
      now,
      now,
    );

    return this.getById(input.inviteId)!;
  }

  getById(inviteId: string): SpaceShareInviteRow | undefined {
    return this.db.query(`
      SELECT * FROM space_share_invites WHERE invite_id = ?
    `).get(inviteId) as SpaceShareInviteRow | undefined ?? undefined;
  }

  getActiveByTokenHash(spaceId: string, tokenHash: string, nowIso: string): SpaceShareInviteRow | undefined {
    return this.db.query(`
      SELECT * FROM space_share_invites
      WHERE space_id = ?
        AND token_hash = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
      LIMIT 1
    `).get(spaceId, tokenHash, nowIso) as SpaceShareInviteRow | undefined ?? undefined;
  }

  getActiveByRelayInviteId(relayInviteId: string, nowIso: string): SpaceShareInviteRow | undefined {
    return this.db.query(`
      SELECT * FROM space_share_invites
      WHERE relay_invite_id = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
      LIMIT 1
    `).get(relayInviteId, nowIso) as SpaceShareInviteRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string, limit = 200): SpaceShareInviteRow[] {
    return this.db.query(`
      SELECT * FROM space_share_invites
      WHERE space_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(spaceId, limit) as SpaceShareInviteRow[];
  }

  countActiveBySpace(spaceId: string, nowIso: string): number {
    const row = this.db.query(`
      SELECT COUNT(*) AS count
      FROM space_share_invites
      WHERE space_id = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > ?)
    `).get(spaceId, nowIso) as { count: number };
    return row.count;
  }

  markUsed(inviteId: string): boolean {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE space_share_invites
      SET status = 'used',
          last_used_at = ?,
          updated_at = ?
      WHERE invite_id = ?
        AND status = 'active'
    `).run(now, now, inviteId).changes > 0;
  }

  revoke(inviteId: string): boolean {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE space_share_invites
      SET status = 'revoked',
          revoked_at = ?,
          updated_at = ?
      WHERE invite_id = ?
        AND status IN ('active', 'used')
    `).run(now, now, inviteId).changes > 0;
  }

  markExpired(inviteId: string): boolean {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE space_share_invites
      SET status = 'expired',
          updated_at = ?
      WHERE invite_id = ?
        AND status = 'active'
    `).run(now, inviteId).changes > 0;
  }

  expireBefore(nowIso: string): number {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE space_share_invites
      SET status = 'expired',
          updated_at = ?
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at <= ?
    `).run(now, nowIso).changes;
  }
}
