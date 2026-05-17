import type { ExperienceStatus } from "../experiences/types.js";
import type { MemoryDocument } from "./types.js";

export function rowToMemoryDocument(row: Record<string, unknown>): MemoryDocument {
  const metadata = JSON.parse(String(row.metadata_json ?? "{}")) as Record<string, unknown>;
  if (typeof row.source_type === "string" && row.source_type.trim().length > 0) {
    metadata.sourceType = row.source_type;
  }
  if (typeof row.source_id === "string" && row.source_id.trim().length > 0) {
    metadata.sourceId = row.source_id;
  }
  if (typeof row.status === "string" && row.status.trim().length > 0) {
    metadata.sourceStatus = row.status;
  }
  if (typeof row.principal_id === "string" && row.principal_id.trim().length > 0) {
    metadata.principalId = row.principal_id;
  }

  return {
    id: String(row.id),
    content: String(row.content),
    type: row.type as MemoryDocument["type"],
    scope: {
      spaceId: row.space_id as string | undefined,
      agentId: row.agent_id as string | undefined,
      userId: row.user_id as string | undefined,
      sessionId: row.session_id as string | undefined,
    },
    metadata,
    tags: JSON.parse(String(row.tags_json ?? "[]")) as string[],
    importance: typeof row.importance === "number" ? row.importance : 0.5,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export function getDocumentSourceStatus(doc: MemoryDocument): ExperienceStatus | undefined {
  const sourceStatus = doc.metadata.sourceStatus;
  if (
    sourceStatus === "draft" ||
    sourceStatus === "accepted" ||
    sourceStatus === "rejected" ||
    sourceStatus === "archived"
  ) {
    return sourceStatus;
  }
  return undefined;
}

export function getSourceStatusWeight(status: ExperienceStatus | undefined): number {
  switch (status) {
    case "accepted":
      return 1.2;
    case "draft":
      return 0.8;
    case "rejected":
      return 0.3;
    case "archived":
      return 0.5;
    default:
      return 1;
  }
}

export function resolveSourceLinkage(
  metadata: Record<string, unknown>,
  scopedPrincipalId?: string,
): {
  sourceType: string;
  sourceId: string;
  status: string;
  principalId: string;
} | undefined {
  const sourceType = normalizeSourceField(metadata.sourceType ?? metadata.source_type);
  const sourceId = normalizeSourceField(metadata.sourceId ?? metadata.source_id);
  if (!sourceType || !sourceId) {
    return undefined;
  }
  const status = normalizeSourceField(
    metadata.sourceStatus ?? metadata.source_status ?? metadata.status,
  ) ?? "";
  const principalId = normalizeSourceField(
    metadata.principalId ?? metadata.principal_id,
  ) ?? normalizeSourceField(scopedPrincipalId) ?? "";
  return {
    sourceType,
    sourceId,
    status,
    principalId,
  };
}

function normalizeSourceField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
