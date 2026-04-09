import type { Database } from "bun:sqlite";

export interface SafetyProfileRow {
  profile_id: string;
  display_name: string;
  description: string;
  rules_json: string;
  dangerous_capabilities_json: string;
  updated_at: string;
}

export interface UpsertSafetyProfileInput {
  profileId: string;
  displayName: string;
  description?: string;
  rulesJson?: string;
  dangerousCapabilitiesJson?: string;
  updatedAt?: string;
}

export class SafetyProfileRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  get(profileId: string): SafetyProfileRow | null {
    return this.db.query(`
      SELECT *
      FROM safety_profiles
      WHERE profile_id = ?
      LIMIT 1
    `).get(profileId) as SafetyProfileRow | null;
  }

  list(): SafetyProfileRow[] {
    return this.db.query(`
      SELECT *
      FROM safety_profiles
      ORDER BY profile_id ASC
    `).all() as SafetyProfileRow[];
  }

  upsert(input: UpsertSafetyProfileInput): SafetyProfileRow {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO safety_profiles (
        profile_id,
        display_name,
        description,
        rules_json,
        dangerous_capabilities_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        rules_json = excluded.rules_json,
        dangerous_capabilities_json = excluded.dangerous_capabilities_json,
        updated_at = excluded.updated_at
    `).run(
      input.profileId,
      input.displayName,
      input.description ?? "",
      input.rulesJson ?? "[]",
      input.dangerousCapabilitiesJson ?? "[]",
      updatedAt,
    );
    return this.get(input.profileId)!;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS safety_profiles (
        profile_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        rules_json TEXT NOT NULL DEFAULT '[]',
        dangerous_capabilities_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      )
    `);
  }
}
