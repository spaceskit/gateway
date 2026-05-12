/**
 * SQLite schema for the Spaceskit gateway.
 *
 * The schema is composed of per-feature migration files under
 * `./migrations/`. Each file owns one entry in the version chain and one
 * row in the `schema_version` table. This module is a thin re-export that
 * preserves the long-standing `migrations` / `seedStatements` API the rest
 * of the codebase consumes.
 *
 * To add a new migration:
 *   1. Create `./migrations/NNN-<short-slug>.ts` exporting an SQL array.
 *   2. Append it to the chain in `./migrations/index.ts`.
 *
 * Never reorder, edit, or remove historical migrations — they are applied
 * exactly once per database and tracked by version string.
 */

import { MIGRATION_CHAIN, SEED_STATEMENTS } from "./migrations/index.js";
import type { Migration as ChainMigration } from "./migrations/index.js";

export type Migration = ChainMigration;

/**
 * Ordered list of migrations. Each entry is applied once and tracked in
 * `schema_version`.
 */
export const migrations: readonly Migration[] = MIGRATION_CHAIN;

/**
 * Default seed data inserted after the initial schema is created. All
 * statements use `INSERT OR IGNORE` so re-running is a no-op.
 */
export const seedStatements: readonly string[] = SEED_STATEMENTS;
