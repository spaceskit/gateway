/**
 * Connector policy repository.
 *
 * Stores global, family, and instance-level rate/disable controls.
 */

import type { Database } from "bun:sqlite";

export type ConnectorPolicyScopeType = "global" | "family" | "instance";

export interface ConnectorPolicyRow {
  scope_type: ConnectorPolicyScopeType;
  scope_id: string;
  requests_per_minute: number;
  burst: number;
  disabled: number;
  disable_reason: string;
  disabled_until: string | null;
  updated_by: string;
  updated_at: string;
}

export interface UpsertConnectorPolicyInput {
  scopeType: ConnectorPolicyScopeType;
  scopeId: string;
  requestsPerMinute: number;
  burst: number;
  disabled: boolean;
  disableReason?: string;
  disabledUntil?: string | null;
  updatedBy: string;
}

export class ConnectorPolicyRepository {
  constructor(private db: Database) {}

  get(scopeType: ConnectorPolicyScopeType, scopeId: string): ConnectorPolicyRow | null {
    return this.db.query(`
      SELECT *
      FROM connector_policy
      WHERE scope_type = ?
        AND scope_id = ?
      LIMIT 1
    `).get(scopeType, scopeId) as ConnectorPolicyRow | null;
  }

  list(scopeType?: ConnectorPolicyScopeType): ConnectorPolicyRow[] {
    if (scopeType) {
      return this.db.query(`
        SELECT *
        FROM connector_policy
        WHERE scope_type = ?
        ORDER BY scope_id ASC
      `).all(scopeType) as ConnectorPolicyRow[];
    }

    return this.db.query(`
      SELECT *
      FROM connector_policy
      ORDER BY scope_type ASC, scope_id ASC
    `).all() as ConnectorPolicyRow[];
  }

  upsert(input: UpsertConnectorPolicyInput): ConnectorPolicyRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO connector_policy (
        scope_type,
        scope_id,
        requests_per_minute,
        burst,
        disabled,
        disable_reason,
        disabled_until,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        requests_per_minute = excluded.requests_per_minute,
        burst = excluded.burst,
        disabled = excluded.disabled,
        disable_reason = excluded.disable_reason,
        disabled_until = excluded.disabled_until,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.scopeType,
      input.scopeId,
      input.requestsPerMinute,
      input.burst,
      input.disabled ? 1 : 0,
      input.disableReason ?? "",
      input.disabledUntil ?? null,
      input.updatedBy,
      now,
    );

    const row = this.get(input.scopeType, input.scopeId);
    if (!row) {
      throw new Error(`Failed to load connector policy: ${input.scopeType}/${input.scopeId}`);
    }
    return row;
  }
}
