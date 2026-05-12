import { inferContextWindow } from "@spaceskit/core";
import {
  classifyTier,
  type GatewayModelCatalogEntryPayload,
  type GatewayModelCatalogSourcePayload,
  type GatewayModelDetectionStatusPayload,
  type GatewayModelProviderCatalogPayload,
  type GatewayProviderAuthAccountPayload,
  type GatewayIntegrationStatusPayload,
  type GatewayProviderAuthModePayload,
} from "@spaceskit/server";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  inferDefaultProviderAuthStatus,
  isCliExecutorProvider,
  isOpenAICompatibleProvider,
  keyFromEnvironment,
  LOCAL_PROVIDER_MODEL_MANIFEST,
  providerDisplayName,
  providerInstallHint,
  providerRecommended,
  providerRequiresApiKey,
  providerSupportedAuthModes,
  resolveProviderAuthMode,
} from "./services/provider-catalog-support.js";
import {
  providerCatalogGroup,
  providerIntegrationClass,
  withProviderPrefix,
} from "./gateway-admin-model-normalizers.js";
import type {
  DiscoveredLocalAgent,
  OpenAICompatibleDetectionResult,
} from "./services/local-agent-discovery-service.js";
import type {
  ClaudeAgentSdkCatalogProbe,
  CodexAppServerCatalogProbe,
} from "./gateway-admin-telemetry-normalizers.js";

interface CatalogProviderConfig {
  model: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthModePayload;
  baseURL?: string;
  allowedModels?: string[];
}

export interface GatewayProviderCatalogBuilderInput {
  providerIds: string[];
  providerConfigs: ReadonlyMap<string, CatalogProviderConfig>;
  localAgentsByProvider: ReadonlyMap<string, DiscoveredLocalAgent>;
  openAIDetections: ReadonlyMap<string, OpenAICompatibleDetectionResult>;
  claudeAgentSdkDetections: ReadonlyMap<string, ClaudeAgentSdkCatalogProbe>;
  codexAppServerDetections: ReadonlyMap<string, CodexAppServerCatalogProbe>;
  providerPolicyRestrictionReason: (providerId: string) => string | undefined;
  isProviderConfigAllowed: (providerId: string) => boolean;
  resolveProviderBaseURL: (providerId: string, configuredBaseURL?: string) => string | undefined;
  appleProviderRuntimeEligibleSync: () => { eligible: boolean; reason: string };
}

export function buildGatewayProviderCatalogs(
  input: GatewayProviderCatalogBuilderInput,
): GatewayModelProviderCatalogPayload[] {
  return input.providerIds.map((providerId) => buildGatewayProviderCatalog(input, providerId));
}

function buildGatewayProviderCatalog(
  input: GatewayProviderCatalogBuilderInput,
  providerId: string,
): GatewayModelProviderCatalogPayload {
  const config = input.providerConfigs.get(providerId);
  const policyRestrictionReason = input.providerPolicyRestrictionReason(providerId);
  const configAllowed = input.isProviderConfigAllowed(providerId);
  const baseURL = input.resolveProviderBaseURL(providerId, config?.baseURL);
  const hasApiKey = Boolean(config?.apiKey || config?.apiKeySecretRef || keyFromEnvironment(providerId));
  const supportedAuthModes = providerSupportedAuthModes(providerId);
  const authMode = resolveProviderAuthMode(providerId, config?.authMode);
  let authStatus = inferDefaultProviderAuthStatus(providerId, authMode, hasApiKey);
  let authAccount: GatewayProviderAuthAccountPayload | undefined;
  const requiresApiKey = providerRequiresApiKey(providerId, baseURL, authMode);
  const localAgent = input.localAgentsByProvider.get(providerId);
  const localRuntimeDetected = localAgent ? localAgent.detected : true;
  let runtimeAvailable = configAllowed && (requiresApiKey ? hasApiKey : true) && localRuntimeDetected;

  const models: GatewayModelCatalogEntryPayload[] = [];
  const addModel = (
    idRaw: string | undefined,
    source: GatewayModelCatalogSourcePayload,
    available: boolean,
    contextWindow?: number,
  ) => {
    const idTrimmed = idRaw?.trim();
    if (!idTrimmed) return;
    const inferredContextWindow = contextWindow ?? inferContextWindow(providerId, idTrimmed);
    const id = withProviderPrefix(providerId, idTrimmed);
    const existingIndex = models.findIndex((entry) => entry.id === id);
    if (existingIndex >= 0) {
      if (models[existingIndex].contextWindow === undefined && inferredContextWindow !== undefined) {
        models[existingIndex] = {
          ...models[existingIndex],
          contextWindow: inferredContextWindow,
        };
      }
      return;
    }
    const tier = classifyTier(providerId, id, inferredContextWindow);
    models.push({
      id,
      displayName: id.includes("/") ? id.split("/").slice(1).join("/") : id,
      source,
      available,
      tier,
      ...(inferredContextWindow !== undefined ? { contextWindow: inferredContextWindow } : {}),
    });
  };

  let detectionStatus: GatewayModelDetectionStatusPayload = runtimeAvailable ? "available" : "unavailable";
  let detectionError: string | undefined = policyRestrictionReason;
  let integrationStatus: GatewayIntegrationStatusPayload = runtimeAvailable ? "reachable" : "missing";

  if (providerId === "apple" && configAllowed) {
    const eligibility = input.appleProviderRuntimeEligibleSync();
    runtimeAvailable = eligibility.eligible;
    detectionStatus = eligibility.eligible ? "available" : "unavailable";
    if (!eligibility.eligible) {
      detectionError = eligibility.reason;
      integrationStatus = "unsupported";
    }
  }

  if (localAgent && configAllowed) {
    if (!localAgent.detected) {
      detectionStatus = "unavailable";
      detectionError = localAgent.detectionError?.trim() || `${localAgent.name} runtime is not detected on this host.`;
      integrationStatus = "missing";
    } else if (localAgent.detectionError?.trim()) {
      detectionStatus = "error";
      detectionError = localAgent.detectionError.trim();
      integrationStatus = "error";
    } else {
      integrationStatus = "installed";
    }

    for (const modelId of localAgent.availableModels ?? []) {
      addModel(modelId, "detected", localAgent.detected);
    }
    for (const modelId of LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []) {
      addModel(modelId, "fallback", localAgent.detected);
    }
  }

  const openAIDetection = input.openAIDetections.get(providerId);
  if (openAIDetection && configAllowed) {
    if (openAIDetection.models.length > 0) {
      for (const model of openAIDetection.models) {
        addModel(model.id, "detected", runtimeAvailable, model.contextWindow);
      }
      detectionStatus = "available";
      integrationStatus = "reachable";
    } else if (openAIDetection.detectionError) {
      detectionStatus = "error";
      detectionError = openAIDetection.detectionError;
      integrationStatus = "error";
    } else if (openAIDetection.serviceReachable) {
      integrationStatus = "no_models_loaded";
    } else if (!openAIDetection.serviceReachable && !runtimeAvailable) {
      detectionStatus = "unavailable";
      integrationStatus = "missing";
    }
  }

  const claudeAgentSdkDetection = input.claudeAgentSdkDetections.get(providerId);
  if (claudeAgentSdkDetection && configAllowed) {
    authStatus = claudeAgentSdkDetection.authStatus;
    authAccount = claudeAgentSdkDetection.authAccount;
    if (claudeAgentSdkDetection.models.length > 0) {
      for (const model of claudeAgentSdkDetection.models) {
        addModel(model.id, "detected", authStatus === "authenticated", model.contextWindow);
      }
      detectionStatus = "available";
      detectionError = undefined;
    } else if (claudeAgentSdkDetection.detectionError) {
      detectionError = claudeAgentSdkDetection.detectionError;
      detectionStatus = authStatus === "error" ? "error" : models.length > 0 ? "available" : "unavailable";
    }
  }

  const codexAppServerDetection = input.codexAppServerDetections.get(providerId);
  if (codexAppServerDetection && configAllowed) {
    authStatus = codexAppServerDetection.authStatus;
    authAccount = codexAppServerDetection.authAccount;
    if (codexAppServerDetection.models.length > 0) {
      for (const model of codexAppServerDetection.models) {
        addModel(model.id, "detected", authStatus === "authenticated", model.contextWindow);
      }
      detectionStatus = "available";
      detectionError = undefined;
    } else if (codexAppServerDetection.detectionError) {
      detectionError = codexAppServerDetection.detectionError;
      detectionStatus = authStatus === "error" ? "error" : models.length > 0 ? "available" : "unavailable";
    }
  }

  for (const modelId of config?.allowedModels ?? []) {
    addModel(modelId, "allowlist", runtimeAvailable);
  }
  addModel(config?.model, "configured", runtimeAvailable);
  const shouldUseFallbackManifest = (
    providerId !== "claude-agent-sdk"
    && providerId !== "codex-app-server"
  ) || !models.some((entry) => entry.source === "detected");
  if (shouldUseFallbackManifest) {
    for (const modelId of LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? []) {
      addModel(modelId, "fallback", runtimeAvailable);
    }
    addModel(DEFAULT_MODEL_BY_PROVIDER[providerId], "fallback", runtimeAvailable);
  }

  sortCatalogModels(providerId, models);

  if (!configAllowed) {
    integrationStatus = "policy_blocked";
  } else if (authStatus === "needs_auth") {
    integrationStatus = "needs_auth";
  } else if (authStatus === "needs_key") {
    integrationStatus = "needs_key";
  } else if (requiresApiKey && !hasApiKey) {
    integrationStatus = "needs_key";
  } else if (authStatus === "error") {
    integrationStatus = "error";
  } else if (detectionStatus === "error") {
    integrationStatus = "error";
  } else if (models.length === 0 && isOpenAICompatibleProvider(providerId) && runtimeAvailable) {
    integrationStatus = "no_models_loaded";
  }

  return {
    providerId,
    displayName: providerDisplayName(providerId),
    group: providerCatalogGroup(providerId),
    integrationClass: providerIntegrationClass(providerId),
    status: integrationStatus,
    hasApiKey,
    requiresApiKey,
    ...(supportedAuthModes.length > 0 ? { supportedAuthModes } : {}),
    ...(authMode ? { authMode } : {}),
    ...(authStatus ? { authStatus } : {}),
    ...(authAccount ? { authAccount } : {}),
    baseURL,
    detectionStatus,
    ...(detectionError ? { detectionError } : {}),
    models,
    installHint: providerInstallHint(providerId),
    recommended: providerRecommended(providerId),
    supportsHostedBilling: providerIntegrationClass(providerId) === "cloud",
    configAllowed,
  };
}

function sortCatalogModels(providerId: string, models: GatewayModelCatalogEntryPayload[]): void {
  if (
    (!isOpenAICompatibleProvider(providerId) || isCliExecutorProvider(providerId))
    && providerId !== "claude-agent-sdk"
    && providerId !== "codex-app-server"
  ) {
    return;
  }

  models.sort((a, b) => {
    const aPriority = catalogModelSourcePriority(providerId, a.source);
    const bPriority = catalogModelSourcePriority(providerId, b.source);
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aCtx = a.contextWindow ?? 0;
    const bCtx = b.contextWindow ?? 0;
    if (aCtx !== bCtx) return bCtx - aCtx;
    return a.displayName.localeCompare(b.displayName);
  });
}

function catalogModelSourcePriority(providerId: string, source: GatewayModelCatalogSourcePayload): number {
  if (providerId === "claude-agent-sdk" || providerId === "codex-app-server") {
    switch (source) {
      case "detected": return 0;
      case "configured": return 1;
      case "allowlist": return 2;
      case "fallback": return 3;
      default: return 4;
    }
  }

  switch (source) {
    case "configured": return 0;
    case "detected": return 1;
    case "allowlist": return 2;
    case "fallback": return 3;
    default: return 4;
  }
}
