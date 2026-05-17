import type { ProviderConfigRow } from "@spaceskit/persistence";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type {
  GatewayProviderAuthModePayload,
  ProviderRuntimeConfigPayload,
} from "@spaceskit/server";
import {
  API_KEY_ENV_BY_PROVIDER,
  LMSTUDIO_BASE_URL_ENV,
  normalizeProviderAuthMode,
  OLLAMA_BASE_URL_ENV,
  OPENAI_BASE_URL_ENV,
} from "./services/provider-catalog-support.js";
import {
  normalizeProviderBaseURL,
  normalizeProviderModelList,
  uniqueModelIds,
} from "./gateway-admin-model-normalizers.js";

export interface GatewayAdminProviderRuntimeConfig {
  providerId: string;
  model: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthModePayload;
  baseURL?: string;
  allowedModels: string[];
  allowCustomModel: boolean;
  nativeCliToolsEnabled: boolean;
  updatedAt: string;
  source: "env" | "runtime";
}

export function providerRuntimeConfigToPayload(
  config: GatewayAdminProviderRuntimeConfig,
  hasApiKey: boolean,
): ProviderRuntimeConfigPayload {
  return {
    providerId: config.providerId,
    model: config.model,
    baseURL: config.baseURL,
    hasApiKey,
    apiKeySecretRef: config.apiKeySecretRef,
    authMode: config.authMode,
    allowedModels: [...config.allowedModels],
    allowCustomModel: config.allowCustomModel,
    nativeCliToolsEnabled: config.nativeCliToolsEnabled,
    updatedAt: config.updatedAt,
    source: config.source,
  };
}

export function rowToProviderConfig(row: ProviderConfigRow): GatewayAdminProviderRuntimeConfig {
  let allowedModels: string[] = [];
  try {
    const parsed = JSON.parse(row.allowed_models_json);
    if (Array.isArray(parsed)) {
      allowedModels = parsed;
    }
  } catch {
    // ignore malformed JSON
  }
  return {
    providerId: row.provider_id,
    model: row.model,
    apiKeySecretRef: row.api_key_secret_ref ?? undefined,
    authMode: normalizeProviderAuthMode(row.auth_mode),
    baseURL: row.base_url ?? undefined,
    allowedModels,
    allowCustomModel: row.allow_custom_model === 1,
    nativeCliToolsEnabled: row.native_cli_tools_enabled === 1,
    updatedAt: row.updated_at,
    source: row.source === "env" ? "env" : "runtime",
  };
}

export function mergeAllowedProviderModels(input: {
  providerId: string;
  model: string;
  modelIds: string[];
  detectedModelIds: string[];
}): string[] {
  const merged = uniqueModelIds([
    input.model,
    ...input.modelIds,
    ...input.detectedModelIds,
  ]);
  const normalized = normalizeProviderModelList(input.providerId, merged);
  return normalized.length > 0 ? normalized : [input.model];
}

export function applyProviderConfigToEnvironment(config: GatewayAdminProviderRuntimeConfig): void {
  const keyEnv = API_KEY_ENV_BY_PROVIDER[config.providerId];
  if (keyEnv) {
    if (config.apiKey) {
      process.env[keyEnv] = config.apiKey;
    } else {
      delete process.env[keyEnv];
    }
  }

  if (config.providerId === "openai") {
    if (config.baseURL) {
      process.env[OPENAI_BASE_URL_ENV] = config.baseURL;
    } else {
      delete process.env[OPENAI_BASE_URL_ENV];
    }
  }

  if (config.providerId === "lmstudio") {
    if (config.baseURL) {
      process.env[LMSTUDIO_BASE_URL_ENV] = config.baseURL;
    } else {
      delete process.env[LMSTUDIO_BASE_URL_ENV];
    }
  }
}

export function clearProviderConfigEnvironment(providerId: string): void {
  const keyEnv = API_KEY_ENV_BY_PROVIDER[providerId];
  if (keyEnv) {
    delete process.env[keyEnv];
  }
  if (providerId === "openai") {
    delete process.env[OPENAI_BASE_URL_ENV];
  }
  if (providerId === "lmstudio") {
    delete process.env[LMSTUDIO_BASE_URL_ENV];
  }
}

export function resolveProviderBaseURLForGateway(input: {
  providerId: string;
  configuredBaseURL?: string;
  gatewayProfile: GatewayCoreProfileId;
  isProviderConfigAllowed: (providerId: string) => boolean;
}): string | undefined {
  const explicitBaseURL = normalizeProviderBaseURL(input.providerId, input.configuredBaseURL);
  if (explicitBaseURL) {
    if (input.gatewayProfile === "embedded") {
      return undefined;
    }
    return explicitBaseURL;
  }

  if (input.providerId === "openai") {
    if (input.gatewayProfile === "embedded") {
      return undefined;
    }
    return normalizeProviderBaseURL(input.providerId, process.env[OPENAI_BASE_URL_ENV]);
  }

  if (input.providerId === "lmstudio") {
    if (!input.isProviderConfigAllowed(input.providerId)) {
      return undefined;
    }
    const lmstudioFromEnv = normalizeProviderBaseURL(input.providerId, process.env[LMSTUDIO_BASE_URL_ENV]);
    if (lmstudioFromEnv) {
      return lmstudioFromEnv;
    }
    return "http://127.0.0.1:1234/v1";
  }

  if (input.providerId === "ollama") {
    if (!input.isProviderConfigAllowed(input.providerId)) {
      return undefined;
    }
    return normalizeProviderBaseURL(input.providerId, process.env[OLLAMA_BASE_URL_ENV]) || "http://127.0.0.1:11434/v1";
  }

  if (input.providerId === "openrouter") {
    return "https://openrouter.ai/api/v1";
  }

  if (input.providerId === "groq") {
    return "https://api.groq.com/openai/v1";
  }

  if (input.providerId === "together") {
    return "https://api.together.xyz/v1";
  }

  if (input.providerId === "mistral") {
    return "https://api.mistral.ai/v1";
  }

  return undefined;
}
