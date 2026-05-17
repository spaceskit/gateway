export interface SpaceListExperiencesPayload {
  apiVersion?: string;
  spaceId: string;
  limit?: number;
  offset?: number;
}

export interface SpaceExperiencePayload {
  experienceId: string;
  spaceId: string;
  summary: string;
  tags: string[];
  lessons: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceExperienceObservationPayload {
  observationId: string;
  experienceId: string;
  agentId: string;
  observation: string;
  strengths: string[];
  weaknesses: string[];
  createdAt: string;
}

export interface SpaceListExperiencesResponsePayload {
  spaceId: string;
  experiences: SpaceExperiencePayload[];
  total: number;
  nextOffset?: number;
}

export interface SpaceGetExperiencePayload {
  apiVersion?: string;
  spaceId: string;
  experienceId: string;
}

export interface SpaceGetExperienceResponsePayload {
  experience?: SpaceExperiencePayload;
  observations: SpaceExperienceObservationPayload[];
}

export interface SpaceListInsightsPayload {
  apiVersion?: string;
  spaceId: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface SpaceInsightPayload {
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

export interface SpaceListInsightsResponsePayload {
  spaceId: string;
  insights: SpaceInsightPayload[];
  total: number;
  nextOffset?: number;
}

export interface SpaceGetInsightPayload {
  apiVersion?: string;
  insightId: string;
}

export interface SpaceGetInsightResponsePayload {
  insight?: SpaceInsightPayload;
}

export interface SpaceMutateInsightPayload {
  apiVersion?: string;
  insightId: string;
}

export interface SpaceMutateInsightResponsePayload {
  insight?: SpaceInsightPayload;
}

export interface SpaceGetSpaceAgentNotesPayload {
  apiVersion?: string;
  spaceId: string;
  agentId?: string;
}

export interface SpaceAgentNotePayload {
  spaceId: string;
  agentId: string;
  notes: string;
  updatedAt: string;
}

export interface SpaceGetSpaceAgentNotesResponsePayload {
  note?: SpaceAgentNotePayload;
  notes: SpaceAgentNotePayload[];
}

export interface SpaceUpdateSpaceAgentNotesPayload {
  apiVersion?: string;
  spaceId: string;
  agentId: string;
  notes: string;
}

export interface SpaceUpdateSpaceAgentNotesResponsePayload {
  note?: SpaceAgentNotePayload;
}

export interface SpaceGetUserProfilePayload {
  apiVersion?: string;
  principalId?: string;
}

export interface SpaceUserProfilePayload {
  principalId: string;
  profile: Record<string, unknown>;
  updatedAt: string;
  source: "user_profiles" | "user_preferences" | "empty";
}

export interface SpaceGetUserProfileResponsePayload {
  profile: SpaceUserProfilePayload;
}

export interface SpaceUpdateUserProfilePayload {
  apiVersion?: string;
  principalId?: string;
  profile: Record<string, unknown>;
}

export interface SpaceUpdateUserProfileResponsePayload {
  profile: SpaceUserProfilePayload;
}

export interface SpaceListMemoriesPayload {
  apiVersion?: string;
  principalId?: string;
  spaceId?: string;
  agentId?: string;
  type?: "episodic" | "semantic" | "procedural" | "observation";
  limit?: number;
  offset?: number;
}

export interface SpaceMemoryDocumentPayload {
  memoryId: string;
  content: string;
  type: "episodic" | "semantic" | "procedural" | "observation";
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

export interface SpaceListMemoriesResponsePayload {
  memories: SpaceMemoryDocumentPayload[];
  total: number;
  nextOffset?: number;
}

export interface SpaceDeleteMemoryPayload {
  apiVersion?: string;
  memoryId: string;
}

export interface SpaceDeleteMemoryResponsePayload {
  deleted: boolean;
}

export interface SpaceUpdateMemoryImportancePayload {
  apiVersion?: string;
  memoryId: string;
  importance: number;
}

export interface SpaceUpdateMemoryImportanceResponsePayload {
  memory?: SpaceMemoryDocumentPayload;
}
