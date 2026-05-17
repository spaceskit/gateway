export interface LocalUsageInstallHint {
  command: string;
  docsUrl: string;
}

export interface LocalUsageWindow {
  window: "primary" | "secondary" | "tertiary";
  label: "session" | "weekly" | "tertiary";
  usedPercent?: number;
  remainingPercent?: number;
  windowMinutes?: number;
  resetsAt?: string;
  resetDescription?: string;
}

export interface CodexBarQuota {
  available: boolean;
  sourceLabel?: string;
  windows: LocalUsageWindow[];
  creditsRemaining?: number;
  accountLabel?: string;
  updatedAt?: string;
  message?: string;
  installHint?: LocalUsageInstallHint;
}

export interface LocalUsageSession {
  sessionId: string;
  model?: string;
  startedAt?: string;
  lastActivityAt: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner";
}

export interface LocalUsageSummary {
  windowDays: number;
  sessionCount: number;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner";
}

export interface LocalProviderUsageTelemetry {
  providerId: string;
  status: "available" | "unavailable" | "unknown";
  fetchedAt: string;
  message?: string;
  quota: CodexBarQuota;
  summary: LocalUsageSummary;
  sessions: LocalUsageSession[];
}
