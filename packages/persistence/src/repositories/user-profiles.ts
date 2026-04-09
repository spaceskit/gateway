import type { Database } from "bun:sqlite";

export interface UserProfileRow {
  principal_id: string;
  profile_json: string;
  updated_at: string;
}

export interface UpsertUserProfileInput {
  principalId: string;
  profileJson: string;
  updatedAt?: string;
}

export interface UserPreferencesFallbackRow {
  experience_level: string;
  runtime_mode: string;
  behavior_profile: string;
  full_access_warning_accepted: number;
  developer_warning_accepted: number;
  calendar_enabled: number;
  reminders_enabled: number;
  updated_at: string;
}

export class UserProfileRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  get(principalId: string): UserProfileRow | undefined {
    return this.db.query(`
      SELECT principal_id, profile_json, updated_at
      FROM user_profiles
      WHERE principal_id = ?
    `).get(principalId) as UserProfileRow | undefined ?? undefined;
  }

  upsert(input: UpsertUserProfileInput): UserProfileRow {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO user_profiles(
        principal_id,
        profile_json,
        updated_at
      ) VALUES (?, ?, ?)
      ON CONFLICT(principal_id) DO UPDATE SET
        profile_json = excluded.profile_json,
        updated_at = excluded.updated_at
    `).run(
      input.principalId,
      input.profileJson,
      updatedAt,
    );
    return this.get(input.principalId)!;
  }

  delete(principalId: string): number {
    return this.db.query("DELETE FROM user_profiles WHERE principal_id = ?").run(principalId).changes;
  }

  getLocalPreferencesFallback(): UserPreferencesFallbackRow | undefined {
    return this.db.query(`
      SELECT
        experience_level,
        runtime_mode,
        behavior_profile,
        full_access_warning_accepted,
        developer_warning_accepted,
        calendar_enabled,
        reminders_enabled,
        updated_at
      FROM user_preferences
      WHERE singleton_id = 1
    `).get() as UserPreferencesFallbackRow | undefined ?? undefined;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        principal_id TEXT PRIMARY KEY,
        profile_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_profiles_updated
        ON user_profiles(updated_at DESC);
    `);
  }
}
