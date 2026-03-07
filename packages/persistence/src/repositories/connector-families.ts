/**
 * Connector family repository.
 *
 * Family = implementation archetype (e.g., apple-calendar-eventkit,
 * whatsapp-cloud, discord-bot).
 */

import type { Database } from "bun:sqlite";

export type ConnectorKind = "channel" | "capability" | "hybrid";
export type ConnectorRuntime = "adapter" | "connector" | "builtin";
export type ConnectorTrustClass = "embedded_safe" | "external_only";

export interface ConnectorFamilyRow {
  family_id: string;
  display_name: string;
  kind: ConnectorKind;
  runtime: ConnectorRuntime;
  trust_class: ConnectorTrustClass;
  embedded_enabled: number;
  capability_types_json: string;
  features_json: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertConnectorFamilyInput {
  familyId: string;
  displayName: string;
  kind: ConnectorKind;
  runtime: ConnectorRuntime;
  trustClass: ConnectorTrustClass;
  embeddedEnabled: boolean;
  capabilityTypes: string[];
  features?: Record<string, unknown>;
}

export class ConnectorFamilyRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertConnectorFamilyInput): ConnectorFamilyRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO connector_families (
        family_id,
        display_name,
        kind,
        runtime,
        trust_class,
        embedded_enabled,
        capability_types_json,
        features_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(family_id) DO UPDATE SET
        display_name = excluded.display_name,
        kind = excluded.kind,
        runtime = excluded.runtime,
        trust_class = excluded.trust_class,
        embedded_enabled = excluded.embedded_enabled,
        capability_types_json = excluded.capability_types_json,
        features_json = excluded.features_json,
        updated_at = excluded.updated_at
    `).run(
      input.familyId,
      input.displayName,
      input.kind,
      input.runtime,
      input.trustClass,
      input.embeddedEnabled ? 1 : 0,
      JSON.stringify(input.capabilityTypes ?? []),
      JSON.stringify(input.features ?? {}),
      now,
      now,
    );

    const row = this.get(input.familyId);
    if (!row) {
      throw new Error(`Failed to load connector family: ${input.familyId}`);
    }
    return row;
  }

  get(familyId: string): ConnectorFamilyRow | null {
    return this.db.query(`
      SELECT *
      FROM connector_families
      WHERE family_id = ?
      LIMIT 1
    `).get(familyId) as ConnectorFamilyRow | null;
  }

  list(): ConnectorFamilyRow[] {
    return this.db.query(`
      SELECT *
      FROM connector_families
      ORDER BY family_id ASC
    `).all() as ConnectorFamilyRow[];
  }

  delete(familyId: string): boolean {
    return this.db.query(`
      DELETE FROM connector_families
      WHERE family_id = ?
    `).run(familyId).changes > 0;
  }
}
