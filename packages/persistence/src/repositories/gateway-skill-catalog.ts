import type { Database, SQLQueryBindings } from "bun:sqlite";

export type GatewaySkillStatus = "active" | "archived";

export interface GatewaySkillCatalogRow {
  skill_id: string;
  name: string;
  description: string;
  content_markdown: string;
  source_ref: string;
  tags_json: string;
  status: GatewaySkillStatus;
  created_at: string;
  updated_at: string;
}

export interface UpsertGatewaySkillCatalogInput {
  skillId: string;
  name: string;
  description?: string;
  contentMarkdown: string;
  sourceRef?: string;
  tags?: string[];
  status?: GatewaySkillStatus;
  createdAt?: string;
}

export interface ListGatewaySkillCatalogQuery {
  query?: string;
  tags?: string[];
  status?: GatewaySkillStatus | "all";
  limit?: number;
}

export class GatewaySkillCatalogRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertGatewaySkillCatalogInput): GatewaySkillCatalogRow {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;

    this.db.query(`
      INSERT INTO gateway_skill_catalog(
        skill_id,
        name,
        description,
        content_markdown,
        source_ref,
        tags_json,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        content_markdown = excluded.content_markdown,
        source_ref = excluded.source_ref,
        tags_json = excluded.tags_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      input.skillId,
      input.name,
      input.description?.trim() ?? "",
      input.contentMarkdown,
      input.sourceRef?.trim() ?? "",
      JSON.stringify(normalizeStringArray(input.tags)),
      normalizeStatus(input.status),
      createdAt,
      now,
    );

    const row = this.get(input.skillId);
    if (!row) {
      throw new Error(`Failed to load gateway skill catalog row: ${input.skillId}`);
    }
    return row;
  }

  get(skillId: string): GatewaySkillCatalogRow | null {
    return this.db.query(`
      SELECT *
      FROM gateway_skill_catalog
      WHERE skill_id = ?
      LIMIT 1
    `).get(skillId) as GatewaySkillCatalogRow | null;
  }

  list(query: ListGatewaySkillCatalogQuery = {}): GatewaySkillCatalogRow[] {
    const clauses: string[] = [];
    const params: SQLQueryBindings[] = [];

    const status = normalizeStatus(query.status);
    if (status !== "all") {
      clauses.push("status = ?");
      params.push(status);
    }

    if (query.query?.trim()) {
      const pattern = `%${query.query.trim().toLowerCase()}%`;
      clauses.push(`(
        lower(skill_id) LIKE ?
        OR lower(name) LIKE ?
        OR lower(description) LIKE ?
        OR lower(source_ref) LIKE ?
      )`);
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitSql = query.limit && query.limit > 0 ? "LIMIT ?" : "";
    if (limitSql) {
      params.push(Math.floor(query.limit!));
    }

    const rows = this.db.query(`
      SELECT *
      FROM gateway_skill_catalog
      ${whereSql}
      ORDER BY updated_at DESC, skill_id ASC
      ${limitSql}
    `).all(...params) as GatewaySkillCatalogRow[];

    const requiredTags = normalizeStringArray(query.tags);
    if (requiredTags.length === 0) {
      return rows;
    }

    const required = new Set(requiredTags.map((tag) => tag.toLowerCase()));
    return rows.filter((row) => {
      const tags = parseStringArray(row.tags_json);
      if (tags.length === 0) return false;
      const available = new Set(tags.map((tag) => tag.toLowerCase()));
      for (const tag of required) {
        if (!available.has(tag)) return false;
      }
      return true;
    });
  }

  delete(skillId: string): boolean {
    return this.db.query(`
      DELETE FROM gateway_skill_catalog
      WHERE skill_id = ?
    `).run(skillId).changes > 0;
  }
}

function normalizeStatus(value: unknown): GatewaySkillStatus | "all" {
  if (value === "all") return "all";
  if (value === "archived") return "archived";
  return "active";
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeStringArray(parsed);
  } catch {
    return [];
  }
}
