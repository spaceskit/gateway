import type { SharingIdentityPolicy } from "./services/space-sharing-service.js";

export function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function parseSharingIdentityPolicyFromSpaceConfig(
  config: Record<string, unknown>,
): SharingIdentityPolicy | undefined {
  const candidate = (
    (isRecord(config.sharingIdentityPolicy) && config.sharingIdentityPolicy)
    || (isRecord(config.sharing_identity_policy) && config.sharing_identity_policy)
  ) as Record<string, unknown> | undefined;
  if (!candidate) return undefined;

  const modeRaw = normalizeOptionalString(candidate.mode)
    ?? normalizeOptionalString(candidate.identityMode)
    ?? normalizeOptionalString(candidate.identity_mode);
  const mode = modeRaw === "strict_apple_id" ? "strict_apple_id" : "device_key";

  const allowFallbackRaw = candidate.allowDeviceKeyFallback;
  const allowFallback = typeof allowFallbackRaw === "boolean"
    ? allowFallbackRaw
    : candidate.allow_device_key_fallback === true;

  return {
    mode,
    allowDeviceKeyFallback: allowFallback,
  };
}

export function normalizeTokenCount(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function toProfileSummaryPayload(
  row: {
    profile_id: string;
    name: string;
    description: string;
    can_moderate: number;
    is_default: number;
    active_revision: number;
    archived: number;
    created_at: string;
    updated_at: string;
  },
  revision: {
    personality_prompt?: string;
    default_skill_set_ids_json?: string;
    provider_hint?: string;
    model_hint?: string;
    model_config_json?: string;
    source?: string;
  } | undefined,
): {
  profileId: string;
  name: string;
  description: string;
  personalityPrompt: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig: {
    preferredModels: string[];
    fallbackModels?: string[];
    constraints?: Record<string, unknown>;
  };
  canModerate: boolean;
  isDefault: boolean;
  status: "active" | "archived";
  activeRevision: number;
  source: string;
  createdAt: string;
  updatedAt: string;
} {
  const modelConfig = parseProfileModelConfig(revision?.model_config_json, revision?.model_hint);
  return {
    profileId: row.profile_id,
    name: row.name,
    description: row.description,
    personalityPrompt: revision?.personality_prompt ?? "",
    defaultSkillIds: parseJsonStringArray(revision?.default_skill_set_ids_json),
    providerHint: revision?.provider_hint || undefined,
    modelHint: modelConfig.preferredModels[0] ?? revision?.model_hint ?? undefined,
    modelConfig,
    canModerate: row.can_moderate === 1,
    isDefault: row.is_default === 1,
    status: row.archived === 1 ? "archived" : "active",
    activeRevision: row.active_revision,
    source: revision?.source ?? "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

export function parseProfileModelConfig(
  raw: string | null | undefined,
  modelHint: string | null | undefined,
): {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
} {
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const preferredModels = normalizeStringArray(parsed.preferredModels);
      const fallbackModels = normalizeStringArray(parsed.fallbackModels);
      const constraints = isRecord(parsed.constraints) ? parsed.constraints : undefined;
      return {
        preferredModels: preferredModels.length > 0
          ? preferredModels
          : (modelHint?.trim() ? [modelHint.trim()] : []),
        ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
        ...(constraints ? { constraints } : {}),
      };
    } catch {
      // Fallback below.
    }
  }

  return {
    preferredModels: modelHint?.trim() ? [modelHint.trim()] : [],
    fallbackModels: [],
  };
}

export function normalizeProfileModelConfig(
  value: { preferredModels: string[]; fallbackModels?: string[]; constraints?: Record<string, unknown> } | undefined,
  modelHint?: string,
): {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
} {
  const preferredModels = normalizeStringArray(value?.preferredModels);
  const fallbackModels = normalizeStringArray(value?.fallbackModels);
  if (preferredModels.length === 0 && modelHint?.trim()) {
    preferredModels.push(modelHint.trim());
  }

  return {
    preferredModels,
    ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
    ...(value?.constraints ? { constraints: value.constraints } : {}),
  };
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
