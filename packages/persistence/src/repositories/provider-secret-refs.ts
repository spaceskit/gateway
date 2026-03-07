import type { Database } from "bun:sqlite";

export interface ProviderSecretRefRow {
  secret_ref: string;
  provider_id: string;
  label: string;
  backend: string;
  encrypted_secret: string;
  iv: string;
  auth_tag: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface UpsertProviderSecretRefInput {
  secretRef: string;
  providerId: string;
  label: string;
  backend: string;
  encryptedSecret: string;
  iv: string;
  authTag: string;
}

export class ProviderSecretRefRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertProviderSecretRefInput): ProviderSecretRefRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO provider_secret_refs (
        secret_ref,
        provider_id,
        label,
        backend,
        encrypted_secret,
        iv,
        auth_tag,
        created_at,
        updated_at,
        last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(secret_ref) DO UPDATE SET
        provider_id = excluded.provider_id,
        label = excluded.label,
        backend = excluded.backend,
        encrypted_secret = excluded.encrypted_secret,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        updated_at = excluded.updated_at
    `).run(
      input.secretRef,
      input.providerId,
      input.label,
      input.backend,
      input.encryptedSecret,
      input.iv,
      input.authTag,
      now,
      now,
    );

    const row = this.get(input.secretRef);
    if (!row) {
      throw new Error(`Failed to load provider secret ref: ${input.secretRef}`);
    }
    return row;
  }

  get(secretRef: string): ProviderSecretRefRow | null {
    return this.db.query(`
      SELECT *
      FROM provider_secret_refs
      WHERE secret_ref = ?
      LIMIT 1
    `).get(secretRef) as ProviderSecretRefRow | null;
  }

  list(providerId?: string): ProviderSecretRefRow[] {
    if (providerId?.trim()) {
      return this.db.query(`
        SELECT *
        FROM provider_secret_refs
        WHERE provider_id = ?
        ORDER BY updated_at DESC, secret_ref ASC
      `).all(providerId.trim()) as ProviderSecretRefRow[];
    }

    return this.db.query(`
      SELECT *
      FROM provider_secret_refs
      ORDER BY updated_at DESC, secret_ref ASC
    `).all() as ProviderSecretRefRow[];
  }

  delete(secretRef: string): boolean {
    return this.db.query(`
      DELETE FROM provider_secret_refs
      WHERE secret_ref = ?
    `).run(secretRef).changes > 0;
  }

  touch(secretRef: string, usedAt = new Date().toISOString()): boolean {
    return this.db.query(`
      UPDATE provider_secret_refs
      SET last_used_at = ?,
          updated_at = ?
      WHERE secret_ref = ?
    `).run(usedAt, usedAt, secretRef).changes > 0;
  }
}
