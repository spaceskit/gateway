/**
 * Connector secret reference repository.
 *
 * Only stores references, never raw credentials.
 */

import type { Database } from "bun:sqlite";

export interface ConnectorSecretRefRow {
  connector_id: string;
  secret_key: string;
  secret_ref: string;
  backend: string;
  updated_at: string;
}

export interface UpsertConnectorSecretRefInput {
  connectorId: string;
  secretKey: string;
  secretRef: string;
  backend: string;
}

export class ConnectorSecretRefRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertConnectorSecretRefInput): ConnectorSecretRefRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO connector_secret_refs (
        connector_id,
        secret_key,
        secret_ref,
        backend,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, secret_key) DO UPDATE SET
        secret_ref = excluded.secret_ref,
        backend = excluded.backend,
        updated_at = excluded.updated_at
    `).run(
      input.connectorId,
      input.secretKey,
      input.secretRef,
      input.backend,
      now,
    );

    const row = this.get(input.connectorId, input.secretKey);
    if (!row) {
      throw new Error(`Failed to load connector secret ref: ${input.connectorId}/${input.secretKey}`);
    }
    return row;
  }

  get(connectorId: string, secretKey: string): ConnectorSecretRefRow | null {
    return this.db.query(`
      SELECT *
      FROM connector_secret_refs
      WHERE connector_id = ?
        AND secret_key = ?
      LIMIT 1
    `).get(connectorId, secretKey) as ConnectorSecretRefRow | null;
  }

  listByConnector(connectorId: string): ConnectorSecretRefRow[] {
    return this.db.query(`
      SELECT *
      FROM connector_secret_refs
      WHERE connector_id = ?
      ORDER BY secret_key ASC
    `).all(connectorId) as ConnectorSecretRefRow[];
  }

  delete(connectorId: string, secretKey: string): boolean {
    return this.db.query(`
      DELETE FROM connector_secret_refs
      WHERE connector_id = ?
        AND secret_key = ?
    `).run(connectorId, secretKey).changes > 0;
  }

  deleteAllForConnector(connectorId: string): number {
    return this.db.query(`
      DELETE FROM connector_secret_refs
      WHERE connector_id = ?
    `).run(connectorId).changes;
  }
}
