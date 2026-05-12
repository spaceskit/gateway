import type { ProviderTelemetryPayload } from "@spaceskit/server";
import { mapFallbackTelemetrySource } from "./gateway-admin-telemetry-normalizers.js";
import type { LocalProviderUsageTelemetry } from "./services/local-usage-telemetry-types.js";

export function buildLocalUsageTelemetryFallback(
  fallbackTelemetry: ProviderTelemetryPayload[],
  fetchedAt: string,
): LocalProviderUsageTelemetry[] {
  return fallbackTelemetry.map((entry) => ({
    providerId: entry.providerId,
    status: entry.status,
    fetchedAt,
    message: entry.message,
    quota: {
      available: entry.windows.length > 0,
      sourceLabel: mapFallbackTelemetrySource(entry.source),
      windows: entry.windows.map((window) => ({
        window: window.window,
        label: window.window === "primary" ? "session" : "weekly",
        usedPercent: window.usedPercent,
        remainingPercent: window.remainingPercent,
        windowMinutes: window.windowDurationMins,
        resetsAt: window.resetsAt,
      })),
      accountLabel: entry.accountLabel,
      updatedAt: fetchedAt,
      message: "Local usage telemetry service is not configured.",
    },
    summary: {
      windowDays: 30,
      sessionCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      tokenAccuracy: "estimated",
      usageSource: "local_scanner",
    },
    sessions: [],
  }));
}
