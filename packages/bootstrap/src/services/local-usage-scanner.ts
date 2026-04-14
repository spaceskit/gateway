import { createReadStream, existsSync, readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { createInterface } from "node:readline";

export interface LocalUsageSessionRecord {
  sessionId: string;
  model?: string;
  startedAtMs?: number;
  lastActivityAtMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export interface LocalUsageSessionScanner {
  readonly providerId: string;
  scan(windowStartMs: number): Promise<LocalUsageSessionRecord[]>;
}

export interface CachedScannerFile {
  mtimeMs: number;
  size: number;
  sessions: LocalUsageSessionRecord[];
}

export function walkFiles(
  roots: string[],
  includeFile: (filePath: string) => boolean,
): string[] {
  const files: string[] = [];
  const stack = [...roots];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;

    let entries: Array<{
      name: string;
      isDirectory: () => boolean;
      isFile: () => boolean;
    }>;
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (includeFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export async function readCachedSessions(
  filePath: string,
  cache: Map<string, CachedScannerFile>,
  parseFile: (path: string, entries: Record<string, unknown>[], fileMtimeMs: number) => LocalUsageSessionRecord[],
): Promise<LocalUsageSessionRecord[]> {
  let fileStat: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    fileStat = await stat(filePath);
  } catch {
    return [];
  }

  const mtimeMs = Number.isFinite(fileStat.mtimeMs) ? fileStat.mtimeMs : 0;
  const size = Number.isFinite(fileStat.size) ? fileStat.size : 0;
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.sessions;
  }

  let entries: Record<string, unknown>[] = [];
  try {
    entries = await readJsonEntries(filePath);
  } catch {
    cache.set(filePath, {
      mtimeMs,
      size,
      sessions: [],
    });
    return [];
  }

  const sessions = parseFile(filePath, entries, mtimeMs);
  cache.set(filePath, {
    mtimeMs,
    size,
    sessions,
  });
  return sessions;
}

export async function readJsonEntries(filePath: string): Promise<Record<string, unknown>[]> {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".jsonl") || normalized.endsWith(".log")) {
    return readJsonLines(filePath);
  }

  const content = await readFile(filePath, "utf8");
  return parseJsonEntries(content);
}

async function readJsonLines(filePath: string): Promise<Record<string, unknown>[]> {
  const entries: Record<string, unknown>[] = [];
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    const candidate = line.trim();
    if (!candidate || !candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (isObjectRecord(parsed)) {
        entries.push(parsed);
      }
    } catch {
      // Ignore malformed JSONL lines.
    }
  }

  return entries;
}

export async function yieldToEventLoop(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function purgeMissingFiles(cache: Map<string, CachedScannerFile>, retainedPaths: Set<string>): void {
  for (const cachedPath of cache.keys()) {
    if (!retainedPaths.has(cachedPath)) {
      cache.delete(cachedPath);
    }
  }
}

export function parseJsonEntries(rawContent: string): Record<string, unknown>[] {
  const content = rawContent.trim();
  if (!content) return [];

  if (content.startsWith("{") || content.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.filter(isObjectRecord);
      }
      if (isObjectRecord(parsed)) {
        return [parsed];
      }
    } catch {
      // Fall back to JSONL parser below.
    }
  }

  const entries: Record<string, unknown>[] = [];
  for (const line of content.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate || !candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (isObjectRecord(parsed)) {
        entries.push(parsed);
      }
    } catch {
      // Ignore malformed JSONL line.
    }
  }
  return entries;
}

export function mergeSessions(
  sessions: LocalUsageSessionRecord[],
  windowStartMs: number,
): LocalUsageSessionRecord[] {
  const bySessionId = new Map<string, LocalUsageSessionRecord>();

  for (const rawSession of sessions) {
    if (!rawSession.sessionId) continue;
    if (rawSession.lastActivityAtMs < windowStartMs) continue;

    const existing = bySessionId.get(rawSession.sessionId);
    if (!existing) {
      bySessionId.set(rawSession.sessionId, {
        ...rawSession,
      });
      continue;
    }

    bySessionId.set(rawSession.sessionId, {
      sessionId: existing.sessionId,
      model: existing.model ?? rawSession.model,
      startedAtMs: minDefined(existing.startedAtMs, rawSession.startedAtMs),
      lastActivityAtMs: Math.max(existing.lastActivityAtMs, rawSession.lastActivityAtMs),
      inputTokens: Math.max(existing.inputTokens, rawSession.inputTokens),
      cachedInputTokens: Math.max(existing.cachedInputTokens, rawSession.cachedInputTokens),
      outputTokens: Math.max(existing.outputTokens, rawSession.outputTokens),
      totalTokens: maxDefined(existing.totalTokens, rawSession.totalTokens),
    });
  }

  return Array.from(bySessionId.values())
    .sort((lhs, rhs) => rhs.lastActivityAtMs - lhs.lastActivityAtMs);
}

function maxDefined(lhs: number | undefined, rhs: number | undefined): number | undefined {
  if (lhs === undefined) return rhs;
  if (rhs === undefined) return lhs;
  return Math.max(lhs, rhs);
}

function minDefined(lhs: number | undefined, rhs: number | undefined): number | undefined {
  if (lhs === undefined) return rhs;
  if (rhs === undefined) return lhs;
  return Math.min(lhs, rhs);
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

export function normalizeTokenCount(value: unknown): number {
  const numeric = asNumber(value);
  if (numeric === undefined) return 0;
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export function parseTimestampMs(value: unknown): number | undefined {
  const numeric = asNumber(value);
  if (numeric !== undefined) {
    if (numeric > 1_000_000_000_000) {
      return Math.floor(numeric);
    }
    if (numeric > 1_000_000_000) {
      return Math.floor(numeric * 1_000);
    }
  }

  const text = asString(value);
  if (!text) return undefined;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractTimestampMs(payload: Record<string, unknown>): number | undefined {
  const keys = [
    "timestamp",
    "ts",
    "time",
    "createdAt",
    "created_at",
    "updatedAt",
    "updated_at",
    "lastActivityAt",
    "last_activity_at",
  ];

  for (const key of keys) {
    const parsed = parseTimestampMs(payload[key]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  for (const nestedKey of ["message", "event", "meta", "session_meta", "turn_context"]) {
    const nested = payload[nestedKey];
    if (!isObjectRecord(nested)) continue;
    const parsed = extractTimestampMs(nested);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

export function findNestedRecord(
  payload: Record<string, unknown>,
  key: string,
  depth = 0,
): Record<string, unknown> | undefined {
  if (depth > 4) return undefined;

  const direct = payload[key];
  if (isObjectRecord(direct)) {
    return direct;
  }

  for (const value of Object.values(payload)) {
    if (!isObjectRecord(value)) continue;
    const nested = findNestedRecord(value, key, depth + 1);
    if (nested) return nested;
  }

  return undefined;
}

export function basenameWithoutExtension(filePath: string): string {
  const segments = filePath.split("/");
  const base = segments[segments.length - 1] ?? "";
  if (!base) return filePath;
  const extension = extname(base);
  return extension.length > 0
    ? base.slice(0, Math.max(0, base.length - extension.length))
    : base;
}
