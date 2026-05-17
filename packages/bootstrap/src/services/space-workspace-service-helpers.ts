import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve as resolvePath, sep as pathSep } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpaceWorkspaceMetadataStatus } from "./space-workspace-service.js";

export const SPACE_DIR_FOLDER = ".space";
const MANAGED_FOLDER_SLUG_MAX_LENGTH = 48;

export const SPACE_DIR_GITIGNORE_ENTRY = ".space/";

export const WELL_KNOWN_PROJECT_FILES = [
  "CLAUDE.md", ".claude/CLAUDE.md",
  "AGENTS.md",
  ".cursorrules", ".cursor/rules",
  "package.json", "Makefile", "Cargo.toml",
  "pyproject.toml", "go.mod",
  "README.md", ".gitignore",
] as const;

export interface SpaceWorkspaceLayout {
  root: string;
  meta: string;
  logs: string;
  work: string;
  sharedContext: string;
  scratchpads: string;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseMetadataStatus(value: unknown): SpaceWorkspaceMetadataStatus {
  if (value === "unknown" || value === "ready" || value === "conflict") {
    return value;
  }
  return "unknown";
}

export function detectGitRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}

export function discoverProjectFiles(root: string): string[] {
  const found: string[] = [];
  for (const relativePath of WELL_KNOWN_PROJECT_FILES) {
    if (existsSync(join(root, relativePath))) {
      found.push(relativePath);
    }
  }
  return found;
}

export function slugifyManagedFolderName(value: string): string | undefined {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MANAGED_FOLDER_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
  return normalized || undefined;
}

export async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export async function ensureFileExists(path: string, content: string): Promise<void> {
  try {
    await readFile(path, "utf8");
  } catch {
    await writeFile(path, content, "utf8");
  }
}

export async function ensureGitignoreContains(root: string, entry: string): Promise<void> {
  const gitignorePath = join(root, ".gitignore");
  let current = "";
  try {
    current = await readFile(gitignorePath, "utf8");
  } catch {
    current = "";
  }

  const lines = current
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.includes(entry)) return;

  const next = current.endsWith("\n") || current.length === 0
    ? `${current}${entry}\n`
    : `${current}\n${entry}\n`;
  await writeFile(gitignorePath, next, "utf8");
}

export function workspaceLayout(root: string): SpaceWorkspaceLayout {
  const normalizedRoot = resolvePath(root);
  return {
    root: normalizedRoot,
    meta: join(normalizedRoot, SPACE_DIR_FOLDER),
    logs: join(normalizedRoot, SPACE_DIR_FOLDER, "logs"),
    work: join(normalizedRoot, SPACE_DIR_FOLDER, "work"),
    sharedContext: join(normalizedRoot, SPACE_DIR_FOLDER, "shared-context"),
    scratchpads: join(normalizedRoot, SPACE_DIR_FOLDER, "scratchpads"),
  };
}

export function parseSpaceConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function serializeEventForJsonl(
  event: Record<string, unknown>,
  includeDebugPayloads: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: typeof event.type === "string" ? event.type : "unknown",
    timestamp: normalizeEventTimestamp(event.timestamp),
    spaceId: typeof event.spaceId === "string" ? event.spaceId : undefined,
    turnId: typeof event.turnId === "string" ? event.turnId : undefined,
    agentId: typeof event.agentId === "string" ? event.agentId : undefined,
  };

  const metadata: Record<string, unknown> = {};
  const heavyKeys = new Set([
    "input",
    "output",
    "messages",
    "payload",
    "args",
    "result",
    "content",
    "text",
    "prompt",
    "toolCalls",
  ]);

  for (const [key, value] of Object.entries(event)) {
    if (key === "type" || key === "timestamp" || key === "spaceId" || key === "turnId" || key === "agentId") {
      continue;
    }

    if (!includeDebugPayloads && heavyKeys.has(key)) {
      continue;
    }

    metadata[key] = summarizeValue(value, includeDebugPayloads);
  }

  if (Object.keys(metadata).length > 0) {
    base.metadata = metadata;
  }

  return base;
}

function normalizeEventTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function summarizeValue(value: unknown, includeDebugPayloads: boolean): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (includeDebugPayloads) return value;
    return value.length > 256 ? `[string:${value.length}]` : value;
  }
  if (Array.isArray(value)) {
    if (includeDebugPayloads) return value;
    return `[array:${value.length}]`;
  }
  if (typeof value === "object") {
    if (includeDebugPayloads) return value;
    return "[object]";
  }
  return String(value);
}

export function normalizeCandidatePath(
  rawPath: unknown,
  cwdRaw?: unknown,
): string | null {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  let decoded = trimmed;
  if (decoded.startsWith("file://")) {
    try {
      decoded = fileURLToPath(new URL(decoded));
    } catch {
      return null;
    }
  }

  const cwd = typeof cwdRaw === "string" && cwdRaw.trim().length > 0
    ? cwdRaw.trim()
    : undefined;
  const resolved = cwd
    ? resolvePath(cwd, decoded)
    : resolvePath(decoded);
  return resolved;
}

export function isPathWithinScope(targetPath: string, scopePath: string): boolean {
  const normalizedTarget = resolvePath(targetPath);
  const normalizedScope = resolvePath(scopePath);
  if (normalizedTarget === normalizedScope) return true;
  return normalizedTarget.startsWith(`${normalizedScope}${pathSep}`);
}

export function normalizeFileUrlPath(value: string): string | null {
  if (!value.startsWith("file://")) return value;
  try {
    return fileURLToPath(new URL(value));
  } catch {
    return null;
  }
}

export function isAbsolutePath(value: string): boolean {
  return isAbsolute(value);
}
