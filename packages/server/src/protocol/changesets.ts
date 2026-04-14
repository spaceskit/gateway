import type { UsageWindowSummaryPayload } from "./usage-policy.js";

export type ChangeSetStatusPayload =
  | "draft"
  | "uploaded"
  | "pending_review"
  | "approved"
  | "applied"
  | "rejected"
  | "expired";

export type ChangeSetAdapterPayload = "filesystem" | "git";

export interface ChangeSetPayload {
  changeSetId: string;
  spaceId: string;
  participantId?: string;
  createdByPrincipalId: string;
  status: ChangeSetStatusPayload;
  title?: string;
  description?: string;
  adapter: ChangeSetAdapterPayload;
  targetBranch?: string;
  workspaceBasePath?: string;
  submittedAt?: string;
  reviewedAt?: string;
  appliedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeSetFilePayload {
  relativePath: string;
  stagedPath: string;
  sha256: string;
  sizeBytes: number;
  changeType: "added" | "modified" | "deleted";
  createdAt: string;
}

export interface ChangeSetReviewPayload {
  reviewId: string;
  changeSetId: string;
  reviewerPrincipalId: string;
  decision: "approved" | "rejected";
  comment?: string;
  diffSummary?: Record<string, unknown>;
  createdAt: string;
}

export interface ChangeSetApplyResultPayload {
  changeSetId: string;
  adapter: ChangeSetAdapterPayload;
  appliedPaths: string[];
  rollbackPath: string;
  git?: {
    attempted: boolean;
    commitMessage: string;
    commitHash?: string;
    warning?: string;
  };
}

export interface SpaceCreateChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  title?: string;
  description?: string;
  adapter?: ChangeSetAdapterPayload;
  targetBranch?: string;
  expiresInSeconds?: number;
}

export interface SpaceCreateChangeSetResponsePayload {
  changeSet: ChangeSetPayload;
}

export interface SpaceListChangeSetsPayload {
  apiVersion?: string;
  spaceId: string;
  statuses?: ChangeSetStatusPayload[];
  limit?: number;
  offset?: number;
}

export interface SpaceListChangeSetsResponsePayload {
  spaceId: string;
  changeSets: ChangeSetPayload[];
}

export interface SpaceUploadChangeSetFileInitPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  relativePath: string;
}

export interface SpaceUploadChangeSetFileInitResponsePayload {
  uploadId: string;
  changeSet: ChangeSetPayload;
  relativePath: string;
}

export interface SpaceUploadChangeSetFileCompletePayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  uploadId: string;
  contentBase64?: string;
  sourcePath?: string;
  expectedSha256?: string;
}

export interface SpaceUploadChangeSetFileCompleteResponsePayload {
  changeSet: ChangeSetPayload;
  file: ChangeSetFilePayload;
}

export interface SpaceSubmitChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceSubmitChangeSetResponsePayload {
  changeSet: ChangeSetPayload;
}

export interface SpaceReviewChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  decision: "approved" | "rejected";
  comment?: string;
}

export interface SpaceReviewChangeSetResponsePayload {
  changeSet: ChangeSetPayload;
  review: ChangeSetReviewPayload;
}

export interface SpaceApplyChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceApplyChangeSetResponsePayload {
  changeSet: ChangeSetPayload;
  result: ChangeSetApplyResultPayload;
}

export interface SpaceChangeSetDiffPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceChangeSetDiffResponsePayload {
  changeSetId: string;
  unifiedDiff: string;
  files: Array<{
    relativePath: string;
    changeType: string;
    sizeBytes: number;
  }>;
  generatedAt: string;
}

export interface SpaceQuotaPolicyPayload {
  spaceId: string;
  maxStagingBytes: number;
  maxOpenChangeSets: number;
  maxAppliedChangeSetsPerMonth: number;
  tokenBudget: number;
  maxParticipantStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSetsPerParticipant: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface ParticipantQuotaPolicyPayload {
  spaceId: string;
  principalId: string;
  maxStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSets: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface SpaceUsageSnapshotPayload {
  spaceId: string;
  stagingBytes: number;
  openChangeSets: number;
  appliedChangeSetsPerMonth: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSpendUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
  updatedAt: string;
}

export interface ParticipantUsageSnapshotPayload {
  spaceId: string;
  principalId: string;
  stagingBytes: number;
  uploadsToday: number;
  openChangeSets: number;
  toolCallsPerHour: number;
  updatedAt: string;
}

export interface SpaceGetQuotaPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceGetQuotaResponsePayload {
  spacePolicy: SpaceQuotaPolicyPayload;
  participantPolicy?: ParticipantQuotaPolicyPayload;
}

export interface SpaceUpdateQuotaPolicyPayload {
  apiVersion?: string;
  spaceId: string;
  maxStagingBytes?: number;
  maxOpenChangeSets?: number;
  maxAppliedChangeSetsPerMonth?: number;
  tokenBudget?: number;
  maxParticipantStagingBytes?: number;
  maxUploadsPerDay?: number;
  maxOpenChangeSetsPerParticipant?: number;
  maxToolCallsPerHour?: number;
}

export interface SpaceUpdateQuotaPolicyResponsePayload {
  spacePolicy: SpaceQuotaPolicyPayload;
}

export interface SpaceGetUsagePayload {
  apiVersion?: string;
  spaceId: string;
  includeAgentSessions?: boolean;
  includeGlobalLifetime?: boolean;
}

export interface AgentUsageSessionPayload {
  sessionId: string;
  spaceId: string;
  agentId: string;
  agentRole: string;
  displayTitle?: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt?: string;
  lastActivityAt: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface SpaceGetUsageResponsePayload {
  spaceUsage: SpaceUsageSnapshotPayload;
  participantUsage?: ParticipantUsageSnapshotPayload;
  agentSessions?: AgentUsageSessionPayload[];
  globalLifetime?: UsageWindowSummaryPayload;
}

export interface SpaceListActivityLogPayload {
  apiVersion?: string;
  spaceId: string;
  turnId?: string;
  limit?: number;
  offset?: number;
  includeSystem?: boolean;
}

export interface SpaceActivityLogEntryPayload {
  entryId: string;
  source: "event_log" | "orchestration_journal" | "turns";
  category: string;
  turnId?: string;
  rootTurnId?: string;
  summaryTurnId?: string;
  agentId?: string;
  actorId?: string;
  eventType: string;
  title: string;
  detail?: string;
  status?: string;
  visibility: string;
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
  seq: number;
  payload: Record<string, unknown>;
}

export interface SpaceListActivityLogResponsePayload {
  spaceId: string;
  spaceUid?: string;
  entries: SpaceActivityLogEntryPayload[];
  total: number;
  nextOffset?: number;
}

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

export interface SpaceGetTurnTracePayload {
  apiVersion?: string;
  spaceId: string;
  turnId: string;
  limit?: number;
  offset?: number;
}

export interface TurnTraceEventPayload {
  eventId: string;
  seq: number;
  eventType: string;
  eventSubtype?: string;
  agentId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface TurnTraceToolCallPayload {
  toolCallId: string;
  toolName?: string;
  status: "started" | "completed" | "error";
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TurnTraceActivityPayload {
  activityId: string;
  seq: number;
  eventType: string;
  agentId?: string;
  title: string;
  detail?: string;
  status?: string;
  visibility: string;
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface TurnTraceExecutionRunPayload {
  executionId: string;
  stepIndex: number;
  agentId?: string;
  providerId?: string;
  modelId?: string;
  status: "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  workingDirectory?: string;
  exitCode?: number;
  commandPreview?: string;
  transcriptArtifactId?: string;
  transcriptTruncated: boolean;
}

export interface TurnTracePayload {
  spaceId: string;
  turnId: string;
  total: number;
  events: TurnTraceEventPayload[];
  toolCalls: TurnTraceToolCallPayload[];
  activities: TurnTraceActivityPayload[];
  executionRuns: TurnTraceExecutionRunPayload[];
  artifactIds: string[];
}

export interface SpaceGetTurnTraceResponsePayload {
  trace: TurnTracePayload;
}

export interface SpaceListArtifactsPayload {
  apiVersion?: string;
  spaceId: string;
  turnId?: string;
  limit?: number;
  offset?: number;
}

export interface SpaceGetArtifactPayload {
  apiVersion?: string;
  spaceId: string;
  artifactId: string;
}

export interface SpaceGetDebugArtifactPayload {
  apiVersion?: string;
  spaceId: string;
  artifactId: string;
}

export interface SpaceArtifactSummaryPayload {
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

export interface SpaceArtifactDetailPayload extends SpaceArtifactSummaryPayload {
  content: string | Record<string, unknown>;
}

export interface SpaceListArtifactsResponsePayload {
  artifacts: SpaceArtifactSummaryPayload[];
  total: number;
}

export interface SpaceGetArtifactResponsePayload {
  artifact: SpaceArtifactDetailPayload;
}

export interface SpaceGetDebugArtifactResponsePayload {
  artifact: SpaceArtifactDetailPayload;
}

export interface SpaceResetAgentUsageSessionPayload {
  apiVersion?: string;
  spaceId: string;
  agentId: string;
}

export interface SpaceResetAgentUsageSessionResponsePayload {
  closedSessionId?: string;
  activeSession: AgentUsageSessionPayload;
}

export interface ToolDenyReasonPayload {
  code: string;
  message: string;
}

export interface EffectiveToolOperationPayload {
  operationId: string;
  capability: string;
  operation: string;
  providerIds: string[];
  allowed: boolean;
  denyReasons: ToolDenyReasonPayload[];
}

export interface EffectiveToolMatrixPayload {
  spaceId: string;
  principalId?: string;
  deviceId?: string;
  agentId?: string;
  policyVersion: string;
  operations: EffectiveToolOperationPayload[];
  generatedAt: string;
}

export interface SpaceGetEffectiveToolsPayload {
  apiVersion?: string;
  spaceId: string;
  agentId?: string;
  accessMode?: "default" | "full_access";
}

export interface SpaceGetEffectiveToolsResponsePayload {
  matrix: EffectiveToolMatrixPayload;
}
