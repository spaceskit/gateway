/**
 * Connector instance repository.
 *
 * Instance = one configured install/account of a connector family.
 */

import type { Database } from "bun:sqlite";

export type ConnectorInstanceStatus = "active" | "paused" | "error";

export interface ConnectorInstanceRow {
  connector_id: string;
  family_id: string;
  display_name: string;
  account_fingerprint_hash: string;
  label_slug: string;
  status: ConnectorInstanceStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertConnectorInstanceInput {
  connectorId: string;
  familyId: string;
  displayName: string;
  accountFingerprintHash: string;
  labelSlug: string;
  status: ConnectorInstanceStatus;
  metadata?: Record<string, unknown>;
}

export class ConnectorInstanceRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertConnectorInstanceInput): ConnectorInstanceRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO connector_instances (
        connector_id,
        family_id,
        display_name,
        account_fingerprint_hash,
        label_slug,
        status,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id) DO UPDATE SET
        family_id = excluded.family_id,
        display_name = excluded.display_name,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      input.connectorId,
      input.familyId,
      input.displayName,
      input.accountFingerprintHash,
      input.labelSlug,
      input.status,
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );

    const row = this.get(input.connectorId);
    if (!row) {
      throw new Error(`Failed to load connector instance: ${input.connectorId}`);
    }
    return row;
  }

  get(connectorId: string): ConnectorInstanceRow | null {
    return this.db.query(`
      SELECT *
      FROM connector_instances
      WHERE connector_id = ?
      LIMIT 1
    `).get(connectorId) as ConnectorInstanceRow | null;
  }

  list(familyId?: string): ConnectorInstanceRow[] {
    if (familyId) {
      return this.db.query(`
        SELECT *
        FROM connector_instances
        WHERE family_id = ?
        ORDER BY connector_id ASC
      `).all(familyId) as ConnectorInstanceRow[];
    }

    return this.db.query(`
      SELECT *
      FROM connector_instances
      ORDER BY connector_id ASC
    `).all() as ConnectorInstanceRow[];
  }

  delete(connectorId: string): boolean {
    return this.db.query(`
      DELETE FROM connector_instances
      WHERE connector_id = ?
    `).run(connectorId).changes > 0;
  }
}
