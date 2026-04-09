import type { MemoryProvider, MemoryType } from "@spaceskit/core";
import type {
  ExperienceRepository,
  ExperienceRow,
  AgentObservationRow,
  PersonalityInsightRepository,
  PersonalityInsightRow,
  ProfileRepository,
  SpaceAgentNotesRepository,
  UserProfileRepository,
} from "@spaceskit/persistence";

export interface MemoryLifecycleServiceOptions {
  experiences?: ExperienceRepository | null;
  insights?: PersonalityInsightRepository | null;
  profiles?: ProfileRepository | null;
  notes?: SpaceAgentNotesRepository | null;
  userProfiles?: UserProfileRepository | null;
  memoryProvider?: MemoryProvider | null;
}

export interface MemoryLifecycleExperiencePayload {
  experienceId: string;
  spaceId: string;
  summary: string;
  tags: string[];
  lessons: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryLifecycleObservationPayload {
  observationId: string;
  experienceId: string;
  agentId: string;
  observation: string;
  strengths: string[];
  weaknesses: string[];
  createdAt: string;
}

export interface MemoryLifecycleInsightPayload {
  insightId: string;
  experienceId?: string;
  spaceId: string;
  profileId: string;
  baseRevision: number;
  proposedPromptDelta: string;
  rationale: string;
  confidence: number;
  status: string;
  approvedRevision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryLifecycleNotePayload {
  spaceId: string;
  agentId: string;
  notes: string;
  updatedAt: string;
}

export interface MemoryLifecycleUserProfilePayload {
  principalId: string;
  profile: Record<string, unknown>;
  updatedAt: string;
  source: "user_profiles" | "user_preferences" | "empty";
}

export interface MemoryLifecycleDocumentPayload {
  memoryId: string;
  content: string;
  type: MemoryType;
  scope: {
    spaceId?: string;
    agentId?: string;
    userId?: string;
    sessionId?: string;
  };
  metadata: Record<string, unknown>;
  tags: string[];
  importance: number;
  createdAt: string;
  updatedAt: string;
}

export class MemoryLifecycleService {
  constructor(private readonly options: MemoryLifecycleServiceOptions) {}

  listExperiences(input: {
    spaceId: string;
    limit?: number;
    offset?: number;
  }): {
    experiences: MemoryLifecycleExperiencePayload[];
    total: number;
    nextOffset?: number;
  } {
    if (!this.options.experiences) {
      return { experiences: [], total: 0 };
    }
    const limit = normalizeLimit(input.limit, 50, 500);
    const offset = normalizeOffset(input.offset);
    const all = this.options.experiences.listBySpace(input.spaceId, 10_000).map(mapExperienceRow);
    const experiences = all.slice(offset, offset + limit);
    const total = all.length;
    return {
      experiences,
      total,
      nextOffset: offset + experiences.length < total ? offset + experiences.length : undefined,
    };
  }

  getExperience(input: {
    spaceId: string;
    experienceId: string;
  }): {
    experience?: MemoryLifecycleExperiencePayload;
    observations: MemoryLifecycleObservationPayload[];
  } {
    if (!this.options.experiences) {
      return { observations: [] };
    }
    const row = this.options.experiences.getById(input.experienceId);
    if (!row || row.space_id !== input.spaceId) {
      return { observations: [] };
    }
    const observations = this.options.experiences
      .listObservationsByExperience(input.experienceId)
      .map(mapObservationRow);
    return {
      experience: mapExperienceRow(row),
      observations,
    };
  }

  listInsights(input: {
    spaceId: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): {
    insights: MemoryLifecycleInsightPayload[];
    total: number;
    nextOffset?: number;
  } {
    if (!this.options.insights) {
      return { insights: [], total: 0 };
    }
    const limit = normalizeLimit(input.limit, 50, 500);
    const offset = normalizeOffset(input.offset);
    const filtered = this.options.insights
      .listBySpace(input.spaceId)
      .filter((row) => !input.status || row.status === input.status)
      .map(mapInsightRow);
    const insights = filtered.slice(offset, offset + limit);
    const total = filtered.length;
    return {
      insights,
      total,
      nextOffset: offset + insights.length < total ? offset + insights.length : undefined,
    };
  }

  getInsight(insightId: string): MemoryLifecycleInsightPayload | undefined {
    if (!this.options.insights) return undefined;
    const row = this.options.insights.getById(insightId);
    return row ? mapInsightRow(row) : undefined;
  }

  acceptInsight(insightId: string): MemoryLifecycleInsightPayload | undefined {
    if (!this.options.insights) return undefined;
    const existing = this.options.insights.getById(insightId);
    if (!existing) {
      return undefined;
    }

    let approvedRevision = 0;
    if (this.options.profiles) {
      const activeRevision = this.options.profiles.getActiveRevision(existing.profile_id);
      if (activeRevision) {
        const proposedPromptDelta = extractProposedPromptDelta(existing.editable_patch);
        const updatedPrompt = mergePersonalityPrompt(activeRevision.personality_prompt, proposedPromptDelta);
        const updated = this.options.profiles.update({
          profileId: existing.profile_id,
          personalityPrompt: updatedPrompt,
          source: `insight:${insightId}`,
        });
        approvedRevision = updated.revision.revision;
      }
    }

    this.options.insights.accept(insightId, approvedRevision);
    const row = this.options.insights.getById(insightId);
    if (row) {
      void this.syncMemorySourceStatus("personality_insight", row.insight_id, row.status);
    }
    return row ? mapInsightRow(row) : undefined;
  }

  rejectInsight(insightId: string): MemoryLifecycleInsightPayload | undefined {
    if (!this.options.insights) return undefined;
    this.options.insights.reject(insightId);
    const row = this.options.insights.getById(insightId);
    if (row) {
      void this.syncMemorySourceStatus("personality_insight", row.insight_id, row.status);
    }
    return row ? mapInsightRow(row) : undefined;
  }

  dismissInsight(insightId: string): MemoryLifecycleInsightPayload | undefined {
    if (!this.options.insights) return undefined;
    this.options.insights.supersede(insightId);
    const row = this.options.insights.getById(insightId);
    if (row) {
      void this.syncMemorySourceStatus("personality_insight", row.insight_id, row.status);
    }
    return row ? mapInsightRow(row) : undefined;
  }

  getSpaceAgentNotes(input: {
    spaceId: string;
    agentId?: string;
  }): {
    note?: MemoryLifecycleNotePayload;
    notes: MemoryLifecycleNotePayload[];
  } {
    if (!this.options.notes) {
      return { notes: [] };
    }
    const agentId = normalizeOptionalString(input.agentId);
    if (agentId) {
      const row = this.options.notes.get(input.spaceId, agentId);
      return {
        note: row ? mapNoteRow(row) : undefined,
        notes: row ? [mapNoteRow(row)] : [],
      };
    }
    return {
      notes: this.options.notes.listBySpace(input.spaceId).map(mapNoteRow),
    };
  }

  updateSpaceAgentNotes(input: {
    spaceId: string;
    agentId: string;
    notes: string;
  }): MemoryLifecycleNotePayload | undefined {
    if (!this.options.notes) return undefined;
    const row = this.options.notes.upsert(input);
    void this.options.memoryProvider?.save({
      content: input.notes,
      type: "procedural",
      scope: {
        spaceId: input.spaceId,
        agentId: input.agentId,
      },
      metadata: {
        sourceType: "space_agent_note",
        sourceId: `${input.spaceId}:${input.agentId}`,
        sourceStatus: "accepted",
      },
      importance: 0.6,
      tags: ["space-note"],
    });
    return mapNoteRow(row);
  }

  getUserProfile(principalIdRaw?: string): MemoryLifecycleUserProfilePayload {
    const principalId = normalizePrincipal(principalIdRaw);
    if (!this.options.userProfiles) {
      return {
        principalId,
        profile: {},
        updatedAt: new Date().toISOString(),
        source: "empty",
      };
    }

    const row = this.options.userProfiles.get(principalId);
    if (row) {
      return {
        principalId,
        profile: parseJsonRecord(row.profile_json),
        updatedAt: row.updated_at,
        source: "user_profiles",
      };
    }

    const localFallback = this.options.userProfiles.getLocalPreferencesFallback();
    if (localFallback) {
      return {
        principalId,
        profile: {
          preferences: {
            experienceLevel: localFallback.experience_level,
            runtimeMode: localFallback.runtime_mode,
            behaviorProfile: localFallback.behavior_profile,
            fullAccessWarningAccepted: localFallback.full_access_warning_accepted === 1,
            developerWarningAccepted: localFallback.developer_warning_accepted === 1,
            calendarEnabled: localFallback.calendar_enabled === 1,
            remindersEnabled: localFallback.reminders_enabled === 1,
          },
        },
        updatedAt: localFallback.updated_at,
        source: "user_preferences",
      };
    }

    return {
      principalId,
      profile: {},
      updatedAt: new Date().toISOString(),
      source: "empty",
    };
  }

  updateUserProfile(input: {
    principalId?: string;
    profile: Record<string, unknown>;
  }): MemoryLifecycleUserProfilePayload {
    const principalId = normalizePrincipal(input.principalId);
    if (!this.options.userProfiles) {
      return {
        principalId,
        profile: input.profile,
        updatedAt: new Date().toISOString(),
        source: "empty",
      };
    }

    const row = this.options.userProfiles.upsert({
      principalId,
      profileJson: JSON.stringify(input.profile),
    });
    void this.options.memoryProvider?.save({
      content: JSON.stringify(input.profile),
      type: "semantic",
      scope: {
        userId: principalId,
      },
      metadata: {
        sourceType: "user_profile",
        sourceId: principalId,
        sourceStatus: "accepted",
        principalId,
      },
      importance: 0.8,
      tags: ["concierge-profile"],
    });
    return {
      principalId,
      profile: parseJsonRecord(row.profile_json),
      updatedAt: row.updated_at,
      source: "user_profiles",
    };
  }

  async listMemories(input: {
    principalId?: string;
    spaceId?: string;
    agentId?: string;
    type?: MemoryType;
    limit?: number;
    offset?: number;
  }): Promise<{
    memories: MemoryLifecycleDocumentPayload[];
    total: number;
    nextOffset?: number;
  }> {
    if (!this.options.memoryProvider) {
      return { memories: [], total: 0 };
    }
    const limit = normalizeLimit(input.limit, 50, 500);
    const offset = normalizeOffset(input.offset);
    const scope = {
      userId: normalizeOptionalString(input.principalId),
      spaceId: normalizeOptionalString(input.spaceId),
      agentId: normalizeOptionalString(input.agentId),
    };
    const all = await this.options.memoryProvider.list(scope, {
      type: input.type,
      sortBy: "recency",
      limit: 10_000,
      offset: 0,
    });
    const sliced = all.slice(offset, offset + limit).map((doc) => ({
      memoryId: doc.id,
      content: doc.content,
      type: doc.type,
      scope: doc.scope,
      metadata: doc.metadata,
      tags: doc.tags,
      importance: doc.importance,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    }));
    const total = all.length;
    return {
      memories: sliced,
      total,
      nextOffset: offset + sliced.length < total ? offset + sliced.length : undefined,
    };
  }

  async deleteMemory(memoryId: string): Promise<{ deleted: boolean }> {
    if (!this.options.memoryProvider) {
      return { deleted: false };
    }
    const existing = await this.options.memoryProvider.get(memoryId);
    if (!existing) {
      return { deleted: false };
    }
    await this.options.memoryProvider.delete(memoryId);
    return { deleted: true };
  }

  async updateMemoryImportance(
    memoryId: string,
    importance: number,
  ): Promise<MemoryLifecycleDocumentPayload | undefined> {
    if (!this.options.memoryProvider) {
      return undefined;
    }
    const existing = await this.options.memoryProvider.get(memoryId);
    if (!existing) {
      return undefined;
    }
    const normalizedImportance = Math.max(0, Math.min(1, Number.isFinite(importance) ? importance : existing.importance));
    const updated = await this.options.memoryProvider.update(memoryId, {
      importance: normalizedImportance,
    });
    return {
      memoryId: updated.id,
      content: updated.content,
      type: updated.type,
      scope: updated.scope,
      metadata: updated.metadata,
      tags: updated.tags,
      importance: updated.importance,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async syncMemorySourceStatus(
    sourceType: string,
    sourceId: string,
    sourceStatus: string,
  ): Promise<void> {
    if (!this.options.memoryProvider) {
      return;
    }
    const documents = await this.options.memoryProvider.list({}, {
      limit: 10_000,
      offset: 0,
      sortBy: "recency",
    });
    const matching = documents.filter((document) => {
      const metadata = document.metadata ?? {};
      return metadata.sourceType === sourceType && metadata.sourceId === sourceId;
    });
    await Promise.all(matching.map((document) => this.options.memoryProvider!.update(document.id, {
      metadata: {
        ...document.metadata,
        sourceStatus,
      },
    })));
  }
}

function mapExperienceRow(row: ExperienceRow): MemoryLifecycleExperiencePayload {
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

function mapObservationRow(row: AgentObservationRow): MemoryLifecycleObservationPayload {
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

function mapInsightRow(row: PersonalityInsightRow): MemoryLifecycleInsightPayload {
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

function extractProposedPromptDelta(editablePatchRaw: string | null | undefined): string {
  const editablePatch = parseJsonRecord(editablePatchRaw);
  return typeof editablePatch.proposedPromptDelta === "string"
    ? editablePatch.proposedPromptDelta.trim()
    : "";
}

function mergePersonalityPrompt(existingPromptRaw: string | null | undefined, proposedPromptDelta: string): string {
  const existingPrompt = normalizeOptionalString(existingPromptRaw) ?? "";
  if (!proposedPromptDelta) {
    return existingPrompt;
  }
  return existingPrompt
    ? `${existingPrompt}\n\n${proposedPromptDelta}`
    : proposedPromptDelta;
}

function mapNoteRow(row: {
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

function parseJsonStringArray(raw: string | null | undefined): string[] {
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

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
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

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePrincipal(value?: string): string {
  return normalizeOptionalString(value) ?? "local";
}

function normalizeLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(1, Math.min(maxValue, Math.floor(value)));
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
