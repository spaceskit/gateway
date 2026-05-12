import type { Logger } from "@spaceskit/observability";
import type { ProviderConfigRepository } from "@spaceskit/persistence";
import type {
  GatewayProviderAuthModePayload,
  ProviderRuntimeConfigPayload,
} from "@spaceskit/server";
import type {
  ProviderSecretRefService,
  ProviderSecretRefSummary,
} from "./services/provider-secret-ref-service.js";
import {
  clearProviderConfigEnvironment,
  providerRuntimeConfigToPayload,
  type GatewayAdminProviderRuntimeConfig,
} from "./gateway-admin-provider-config-support.js";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  isCliExecutorProvider,
  keyFromEnvironment,
  resolveProviderAuthMode,
  resolveRequestedProviderAuthMode,
} from "./services/provider-catalog-support.js";
import {
  normalizeProviderBaseURL,
  normalizeProviderId,
  normalizeProviderModelList,
  withProviderPrefix,
} from "./gateway-admin-model-normalizers.js";

export interface GatewayAdminProviderConfigUpdateInput {
  providerId: string;
  model?: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthModePayload;
  baseURL?: string;
  allowedModels?: string[];
  allowCustomModel?: boolean;
  nativeCliToolsEnabled?: boolean;
}

export interface GatewayAdminPutSecretRefInput {
  secretRef?: string;
  providerId: string;
  label?: string;
  secret: string;
  backend?: string;
}

export interface GatewayAdminPutSecretRefResult {
  secretRef: ProviderSecretRefSummary;
  created: boolean;
}

export interface GatewayAdminProviderSettingsContext {
  logger: Logger;
  providerConfigs: Map<string, GatewayAdminProviderRuntimeConfig>;
  providerConfigRepo?: ProviderConfigRepository;
  providerSecretRefService?: ProviderSecretRefService;
  defaultModelId?: string;
  ensureAppleProviderEnabledSync(operation: string): void;
  assertProviderConfigAllowed(
    providerId: string,
    input: GatewayAdminProviderConfigUpdateInput,
    existing?: GatewayAdminProviderRuntimeConfig,
  ): void;
  mergeAllowedModels(providerId: string, model: string, modelIds: string[]): string[];
  resolveProviderBaseURL(providerId: string, configuredBaseURL?: string): string | undefined;
  applyConfigToEnvironment(config: GatewayAdminProviderRuntimeConfig): void;
  invalidateProviderRuntimeCaches(providerId: string): void;
}

export function getGatewayAdminProviderSettings(
  context: GatewayAdminProviderSettingsContext,
  providerIdRaw: string,
): ProviderRuntimeConfigPayload {
  const providerId = normalizeProviderId(providerIdRaw);
  if (!providerId) {
    throw new Error("providerId is required");
  }
  if (providerId === "apple") {
    context.ensureAppleProviderEnabledSync("getProviderSettings");
  }

  const existing = context.providerConfigs.get(providerId);
  const model = withProviderPrefix(
    providerId,
    existing?.model
      || DEFAULT_MODEL_BY_PROVIDER[providerId]
      || context.defaultModelId
      || `${providerId}/default`,
  );

  const hasApiKey = Boolean(existing?.apiKey || existing?.apiKeySecretRef || keyFromEnvironment(providerId));
  const baseURL = context.resolveProviderBaseURL(providerId, existing?.baseURL);
  const normalizedAllowedModels = normalizeProviderModelList(
    providerId,
    existing?.allowedModels?.length
      ? existing.allowedModels
      : [model],
  );
  const allowedModels = context.mergeAllowedModels(providerId, model, normalizedAllowedModels);
  const allowCustomModel = existing?.allowCustomModel ?? false;
  const nativeCliToolsEnabled = isCliExecutorProvider(providerId)
    ? (existing?.nativeCliToolsEnabled ?? false)
    : false;

  return {
    providerId,
    model,
    baseURL,
    hasApiKey,
    apiKeySecretRef: existing?.apiKeySecretRef,
    authMode: resolveProviderAuthMode(providerId, existing?.authMode),
    allowedModels,
    allowCustomModel,
    nativeCliToolsEnabled,
    updatedAt: existing?.updatedAt ?? new Date().toISOString(),
    source: existing?.source ?? "runtime",
  };
}

export function setGatewayAdminProviderConfig(
  context: GatewayAdminProviderSettingsContext,
  input: GatewayAdminProviderConfigUpdateInput,
): ProviderRuntimeConfigPayload {
  const providerId = normalizeProviderId(input.providerId);
  if (!providerId) {
    throw new Error("providerId is required");
  }
  if (providerId === "apple") {
    context.ensureAppleProviderEnabledSync("setProviderConfig");
  }

  const existing = context.providerConfigs.get(providerId);
  context.assertProviderConfigAllowed(providerId, input, existing);
  const rawModel = input.model?.trim()
    || existing?.model
    || DEFAULT_MODEL_BY_PROVIDER[providerId]
    || context.defaultModelId
    || "";

  if (!rawModel) {
    throw new Error("model is required");
  }
  const model = withProviderPrefix(providerId, rawModel);

  const requestedApiKey = input.apiKey?.trim();
  const requestedSecretRef = input.apiKeySecretRef?.trim();
  const implicitAuthMode = (!input.authMode && !existing?.authMode && (requestedApiKey || requestedSecretRef))
    ? "api_key"
    : existing?.authMode;
  const authMode = resolveRequestedProviderAuthMode(providerId, input.authMode, implicitAuthMode);
  if (requestedSecretRef) {
    if (!context.providerSecretRefService) {
      throw new Error("Provider secret ref service unavailable");
    }
    const summary = context.providerSecretRefService.getSecretRef(requestedSecretRef);
    if (!summary) {
      throw new Error(`Unknown provider secret ref: ${requestedSecretRef}`);
    }
    if (summary.providerId !== providerId) {
      throw new Error(
        `Secret ref provider mismatch: expected ${providerId}, got ${summary.providerId}`,
      );
    }
  }

  const allowCustomModel = input.allowCustomModel ?? existing?.allowCustomModel ?? false;
  const nativeCliToolsEnabled = isCliExecutorProvider(providerId)
    ? (input.nativeCliToolsEnabled ?? existing?.nativeCliToolsEnabled ?? false)
    : false;
  const normalizedAllowedModels = normalizeProviderModelList(
    providerId,
    input.allowedModels
      ?? existing?.allowedModels
      ?? [model],
  );
  const allowedModels = context.mergeAllowedModels(providerId, model, normalizedAllowedModels);
  const inputHasBaseURL = Object.prototype.hasOwnProperty.call(input, "baseURL");
  const normalizedInputBaseURL = normalizeProviderBaseURL(providerId, input.baseURL);

  const config: GatewayAdminProviderRuntimeConfig = {
    providerId,
    model,
    apiKey: authMode === "api_key"
      ? (requestedApiKey || (requestedSecretRef ? undefined : existing?.apiKey))
      : undefined,
    apiKeySecretRef: requestedSecretRef || (requestedApiKey ? undefined : existing?.apiKeySecretRef),
    authMode,
    baseURL: inputHasBaseURL ? normalizedInputBaseURL : existing?.baseURL,
    allowedModels,
    allowCustomModel,
    nativeCliToolsEnabled,
    updatedAt: new Date().toISOString(),
    source: "runtime",
  };

  context.providerConfigs.set(providerId, config);
  context.applyConfigToEnvironment(config);
  context.invalidateProviderRuntimeCaches(providerId);

  context.providerConfigRepo?.upsert({
    providerId: config.providerId,
    model: config.model,
    baseUrl: config.baseURL,
    allowedModelsJson: JSON.stringify(config.allowedModels),
    allowCustomModel: config.allowCustomModel,
    nativeCliToolsEnabled: config.nativeCliToolsEnabled,
    apiKeySecretRef: config.apiKeySecretRef,
    authMode: config.authMode,
    source: config.source,
  });

  context.logger.info("Gateway provider config updated", {
    providerId,
    model,
    hasApiKey: Boolean(config.apiKey || config.apiKeySecretRef),
    apiKeySecretRef: config.apiKeySecretRef ?? "",
    hasBaseURL: Boolean(config.baseURL),
  });

  return providerRuntimeConfigToPayload(
    config,
    Boolean(config.apiKey || config.apiKeySecretRef),
  );
}

export function putGatewayAdminSecretRef(
  context: GatewayAdminProviderSettingsContext,
  input: GatewayAdminPutSecretRefInput,
): GatewayAdminPutSecretRefResult {
  if (!context.providerSecretRefService) {
    throw new Error("Provider secret ref service unavailable");
  }
  return context.providerSecretRefService.putSecretRef(input);
}

export function listGatewayAdminSecretRefs(
  context: GatewayAdminProviderSettingsContext,
  providerId?: string,
): ProviderSecretRefSummary[] {
  if (!context.providerSecretRefService) {
    return [];
  }
  return context.providerSecretRefService.listSecretRefs(providerId);
}

export function deleteGatewayAdminSecretRef(
  context: GatewayAdminProviderSettingsContext,
  secretRef: string,
): boolean {
  if (!context.providerSecretRefService) {
    throw new Error("Provider secret ref service unavailable");
  }
  const deleted = context.providerSecretRefService.deleteSecretRef(secretRef);

  for (const [providerId, config] of context.providerConfigs.entries()) {
    if (config.apiKeySecretRef !== secretRef) continue;
    context.providerConfigs.set(providerId, {
      ...config,
      apiKeySecretRef: undefined,
      updatedAt: new Date().toISOString(),
    });
    context.invalidateProviderRuntimeCaches(providerId);
  }

  return deleted;
}

export function removeGatewayAdminProviderConfig(
  context: GatewayAdminProviderSettingsContext,
  providerIdRaw: string,
): void {
  const providerId = normalizeProviderId(providerIdRaw);
  if (!providerId) {
    throw new Error("providerId is required");
  }

  const existing = context.providerConfigs.get(providerId);
  context.providerConfigs.delete(providerId);
  context.providerConfigRepo?.remove(providerId);
  context.invalidateProviderRuntimeCaches(providerId);

  clearProviderConfigEnvironment(providerId);

  context.logger.info("Gateway provider config removed", {
    providerId,
    hadConfig: Boolean(existing),
  });
}
