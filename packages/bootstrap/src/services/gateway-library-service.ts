import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  GatewayLinkedSkillIndexRepository,
  GatewayLinkedSkillIndexRow,
  GatewaySkillCatalogRepository,
  GatewaySkillDraftRepository,
  GatewaySkillCatalogRow,
} from "@spaceskit/persistence";
import type {
  LibraryArchiveEntryPayload,
  LibraryArchiveEntryResponsePayload,
  LibraryCreateSkillDraftPayload,
  LibraryCreateSkillDraftResponsePayload,
  LibraryDeleteEntryPayload,
  LibraryDeleteEntryResponsePayload,
  LibraryDeleteSkillDraftPayload,
  LibraryDeleteSkillDraftResponsePayload,
  LibraryEntryPayload,
  LibraryGetEntryResponsePayload,
  LibraryGetSkillDraftResponsePayload,
  LibraryImportEntryPayload,
  LibraryImportEntryResponsePayload,
  LibraryListEntriesPayload,
  LibraryListEntriesResponsePayload,
  LibraryListSkillDraftsResponsePayload,
  LibrarySaveSkillPayload,
  LibrarySaveSkillResponsePayload,
  LibraryScanEntriesResponsePayload,
  LibrarySetEntryEnabledPayload,
  LibrarySetEntryEnabledResponsePayload,
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

export interface GatewayLibraryServiceOptions {
  repository: GatewaySkillCatalogRepository;
  linkedRepository?: GatewayLinkedSkillIndexRepository | null;
  drafts?: GatewaySkillDraftRepository | null;
  workspaceRoot?: string;
  scanRoots?: string[];
}

export class GatewayLibraryService {
  private readonly repository: GatewaySkillCatalogRepository;
  private readonly linkedRepository: GatewayLinkedSkillIndexRepository | null;
  private readonly drafts: GatewaySkillDraftRepository | null;
  private readonly workspaceRoot?: string;
  private readonly scanRootsOverride?: string[];
  private linkedIndexInitialized = false;

  constructor(options: GatewayLibraryServiceOptions) {
    this.repository = options.repository;
    this.linkedRepository = options.linkedRepository ?? null;
    this.drafts = options.drafts ?? null;
    this.workspaceRoot = options.workspaceRoot;
    this.scanRootsOverride = options.scanRoots;
  }

  listEntries(input: LibraryListEntriesPayload = {}): LibraryListEntriesResponsePayload["entries"] {
    this.ensureLinkedIndexReady();
    const query = normalizeOptional(input.query);
    const requestedTags = normalizeStringArray(input.tags);
    const requestedStatus = normalizeStatusFilter(input.status);
    const requestedSourceKinds = normalizeSourceKinds(input.sourceKinds);
    const includeArchived = input.includeArchived === true || requestedStatus === "archived" || requestedStatus === "all";
    const includeContent = input.includeContent === true;
    const installedRows = this.repository.list({
      query,
      tags: requestedTags,
      sourceKinds: requestedSourceKinds.filter((kind) => kind === "installed" || kind === "system") as Array<"installed" | "system">,
      enabled: normalizeInstalledEnabledFilter(requestedStatus),
      status: normalizeInstalledStatusFilter(requestedStatus, includeArchived),
      limit: input.limit,
    });
    const installedEntries = installedRows.map((row) => this.toInstalledEntry(row, includeContent));
    const linkedEntries = this.buildLinkedEntries(includeContent);
    const verifiedEntries = this.buildVerifiedEntries(includeContent);
    const importedBySource = buildImportedBySource(installedRows);

    const entries = [
      ...installedEntries,
      ...linkedEntries.map((entry) => attachImportedState(entry, importedBySource)),
      ...verifiedEntries.map((entry) => attachImportedState(entry, importedBySource)),
    ].filter((entry) => {
      if (requestedSourceKinds.length > 0 && !requestedSourceKinds.includes(entry.sourceKind)) {
        return false;
      }
      if (!matchesRequestedStatus(entry, requestedStatus, includeArchived)) {
        return false;
      }
      if (!matchesRequestedTags(entry, requestedTags)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return searchEntry(entry, query);
    });

    return entries
      .sort(compareLibraryEntries)
      .slice(0, normalizeLimit(input.limit) ?? entries.length);
  }

  getEntry(entryId: string, includeContent = false): LibraryGetEntryResponsePayload["entry"] | null {
    this.ensureLinkedIndexReady();
    const normalizedEntryId = normalizeRequired(entryId, "entryId");
    if (normalizedEntryId.startsWith("linked:")) {
      const row = this.linkedRepository?.list().find((entry) => entry.entry_id === normalizedEntryId) ?? null;
      if (!row) return null;
      const resolved = includeContent ? this.refreshLinkedEntryIfStale(row) : row;
      return this.toLinkedEntry(resolved, includeContent);
    }
    if (normalizedEntryId.startsWith("verified:")) {
      return this.buildVerifiedEntries(includeContent).find((entry) => entry.entryId === normalizedEntryId) ?? null;
    }

    const row = this.repository.get(normalizedEntryId);
    if (!row) return null;
    return this.toInstalledEntry(row, includeContent);
  }

  saveSkill(input: LibrarySaveSkillPayload): LibrarySaveSkillResponsePayload {
    const entryId = normalizeOptional(input.entryId) ?? normalizeOptional(input.skillId) ?? `skill-${randomUUID()}`;
    const existing = this.repository.get(entryId);
    const requestedStatus = normalizeEntryStatusPayload(input.status);
    const persistedState = normalizePersistedSkillState(requestedStatus, input.enabled);
    const row = this.repository.upsert({
      skillId: entryId,
      name: normalizeRequired(input.name, "name"),
      description: normalizeOptional(input.description),
      contentMarkdown: normalizeRequired(input.contentMarkdown, "contentMarkdown"),
      sourceRef: normalizeOptional(input.sourceRef),
      sourceKind: input.sourceKind === "system" ? "system" : "installed",
      enabled: persistedState.enabled,
      tags: normalizeStringArray(input.tags),
      provenance: existing ? parseJsonRecord(existing.provenance_json) : {},
      status: persistedState.status,
    });

    return {
      entry: this.toInstalledEntry(row, true),
      created: !existing,
    };
  }

  importEntry(input: LibraryImportEntryPayload): LibraryImportEntryResponsePayload {
    const sourceEntry = this.getEntry(input.entryId, true);
    if (!sourceEntry) {
      throw { code: "NOT_FOUND", message: `Library entry not found: ${input.entryId}` };
    }
    if (!sourceEntry.importable) {
      throw { code: "FAILED_PRECONDITION", message: `Entry is not importable: ${input.entryId}` };
    }

    const skillId = normalizeOptional(input.skillId)
      ?? slugify(normalizeOptional(input.name) ?? sourceEntry.name)
      ?? `skill-${randomUUID()}`;
    const existing = this.repository.get(skillId);
    const row = this.repository.upsert({
      skillId,
      name: normalizeOptional(input.name) ?? sourceEntry.name,
      description: sourceEntry.description,
      contentMarkdown: sourceEntry.contentMarkdown ?? "",
      sourceRef: sourceEntry.sourceRef,
      sourceKind: "installed",
      enabled: true,
      tags: sourceEntry.tags,
      provenance: {
        importedFrom: sourceEntry.entryId,
        importedSourceKind: sourceEntry.sourceKind,
      },
      status: "active",
    });

    return {
      entry: this.toInstalledEntry(row, true),
      created: !existing,
    };
  }

  archiveEntry(input: LibraryArchiveEntryPayload): LibraryArchiveEntryResponsePayload {
    const row = this.repository.archive(normalizeRequired(input.entryId, "entryId"));
    if (!row) {
      throw { code: "NOT_FOUND", message: `Library entry not found: ${input.entryId}` };
    }
    return {
      entry: this.toInstalledEntry(row, true),
      archived: row.status === "archived",
    };
  }

  setEntryEnabled(input: LibrarySetEntryEnabledPayload): LibrarySetEntryEnabledResponsePayload {
    const row = this.repository.setEnabled(
      normalizeRequired(input.entryId, "entryId"),
      input.enabled === true,
    );
    if (!row) {
      throw { code: "NOT_FOUND", message: `Library entry not found: ${input.entryId}` };
    }
    return {
      entry: this.toInstalledEntry(row, true),
    };
  }

  deleteEntry(input: LibraryDeleteEntryPayload): LibraryDeleteEntryResponsePayload {
    return {
      entryId: normalizeRequired(input.entryId, "entryId"),
      deleted: this.repository.delete(normalizeRequired(input.entryId, "entryId")),
    };
  }

  scanEntries(): LibraryScanEntriesResponsePayload {
    const linkedEntries = this.syncLinkedEntries().map((row) => this.toLinkedEntry(row, false));
    return {
      entries: [
        ...linkedEntries,
        ...this.buildVerifiedEntries(false),
      ],
      scannedAt: new Date().toISOString(),
    };
  }

  listSkillDrafts(): LibraryListSkillDraftsResponsePayload["drafts"] {
    if (!this.drafts) return [];
    return this.drafts.list().map((draft) => ({
      draftId: draft.draft_id,
      name: draft.name,
      description: normalizeOptional(draft.description),
      requestPrompt: draft.request_prompt,
      contentMarkdown: draft.content_markdown,
      createdAt: draft.created_at,
      updatedAt: draft.updated_at,
    }));
  }

  getSkillDraft(draftId: string): LibraryGetSkillDraftResponsePayload["draft"] | null {
    if (!this.drafts) return null;
    const draft = this.drafts.get(normalizeRequired(draftId, "draftId"));
    if (!draft) return null;
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

  createSkillDraft(input: LibraryCreateSkillDraftPayload): LibraryCreateSkillDraftResponsePayload {
    if (!this.drafts) {
      throw { code: "FAILED_PRECONDITION", message: "Skill draft repository unavailable" };
    }

    const draftId = normalizeOptional(input.draftId) ?? `draft-${randomUUID()}`;
    const existing = this.drafts.get(draftId);
    const name = normalizeOptional(input.name) ?? inferDraftName(input.requestPrompt);
    const description = normalizeOptional(input.description) ?? input.requestPrompt.trim();
    const draft = this.drafts.upsert({
      draftId,
      name,
      description,
      requestPrompt: normalizeRequired(input.requestPrompt, "requestPrompt"),
      contentMarkdown: buildSkillDraftMarkdown({
        name,
        description,
        requestPrompt: input.requestPrompt,
      }),
    });

    return {
      draft: {
        draftId: draft.draft_id,
        name: draft.name,
        description: normalizeOptional(draft.description),
        requestPrompt: draft.request_prompt,
        contentMarkdown: draft.content_markdown,
        createdAt: draft.created_at,
        updatedAt: draft.updated_at,
      },
      created: !existing,
    };
  }

  deleteSkillDraft(input: LibraryDeleteSkillDraftPayload): LibraryDeleteSkillDraftResponsePayload {
    if (!this.drafts) {
      return {
        draftId: normalizeRequired(input.draftId, "draftId"),
        deleted: false,
      };
    }
    return {
      draftId: normalizeRequired(input.draftId, "draftId"),
      deleted: this.drafts.delete(normalizeRequired(input.draftId, "draftId")),
    };
  }

  getActiveSkillMarkdownMap(skillIds: string[]): Map<string, string> {
    this.ensureLinkedIndexReady();
    const markdownById = new Map<string, string>();
    for (const skillId of normalizeStringArray(skillIds)) {
      const linkedRow = this.linkedRepository?.getBySkillId(skillId) ?? null;
      if (linkedRow) {
        const refreshedRow = this.refreshLinkedEntryIfStale(linkedRow);
        if (refreshedRow.sync_state === "ready") {
          const linkedContent = refreshedRow.content_markdown.trim();
          if (linkedContent) {
            markdownById.set(skillId, linkedContent);
          }
        }
        continue;
      }

      const row = this.repository.get(skillId);
      if (!row || row.status !== "active" || row.enabled !== 1) continue;
      const content = row.content_markdown.trim();
      if (!content) continue;
      markdownById.set(skillId, content);
    }
    return markdownById;
  }

  private toInstalledEntry(row: GatewaySkillCatalogRow, includeContent: boolean): LibraryEntryPayload {
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

  private toLinkedEntry(row: GatewayLinkedSkillIndexRow, includeContent: boolean): LibraryEntryPayload {
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

  private buildLinkedEntries(includeContent: boolean): LibraryEntryPayload[] {
    if (!this.linkedRepository) return [];
    return this.linkedRepository
      .list()
      .map((row) => this.toLinkedEntry(row, includeContent));
  }

  private buildVerifiedEntries(includeContent: boolean): LibraryEntryPayload[] {
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

  private collectSkillFiles(): Map<string, string> {
    const files = new Map<string, string>();
    for (const root of this.resolveScanRoots()) {
      const normalizedRoot = normalizeOptional(root);
      if (!normalizedRoot || !existsSync(normalizedRoot)) {
        continue;
      }

      const stats = statSync(normalizedRoot);
      if (stats.isFile() && basename(normalizedRoot) === "SKILL.md") {
        files.set(normalizedRoot, normalizedRoot);
        continue;
      }

      if (!stats.isDirectory()) {
        continue;
      }

      for (const filePath of walkForSkillFiles(normalizedRoot)) {
        files.set(filePath, filePath);
      }
    }
    return files;
  }

  private resolveScanRoots(): string[] {
    if (Array.isArray(this.scanRootsOverride) && this.scanRootsOverride.length > 0) {
      return Array.from(new Set(this.scanRootsOverride.map((root) => root.trim()).filter(Boolean)));
    }
    const roots = [
      join(homedir(), ".codex", "skills"),
      join(homedir(), ".agents", "skills"),
    ];
    const workspaceAgentsPath = this.workspaceRoot
      ? resolve(this.workspaceRoot, "AGENTS.md")
      : resolve(process.cwd(), "AGENTS.md");
    if (existsSync(workspaceAgentsPath)) {
      const content = readFileSync(workspaceAgentsPath, "utf8");
      for (const match of content.matchAll(/file:\s+([^\s)]+SKILL\.md)/g)) {
        const skillPath = match[1]?.trim();
        if (skillPath) {
          roots.push(skillPath);
          roots.push(dirname(skillPath));
        }
      }
    }
    return Array.from(new Set(roots.map((root) => root.trim()).filter(Boolean)));
  }

  private ensureLinkedIndexReady(): void {
    if (!this.linkedRepository || this.linkedIndexInitialized) return;
    this.syncLinkedEntries();
  }

  private syncLinkedEntries(): GatewayLinkedSkillIndexRow[] {
    if (!this.linkedRepository) return [];

    const seenSourcePaths: string[] = [];
    for (const filePath of this.collectSkillFiles().values()) {
      seenSourcePaths.push(filePath);
      const existing = this.linkedRepository.getBySourcePath(filePath);
      const scanned = scanLinkedSkillFile(filePath);
      if (!scanned) {
        if (existing) {
          this.linkedRepository.upsert({
            entryId: existing.entry_id,
            skillId: existing.skill_id,
            sourcePath: existing.source_path,
            name: existing.name,
            description: existing.description,
            contentMarkdown: existing.content_markdown,
            tags: parseJsonArray(existing.tags_json),
            syncState: "parse_error",
            fileMtimeMs: existing.file_mtime_ms,
            fileSize: existing.file_size,
            contentHash: existing.content_hash,
            createdAt: existing.created_at,
          });
        }
        continue;
      }

      const identifiers = existing ?? linkedIdentifiersForPath(filePath, scanned.name);
      this.linkedRepository.upsert({
        entryId: identifiers.entry_id,
        skillId: identifiers.skill_id,
        sourcePath: filePath,
        name: scanned.name,
        description: scanned.description,
        contentMarkdown: scanned.contentMarkdown,
        tags: scanned.tags,
        syncState: "ready",
        fileMtimeMs: scanned.fileMtimeMs,
        fileSize: scanned.fileSize,
        contentHash: scanned.contentHash,
        createdAt: existing?.created_at,
      });
    }

    this.linkedRepository.markMissingExceptSourcePaths(seenSourcePaths);
    this.linkedIndexInitialized = true;
    return this.linkedRepository.list();
  }

  private refreshLinkedEntryIfStale(row: GatewayLinkedSkillIndexRow): GatewayLinkedSkillIndexRow {
    const sourcePath = row.source_path.trim();
    if (!sourcePath || !existsSync(sourcePath)) {
      const refreshed = this.linkedRepository?.upsert({
        entryId: row.entry_id,
        skillId: row.skill_id,
        sourcePath: row.source_path,
        name: row.name,
        description: row.description,
        contentMarkdown: row.content_markdown,
        tags: parseJsonArray(row.tags_json),
        syncState: "missing",
        fileMtimeMs: row.file_mtime_ms,
        fileSize: row.file_size,
        contentHash: row.content_hash,
        createdAt: row.created_at,
      }) ?? row;
      return refreshed;
    }

    const stats = statSync(sourcePath);
    const fileMtimeMs = Math.floor(stats.mtimeMs);
    const fileSize = Math.floor(stats.size);
    if (row.sync_state === "ready" && row.file_mtime_ms === fileMtimeMs && row.file_size === fileSize) {
      return row;
    }

    const scanned = scanLinkedSkillFile(sourcePath);
    if (!scanned) {
      return this.linkedRepository?.upsert({
        entryId: row.entry_id,
        skillId: row.skill_id,
        sourcePath: row.source_path,
        name: row.name,
        description: row.description,
        contentMarkdown: row.content_markdown,
        tags: parseJsonArray(row.tags_json),
        syncState: "parse_error",
        fileMtimeMs,
        fileSize,
        contentHash: row.content_hash,
        createdAt: row.created_at,
      }) ?? row;
    }

    return this.linkedRepository?.upsert({
      entryId: row.entry_id,
      skillId: row.skill_id,
      sourcePath,
      name: scanned.name,
      description: scanned.description,
      contentMarkdown: scanned.contentMarkdown,
      tags: scanned.tags,
      syncState: "ready",
      fileMtimeMs: scanned.fileMtimeMs,
      fileSize: scanned.fileSize,
      contentHash: scanned.contentHash,
      createdAt: row.created_at,
    }) ?? row;
  }
}

function walkForSkillFiles(root: string): string[] {
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (stats.isFile() && basename(fullPath) === "SKILL.md") {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function scanLinkedSkillFile(filePath: string): {
  name: string;
  description?: string;
  contentMarkdown: string;
  tags: string[];
  fileMtimeMs: number;
  fileSize: number;
  contentHash: string;
} | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const stats = statSync(filePath);
    const metadata = parseFrontmatter(content);
    const name = metadata.name ?? basename(dirname(filePath));
    return {
      name,
      description: metadata.description ?? firstParagraph(content),
      contentMarkdown: content,
      tags: metadata.tags,
      fileMtimeMs: Math.floor(stats.mtimeMs),
      fileSize: Math.floor(stats.size),
      contentHash: createHash("sha1").update(content).digest("hex"),
    };
  } catch {
    return null;
  }
}

function linkedIdentifiersForPath(
  filePath: string,
  displayName: string,
): { entry_id: string; skill_id: string } {
  const pathHash = createHash("sha1").update(filePath).digest("hex").slice(0, 12);
  const baseName = slugify(displayName) ?? "skill";
  return {
    entry_id: `linked:${pathHash}`,
    skill_id: `linked.${baseName}.${pathHash}`,
  };
}

function parseFrontmatter(content: string): { name?: string; description?: string; tags: string[] } {
  const tags: string[] = [];
  if (!content.startsWith("---\n")) {
    return { tags };
  }
  const end = content.indexOf("\n---", 4);
  if (end < 0) {
    return { tags };
  }
  const frontmatter = content.slice(4, end).split("\n");
  let name: string | undefined;
  let description: string | undefined;
  for (const line of frontmatter) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim().replace(/^"|"$/g, "");
    if (!key || !value) continue;
    if (key === "name") name = value;
    if (key === "description") description = value;
    if (key === "tags") {
      tags.push(...value.split(",").map((entry) => entry.trim()).filter(Boolean));
    }
  }
  return { name, description, tags: Array.from(new Set(tags)) };
}

function firstParagraph(content: string): string | undefined {
  return content
    .split("\n\n")
    .map((block) => block.trim())
    .find((block) => block.length > 0 && !block.startsWith("---") && !block.startsWith("#"));
}

function buildImportedBySource(rows: GatewaySkillCatalogRow[]): Map<string, string> {
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

function attachImportedState(entry: LibraryEntryPayload, importedBySource: Map<string, string>): LibraryEntryPayload {
  const importedSkillId = importedBySource.get(entry.entryId);
  return {
    ...entry,
    importedSkillId,
  };
}

function searchEntry(entry: LibraryEntryPayload, query: string): boolean {
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

function matchesRequestedStatus(
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

function matchesRequestedTags(entry: LibraryEntryPayload, requestedTags: string[]): boolean {
  if (requestedTags.length === 0) {
    return true;
  }
  const tags = new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean));
  return requestedTags.every((tag) => tags.has(tag));
}

function buildSkillDraftMarkdown(input: { name: string; description?: string; requestPrompt: string }): string {
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

function inferDraftName(requestPrompt: string): string {
  const cleaned = requestPrompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "New Skill";
  return cleaned.split(" ").slice(0, 4).join(" ").replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
}

function slugify(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

function normalizeOptional(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function normalizeRequired(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw { code: "INVALID_ARGUMENT", message: `${field} is required` };
  }
  return normalized;
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

function normalizeSourceKinds(value: unknown): Array<LibraryEntryPayload["sourceKind"]> {
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

function normalizeStatusFilter(value: unknown): LibraryEntryPayload["status"] | "all" {
  if (value === "all") return "all";
  if (value === "disabled") return "disabled";
  if (value === "archived") return "archived";
  return "enabled";
}

function compareLibraryEntries(lhs: LibraryEntryPayload, rhs: LibraryEntryPayload): number {
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

function normalizeEntryStatusPayload(value: unknown): LibraryEntryPayload["status"] | undefined {
  if (value === "disabled") return "disabled";
  if (value === "archived") return "archived";
  if (value === "enabled") return "enabled";
  return undefined;
}

function normalizeInstalledEnabledFilter(
  requestedStatus: LibraryEntryPayload["status"] | "all",
): "all" | boolean {
  if (requestedStatus === "enabled") return true;
  if (requestedStatus === "disabled") return false;
  return "all";
}

function normalizeInstalledStatusFilter(
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

function normalizePersistedSkillState(
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

function normalizeLimit(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(value), 1), 500);
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
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

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeStringArray(parsed);
  } catch {
    return [];
  }
}
