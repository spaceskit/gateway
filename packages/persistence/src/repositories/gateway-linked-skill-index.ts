import type { Database, SQLQueryBindings } from "bun:sqlite";

export type GatewayLinkedSkillSyncState = "ready" | "missing" | "parse_error";

export interface GatewayLinkedSkillIndexRow {
  entry_id: string;
  skill_id: string;
  source_path: string;
  name: string;
  description: string;
  content_markdown: string;
  tags_json: string;
  sync_state: GatewayLinkedSkillSyncState;
  file_mtime_ms: number;
  file_size: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertGatewayLinkedSkillIndexInput {
  entryId: string;
  skillId: string;
  sourcePath: string;
  name: string;
  description?: string;
  contentMarkdown: string;
  tags?: string[];
  syncState?: GatewayLinkedSkillSyncState;
  fileMtimeMs?: number;
  fileSize?: number;
  contentHash?: string;
  createdAt?: string;
}

export class GatewayLinkedSkillIndexRepository {
  constructor(private readonly db: Database) {}

  upsert(input: UpsertGatewayLinkedSkillIndexInput): GatewayLinkedSkillIndexRow {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;

    this.db.query(`
      INSERT INTO gateway_linked_skill_index(
        entry_id,
        skill_id,
        source_path,
        name,
        description,
        content_markdown,
        tags_json,
        sync_state,
        file_mtime_ms,
        file_size,
        content_hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_path) DO UPDATE SET
        entry_id = excluded.entry_id,
        skill_id = excluded.skill_id,
        name = excluded.name,
        description = excluded.description,
        content_markdown = excluded.content_markdown,
        tags_json = excluded.tags_json,
        sync_state = excluded.sync_state,
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(
      input.entryId,
      input.skillId,
      input.sourcePath,
      input.name,
      input.description?.trim() ?? "",
      input.contentMarkdown,
      JSON.stringify(normalizeStringArray(input.tags)),
      normalizeSyncState(input.syncState),
      normalizeNumber(input.fileMtimeMs),
      normalizeNumber(input.fileSize),
      input.contentHash?.trim() ?? "",
      createdAt,
      now,
    );

    return this.getBySourcePath(input.sourcePath)!;
  }

  getBySourcePath(sourcePath: string): GatewayLinkedSkillIndexRow | null {
    return this.db.query(`
      SELECT *
      FROM gateway_linked_skill_index
      WHERE source_path = ?
      LIMIT 1
    `).get(sourcePath) as GatewayLinkedSkillIndexRow | null;
  }

  getBySkillId(skillId: string): GatewayLinkedSkillIndexRow | null {
    return this.db.query(`
      SELECT *
      FROM gateway_linked_skill_index
      WHERE skill_id = ?
      LIMIT 1
    `).get(skillId) as GatewayLinkedSkillIndexRow | null;
  }

  list(skillIds?: string[]): GatewayLinkedSkillIndexRow[] {
    if (!Array.isArray(skillIds) || skillIds.length === 0) {
      return this.db.query(`
        SELECT *
        FROM gateway_linked_skill_index
        ORDER BY lower(name) ASC, lower(skill_id) ASC
      `).all() as GatewayLinkedSkillIndexRow[];
    }

    const normalizedSkillIds = normalizeStringArray(skillIds);
    if (normalizedSkillIds.length === 0) return [];
    const placeholders = normalizedSkillIds.map(() => "?").join(", ");
    return this.db.query(`
      SELECT *
      FROM gateway_linked_skill_index
      WHERE skill_id IN (${placeholders})
      ORDER BY lower(name) ASC, lower(skill_id) ASC
    `).all(...normalizedSkillIds as SQLQueryBindings[]) as GatewayLinkedSkillIndexRow[];
  }

  markMissingExceptSourcePaths(sourcePaths: string[]): number {
    const normalizedSourcePaths = normalizeStringArray(sourcePaths);
    const now = new Date().toISOString();

    if (normalizedSourcePaths.length === 0) {
      return this.db.query(`
        UPDATE gateway_linked_skill_index
        SET sync_state = 'missing',
            updated_at = ?
      `).run(now).changes;
    }

    const placeholders = normalizedSourcePaths.map(() => "?").join(", ");
    return this.db.query(`
      UPDATE gateway_linked_skill_index
      SET sync_state = 'missing',
          updated_at = ?
      WHERE source_path NOT IN (${placeholders})
    `).run(now, ...normalizedSourcePaths).changes;
  }
}

function normalizeSyncState(value: GatewayLinkedSkillSyncState | undefined): GatewayLinkedSkillSyncState {
  if (value === "missing" || value === "parse_error") return value;
  return "ready";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function normalizeNumber(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}
