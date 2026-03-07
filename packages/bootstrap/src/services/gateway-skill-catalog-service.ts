import { randomUUID } from "node:crypto";
import type {
  GatewaySkillCatalogRow,
  GatewaySkillStatus,
  GatewaySkillCatalogRepository,
} from "@spaceskit/persistence";
import type {
  GatewaySkillEntryPayload,
  GatewaySkillListPayload,
  GatewaySkillUpsertPayload,
} from "@spaceskit/server";

export interface GatewaySkillCatalogServiceOptions {
  repository: GatewaySkillCatalogRepository;
}

export class GatewaySkillCatalogServiceError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND";

  constructor(code: GatewaySkillCatalogServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class GatewaySkillCatalogService {
  constructor(private readonly options: GatewaySkillCatalogServiceOptions) {}

  listSkills(input: GatewaySkillListPayload = {}): GatewaySkillEntryPayload[] {
    const status = normalizeStatusFilter(input.status);
    const rows = this.options.repository.list({
      query: normalizeOptional(input.query),
      tags: normalizeTags(input.tags),
      status,
      limit: normalizeLimit(input.limit),
    });
    return rows.map((row) => this.toPayload(row));
  }

  getSkill(skillId: string): GatewaySkillEntryPayload | null {
    const row = this.options.repository.get(normalizeRequired(skillId, "skillId"));
    if (!row) return null;
    return this.toPayload(row);
  }

  upsertSkill(
    input: GatewaySkillUpsertPayload,
  ): { skill: GatewaySkillEntryPayload; created: boolean } {
    const skillId = normalizeOptional(input.skillId) ?? `skill-${randomUUID()}`;
    const existing = this.options.repository.get(skillId);
    const status = normalizeStatusPayload(input.status);
    const row = this.options.repository.upsert({
      skillId,
      name: normalizeRequired(input.name, "name"),
      description: normalizeOptional(input.description),
      contentMarkdown: normalizeRequired(input.contentMarkdown, "contentMarkdown"),
      sourceRef: normalizeOptional(input.sourceRef),
      tags: normalizeTags(input.tags),
      status,
    });

    return {
      skill: this.toPayload(row),
      created: !existing,
    };
  }

  deleteSkill(skillId: string): boolean {
    return this.options.repository.delete(normalizeRequired(skillId, "skillId"));
  }

  getActiveSkillMarkdownMap(skillIds: string[]): Map<string, string> {
    const normalizedIds = normalizeTags(skillIds);
    const markdownById = new Map<string, string>();
    for (const skillId of normalizedIds) {
      const row = this.options.repository.get(skillId);
      if (!row || row.status !== "active") continue;
      const content = row.content_markdown.trim();
      if (!content) continue;
      markdownById.set(skillId, content);
    }
    return markdownById;
  }

  private toPayload(row: GatewaySkillCatalogRow): GatewaySkillEntryPayload {
    return {
      skillId: row.skill_id,
      name: row.name,
      description: normalizeOptional(row.description),
      contentMarkdown: row.content_markdown,
      sourceRef: normalizeOptional(row.source_ref),
      tags: normalizeTags(parseStringArray(row.tags_json)),
      status: normalizeStatusPayload(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new GatewaySkillCatalogServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(value), 1), 500);
}

function normalizeStatusFilter(value: string | undefined): GatewaySkillStatus | "all" {
  if (value === "all") return "all";
  if (value === "archived") return "archived";
  return "active";
}

function normalizeStatusPayload(value: string | undefined): GatewaySkillStatus {
  return value === "archived" ? "archived" : "active";
}

function normalizeTags(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  ));
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}
