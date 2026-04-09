import type { Database } from "bun:sqlite";

export type ToolAccessPolicyScopeType = "gateway" | "space" | "agent_override";

export interface ToolAccessPolicyRow {
  scope_type: ToolAccessPolicyScopeType;
  scope_id: string;
  rules_json: string;
  dangerous_capabilities_json: string;
  guest_access_preset: string | null;
  policy_version: string;
  updated_by: string;
  updated_at: string;
}

export interface UpsertToolAccessPolicyInput {
  scopeType: ToolAccessPolicyScopeType;
  scopeId: string;
  rulesJson: string;
  dangerousCapabilitiesJson: string;
  guestAccessPreset?: string | null;
  policyVersion?: string;
  updatedBy?: string;
}

export class ToolAccessPolicyRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  get(scopeType: ToolAccessPolicyScopeType, scopeId: string): ToolAccessPolicyRow | null {
    return this.db.query(`
      SELECT *
      FROM tool_access_policies
      WHERE scope_type = ?
        AND scope_id = ?
      LIMIT 1
    `).get(scopeType, scopeId) as ToolAccessPolicyRow | null;
  }

  list(scopeType?: ToolAccessPolicyScopeType): ToolAccessPolicyRow[] {
    if (scopeType) {
      return this.db.query(`
        SELECT *
        FROM tool_access_policies
        WHERE scope_type = ?
        ORDER BY scope_id ASC
      `).all(scopeType) as ToolAccessPolicyRow[];
    }
    return this.db.query(`
      SELECT *
      FROM tool_access_policies
      ORDER BY scope_type ASC, scope_id ASC
    `).all() as ToolAccessPolicyRow[];
  }

  upsert(input: UpsertToolAccessPolicyInput): ToolAccessPolicyRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO tool_access_policies (
        scope_type,
        scope_id,
        rules_json,
        dangerous_capabilities_json,
        guest_access_preset,
        policy_version,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        rules_json = excluded.rules_json,
        dangerous_capabilities_json = excluded.dangerous_capabilities_json,
        guest_access_preset = excluded.guest_access_preset,
        policy_version = excluded.policy_version,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.scopeType,
      input.scopeId,
      input.rulesJson,
      input.dangerousCapabilitiesJson,
      input.guestAccessPreset ?? null,
      input.policyVersion ?? "tool_access_policy_v1",
      input.updatedBy ?? "system",
      now,
    );
    return this.get(input.scopeType, input.scopeId)!;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_access_policies (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        rules_json TEXT NOT NULL DEFAULT '[]',
        dangerous_capabilities_json TEXT NOT NULL DEFAULT '[]',
        guest_access_preset TEXT,
        policy_version TEXT NOT NULL DEFAULT 'tool_access_policy_v1',
        updated_by TEXT NOT NULL DEFAULT 'system',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tool_access_policies_scope
        ON tool_access_policies (scope_type, scope_id);
    `);
    this.ensureCanonicalColumns();
  }

  private ensureCanonicalColumns(): void {
    const columns = this.db
      .query("PRAGMA table_info(tool_access_policies)")
      .all() as Array<{ name: string }>;
    const hasGuestAccessPreset = columns.some((column) => column.name === "guest_access_preset");

    if (!hasGuestAccessPreset) {
      this.db.exec(
        "ALTER TABLE tool_access_policies ADD COLUMN guest_access_preset TEXT",
      );
    }
  }
}
