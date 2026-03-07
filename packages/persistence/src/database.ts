/**
 * Database manager — handles connection, migrations, and generation resets.
 *
 * Uses Bun's built-in bun:sqlite for zero-dependency, high-performance
 * SQLite access. The API is intentionally thin: it provides the raw `db`
 * handle so repository modules can compose their own queries.
 */

import { Database } from "bun:sqlite";
import { migrations, seedStatements } from "./schema.js";

export interface DatabaseOptions {
  /** File path for the SQLite database, or ":memory:" for in-memory. */
  path: string;
  /**
   * Runtime generation string. When this changes between launches,
   * all ephemeral space data is wiped (sessions, turns, canvas, etc.)
   * while preserving configuration (profiles, templates, policies).
   */
  runtimeGeneration?: string;
}

export interface GenerationResetInfo {
  previousGeneration: string;
  newGeneration: string;
  appliedAt: Date;
}

export interface DatabaseManager {
  readonly db: Database;
  readonly generationResetInfo: GenerationResetInfo | null;

  /** Gracefully close the database connection. */
  close(): void;
}

/**
 * Initialize the database: open connection, run migrations, apply seed data,
 * and handle runtime generation resets.
 *
 * Usage:
 * ```ts
 * const mgr = initDatabase({ path: "./gateway.db" });
 * ```
 */
export function initDatabase(options: DatabaseOptions): DatabaseManager {
  const db = new Database(options.path, { create: true });

  // Enable WAL mode for better concurrent read performance
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  // Run migrations inside a transaction
  runMigrations(db);

  // Handle runtime generation reset
  const generationResetInfo = options.runtimeGeneration
    ? applyGenerationReset(db, options.runtimeGeneration)
    : null;

  return {
    db,
    generationResetInfo,
    close() {
      db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function runMigrations(db: Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );

  const appliedSet = new Set(
    db.query("SELECT version FROM schema_version").all()
      .map((r) => (r as { version: string }).version),
  );

  for (const migration of migrations) {
    if (appliedSet.has(migration.version)) continue;

    db.transaction(() => {
      for (const sql of migration.up) {
        db.exec(sql);
      }
      db.query(
        "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
      ).run(migration.version, new Date().toISOString());
    })();
  }

  // Seed defaults (idempotent via INSERT OR IGNORE)
  const appliedAfterMigration = new Set(
    db.query("SELECT version FROM schema_version").all()
      .map((r) => (r as { version: string }).version),
  );

  // Only seed if we just applied the initial schema
  if (!appliedSet.has("v1_schema") && appliedAfterMigration.has("v1_schema")) {
    db.transaction(() => {
      for (const sql of seedStatements) {
        db.exec(sql);
      }
    })();
  }
}

function applyGenerationReset(
  db: Database,
  currentGeneration: string,
): GenerationResetInfo | null {
  db.exec(
    `CREATE TABLE IF NOT EXISTS runtime_generation (
      singleton_id INTEGER PRIMARY KEY,
      generation TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );

  const row = db
    .query("SELECT generation FROM runtime_generation WHERE singleton_id = 1")
    .get() as { generation: string } | null;

  const previousGeneration = row?.generation ?? "";

  if (previousGeneration === currentGeneration) {
    return null;
  }

  // Wipe ephemeral space data
  db.transaction(() => {
    const tables = [
      "space_canvas_ops",
      "space_canvas_state",
      "agent_orchestrator_sessions",
      "space_orchestrator_sessions",
      "personality_insights",
      "space_ratings",
      "turns",
      "feedback_items",
      "agent_execution_states",
      "space_states",
      "spaces",
      "event_log",
      "agent_usage_sessions",
      "audit_events",
      "orchestration_journal",
    ];

    for (const table of tables) {
      try {
        db.exec(`DELETE FROM ${table}`);
      } catch {
        // Table may not exist in older schema versions — skip
      }
    }

    db.query(
      `INSERT INTO runtime_generation(singleton_id, generation, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(singleton_id)
       DO UPDATE SET generation = excluded.generation, updated_at = excluded.updated_at`,
    ).run(currentGeneration, new Date().toISOString());
  })();

  return {
    previousGeneration,
    newGeneration: currentGeneration,
    appliedAt: new Date(),
  };
}
