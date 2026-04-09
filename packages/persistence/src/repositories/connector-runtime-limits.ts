import type { Database } from "bun:sqlite";

export type ConnectorRuntimeLimitScopeType = "global" | "family" | "instance";

export interface ConnectorRuntimeLimitRow {
  scope_type: ConnectorRuntimeLimitScopeType;
  scope_id: string;
  requests_per_minute: number;
  burst: number;
  updated_by: string;
  updated_at: string;
}

export interface UpsertConnectorRuntimeLimitInput {
  scopeType: ConnectorRuntimeLimitScopeType;
  scopeId: string;
  requestsPerMinute: number;
  burst: number;
  updatedBy: string;
}

export class ConnectorRuntimeLimitRepository {
  constructor(private readonly db: Database) {}

  get(scopeType: ConnectorRuntimeLimitScopeType, scopeId: string): ConnectorRuntimeLimitRow | null {
    return this.db.query(`
      SELECT *
      FROM connector_runtime_limits
      WHERE scope_type = ?
        AND scope_id = ?
      LIMIT 1
    `).get(scopeType, scopeId) as ConnectorRuntimeLimitRow | null;
  }

  list(scopeType?: ConnectorRuntimeLimitScopeType): ConnectorRuntimeLimitRow[] {
    if (scopeType) {
      return this.db.query(`
        SELECT *
        FROM connector_runtime_limits
        WHERE scope_type = ?
        ORDER BY scope_id ASC
      `).all(scopeType) as ConnectorRuntimeLimitRow[];
    }
    return this.db.query(`
      SELECT *
      FROM connector_runtime_limits
      ORDER BY scope_type ASC, scope_id ASC
    `).all() as ConnectorRuntimeLimitRow[];
  }

  upsert(input: UpsertConnectorRuntimeLimitInput): ConnectorRuntimeLimitRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO connector_runtime_limits (
        scope_type,
        scope_id,
        requests_per_minute,
        burst,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        requests_per_minute = excluded.requests_per_minute,
        burst = excluded.burst,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.scopeType,
      input.scopeId,
      input.requestsPerMinute,
      input.burst,
      input.updatedBy,
      now,
    );
    return this.get(input.scopeType, input.scopeId)!;
  }
}
