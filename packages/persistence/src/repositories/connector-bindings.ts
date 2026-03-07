/**
 * Connector binding repository.
 */

import type { Database } from "bun:sqlite";

export type ConnectorBindingType = "inbound_route" | "outbound_action" | "capability_export";
export type ConnectorBindingTarget = "main_orchestrator" | "space_orchestrator";

export interface ConnectorBindingRow {
  binding_id: string;
  connector_id: string;
  binding_type: ConnectorBindingType;
  selector_json: string;
  selector_hash: string;
  target_type: ConnectorBindingTarget;
  target_space_id: string;
  allowed_actions_json: string;
  capability_types_json: string;
  priority: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertConnectorBindingInput {
  bindingId: string;
  connectorId: string;
  bindingType: ConnectorBindingType;
  selectorJson: string;
  selectorHash: string;
  targetType: ConnectorBindingTarget;
  targetSpaceId?: string;
  allowedActionsJson: string;
  capabilityTypesJson: string;
  priority: number;
  enabled: boolean;
}

export class ConnectorBindingRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertConnectorBindingInput): ConnectorBindingRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO connector_bindings (
        binding_id,
        connector_id,
        binding_type,
        selector_json,
        selector_hash,
        target_type,
        target_space_id,
        allowed_actions_json,
        capability_types_json,
        priority,
        enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(binding_id) DO UPDATE SET
        connector_id = excluded.connector_id,
        binding_type = excluded.binding_type,
        selector_json = excluded.selector_json,
        selector_hash = excluded.selector_hash,
        target_type = excluded.target_type,
        target_space_id = excluded.target_space_id,
        allowed_actions_json = excluded.allowed_actions_json,
        capability_types_json = excluded.capability_types_json,
        priority = excluded.priority,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(
      input.bindingId,
      input.connectorId,
      input.bindingType,
      input.selectorJson,
      input.selectorHash,
      input.targetType,
      input.targetSpaceId ?? "",
      input.allowedActionsJson,
      input.capabilityTypesJson,
      input.priority,
      input.enabled ? 1 : 0,
      now,
      now,
    );

    const row = this.get(input.bindingId);
    if (!row) {
      throw new Error(`Failed to load connector binding: ${input.bindingId}`);
    }
    return row;
  }

  get(bindingId: string): ConnectorBindingRow | null {
    return this.db.query(`
      SELECT *
      FROM connector_bindings
      WHERE binding_id = ?
      LIMIT 1
    `).get(bindingId) as ConnectorBindingRow | null;
  }

  listByConnector(connectorId: string): ConnectorBindingRow[] {
    return this.db.query(`
      SELECT *
      FROM connector_bindings
      WHERE connector_id = ?
      ORDER BY priority ASC, binding_id ASC
    `).all(connectorId) as ConnectorBindingRow[];
  }

  listAll(): ConnectorBindingRow[] {
    return this.db.query(`
      SELECT *
      FROM connector_bindings
      ORDER BY connector_id ASC, priority ASC, binding_id ASC
    `).all() as ConnectorBindingRow[];
  }

  delete(bindingId: string): boolean {
    return this.db.query(`
      DELETE FROM connector_bindings
      WHERE binding_id = ?
    `).run(bindingId).changes > 0;
  }
}
