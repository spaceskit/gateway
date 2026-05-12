import type { Logger } from "@spaceskit/observability";
import type { ProviderConfigRepository } from "@spaceskit/persistence";
import {
  API_KEY_ENV_BY_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  keyFromEnvironment,
  LOCAL_PROVIDER_MODEL_MANIFEST,
  OPENAI_BASE_URL_ENV,
  resolveProviderAuthMode,
} from "./services/provider-catalog-support.js";
import {
  normalizeProviderModelList,
  withProviderPrefix,
} from "./gateway-admin-model-normalizers.js";
import {
  type GatewayAdminProviderRuntimeConfig,
  rowToProviderConfig,
} from "./gateway-admin-provider-config-support.js";

export interface GatewayAdminProviderEnvSeederOptions {
  logger: Pick<Logger, "warn">;
  providerConfigRepo?: ProviderConfigRepository;
  providerConfigs: Map<string, GatewayAdminProviderRuntimeConfig>;
  defaultProviderId?: string;
  defaultModelId?: string;
  defaultApiKey?: string;
  isProviderConfigAllowed: (providerId: string) => boolean;
  providerVisibleInCatalog: (providerId: string) => boolean;
  resolveProviderBaseURL: (providerId: string, configuredBaseURL?: string) => string | undefined;
  findExecutable: (commands: string[]) => string | null;
}

export function seedGatewayAdminProvidersFromEnvironment(
  options: GatewayAdminProviderEnvSeederOptions,
): void {
  const now = new Date().toISOString();

  // Load persisted configs first. Env and runtime configs can still overwrite these defaults.
  if (options.providerConfigRepo) {
    for (const row of options.providerConfigRepo.list()) {
      if (options.providerConfigs.has(row.provider_id)) continue;
      if (!options.isProviderConfigAllowed(row.provider_id)) continue;
      const rowConfig = rowToProviderConfig(row);
      options.providerConfigs.set(row.provider_id, {
        ...rowConfig,
        baseURL: options.resolveProviderBaseURL(rowConfig.providerId, rowConfig.baseURL),
      });
    }
  }

  if (options.defaultProviderId && options.defaultModelId) {
    if (!options.isProviderConfigAllowed(options.defaultProviderId)) {
      options.logger.warn("Skipping blocked embedded default provider from environment", {
        providerId: options.defaultProviderId,
      });
    } else {
      const normalizedDefaultModel = withProviderPrefix(options.defaultProviderId, options.defaultModelId);
      options.providerConfigs.set(options.defaultProviderId, {
        providerId: options.defaultProviderId,
        model: normalizedDefaultModel,
        apiKey: options.defaultApiKey || keyFromEnvironment(options.defaultProviderId),
        apiKeySecretRef: undefined,
        authMode: resolveProviderAuthMode(options.defaultProviderId),
        baseURL: options.resolveProviderBaseURL(
          options.defaultProviderId,
          options.defaultProviderId === "openai" ? process.env[OPENAI_BASE_URL_ENV] : undefined,
        ),
        allowedModels: [normalizedDefaultModel],
        allowCustomModel: false,
        nativeCliToolsEnabled: false,
        updatedAt: now,
        source: "env",
      });
    }
  }

  for (const providerId of Object.keys(API_KEY_ENV_BY_PROVIDER)) {
    const apiKey = keyFromEnvironment(providerId);
    const existing = options.providerConfigs.get(providerId);
    if (!apiKey && !existing) continue;
    const preferredAuthMode = existing?.authMode ?? (apiKey ? "api_key" : undefined);
    const resolvedAuthMode = resolveProviderAuthMode(providerId, preferredAuthMode);

    options.providerConfigs.set(providerId, {
      providerId,
      model: withProviderPrefix(
        providerId,
        existing?.model || DEFAULT_MODEL_BY_PROVIDER[providerId] || options.defaultModelId || "",
      ),
      apiKey: resolvedAuthMode === "api_key"
        ? (apiKey || existing?.apiKey)
        : undefined,
      apiKeySecretRef: existing?.apiKeySecretRef,
      authMode: resolvedAuthMode,
      baseURL: options.resolveProviderBaseURL(
        providerId,
        providerId === "openai" ? (process.env[OPENAI_BASE_URL_ENV] || existing?.baseURL) : existing?.baseURL,
      ),
      allowedModels: normalizeProviderModelList(
        providerId,
        existing?.allowedModels?.length
          ? existing.allowedModels
          : [existing?.model || DEFAULT_MODEL_BY_PROVIDER[providerId] || options.defaultModelId || ""],
      ),
      allowCustomModel: existing?.allowCustomModel ?? false,
      nativeCliToolsEnabled: existing?.nativeCliToolsEnabled ?? false,
      updatedAt: now,
      source: "env",
    });
  }

  if (options.providerVisibleInCatalog("apple")) {
    const existing = options.providerConfigs.get("apple");
    const model = withProviderPrefix(
      "apple",
      existing?.model || DEFAULT_MODEL_BY_PROVIDER.apple,
    );
    options.providerConfigs.set("apple", {
      providerId: "apple",
      model,
      apiKey: undefined,
      apiKeySecretRef: undefined,
      authMode: undefined,
      baseURL: undefined,
      allowedModels: normalizeProviderModelList(
        "apple",
        existing?.allowedModels?.length ? existing.allowedModels : [model],
      ),
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      updatedAt: now,
      source: existing?.source ?? "env",
    });
  }

  seedCliExecutorProviders(options, now);
  seedCodexAppServerProvider(options, now);
}

function seedCliExecutorProviders(
  options: GatewayAdminProviderEnvSeederOptions,
  now: string,
): void {
  for (const providerId of ["claude", "codex", "gemini"] as const) {
    if (options.providerConfigs.has(providerId)) continue;
    if (!options.providerVisibleInCatalog(providerId)) continue;
    if (!options.findExecutable([providerId])) continue;
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[providerId];
    if (!defaultModel) continue;
    const model = withProviderPrefix(providerId, defaultModel);
    const manifest = LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? [];
    options.providerConfigs.set(providerId, {
      providerId,
      model,
      apiKey: undefined,
      apiKeySecretRef: undefined,
      authMode: undefined,
      baseURL: undefined,
      allowedModels: normalizeProviderModelList(providerId, manifest.length > 0 ? manifest : [model]),
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      updatedAt: now,
      source: "env",
    });
  }
}

function seedCodexAppServerProvider(
  options: GatewayAdminProviderEnvSeederOptions,
  now: string,
): void {
  if (
    options.providerConfigs.has("codex-app-server")
    || !options.providerVisibleInCatalog("codex-app-server")
  ) {
    return;
  }

  const executablePath = options.findExecutable(["codex"]);
  const defaultModel = DEFAULT_MODEL_BY_PROVIDER["codex-app-server"];
  if (!executablePath || !defaultModel) return;

  const model = withProviderPrefix("codex-app-server", defaultModel);
  const manifest = LOCAL_PROVIDER_MODEL_MANIFEST["codex-app-server"] ?? [];
  options.providerConfigs.set("codex-app-server", {
    providerId: "codex-app-server",
    model,
    apiKey: undefined,
    apiKeySecretRef: undefined,
    authMode: "host_login",
    baseURL: undefined,
    allowedModels: normalizeProviderModelList(
      "codex-app-server",
      manifest.length > 0 ? manifest : [model],
    ),
    allowCustomModel: false,
    nativeCliToolsEnabled: false,
    updatedAt: now,
    source: "env",
  });
}
