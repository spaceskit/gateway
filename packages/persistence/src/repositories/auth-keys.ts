/**
 * Auth keys repository — stores gateway-managed signing keys keyed by role.
 *
 * Distinct from device_identities (per-device principals) and the gateway
 * principal key. Used today for the dedicated invite-signing key so that
 * invite tokens can be rotated independently of the gateway principal.
 */

import type { Database } from "bun:sqlite";

export type AuthKeyAlgorithm = "Ed25519";

export interface AuthKeyRow {
  kid: string;
  role: string;
  algorithm: string;
  public_key: string;
  private_key: string;
  created_at: string;
  rotated_at: string | null;
}

export interface CreateAuthKeyInput {
  kid: string;
  role: string;
  algorithm: AuthKeyAlgorithm;
  publicKey: string;
  privateKey: string;
}

export class AuthKeyRepository {
  constructor(private db: Database) {}

  create(input: CreateAuthKeyInput): AuthKeyRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO auth_keys(
        kid,
        role,
        algorithm,
        public_key,
        private_key,
        created_at,
        rotated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.kid,
      input.role,
      input.algorithm,
      input.publicKey,
      input.privateKey,
      now,
    );

    return this.getByKid(input.kid)!;
  }

  getByKid(kid: string): AuthKeyRow | undefined {
    return this.db.query(`
      SELECT * FROM auth_keys WHERE kid = ? LIMIT 1
    `).get(kid) as AuthKeyRow | undefined ?? undefined;
  }

  /**
   * Returns the most recently created non-rotated key for a role, or
   * undefined if no key exists for that role yet.
   */
  getActiveByRole(role: string): AuthKeyRow | undefined {
    return this.db.query(`
      SELECT * FROM auth_keys
      WHERE role = ?
        AND rotated_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get(role) as AuthKeyRow | undefined ?? undefined;
  }

  markRotated(kid: string): boolean {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE auth_keys
      SET rotated_at = ?
      WHERE kid = ?
        AND rotated_at IS NULL
    `).run(now, kid).changes > 0;
  }
}
