import { createHash } from "node:crypto";
import { GatewaySyncError } from "./sync-service-types.js";
import type {
  PullResourcesResult,
  SyncResourceDenied,
  SyncResourcePayload,
  SyncResourceRef,
  SyncProvenance,
} from "./sync-service-types.js";

export function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore parse errors.
  }
  return [];
}

export function parseUnknownTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return Array.from(
    new Set(
      raw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function sanitizeStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function dedupeRefs(refs: SyncResourceRef[]): SyncResourceRef[] {
  const map = new Map<string, SyncResourceRef>();
  for (const ref of refs) {
    const key = `${ref.resourceType}:${ref.resourceId}`;
    if (!map.has(key)) {
      map.set(key, ref);
    }
  }
  return Array.from(map.values());
}

export function clampLimit(limit: number, min: number, max: number): number {
  if (!Number.isFinite(limit)) return min;
  return Math.min(max, Math.max(min, Math.floor(limit)));
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = Number.parseInt(decoded, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function computeSyncRefVersionHash(input: {
  resourceType: string;
  resourceId: string;
  updatedAt?: string;
  tags?: string[];
}): string {
  return hashJson({
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    updatedAt: input.updatedAt ?? "",
    tags: input.tags ?? [],
  });
}

export function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function hashSecret(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

export function normalizeAuthHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function parsePullResponse(raw: string): PullResourcesResult {
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      return {
        resources: Array.isArray(parsed.resources)
          ? (parsed.resources as SyncResourcePayload[])
          : [],
        denied: Array.isArray(parsed.denied)
          ? (parsed.denied as SyncResourceDenied[])
          : [],
        provenance: Array.isArray(parsed.provenance)
          ? (parsed.provenance as SyncProvenance[])
          : [],
        appliedCount: asNumber(parsed.appliedCount),
        skippedCount: asNumber(parsed.skippedCount),
        apiVersion: normalizeApiVersion(asNonEmptyString(parsed.apiVersion)),
      };
    }
  } catch {
    // Ignore and fallback.
  }

  return {
    resources: [],
    denied: [],
    provenance: [],
    appliedCount: 0,
    skippedCount: 0,
    apiVersion: "v2",
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeApiVersion(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "v2";
}

export function coerceContentJson(value: unknown, fallback: Record<string, unknown>): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify({ value: String(value ?? "") });
  }
}

export function deterministicImportArtifactId(
  peerId: string,
  targetSpaceId: string,
  resourceType: string,
  resourceId: string,
): string {
  const digest = hashJson({
    peerId,
    targetSpaceId,
    resourceType,
    resourceId,
  }).slice(0, 24);

  return `artifact-sync-${digest}`;
}

export function normalizeHttpBaseUrl(raw: string): string | undefined {
  const normalized = raw.trim();
  if (!normalized) return undefined;

  // Accept ws/wss endpoints and map them to http/https for sync HTTP routes.
  const endpoint = normalized
    .replace(/^ws:\/\//i, "http://")
    .replace(/^wss:\/\//i, "https://");

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function mapRemoteStatusToError(status: number, message: string): GatewaySyncError {
  if (status === 400) {
    return new GatewaySyncError("INVALID_ARGUMENT", message);
  }
  if (status === 403) {
    return new GatewaySyncError("PERMISSION_DENIED", message);
  }
  if (status === 404) {
    return new GatewaySyncError("NOT_FOUND", message);
  }

  return new GatewaySyncError("FAILED_PRECONDITION", message);
}
