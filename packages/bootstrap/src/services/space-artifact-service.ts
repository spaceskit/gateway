import {
  ArtifactRepository,
  SpaceRepository,
  type ArtifactRow,
} from "@spaceskit/persistence";

export type SpaceArtifactServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION";

export class SpaceArtifactServiceError extends Error {
  readonly code: SpaceArtifactServiceErrorCode;

  constructor(code: SpaceArtifactServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SpaceArtifactSummary {
  artifactId: string;
  spaceId: string;
  turnId?: string;
  agentId?: string;
  type: string;
  title: string;
  mimeType?: string;
  sizeBytes: number;
  tags: string[];
  visibility: "shared" | "private";
  createdAt: string;
  updatedAt: string;
}

export interface SpaceArtifactDetail extends SpaceArtifactSummary {
  content: string | Record<string, unknown>;
}

export interface SpaceArtifactServiceOptions {
  artifacts: ArtifactRepository;
  spaces: SpaceRepository;
  maxArtifactBytes?: number;
}

export class SpaceArtifactService {
  private readonly maxArtifactBytes: number;

  constructor(private readonly options: SpaceArtifactServiceOptions) {
    this.maxArtifactBytes = options.maxArtifactBytes ?? 256 * 1024;
  }

  listArtifacts(input: {
    spaceId: string;
    turnId?: string;
    limit?: number;
    offset?: number;
  }): { artifacts: SpaceArtifactSummary[]; total: number } {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    this.assertSpaceExists(spaceId);
    const turnId = normalizeOptional(input.turnId);
    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);

    const rows = turnId
      ? this.options.artifacts.listBySpaceAndTurnPaged(spaceId, turnId, limit, offset)
      : this.options.artifacts.listBySpacePaged(spaceId, limit, offset);

    const artifacts = rows.map((row) => mapSummary(row));
    const total = turnId
      ? this.options.artifacts.countBySpaceAndTurn(spaceId, turnId)
      : this.options.artifacts.countBySpace(spaceId);
    return { artifacts, total };
  }

  getArtifact(input: { spaceId: string; artifactId: string }): SpaceArtifactDetail {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const artifactId = normalizeRequired(input.artifactId, "artifactId");
    this.assertSpaceExists(spaceId);

    const row = this.options.artifacts.getById(artifactId);
    if (!row || row.space_id !== spaceId) {
      throw new SpaceArtifactServiceError("NOT_FOUND", `Artifact not found in space: ${artifactId}`);
    }

    if (row.size_bytes > this.maxArtifactBytes) {
      throw new SpaceArtifactServiceError(
        "FAILED_PRECONDITION",
        `Artifact exceeds display size limit (${row.size_bytes}/${this.maxArtifactBytes} bytes)`,
      );
    }

    const parsed = parseContent(row.content_json);
    return {
      ...mapSummary(row),
      content: parsed,
    };
  }

  private assertSpaceExists(spaceId: string): void {
    if (!this.options.spaces.getById(spaceId)) {
      throw new SpaceArtifactServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }
}

function mapSummary(row: ArtifactRow): SpaceArtifactSummary {
  return {
    artifactId: row.artifact_id,
    spaceId: row.space_id,
    turnId: normalizeOptional(row.turn_id),
    agentId: normalizeOptional(row.agent_id),
    type: row.artifact_type,
    title: row.title,
    mimeType: normalizeOptional(row.mime_type),
    sizeBytes: row.size_bytes,
    tags: parseTags(row.tags_json),
    visibility: row.visibility === "private" ? "private" : "shared",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseContent(raw: string): string | Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // return raw string below
  }
  return raw;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new SpaceArtifactServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  return Math.max(1, Math.min(1000, Math.floor(value)));
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
