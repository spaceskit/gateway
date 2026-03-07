/**
 * Gateway policy repository — singleton read/write path for top-level policy.
 */

import type { Database } from "bun:sqlite";

export interface GatewayPolicyRow {
  singleton_id: number;
  allowed_capability_types_json: string;
  denied_capability_types_json: string;
  allowed_skill_ids_json: string;
  denied_skill_ids_json: string;
  global_flags_json: string;
  updated_at: string;
}

export interface SetGatewayPolicyInput {
  allowedCapabilityTypes: string[];
  deniedCapabilityTypes: string[];
  allowedSkillIds: string[];
  deniedSkillIds: string[];
  globalFlags: Record<string, unknown>;
}

export class GatewayPolicyRepository {
  constructor(private db: Database) {}

  get(): GatewayPolicyRow {
    const row = this.db
      .query("SELECT * FROM gateway_policy WHERE singleton_id = 1")
      .get() as GatewayPolicyRow | null;

    if (row) {
      return row;
    }

    this.db.query(`
      INSERT INTO gateway_policy(
        singleton_id,
        allowed_capability_types_json,
        denied_capability_types_json,
        allowed_skill_ids_json,
        denied_skill_ids_json,
        global_flags_json,
        updated_at
      ) VALUES (1, '[]', '[]', '[]', '[]', '{}', ?)
      ON CONFLICT(singleton_id) DO NOTHING
    `).run(new Date().toISOString());

    return this.db
      .query("SELECT * FROM gateway_policy WHERE singleton_id = 1")
      .get() as GatewayPolicyRow;
  }

  set(input: SetGatewayPolicyInput): GatewayPolicyRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_policy(
        singleton_id,
        allowed_capability_types_json,
        denied_capability_types_json,
        allowed_skill_ids_json,
        denied_skill_ids_json,
        global_flags_json,
        updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        allowed_capability_types_json = excluded.allowed_capability_types_json,
        denied_capability_types_json = excluded.denied_capability_types_json,
        allowed_skill_ids_json = excluded.allowed_skill_ids_json,
        denied_skill_ids_json = excluded.denied_skill_ids_json,
        global_flags_json = excluded.global_flags_json,
        updated_at = excluded.updated_at
    `).run(
      JSON.stringify(input.allowedCapabilityTypes),
      JSON.stringify(input.deniedCapabilityTypes),
      JSON.stringify(input.allowedSkillIds),
      JSON.stringify(input.deniedSkillIds),
      JSON.stringify(input.globalFlags),
      now,
    );

    return this.get();
  }
}

