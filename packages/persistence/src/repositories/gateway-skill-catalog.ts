import type { Database, SQLQueryBindings } from "bun:sqlite";

export type GatewaySkillStatus = "active" | "archived";

export interface GatewaySkillCatalogRow {
  skill_id: string;
  name: string;
  description: string;
  content_markdown: string;
  source_ref: string;
  source_kind: "installed" | "system";
  enabled: number;
  provenance_json: string;
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
  sourceKind?: "installed" | "system";
  enabled?: boolean;
  provenance?: Record<string, unknown>;
  tags?: string[];
  status?: GatewaySkillStatus;
  createdAt?: string;
}

export interface ListGatewaySkillCatalogQuery {
  query?: string;
  tags?: string[];
  sourceKinds?: Array<"installed" | "system">;
  enabled?: boolean | "all";
  status?: GatewaySkillStatus | "all";
  limit?: number;
}

export class GatewaySkillCatalogRepository {
  constructor(private db: Database) {
    this.ensureCanonicalColumns();
  }

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
        source_kind,
        enabled,
        provenance_json,
        tags_json,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        content_markdown = excluded.content_markdown,
        source_ref = excluded.source_ref,
        source_kind = excluded.source_kind,
        enabled = excluded.enabled,
        provenance_json = excluded.provenance_json,
        tags_json = excluded.tags_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      input.skillId,
      input.name,
      input.description?.trim() ?? "",
      input.contentMarkdown,
      input.sourceRef?.trim() ?? "",
      input.sourceKind === "system" ? "system" : "installed",
      input.enabled === false ? 0 : 1,
      JSON.stringify(normalizeRecord(input.provenance)),
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

    if (query.enabled !== "all" && typeof query.enabled === "boolean") {
      clauses.push("enabled = ?");
      params.push(query.enabled ? 1 : 0);
    }

    const sourceKinds = normalizeSourceKinds(query.sourceKinds);
    if (sourceKinds.length > 0) {
      clauses.push(`source_kind IN (${sourceKinds.map(() => "?").join(", ")})`);
      params.push(...sourceKinds);
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

  archive(skillId: string): GatewaySkillCatalogRow | null {
    this.db.query(`
      UPDATE gateway_skill_catalog
      SET status = 'archived',
          enabled = 0,
          updated_at = ?
      WHERE skill_id = ?
    `).run(new Date().toISOString(), skillId);
    return this.get(skillId);
  }

  setEnabled(skillId: string, enabled: boolean): GatewaySkillCatalogRow | null {
    this.db.query(`
      UPDATE gateway_skill_catalog
      SET enabled = ?,
          updated_at = ?
      WHERE skill_id = ?
    `).run(enabled ? 1 : 0, new Date().toISOString(), skillId);
    return this.get(skillId);
  }

  private ensureCanonicalColumns(): void {
    const columns = this.db
      .query("PRAGMA table_info(gateway_skill_catalog)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has("source_kind")) {
      this.db.exec(
        "ALTER TABLE gateway_skill_catalog ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'installed'",
      );
    }
    if (!columnNames.has("enabled")) {
      this.db.exec(
        "ALTER TABLE gateway_skill_catalog ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
      );
    }
    if (!columnNames.has("provenance_json")) {
      this.db.exec(
        "ALTER TABLE gateway_skill_catalog ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}'",
      );
    }
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

function normalizeSourceKinds(input: unknown): Array<"installed" | "system"> {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(
    input.filter((value): value is "installed" | "system" => value === "installed" || value === "system"),
  ));
}

function normalizeRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
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
