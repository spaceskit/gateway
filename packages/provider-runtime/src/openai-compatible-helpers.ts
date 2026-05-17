import type { GenerateResult, TokenUsage, ToolCall, TurnReasoningEffort } from "@spaceskit/core";

export type SupportedProviderId =
  | "openai"
  | "openrouter"
  | "groq"
  | "together"
  | "mistral"
  | "lmstudio"
  | "ollama";

export interface ModelReference {
  providerId: SupportedProviderId;
  fullModelId: string;
  providerModelId: string;
}

export const DEFAULT_BASE_URL_BY_PROVIDER: Record<SupportedProviderId, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  mistral: "https://api.mistral.ai/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

const PROVIDER_ALIASES: Record<string, SupportedProviderId> = {
  openai: "openai",
  openrouter: "openrouter",
  groq: "groq",
  together: "together",
  mistral: "mistral",
  lmstudio: "lmstudio",
  ollama: "ollama",
};

export function normalizeProviderId(value?: string): SupportedProviderId | undefined {
  if (!value) return undefined;
  return PROVIDER_ALIASES[value.trim().toLowerCase()];
}

export function resolveApiKey(explicit: string | undefined, providerId?: SupportedProviderId): string | undefined {
  const configured = explicit?.trim();
  if (configured) {
    return configured;
  }

  switch (providerId) {
    case "openai":
      return process.env.OPENAI_API_KEY?.trim() || undefined;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY?.trim() || undefined;
    case "groq":
      return process.env.GROQ_API_KEY?.trim() || undefined;
    case "together":
      return process.env.TOGETHER_API_KEY?.trim() || undefined;
    case "mistral":
      return process.env.MISTRAL_API_KEY?.trim() || undefined;
    case "ollama":
      return process.env.OLLAMA_API_KEY?.trim() || undefined;
    case "lmstudio":
      return process.env.OPENAI_API_KEY?.trim() || undefined;
    default:
      return undefined;
  }
}

export function firstChoice(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  return asRecord(choices[0]);
}

export function extractContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const record = asRecord(part);
      if (!record) return "";
      if (typeof record.text === "string") return record.text;
      if (record.type === "text" && typeof record.value === "string") return record.value;
      return "";
    })
    .join("");
}

export function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((entry, index) => {
    const record = asRecord(entry) ?? {};
    const fn = asRecord(record.function) ?? {};
    const argumentsPayload = typeof fn.arguments === "string"
      ? safeParseJson(fn.arguments) ?? {}
      : (asRecord(fn.arguments) ?? {});
    return {
      id: typeof record.id === "string" ? record.id : `tool-call-${index + 1}`,
      name: typeof fn.name === "string" ? fn.name : `tool_${index + 1}`,
      arguments: asRecord(argumentsPayload) ?? {},
    };
  });
}

export function parseUsage(usage: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = toInt(usage.prompt_tokens ?? usage.input_tokens) ?? 0;
  const completionTokens = toInt(usage.completion_tokens ?? usage.output_tokens) ?? 0;
  const totalTokens = Math.max(
    toInt(usage.total_tokens) ?? 0,
    promptTokens + completionTokens,
  );
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    tokenAccuracy: "reported",
    usageSource: "ledger",
  };
}

export function normalizeFinishReason(value: unknown): GenerateResult["finishReason"] {
  if (typeof value !== "string") {
    return "other";
  }

  switch (value.trim().toLowerCase()) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "tool-calls":
      return "tool_calls";
    case "content_filter":
    case "content-filter":
      return "content_filter";
    case "error":
      return "error";
    default:
      return "other";
  }
}

export function normalizeToolSchema(input: unknown): Record<string, unknown> {
  const schema = asRecord(input);
  if (!schema) {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  if (schema.type === "object") {
    return schema;
  }
  return {
    ...schema,
    type: "object",
  };
}

export function extractSseData(event: string): string {
  return event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
}

export function safeParseJson(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Detect OpenAI o-series reasoning models that support reasoning_effort.
 * Matches: o1, o1-mini, o1-preview, o3, o3-mini, o4-mini, etc.
 */
export function isOSeriesModel(modelId: string): boolean {
  const lower = modelId.trim().toLowerCase();
  return /^o\d/.test(lower);
}

/**
 * Map gateway effort level to OpenAI reasoning_effort parameter.
 * OpenAI supports "low" | "medium" | "high" — gateway "max" maps to "high".
 */
export function toOpenAIReasoningEffort(effort: TurnReasoningEffort): "low" | "medium" | "high" {
  if (effort === "max") return "high";
  return effort;
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return undefined;
}
