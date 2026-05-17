import type { ProviderUsageSnapshotPayload } from "./usage-policy.js";

export interface LocalUsageInstallHintPayload {
  command: string;
  docsUrl: string;
}

export interface LocalUsageWindowPayload {
  window: "primary" | "secondary" | "tertiary";
  label: "session" | "weekly" | "tertiary";
  usedPercent?: number;
  remainingPercent?: number;
  windowMinutes?: number;
  resetsAt?: string;
  resetDescription?: string;
}

export interface CodexBarQuotaPayload {
  available: boolean;
  sourceLabel?: string;
  windows: LocalUsageWindowPayload[];
  creditsRemaining?: number;
  accountLabel?: string;
  updatedAt?: string;
  message?: string;
  installHint?: LocalUsageInstallHintPayload;
}

export interface LocalUsageSessionPayload {
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

export interface LocalUsageSummaryPayload {
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

export interface LocalProviderUsageTelemetryPayload {
  providerId: string;
  status: ProviderUsageSnapshotPayload["status"];
  fetchedAt: string;
  message?: string;
  quota: CodexBarQuotaPayload;
  summary: LocalUsageSummaryPayload;
  sessions: LocalUsageSessionPayload[];
}

export interface GatewayGetLocalUsageTelemetryResponsePayload {
  telemetry: LocalProviderUsageTelemetryPayload[];
  generatedAt: string;
}
