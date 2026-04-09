import type { Database } from "bun:sqlite";

export type GatewayMemoryDefaultExperienceCaptureRowValue = "ENABLED" | "DISABLED";
export type GatewayMemoryDefaultPrivacyModeRowValue = "STANDARD";

export interface GatewayMemoryDefaultsRow {
  singleton_id: number;
  default_experience_capture: GatewayMemoryDefaultExperienceCaptureRowValue;
  default_space_privacy_mode: GatewayMemoryDefaultPrivacyModeRowValue;
  updated_at: string;
}

export interface SetGatewayMemoryDefaultsInput {
  defaultExperienceCapture: GatewayMemoryDefaultExperienceCaptureRowValue;
  defaultSpacePrivacyMode?: GatewayMemoryDefaultPrivacyModeRowValue;
}

export class GatewayMemoryDefaultsRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  get(): GatewayMemoryDefaultsRow {
    const row = this.db
      .query("SELECT * FROM gateway_memory_defaults WHERE singleton_id = 1")
      .get() as GatewayMemoryDefaultsRow | null;
    if (row) {
      return row;
    }

    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_memory_defaults(
        singleton_id,
        default_experience_capture,
        default_space_privacy_mode,
        updated_at
      ) VALUES (1, 'ENABLED', 'STANDARD', ?)
      ON CONFLICT(singleton_id) DO NOTHING
    `).run(now);

    return this.db
      .query("SELECT * FROM gateway_memory_defaults WHERE singleton_id = 1")
      .get() as GatewayMemoryDefaultsRow;
  }

  set(input: SetGatewayMemoryDefaultsInput): GatewayMemoryDefaultsRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_memory_defaults(
        singleton_id,
        default_experience_capture,
        default_space_privacy_mode,
        updated_at
      ) VALUES (1, ?, ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        default_experience_capture = excluded.default_experience_capture,
        default_space_privacy_mode = excluded.default_space_privacy_mode,
        updated_at = excluded.updated_at
    `).run(
      input.defaultExperienceCapture,
      input.defaultSpacePrivacyMode ?? "STANDARD",
      now,
    );
    return this.get();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_memory_defaults (
        singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
        default_experience_capture TEXT NOT NULL DEFAULT 'ENABLED',
        default_space_privacy_mode TEXT NOT NULL DEFAULT 'STANDARD',
        updated_at TEXT NOT NULL
      )
    `);
  }
}
