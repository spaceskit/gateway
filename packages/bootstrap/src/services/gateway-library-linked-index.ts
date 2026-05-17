import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  GatewayLinkedSkillIndexRepository,
  GatewayLinkedSkillIndexRow,
} from "@spaceskit/persistence";
import type { LibraryEntryPayload } from "./internal-payload-types.js";
import {
  normalizeOptional,
  parseJsonArray,
  slugify,
  toLinkedEntry,
} from "./gateway-library-read-model.js";

export interface GatewayLinkedSkillIndexServiceOptions {
  repository?: GatewayLinkedSkillIndexRepository | null;
  workspaceRoot?: string;
  scanRoots?: string[];
}

export type LinkedSkillMarkdownLookup =
  | { found: true; markdown?: string }
  | { found: false };

export class GatewayLinkedSkillIndexService {
  private readonly repository: GatewayLinkedSkillIndexRepository | null;
  private readonly workspaceRoot?: string;
  private readonly scanRootsOverride?: string[];
  private initialized = false;

  constructor(options: GatewayLinkedSkillIndexServiceOptions) {
    this.repository = options.repository ?? null;
    this.workspaceRoot = options.workspaceRoot;
    this.scanRootsOverride = options.scanRoots;
  }

  ensureReady(): void {
    if (!this.repository || this.initialized) return;
    this.syncRows();
  }

  listEntries(includeContent: boolean): LibraryEntryPayload[] {
    if (!this.repository) return [];
    return this.repository
      .list()
      .map((row) => toLinkedEntry(row, includeContent));
  }

  getEntry(entryId: string, includeContent: boolean): LibraryEntryPayload | null {
    const row = this.repository?.list().find((entry) => entry.entry_id === entryId) ?? null;
    if (!row) return null;
    const resolved = includeContent ? this.refreshIfStale(row) : row;
    return toLinkedEntry(resolved, includeContent);
  }

  scanEntries(): LibraryEntryPayload[] {
    return this.syncRows().map((row) => toLinkedEntry(row, false));
  }

  getActiveSkillMarkdown(skillId: string): LinkedSkillMarkdownLookup {
    const linkedRow = this.repository?.getBySkillId(skillId) ?? null;
    if (!linkedRow) {
      return { found: false };
    }

    const refreshedRow = this.refreshIfStale(linkedRow);
    if (refreshedRow.sync_state !== "ready") {
      return { found: true };
    }

    const linkedContent = refreshedRow.content_markdown.trim();
    if (!linkedContent) {
      return { found: true };
    }

    return {
      found: true,
      markdown: linkedContent,
    };
  }

  private syncRows(): GatewayLinkedSkillIndexRow[] {
    if (!this.repository) return [];

    const seenSourcePaths: string[] = [];
    for (const filePath of this.collectSkillFiles().values()) {
      seenSourcePaths.push(filePath);
      const existing = this.repository.getBySourcePath(filePath);
      const scanned = scanLinkedSkillFile(filePath);
      if (!scanned) {
        if (existing) {
          this.repository.upsert({
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
      this.repository.upsert({
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

    this.repository.markMissingExceptSourcePaths(seenSourcePaths);
    this.initialized = true;
    return this.repository.list();
  }

  private refreshIfStale(row: GatewayLinkedSkillIndexRow): GatewayLinkedSkillIndexRow {
    const sourcePath = row.source_path.trim();
    if (!sourcePath || !existsSync(sourcePath)) {
      return this.repository?.upsert({
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
    }

    const stats = statSync(sourcePath);
    const fileMtimeMs = Math.floor(stats.mtimeMs);
    const fileSize = Math.floor(stats.size);
    if (row.sync_state === "ready" && row.file_mtime_ms === fileMtimeMs && row.file_size === fileSize) {
      return row;
    }

    const scanned = scanLinkedSkillFile(sourcePath);
    if (!scanned) {
      return this.repository?.upsert({
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

    return this.repository?.upsert({
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
