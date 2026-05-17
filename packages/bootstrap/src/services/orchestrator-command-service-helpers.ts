export function parseObject(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors.
  }
  return undefined;
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

  const highlights = turns
    .slice(0, 3)
    .map((turn) => {
      const normalizedOutput = turn.output.trim();
      const preview = normalizedOutput.length > 140
        ? `${normalizedOutput.slice(0, 137)}...`
        : normalizedOutput;
      return `${turn.agentId}: ${preview}`;
    });

  return `${spaceName} has recent activity. ${highlights.join(" ")}`;
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export function asRole(value: unknown): "participant" | "global_coordinator" | "space_moderator" | undefined {
  if (
    value === "participant"
    || value === "global_coordinator"
    || value === "space_moderator"
  ) {
    return value;
  }
  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeSpaceStatusList(value: unknown): Array<"created" | "active" | "paused" | "completed" | "failed"> {
  if (!Array.isArray(value)) return [];
  const normalized = new Set<"created" | "active" | "paused" | "completed" | "failed">();
  for (const entry of value) {
    if (
      entry === "created"
      || entry === "active"
      || entry === "paused"
      || entry === "completed"
      || entry === "failed"
    ) {
      normalized.add(entry);
    }
  }
  return [...normalized];
}

export function normalizeSkillListStatus(value: unknown): "active" | "archived" | "all" | undefined {
  if (value === "active" || value === "archived" || value === "all") {
    return value;
  }
  return undefined;
}

export function normalizeSkillWriteStatus(value: unknown): "active" | "archived" | undefined {
  if (value === "active" || value === "archived") {
    return value;
  }
  return undefined;
}

export function normalizeDigestWindow(value: unknown): "latest" | "recent" {
  return asString(value)?.toLowerCase() === "recent" ? "recent" : "latest";
}

