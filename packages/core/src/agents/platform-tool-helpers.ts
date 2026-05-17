import type { ExperienceStatus } from "../experiences/types.js";

export const PLATFORM_TOOL_PREFIX = "platform.";
export const MAX_TURN_CONTENT_PREVIEW = 200;

export function inferSpaceState(space: { agents: unknown[] }): string {
  return (space as Record<string, unknown>).status as string ?? "active";
}

export function truncateContent(jsonStr: string | null): string | null {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    const text = typeof parsed === "string"
      ? parsed
      : typeof parsed.text === "string"
        ? parsed.text
        : typeof parsed.content === "string"
          ? parsed.content
          : JSON.stringify(parsed);
    return text.length > MAX_TURN_CONTENT_PREVIEW
      ? text.slice(0, MAX_TURN_CONTENT_PREVIEW) + "..."
      : text;
  } catch {
    return jsonStr.length > MAX_TURN_CONTENT_PREVIEW
      ? jsonStr.slice(0, MAX_TURN_CONTENT_PREVIEW) + "..."
      : jsonStr;
  }
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeOptionalInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.floor(value);
}

export function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeExperienceStatus(value: unknown): ExperienceStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "draft":
    case "accepted":
    case "rejected":
    case "archived":
      return normalized;
    default:
      return undefined;
  }
}

export function extractTextPreview(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object" && "text" in parsed && typeof (parsed as Record<string, unknown>).text === "string") {
      return (parsed as Record<string, unknown>).text as string;
    }
  } catch {
    return raw;
  }
  return "";
}

export function buildSpaceDigestFallback(
  spaceName: string,
  turns: Array<{ agentId: string; output: string }>,
): string {
  if (turns.length === 0) {
    return `${spaceName} has no recent activity.`;
  }
  const preview = turns
    .slice(0, 3)
    .map((turn) => `${turn.agentId}: ${turn.output.slice(0, 120)}`)
    .join(" ");
  return `${spaceName} recent activity: ${preview}`;
}

export function normalizeTopology(value: unknown): "direct" | "shared_team_chat" | "broadcast_team" | undefined {
  return value === "direct" || value === "shared_team_chat" || value === "broadcast_team"
    ? value
    : undefined;
}

export function safeParseJson<T>(jsonStr: string, fallback: T): T {
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

export function firstPreferredModelFromProfileConfig(jsonStr: string): string | null {
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (!Array.isArray(parsed.preferredModels)) {
      return null;
    }
    const preferredModel = parsed.preferredModels.find((entry) =>
      typeof entry === "string" && entry.trim().length > 0
    );
    return typeof preferredModel === "string" ? preferredModel.trim() : null;
  } catch {
    return null;
  }
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
