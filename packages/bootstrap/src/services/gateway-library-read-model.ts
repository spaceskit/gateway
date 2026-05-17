import type {
  GatewayLinkedSkillIndexRow,
  GatewaySkillCatalogRow,
  GatewaySkillDraftRow,
} from "@spaceskit/persistence";
import type {
  LibraryEntryPayload,
  SkillDraftPayload,
} from "./internal-payload-types.js";

interface VerifiedCatalogEntry {
  catalogId: string;
  provider: string;
  name: string;
  description: string;
  contentMarkdown: string;
  tags: string[];
}

const VERIFIED_CATALOG: VerifiedCatalogEntry[] = [
  {
    catalogId: "openai.create-skill",
    provider: "OpenAI",
    name: "Create Skill",
    description: "Draft a new skill from a short operator brief and turn it into structured markdown.",
    contentMarkdown: [
      "# Create Skill",
      "",
      "Turn the user's request into a structured skill draft with purpose, triggers, workflow, and boundaries.",
      "",
      "Always ask for the smallest missing detail set first, then produce markdown that can be reviewed and imported.",
    ].join("\n"),
    tags: ["skills", "authoring", "verified"],
  },
  {
    catalogId: "openai.code-review",
    provider: "OpenAI",
    name: "Code Review",
    description: "Review a change for regressions, risky assumptions, and missing tests.",
    contentMarkdown: [
      "# Code Review",
      "",
      "Read the relevant diff or files first.",
      "Prioritize correctness, regressions, and missing coverage over style nits.",
    ].join("\n"),
    tags: ["code", "review", "verified"],
  },
  {
    catalogId: "anthropic.research-synthesis",
    provider: "Anthropic",
    name: "Research Synthesis",
    description: "Turn scattered notes and findings into a concise, source-aware synthesis.",
    contentMarkdown: [
      "# Research Synthesis",
      "",
      "Aggregate the available notes, identify agreement and disagreement, and produce a short synthesis with explicit assumptions.",
    ].join("\n"),
    tags: ["research", "writing", "verified"],
  },
  {
    catalogId: "anthropic.tool-guardrails",
    provider: "Anthropic",
    name: "Tool Guardrails",
    description: "Apply explicit guardrails before invoking sensitive or high-impact tools.",
    contentMarkdown: [
      "# Tool Guardrails",
      "",
      "Before any high-impact tool call, restate the goal, confirm the preconditions, and prefer the least destructive action.",
    ].join("\n"),
    tags: ["safety", "tools", "verified"],
  },
];

export function toInstalledEntry(row: GatewaySkillCatalogRow, includeContent: boolean): LibraryEntryPayload {
  return {
    entryId: row.skill_id,
    skillId: row.skill_id,
    name: row.name,
    description: normalizeOptional(row.description),
    contentMarkdown: includeContent ? row.content_markdown : undefined,
    sourceKind: row.source_kind === "system" ? "system" : "installed",
    sourceRef: normalizeOptional(row.source_ref),
    provenance: parseJsonRecord(row.provenance_json),
    tags: parseJsonArray(row.tags_json),
    status: row.status === "archived" ? "archived" : row.enabled === 1 ? "enabled" : "disabled",
    importable: false,
    importedSkillId: row.skill_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toLinkedEntry(row: GatewayLinkedSkillIndexRow, includeContent: boolean): LibraryEntryPayload {
  return {
    entryId: row.entry_id,
    skillId: row.skill_id,
    name: row.name,
    description: normalizeOptional(row.description),
    contentMarkdown: includeContent ? row.content_markdown : undefined,
    sourceKind: "linked",
    sourceRef: row.source_path,
    syncState: row.sync_state,
    provenance: { filePath: row.source_path },
    tags: parseJsonArray(row.tags_json),
    status: "enabled",
    importable: false,
    importedSkillId: row.skill_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildVerifiedEntries(includeContent: boolean): LibraryEntryPayload[] {
  return VERIFIED_CATALOG.map((entry) => ({
    entryId: `verified:${entry.catalogId}`,
    name: entry.name,
    description: entry.description,
    contentMarkdown: includeContent ? entry.contentMarkdown : undefined,
    sourceKind: "verified",
    sourceRef: `${entry.provider} verified catalog`,
    provenance: { provider: entry.provider, catalogId: entry.catalogId },
    tags: entry.tags,
    status: "enabled",
    importable: true,
    createdAt: "",
    updatedAt: "",
  }));
}

export function toSkillDraftPayload(draft: GatewaySkillDraftRow): SkillDraftPayload {
  return {
    draftId: draft.draft_id,
    name: draft.name,
    description: normalizeOptional(draft.description),
    requestPrompt: draft.request_prompt,
    contentMarkdown: draft.content_markdown,
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
  };
}

export function buildImportedBySource(rows: GatewaySkillCatalogRow[]): Map<string, string> {
  const imported = new Map<string, string>();
  for (const row of rows) {
    const provenance = parseJsonRecord(row.provenance_json);
    const importedFrom = typeof provenance.importedFrom === "string" ? provenance.importedFrom.trim() : "";
    if (importedFrom) {
      imported.set(importedFrom, row.skill_id);
    }
  }
  return imported;
}

export function attachImportedState(
  entry: LibraryEntryPayload,
  importedBySource: Map<string, string>,
): LibraryEntryPayload {
  const importedSkillId = importedBySource.get(entry.entryId);
  return {
    ...entry,
    importedSkillId,
  };
}

export function searchEntry(entry: LibraryEntryPayload, query: string): boolean {
  const haystack = [
    entry.entryId,
    entry.skillId,
    entry.name,
    entry.description,
    entry.sourceRef,
    ...(entry.tags ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function matchesRequestedStatus(
  entry: LibraryEntryPayload,
  requestedStatus: LibraryEntryPayload["status"] | "all",
  includeArchived: boolean,
): boolean {
  if (requestedStatus === "all") {
    return true;
  }
  if (requestedStatus === "archived") {
    return entry.status === "archived";
  }
  if (!includeArchived && entry.status === "archived") {
    return false;
  }
  return entry.status === requestedStatus;
}

export function matchesRequestedTags(entry: LibraryEntryPayload, requestedTags: string[]): boolean {
  if (requestedTags.length === 0) {
    return true;
  }
  const tags = new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean));
  return requestedTags.every((tag) => tags.has(tag));
}

export function buildSkillDraftMarkdown(input: { name: string; description?: string; requestPrompt: string }): string {
  return [
    `# ${input.name}`,
    "",
    "## Purpose",
    input.description?.trim() || input.requestPrompt.trim(),
    "",
    "## When To Use",
    "- Use this skill when the operator asks for this capability explicitly.",
    "- Use this skill when the task clearly matches the workflow below.",
    "",
    "## Workflow",
    "1. Restate the goal in one sentence.",
    "2. Identify any missing inputs or constraints.",
    "3. Produce the requested output using the format the operator expects.",
    "",
    "## Guardrails",
    "- Do not invent unavailable files, tools, or external systems.",
    "- State assumptions when required inputs are missing.",
    "",
    "## Operator Request",
    input.requestPrompt.trim(),
  ].join("\n");
}

export function inferDraftName(requestPrompt: string): string {
  const cleaned = requestPrompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "New Skill";
  return cleaned.split(" ").slice(0, 4).join(" ").replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
}

export function slugify(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

export function normalizeOptional(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

export function normalizeRequired(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw { code: "INVALID_ARGUMENT", message: `${field} is required` };
  }
  return normalized;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

export function normalizeSourceKinds(value: unknown): Array<LibraryEntryPayload["sourceKind"]> {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((entry): entry is LibraryEntryPayload["sourceKind"] => (
        entry === "installed"
        || entry === "scanned"
        || entry === "linked"
        || entry === "verified"
        || entry === "system"
      )),
  ));
}

export function normalizeStatusFilter(value: unknown): LibraryEntryPayload["status"] | "all" {
  if (value === "all") return "all";
  if (value === "disabled") return "disabled";
  if (value === "archived") return "archived";
  return "enabled";
}

export function compareLibraryEntries(lhs: LibraryEntryPayload, rhs: LibraryEntryPayload): number {
  const sourceOrder = libraryEntrySourceSortOrder(lhs.sourceKind) - libraryEntrySourceSortOrder(rhs.sourceKind);
  if (sourceOrder !== 0) {
    return sourceOrder;
  }

  const nameOrder = lhs.name.localeCompare(rhs.name, undefined, { sensitivity: "base" });
  if (nameOrder !== 0) {
    return nameOrder;
  }

  return lhs.entryId.localeCompare(rhs.entryId, undefined, { sensitivity: "base" });
}

export function normalizeEntryStatusPayload(value: unknown): LibraryEntryPayload["status"] | undefined {
  if (value === "disabled") return "disabled";
  if (value === "archived") return "archived";
  if (value === "enabled") return "enabled";
  return undefined;
}

export function normalizeInstalledEnabledFilter(
  requestedStatus: LibraryEntryPayload["status"] | "all",
): "all" | boolean {
  if (requestedStatus === "enabled") return true;
  if (requestedStatus === "disabled") return false;
  return "all";
}

export function normalizeInstalledStatusFilter(
  requestedStatus: LibraryEntryPayload["status"] | "all",
  includeArchived: boolean,
): "active" | "archived" | "all" {
  if (requestedStatus === "archived") {
    return "archived";
  }
  if (requestedStatus === "all" || includeArchived) {
    return "all";
  }
  return "active";
}

export function normalizePersistedSkillState(
  requestedStatus: LibraryEntryPayload["status"] | undefined,
  enabled: boolean | undefined,
): { status: "active" | "archived"; enabled: boolean } {
  if (requestedStatus === "archived") {
    return {
      status: "archived",
      enabled: false,
    };
  }
  if (requestedStatus === "disabled") {
    return {
      status: "active",
      enabled: false,
    };
  }
  if (requestedStatus === "enabled") {
    return {
      status: "active",
      enabled: true,
    };
  }
  return {
    status: "active",
    enabled: enabled !== false,
  };
}

export function normalizeLimit(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(value), 1), 500);
}

export function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeStringArray(parsed);
  } catch {
    return [];
  }
}

function libraryEntrySourceSortOrder(sourceKind: LibraryEntryPayload["sourceKind"]): number {
  switch (sourceKind) {
    case "linked":
      return 0;
    case "installed":
      return 1;
    case "system":
      return 2;
    case "verified":
      return 3;
    case "scanned":
      return 4;
  }
}
