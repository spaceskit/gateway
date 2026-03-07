import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  KnowledgeBaseEntryRepository,
  type KnowledgeBaseEntryKind,
  type KnowledgeBaseEntryScopeType,
} from "@spaceskit/persistence";
import type {
  GatewayKnowledgeBaseEntryPayload,
  GatewayListKnowledgeBaseEntriesPayload,
  GatewayUpsertKnowledgeBaseEntryPayload,
} from "@spaceskit/server";

export interface KnowledgeBaseServiceOptions {
  repository: KnowledgeBaseEntryRepository;
}

export class KnowledgeBaseServiceError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "FAILED_PRECONDITION";

  constructor(code: KnowledgeBaseServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class KnowledgeBaseService {
  constructor(private readonly options: KnowledgeBaseServiceOptions) {}

  listEntries(
    input: GatewayListKnowledgeBaseEntriesPayload = {},
  ): GatewayKnowledgeBaseEntryPayload[] {
    const limit = normalizeLimit(input.limit);
    const kinds = normalizeKinds(input.kinds);
    const tags = normalizeTags(input.tags);
    const query = normalizeOptional(input.query);
    const spaceId = normalizeOptional(input.spaceId);

    return this.options.repository.list({
      spaceId,
      limit,
      kinds,
      tags,
      query,
    }).map((row) => this.toPayload(row));
  }

  upsertEntry(
    input: GatewayUpsertKnowledgeBaseEntryPayload,
  ): GatewayKnowledgeBaseEntryPayload {
    const entryId = normalizeOptional(input.entryId) ?? `kb-${randomUUID()}`;
    const name = normalizeRequired(input.name, "name");
    const kind = normalizeKind(input.kind);
    const normalizedUri = normalizeUri(kind, normalizeRequired(input.uri, "uri"));
    const description = normalizeOptional(input.description);
    const tags = normalizeTags(input.tags);
    const scopeType = normalizeScopeType(input.scopeType);
    const spaceId = scopeType === "space"
      ? normalizeRequired(input.spaceId, "spaceId")
      : undefined;

    const row = this.options.repository.upsert({
      entryId,
      name,
      kind,
      uri: normalizedUri,
      description,
      tags,
      scopeType,
      spaceId,
    });

    return this.toPayload(row);
  }

  deleteEntry(entryId: string): boolean {
    return this.options.repository.delete(normalizeRequired(entryId, "entryId"));
  }

  private toPayload(
    row: ReturnType<KnowledgeBaseEntryRepository["upsert"]>,
  ): GatewayKnowledgeBaseEntryPayload {
    return {
      entryId: row.entry_id,
      name: row.name,
      kind: row.kind,
      uri: row.uri,
      description: normalizeOptional(row.description),
      tags: normalizeTags(parseStringArray(row.tags_json)),
      scopeType: row.scope_type,
      spaceId: normalizeOptional(row.space_id ?? undefined),
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
    throw new KnowledgeBaseServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(value), 1), 500);
}

function normalizeKinds(values: GatewayListKnowledgeBaseEntriesPayload["kinds"]): KnowledgeBaseEntryKind[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalized = Array.from(new Set(values.filter((value): value is KnowledgeBaseEntryKind => (
    value === "web" || value === "file" || value === "folder"
  ))));

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTags(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ));
}

function normalizeKind(value: string): KnowledgeBaseEntryKind {
  if (value === "web" || value === "file" || value === "folder") {
    return value;
  }
  throw new KnowledgeBaseServiceError("INVALID_ARGUMENT", `Unsupported kind: ${value}`);
}

function normalizeScopeType(value: string): KnowledgeBaseEntryScopeType {
  if (value === "global" || value === "space") {
    return value;
  }
  throw new KnowledgeBaseServiceError("INVALID_ARGUMENT", `Unsupported scopeType: ${value}`);
}

function normalizeUri(kind: KnowledgeBaseEntryKind, raw: string): string {
  if (kind === "web") {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new KnowledgeBaseServiceError("INVALID_ARGUMENT", "Web links must be valid URLs");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new KnowledgeBaseServiceError("INVALID_ARGUMENT", "Web links must use http or https");
    }
    return parsed.toString();
  }

  if (raw.startsWith("file://")) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new KnowledgeBaseServiceError("INVALID_ARGUMENT", "Local links must be valid file URLs or absolute paths");
    }
    if (parsed.protocol !== "file:") {
      throw new KnowledgeBaseServiceError("INVALID_ARGUMENT", "Local links must use file:// URLs or absolute paths");
    }
    return parsed.toString();
  }

  if (!isAbsolute(raw)) {
    throw new KnowledgeBaseServiceError(
      "INVALID_ARGUMENT",
      "Local links must use file:// URLs or absolute paths",
    );
  }

  return pathToFileURL(raw).toString();
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
