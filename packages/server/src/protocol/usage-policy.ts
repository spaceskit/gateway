export interface UsageGetSnapshotPayload {
  apiVersion?: string;
}

export interface UsageWindowSummaryPayload {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface BudgetSummaryPayload {
  softCapUsd: number;
  hardCapUsd: number;
  warningThreshold: number;
  spentUsd: number;
  leftUsd: number;
}

export interface ProviderUsageSnapshotPayload {
  providerId: string;
  status: "available" | "unavailable" | "unknown";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
  message?: string;
}

export interface VoiceUsageWindowSummaryPayload {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
  estimatedCostUsd: number;
}

export interface VoiceUsageSourceSummaryPayload {
  source: "managed" | "byok" | "local_model" | "apple_speech" | "unknown";
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
  estimatedCostUsd: number;
}

export interface VoiceUsageLockSummaryPayload {
  enabled: boolean;
  managedSttSecondsMonthlyLimit?: number;
  managedTtsCharsMonthlyLimit?: number;
  managedTtsSecondsMonthlyLimit?: number;
  managedCurrentMonthSttSeconds?: number;
  managedCurrentMonthTtsChars?: number;
  managedCurrentMonthTtsSeconds?: number;
}

export interface VoiceUsageSnapshotPayload {
  windows: {
    last5h: VoiceUsageWindowSummaryPayload;
    last7d: VoiceUsageWindowSummaryPayload;
    last30d: VoiceUsageWindowSummaryPayload;
    lifetime: VoiceUsageWindowSummaryPayload;
  };
  bySource: VoiceUsageSourceSummaryPayload[];
  lock?: VoiceUsageLockSummaryPayload;
}

export interface UsageSnapshotPayload {
  computedAt: string;
  currency: "USD";
  windows: {
    last5h: UsageWindowSummaryPayload;
    last7d: UsageWindowSummaryPayload;
    last30d: UsageWindowSummaryPayload;
    lifetime: UsageWindowSummaryPayload;
  };
  budget: BudgetSummaryPayload;
  providerUsage: ProviderUsageSnapshotPayload[];
  voice?: VoiceUsageSnapshotPayload;
}

export interface UsageGetSnapshotResponsePayload {
  snapshot: UsageSnapshotPayload;
}

export interface GatewayPolicyPayload {
  allowedCapabilityTypes: string[];
  deniedCapabilityTypes: string[];
  allowedSkillIds: string[];
  deniedSkillIds: string[];
  globalFlags: Record<string, unknown>;
  updatedAt: string;
}

export interface GatewayGetPolicyPayload {
  apiVersion?: string;
}

export interface GatewayGetPolicyResponsePayload {
  policy: GatewayPolicyPayload;
}

export interface GatewayUpdatePolicyPayload {
  apiVersion?: string;
  allowedCapabilityTypes?: string[];
  deniedCapabilityTypes?: string[];
  allowedSkillIds?: string[];
  deniedSkillIds?: string[];
  globalFlags?: Record<string, unknown>;
}

export interface GatewayUpdatePolicyResponsePayload {
  policy: GatewayPolicyPayload;
}
