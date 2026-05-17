import type { PersonaRevisionRow, ProfileModelConfig } from "@spaceskit/persistence";
import type { ProfileModelConfigPayload } from "./internal-payload-types.js";

export const DEFAULT_PERSONA_DEFINITION = {
  personaId: "persona-default",
  name: "Focused Guide",
  description: "Clear, calm, direct guidance with restrained emotion.",
  tone: "Direct and clear.",
  style: "Concise, structured, and practical.",
  emotionalLayer: "Steady and supportive without excess chatter.",
  constraints: [
    "Do not invent facts.",
    "State assumptions when needed.",
    "Prefer simple explanations before advanced detail.",
    "When citing tool results, reference the specific tool and its output.",
    "Use markdown formatting when structure aids clarity, but do not over-format short answers.",
  ],
  instructions:
    "Be warm enough to feel human, but stay precise and task-focused. Answer questions directly before elaborating. When given a command, confirm what you will do, then do it.",
} as const;

export function buildPersonaInstructions(revision: PersonaRevisionRow | undefined): string {
  if (!revision) return "";
  const constraints = parseStringArray(revision.constraints_json);
  const parts: string[] = [];
  if (revision.tone.trim()) {
    parts.push(`Tone: ${revision.tone.trim()}`);
  }
  if (revision.style.trim()) {
    parts.push(`Style: ${revision.style.trim()}`);
  }
  if (revision.emotional_layer.trim()) {
    parts.push(`Emotional Layer: ${revision.emotional_layer.trim()}`);
  }
  if (constraints.length > 0) {
    parts.push(`Constraints:\n${constraints.map((constraint) => `- ${constraint}`).join("\n")}`);
  }
  if (revision.instructions.trim()) {
    parts.push(revision.instructions.trim());
  }
  return parts.join("\n\n");
}

export function normalizeOptional(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

export function normalizeRequired(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw { code: "INVALID_ARGUMENT", message: `${field} is required` };
  }
  return normalized;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return normalizeStringArray(parsed);
  } catch {
    return [];
  }
}

export function normalizeModelConfig(
  input: ProfileModelConfigPayload | undefined,
): ProfileModelConfig | undefined {
  if (!input) {
    return undefined;
  }
  const preferredModels = normalizeStringArray(input?.preferredModels);
  const fallbackModels = normalizeStringArray(input?.fallbackModels);
  const constraints = input?.constraints && typeof input.constraints === "object"
    ? input.constraints
    : undefined;
  return {
    preferredModels,
    ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
    ...(constraints ? { constraints } : {}),
  };
}

export function parseModelConfig(
  raw: string | null | undefined,
): ProfileModelConfig {
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return normalizeModelConfig({
        preferredModels: normalizeStringArray(parsed.preferredModels),
        fallbackModels: normalizeStringArray(parsed.fallbackModels),
        constraints: parsed.constraints && typeof parsed.constraints === "object"
          ? parsed.constraints as Record<string, unknown>
          : undefined,
      }) ?? { preferredModels: [] };
    } catch {
      // Treat malformed model config as empty; model_config_json is canonical.
    }
  }

  return normalizeModelConfig(undefined) ?? { preferredModels: [] };
}

export function toModelConfigPayload(modelConfig: ProfileModelConfig | undefined): ProfileModelConfigPayload | undefined {
  if (!modelConfig) return undefined;
  return {
    preferredModels: normalizeStringArray(modelConfig.preferredModels),
    fallbackModels: normalizeStringArray(modelConfig.fallbackModels),
    ...(modelConfig.constraints ? { constraints: modelConfig.constraints } : {}),
  };
}

export function isMissingPersonaTableError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  return message.includes("no such table: personas")
    || message.includes("no such table: persona_revisions");
}

export function personaSchemaUnavailableError(): { code: "FAILED_PRECONDITION"; message: string } {
  return {
    code: "FAILED_PRECONDITION",
    message: "Gateway persona schema is unavailable. Restart on the upgraded gateway build to repair identity storage.",
  };
}
