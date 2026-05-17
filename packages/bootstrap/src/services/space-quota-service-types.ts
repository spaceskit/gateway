import type {
  AgentUsageSessionRepository,
  ParticipantQuotaPolicyRepository,
  ParticipantUsageCounterRepository,
  SpaceChangeSetFileRepository,
  SpaceChangeSetRepository,
  SpaceQuotaPolicyRepository,
  SpaceRepository,
  SpaceUsageCounterRepository,
  UsageAnalyticsRepository,
} from "@spaceskit/persistence";

export type SpaceQuotaServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "QUOTA_EXCEEDED";

export class SpaceQuotaServiceError extends Error {
  readonly code: SpaceQuotaServiceErrorCode;

  constructor(code: SpaceQuotaServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SpaceQuotaPolicy {
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

export interface ParticipantQuotaPolicy {
  spaceId: string;
  principalId: string;
  maxStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSets: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface SpaceUsageSnapshot {
  spaceId: string;
  stagingBytes: number;
  openChangeSets: number;
  appliedChangeSetsPerMonth: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSpendUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner";
  updatedAt: string;
}

export interface ParticipantUsageSnapshot {
  spaceId: string;
  principalId: string;
  stagingBytes: number;
  uploadsToday: number;
  openChangeSets: number;
  toolCallsPerHour: number;
  updatedAt: string;
}

export interface GetSpaceQuotaResult {
  spacePolicy: SpaceQuotaPolicy;
  participantPolicy?: ParticipantQuotaPolicy;
}

export interface GetSpaceUsageResult {
  spaceUsage: SpaceUsageSnapshot;
  participantUsage?: ParticipantUsageSnapshot;
  agentSessions?: AgentUsageSessionSnapshot[];
  globalLifetime?: GlobalUsageSummary;
}

export interface AgentUsageSessionSnapshot {
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
  usageSource: "ledger" | "local_scanner";
}

export interface GlobalUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner";
}

export interface UpdateSpaceQuotaPolicyInput {
  spaceId: string;
  updatedBy: string;
  maxStagingBytes?: number;
  maxOpenChangeSets?: number;
  maxAppliedChangeSetsPerMonth?: number;
  tokenBudget?: number;
  maxParticipantStagingBytes?: number;
  maxUploadsPerDay?: number;
  maxOpenChangeSetsPerParticipant?: number;
  maxToolCallsPerHour?: number;
}

export interface SpaceQuotaServiceOptions {
  spaces: SpaceRepository;
  spaceQuotaPolicies: SpaceQuotaPolicyRepository;
  participantQuotaPolicies: ParticipantQuotaPolicyRepository;
  spaceUsageCounters: SpaceUsageCounterRepository;
  participantUsageCounters: ParticipantUsageCounterRepository;
  changeSets: SpaceChangeSetRepository;
  changeSetFiles: SpaceChangeSetFileRepository;
  usageAnalytics: UsageAnalyticsRepository;
  agentUsageSessions: AgentUsageSessionRepository;
  now?: () => Date;
  inputPricePer1k?: number;
  outputPricePer1k?: number;
  onAgentUsageSessionReset?: (spaceId: string, agentId: string) => void;
}
