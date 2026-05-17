import type {
  AgentObservationRow,
  ExperienceRow,
  PersonalityInsightRow,
} from "@spaceskit/persistence";
import type {
  MemoryLifecycleExperiencePayload,
  MemoryLifecycleInsightPayload,
  MemoryLifecycleNotePayload,
  MemoryLifecycleObservationPayload,
} from "./memory-lifecycle-service.js";

export function mapExperienceRow(row: ExperienceRow): MemoryLifecycleExperiencePayload {
  return {
    experienceId: row.experience_id,
    spaceId: row.space_id,
    summary: row.summary,
    tags: parseJsonStringArray(row.tags_json),
    lessons: parseJsonStringArray(row.lessons_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapObservationRow(row: AgentObservationRow): MemoryLifecycleObservationPayload {
  return {
    observationId: row.observation_id,
    experienceId: row.experience_id,
    agentId: row.agent_id,
    observation: row.observation,
    strengths: parseJsonStringArray(row.strengths_json),
    weaknesses: parseJsonStringArray(row.weaknesses_json),
    createdAt: row.created_at,
  };
}

export function mapInsightRow(row: PersonalityInsightRow): MemoryLifecycleInsightPayload {
  const proposedPromptDelta = extractProposedPromptDelta(row.editable_patch);

  return {
    insightId: row.insight_id,
    experienceId: normalizeOptionalString(row.experience_id),
    spaceId: row.space_id,
    profileId: row.profile_id,
    baseRevision: row.base_revision,
    proposedPromptDelta,
    rationale: row.rationale,
    confidence: row.confidence,
    status: row.status,
    approvedRevision: row.approved_revision,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function extractProposedPromptDelta(editablePatchRaw: string | null | undefined): string {
  const editablePatch = parseJsonRecord(editablePatchRaw);
  return typeof editablePatch.proposedPromptDelta === "string"
    ? editablePatch.proposedPromptDelta.trim()
    : "";
}

export function mergePersonalityPrompt(existingPromptRaw: string | null | undefined, proposedPromptDelta: string): string {
  const existingPrompt = normalizeOptionalString(existingPromptRaw) ?? "";
  if (!proposedPromptDelta) {
    return existingPrompt;
  }
  return existingPrompt
    ? `${existingPrompt}\n\n${proposedPromptDelta}`
    : proposedPromptDelta;
}

export function mapNoteRow(row: {
  space_id: string;
  agent_id: string;
  notes: string;
  updated_at: string;
}): MemoryLifecycleNotePayload {
  return {
    spaceId: row.space_id,
    agentId: row.agent_id,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // ignore invalid JSON
  }
  return [];
}

export function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore invalid JSON
  }
  return {};
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePrincipal(value?: string): string {
  return normalizeOptionalString(value) ?? "local";
}

export function normalizeLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(1, Math.min(maxValue, Math.floor(value)));
}

export function normalizeOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
