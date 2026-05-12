import type { ProfileModelConfig } from "@spaceskit/persistence";
import type {
  GatewayCreateIntegrationRequestResponsePayload,
  GatewayIntegrationClassPayload,
  GatewayProviderCatalogGroupPayload,
  GatewayRuntimeDefaultSelectionPayload,
  MainAgentSelectionMode,
} from "@spaceskit/server";
import { classifyExecutionAdapter, mapExecutionClassToCatalogGroup } from "./execution/execution-adapter-factory.js";
import { isObjectRecord } from "./gateway-admin-value-normalizers.js";

export function normalizeRuntimeDefaultSelection(
  providerIdRaw?: string,
  modelIdRaw?: string,
): GatewayRuntimeDefaultSelectionPayload | null {
  const providerId = normalizeProviderId(providerIdRaw);
  const modelId = modelIdRaw?.trim();
  if (!providerId || !modelId) {
    return null;
  }
  return {
    providerId,
    modelId: withProviderPrefix(providerId, modelId),
  };
}

export function runtimeDefaultPriority(providerIdRaw: string): number {
  const providerId = providerIdRaw.trim().toLowerCase();
  switch (providerId) {
    case "codex-app-server":
      return 0;
    case "apple":
      return 1;
    case "openai":
      return 2;
    case "openrouter":
      return 3;
    case "codex":
      return 4;
    case "gemini":
      return 5;
    case "lmstudio":
      return 6;
    case "ollama":
      return 7;
    case "anthropic":
      return 8;
    case "claude-agent-sdk":
      return 9;
    case "claude":
      return 10;
    default:
      return 50;
  }
}

export function normalizeProviderId(providerId?: string): string | undefined {
  if (!providerId) return undefined;
  const normalized = providerId.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized;
}

export function normalizeProviderIds(providerIds?: string[]): string[] {
  if (!providerIds) return [];
  return Array.from(
    new Set(
      providerIds
        .map((providerId) => normalizeProviderId(providerId))
        .filter((providerId): providerId is string => Boolean(providerId)),
    ),
  );
}

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function mergeSkillIds(existing: string[], required: readonly string[]): string[] {
  return Array.from(new Set([...existing, ...required].map((entry) => entry.trim()).filter(Boolean)));
}

export function parseModelConfig(
  value: string | null | undefined,
  modelHint: string | null | undefined,
): ProfileModelConfig {
  if (value?.trim()) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const preferredModels = normalizeStringList(parsed.preferredModels);
      const fallbackModels = normalizeStringList(parsed.fallbackModels);
      const constraints = isObjectRecord(parsed.constraints) ? parsed.constraints : undefined;
      return {
        preferredModels: preferredModels.length > 0
          ? preferredModels
          : (modelHint?.trim() ? [modelHint.trim()] : []),
        fallbackModels,
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

export function normalizeStringList(value: unknown): string[] {
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

export function normalizeIntegrationClass(
  value?: GatewayIntegrationClassPayload,
): "cloud" | "executor" | "local_runtime" | undefined {
  if (value === "cloud" || value === "executor" || value === "local_runtime") {
    return value;
  }
  return undefined;
}

export function mapIntegrationRequestRow(row: {
  integration_request_id: string;
  integration_class: string;
  requested_name: string;
  use_case: string;
  source_url: string;
  notes: string;
  principal_id: string;
  device_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}): GatewayCreateIntegrationRequestResponsePayload["request"] {
  return {
    integrationRequestId: row.integration_request_id,
    integrationClass: (normalizeIntegrationClass(row.integration_class as GatewayIntegrationClassPayload) ?? "cloud"),
    requestedName: row.requested_name,
    useCase: row.use_case || undefined,
    sourceURL: row.source_url || undefined,
    notes: row.notes || undefined,
    principalId: row.principal_id || undefined,
    deviceId: row.device_id || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deriveProviderFromModel(model?: string): string | undefined {
  if (!model) return undefined;
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  const prefix = trimmed.includes("/") ? trimmed.split("/")[0] : "";
  return normalizeProviderId(prefix);
}

export function withProviderPrefix(providerId: string, modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return `${providerId}/`;
  const providerPrefix = `${providerId.toLowerCase()}/`;
  if (trimmed.toLowerCase().startsWith(providerPrefix)) {
    return `${providerId}/${trimmed.slice(providerPrefix.length)}`;
  }
  return `${providerId}/${trimmed}`;
}

export function normalizeProviderBaseURL(providerId: string, baseURLRaw?: string): string | undefined {
  const trimmed = baseURLRaw?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (providerId !== "lmstudio") {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname) {
      parsed.pathname = "/v1";
    } else {
      parsed.pathname = pathname;
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function resolveOpenAICompatibleModelsEndpoint(baseURLRaw?: string): string {
  const baseURL = baseURLRaw?.trim() || "http://127.0.0.1:1234/v1";
  return `${baseURL.replace(/\/+$/, "")}/models`;
}

export function describeOpenAICompatibleDetectionError(error: unknown, endpoint: string): string {
  const fallback = `Failed to discover models from OpenAI-compatible endpoint: ${endpoint}`;
  if (!(error instanceof Error)) {
    return fallback;
  }

  const code = isObjectRecord(error) && typeof error.code === "string" ? error.code : undefined;
  if (code === "ConnectionRefused") {
    return `Connection refused at ${endpoint}. If using LM Studio, run: lms server start --port 1234`;
  }

  const message = error.message?.trim();
  if (message) {
    return `${message} (endpoint: ${endpoint})`;
  }

  return fallback;
}

export function normalizeProviderModelList(providerId: string, modelIds?: string[]): string[] {
  if (!modelIds || modelIds.length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      modelIds
        .map((modelId) => withProviderPrefix(providerId, modelId))
        .map((modelId) => modelId.trim())
        .filter((modelId) => modelId.length > 0),
    ),
  );
}

export function uniqueModelIds(modelIds: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const modelId of modelIds) {
    const normalized = modelId.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function collectProfileModelCandidates(
  modelHint?: string,
  modelConfig?: ProfileModelConfig,
): string[] {
  const candidates = [
    modelHint,
    ...(modelConfig?.preferredModels ?? []),
    ...(modelConfig?.fallbackModels ?? []),
  ];
  return Array.from(
    new Set(
      candidates
        .map((modelId) => modelId?.trim() ?? "")
        .filter((modelId) => modelId.length > 0),
    ),
  );
}

export function normalizeSelectionMode(value: unknown): MainAgentSelectionMode | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (normalized === "provider_model" || normalized === "agent_definition") {
    return normalized;
  }
  return null;
}

export function providerCatalogGroup(providerId: string): GatewayProviderCatalogGroupPayload {
  return mapExecutionClassToCatalogGroup(classifyExecutionAdapter(providerId));
}

export function providerIntegrationClass(providerId: string): GatewayIntegrationClassPayload {
  return classifyExecutionAdapter(providerId);
}

export function throwGatewayError(
  code: "INVALID_ARGUMENT" | "NOT_FOUND" | "ALREADY_EXISTS" | "FAILED_PRECONDITION",
  message: string,
): never {
  throw { code, message };
}

export function isSpaceAdminErrorLike(
  err: unknown,
): err is { code: "INVALID_ARGUMENT" | "NOT_FOUND" | "ALREADY_EXISTS" | "FAILED_PRECONDITION"; message: string } {
  if (typeof err !== "object" || err === null) {
    return false;
  }

  const candidate = err as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string"
    && typeof candidate.message === "string"
  );
}
