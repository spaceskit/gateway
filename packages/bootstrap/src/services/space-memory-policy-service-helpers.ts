import type {
  SpaceExperienceCaptureMode,
  SpaceMemoryPolicy,
  SpacePrivacyMode,
  ThinkingCapturePolicy,
} from "@spaceskit/core";
import type { EndIncognitoSessionResult } from "./space-memory-policy-service.js";

export function emptyDeletedCounts(): EndIncognitoSessionResult["deleted"] {
  return {
    turns: 0,
    eventLog: 0,
    orchestrationJournal: 0,
    artifacts: 0,
    experiences: 0,
    personalityInsights: 0,
    agentNotes: 0,
    agentUsageSessions: 0,
  };
}

export function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function normalizeTimestamp(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseSpaceConfig(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed config payloads and fall back to defaults.
  }
  return {};
}

export function parseSpaceMemoryPolicy(value: unknown): SpaceMemoryPolicy {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    experienceCapture: parseSpaceExperienceCaptureMode(
      record.experienceCapture ?? record.experience_capture,
    ),
    privacyMode: parseSpacePrivacyMode(
      record.privacyMode ?? record.privacy_mode,
    ),
  };
}

export function parseSpaceExperienceCaptureMode(value: unknown): SpaceExperienceCaptureMode {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  switch (normalized) {
    case "ENABLED":
      return "ENABLED";
    case "DISABLED":
      return "DISABLED";
    default:
      return "INHERIT";
  }
}

export function parseSpacePrivacyMode(value: unknown): SpacePrivacyMode {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return normalized === "INCOGNITO_SESSION" ? "INCOGNITO_SESSION" : "STANDARD";
}

export function parseThinkingCapturePolicy(value: unknown): ThinkingCapturePolicy {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  switch (normalized) {
    case "OFF":
      return "OFF";
    case "FULL":
      return "FULL";
    default:
      return "SUMMARY";
  }
}

export function serializeSpaceMemoryPolicy(value: SpaceMemoryPolicy): Record<string, SpaceExperienceCaptureMode | SpacePrivacyMode> {
  return {
    experienceCapture: value.experienceCapture,
    privacyMode: value.privacyMode,
  };
}

export function normalizeGatewayExperienceCapture(
  value: string,
): Exclude<SpaceExperienceCaptureMode, "INHERIT"> {
  return value === "DISABLED" ? "DISABLED" : "ENABLED";
}
