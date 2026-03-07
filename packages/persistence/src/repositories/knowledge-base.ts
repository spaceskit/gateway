import type { Database, SQLQueryBindings } from "bun:sqlite";

export type KnowledgeBaseEntryKind = "web" | "file" | "folder";
export type KnowledgeBaseEntryScopeType = "global" | "space";

export interface KnowledgeBaseEntryRow {
  entry_id: string;
  name: string;
  kind: KnowledgeBaseEntryKind;
  uri: string;
  description: string;
  tags_json: string;
  scope_type: KnowledgeBaseEntryScopeType;
  space_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertKnowledgeBaseEntryInput {
  entryId: string;
  name: string;
  kind: KnowledgeBaseEntryKind;
  uri: string;
  description?: string;
  tags: string[];
  scopeType: KnowledgeBaseEntryScopeType;
  spaceId?: string;
  createdAt?: string;
}

export interface ListKnowledgeBaseEntriesQuery {
  spaceId?: string;
  tags?: string[];
  kinds?: KnowledgeBaseEntryKind[];
  query?: string;
  limit?: number;
}

export class KnowledgeBaseEntryRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertKnowledgeBaseEntryInput): KnowledgeBaseEntryRow {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;

    this.db.query(`
      INSERT INTO knowledge_base_entries(
        entry_id,
        name,
        kind,
        uri,
        description,
        tags_json,
        scope_type,
        space_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        uri = excluded.uri,
        description = excluded.description,
        tags_json = excluded.tags_json,
        scope_type = excluded.scope_type,
        space_id = excluded.space_id,
        updated_at = excluded.updated_at
    `).run(
      input.entryId,
      input.name,
      input.kind,
      input.uri,
      input.description?.trim() ?? "",
      JSON.stringify(input.tags),
      input.scopeType,
      input.scopeType === "space" ? input.spaceId ?? null : null,
      createdAt,
      now,
    );

    const row = this.get(input.entryId);
    if (!row) {
      throw new Error(`Failed to load knowledge base entry: ${input.entryId}`);
    }
    return row;
  }

  get(entryId: string): KnowledgeBaseEntryRow | null {
    return this.db.query(`
      SELECT *
      FROM knowledge_base_entries
      WHERE entry_id = ?
      LIMIT 1
    `).get(entryId) as KnowledgeBaseEntryRow | null;
  }

  list(query: ListKnowledgeBaseEntriesQuery = {}): KnowledgeBaseEntryRow[] {
    const clauses: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (query.spaceId?.trim()) {
      clauses.push("(scope_type = 'global' OR (scope_type = 'space' AND space_id = ?))");
      params.push(query.spaceId.trim());
    }

    if (Array.isArray(query.kinds) && query.kinds.length > 0) {
      const uniqueKinds = Array.from(new Set(query.kinds));
      clauses.push(`kind IN (${uniqueKinds.map(() => "?").join(", ")})`);
      params.push(...uniqueKinds);
    }

    if (query.query?.trim()) {
      const pattern = `%${query.query.trim().toLowerCase()}%`;
      clauses.push(`(
        lower(name) LIKE ?
        OR lower(uri) LIKE ?
        OR lower(description) LIKE ?
      )`);
      params.push(pattern, pattern, pattern);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitSql = query.limit && query.limit > 0 ? "LIMIT ?" : "";
    if (limitSql) {
      params.push(Math.floor(query.limit!));
    }

    const rows = this.db.query(`
      SELECT *
      FROM knowledge_base_entries
      ${whereSql}
      ORDER BY updated_at DESC, entry_id ASC
      ${limitSql}
    `).all(...params) as KnowledgeBaseEntryRow[];

    if (!Array.isArray(query.tags) || query.tags.length === 0) {
      return rows;
    }

    const requiredTags = new Set(
      query.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    );

    if (requiredTags.size === 0) {
      return rows;
    }

    return rows.filter((row) => {
      const rowTags = parseTags(row.tags_json);
      if (rowTags.length === 0) return false;
      const available = new Set(rowTags.map((tag) => tag.toLowerCase()));
      for (const requiredTag of requiredTags) {
        if (!available.has(requiredTag)) {
          return false;
        }
      }
      return true;
    });
  }

  delete(entryId: string): boolean {
    return this.db.query(`
      DELETE FROM knowledge_base_entries
      WHERE entry_id = ?
    `).run(entryId).changes > 0;
  }
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
