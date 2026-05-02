/**
 * Invite tokens repository — stores short-lived, single-use invite tokens
 * issued by the gateway for v2 invite links.
 *
 * Each token is signed with the dedicated invite-signing key from
 * `auth_keys` (role = "invite-signing"). Tokens are atomically consumed on
 * first successful join via `consumeOnce`.
 */

import type { Database } from "bun:sqlite";

export interface InviteTokenRow {
  token_id: string;
  space_id: string;
  signed_token: string;
  mode: string;
  signing_kid: string;
  issued_by_principal_id: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface CreateInviteTokenInput {
  tokenId: string;
  spaceId: string;
  signedToken: string;
  mode: string;
  signingKid: string;
  expiresAt: string;
  issuedByPrincipalId?: string;
}

export class InviteTokenRepository {
  constructor(private db: Database) {}

  create(input: CreateInviteTokenInput): InviteTokenRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO invite_tokens(
        token_id,
        space_id,
        signed_token,
        mode,
        signing_kid,
        issued_by_principal_id,
        expires_at,
        consumed_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      input.tokenId,
      input.spaceId,
      input.signedToken,
      input.mode,
      input.signingKid,
      input.issuedByPrincipalId ?? "",
      input.expiresAt,
      now,
    );

    return this.getByTokenId(input.tokenId)!;
  }

  getByTokenId(tokenId: string): InviteTokenRow | undefined {
    return this.db.query(`
      SELECT * FROM invite_tokens WHERE token_id = ? LIMIT 1
    `).get(tokenId) as InviteTokenRow | undefined ?? undefined;
  }

  getBySignedToken(signedToken: string): InviteTokenRow | undefined {
    return this.db.query(`
      SELECT * FROM invite_tokens WHERE signed_token = ? LIMIT 1
    `).get(signedToken) as InviteTokenRow | undefined ?? undefined;
  }

  /**
   * Atomic single-shot consume: marks the token consumed only if it has
   * not already been consumed. Returns true on success, false if the
   * token was already consumed (or does not exist).
   */
  consumeOnce(tokenId: string, nowIso: string = new Date().toISOString()): boolean {
    return this.db.query(`
      UPDATE invite_tokens
      SET consumed_at = ?
      WHERE token_id = ?
        AND consumed_at IS NULL
    `).run(nowIso, tokenId).changes > 0;
  }

  listBySpace(spaceId: string, limit = 200): InviteTokenRow[] {
    return this.db.query(`
      SELECT * FROM invite_tokens
      WHERE space_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(spaceId, limit) as InviteTokenRow[];
  }

  deleteExpired(nowIso: string = new Date().toISOString()): number {
    return this.db.query(`
      DELETE FROM invite_tokens
      WHERE consumed_at IS NULL
        AND expires_at <= ?
    `).run(nowIso).changes;
  }
}
