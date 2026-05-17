import type { OpenAICompatibleDetectionResult } from "./services/local-agent-discovery-service.js";
import {
  deriveProviderFromModel,
  normalizeProviderId,
  resolveOpenAICompatibleModelsEndpoint,
  uniqueModelIds,
  withProviderPrefix,
} from "./gateway-admin-model-normalizers.js";

interface ManagedAgentProviderConfig {
  providerId: string;
  model: string;
  allowedModels: string[];
  allowCustomModel: boolean;
}

interface ManagedAgentProviderRuntimeConfigIndex {
  get(providerId: string): { baseURL?: string } | undefined;
}

export interface ProviderRuntimeValidationResult {
  valid: boolean;
  reason?: string;
  fallbackModelId?: string;
}

export interface ResolvedProviderModelId {
  valid: boolean;
  providerHint?: string;
  modelId?: string;
  fallbackApplied: boolean;
  fallbackReason?: string;
  reason?: string;
}

export interface PinnedProviderModelValidation {
  valid: boolean;
  providerHint?: string;
  modelId?: string;
  reason?: string;
}

export interface GatewayAdminManagedAgentProviderModelContext {
  providerConfigs: ManagedAgentProviderRuntimeConfigIndex;
  defaultProviderId?: string;
  defaultModelId?: string;
  listProviderConfigs: () => ManagedAgentProviderConfig[];
  mergeAllowedModels: (providerId: string, model: string, modelIds: string[]) => string[];
  ensureAppleFoundationAvailability: () => Promise<unknown>;
  appleProviderRuntimeEligibleSync: () => { eligible: boolean; reason: string };
  resolveProviderBaseURL: (providerId: string, configuredBaseURL?: string) => string | undefined;
  detectOpenAICompatibleModels: (
    baseURLRaw?: string,
    options?: { forceRefresh?: boolean },
  ) => Promise<OpenAICompatibleDetectionResult>;
}

export function resolveManagedAgentFallbackProviderModel(
  context: GatewayAdminManagedAgentProviderModelContext,
): { providerHint: string; modelId: string } | null {
  const providerConfigs = context.listProviderConfigs();
  if (providerConfigs.length > 0) {
    // Prefer non-Apple provider as fallback; Apple is always-available on macOS
    // but should not shadow user-configured or detected CLI providers.
    const fallback = providerConfigs.find((c) => c.providerId !== "apple")
      ?? providerConfigs[0];
    return {
      providerHint: fallback.providerId,
      modelId: fallback.model,
    };
  }

  const defaultProvider = normalizeProviderId(context.defaultProviderId)
    || deriveProviderFromModel(context.defaultModelId);
  const defaultModelRaw = context.defaultModelId?.trim();
  if (defaultProvider && defaultModelRaw) {
    return {
      providerHint: defaultProvider,
      modelId: withProviderPrefix(defaultProvider, defaultModelRaw),
    };
  }

  return null;
}

export async function resolveManagedAgentValidatedProviderModel(
  context: GatewayAdminManagedAgentProviderModelContext,
  input: {
    providerHintRaw?: string;
    modelIdRaw?: string;
    repairIfInvalid: boolean;
    allowFallbackRepair?: boolean;
  },
): Promise<ResolvedProviderModelId> {
  const allowFallbackRepair = input.allowFallbackRepair ?? true;
  let fallbackApplied = false;
  let fallbackReason: string | undefined;

  let pinned = validateManagedAgentPinnedProviderModel(
    context,
    input.providerHintRaw,
    input.modelIdRaw,
  );
  if (!pinned.valid) {
    if (!input.repairIfInvalid || !allowFallbackRepair) {
      return {
        valid: false,
        fallbackApplied: false,
        reason: pinned.reason || "Runtime/model selection is invalid",
      };
    }

    const fallback = resolveManagedAgentFallbackProviderModel(context);
    if (!fallback) {
      return {
        valid: false,
        fallbackApplied: false,
        reason: "Unable to repair runtime/model selection: no runtimes configured",
      };
    }

    fallbackApplied = true;
    fallbackReason = pinned.reason ?? "Configured runtime/model unavailable";
    pinned = {
      valid: true,
      providerHint: fallback.providerHint,
      modelId: fallback.modelId,
    };
  }

  if (!pinned.valid || !pinned.providerHint || !pinned.modelId) {
    return {
      valid: false,
      fallbackApplied,
      fallbackReason,
      reason: pinned.reason || "Runtime/model selection is invalid",
    };
  }

  const runtimeValidation = await validateManagedAgentProviderRuntimeSelection(
    context,
    pinned.providerHint,
    pinned.modelId,
  );
  if (!runtimeValidation.valid) {
    if (!input.repairIfInvalid || !allowFallbackRepair) {
      return {
        valid: false,
        fallbackApplied,
        fallbackReason,
        reason: runtimeValidation.reason || "Runtime model selection is invalid",
      };
    }

    let fallbackProviderHint: string | undefined;
    let fallbackModelId: string | undefined;
    const runtimeFallbackModel = runtimeValidation.fallbackModelId;
    if (
      runtimeFallbackModel
      && runtimeFallbackModel.trim().length > 0
      && runtimeFallbackModel.trim().toLowerCase() !== pinned.modelId.trim().toLowerCase()
    ) {
      fallbackProviderHint = pinned.providerHint;
      fallbackModelId = runtimeFallbackModel.trim();
    } else {
      const fallback = resolveManagedAgentFallbackProviderModel(context);
      if (fallback) {
        const sameProvider = fallback.providerHint === pinned.providerHint;
        const sameModel = fallback.modelId.trim().toLowerCase() === pinned.modelId.trim().toLowerCase();
        if (!(sameProvider && sameModel)) {
          fallbackProviderHint = fallback.providerHint;
          fallbackModelId = fallback.modelId;
        }
      }
    }

    if (!fallbackProviderHint || !fallbackModelId) {
      return {
        valid: false,
        fallbackApplied,
        fallbackReason,
        reason: runtimeValidation.reason || "Unable to repair runtime model selection",
      };
    }

    const fallbackPinned = validateManagedAgentPinnedProviderModel(
      context,
      fallbackProviderHint,
      fallbackModelId,
    );
    if (!fallbackPinned.valid || !fallbackPinned.providerHint || !fallbackPinned.modelId) {
      return {
        valid: false,
        fallbackApplied,
        fallbackReason,
        reason: fallbackPinned.reason
          || runtimeValidation.reason
          || "Fallback runtime/model selection is invalid",
      };
    }

    const fallbackRuntimeValidation = await validateManagedAgentProviderRuntimeSelection(
      context,
      fallbackPinned.providerHint,
      fallbackPinned.modelId,
    );
    if (!fallbackRuntimeValidation.valid) {
      return {
        valid: false,
        fallbackApplied,
        fallbackReason,
        reason: fallbackRuntimeValidation.reason
          || runtimeValidation.reason
          || "Fallback runtime model selection is invalid",
      };
    }

    fallbackApplied = true;
    fallbackReason = runtimeValidation.reason ?? "Configured runtime model unavailable";
    pinned = fallbackPinned;
  }

  return {
    valid: true,
    providerHint: pinned.providerHint,
    modelId: pinned.modelId,
    fallbackApplied,
    fallbackReason,
  };
}

export function validateManagedAgentPinnedProviderModel(
  context: GatewayAdminManagedAgentProviderModelContext,
  providerHintRaw?: string,
  modelIdRaw?: string,
): PinnedProviderModelValidation {
  const providerHint = deriveProviderFromModel(modelIdRaw) || normalizeProviderId(providerHintRaw);
  if (!providerHint) {
    return {
      valid: false,
      reason: "Main profile is missing runtime/model hints.",
    };
  }

  const providerConfig = context.listProviderConfigs()
    .find((entry) => entry.providerId.trim().toLowerCase() === providerHint);
  if (!providerConfig) {
    return {
      valid: false,
      reason: `Configured provider is unavailable: ${providerHint}`,
    };
  }

  const modelId = withProviderPrefix(
    providerHint,
    modelIdRaw?.trim() || providerConfig.model,
  );
  const allowedModels = context.mergeAllowedModels(
    providerHint,
    providerConfig.model,
    providerConfig.allowedModels,
  );
  if (!providerConfig.allowCustomModel && !allowedModels.includes(modelId)) {
    return {
      valid: false,
      reason: `Configured model is unavailable for provider ${providerHint}: ${modelId}`,
    };
  }

  return {
    valid: true,
    providerHint,
    modelId,
  };
}

export async function validateManagedAgentProviderRuntimeSelection(
  context: GatewayAdminManagedAgentProviderModelContext,
  providerId: string,
  modelIdRaw: string,
): Promise<ProviderRuntimeValidationResult> {
  if (providerId === "apple") {
    await context.ensureAppleFoundationAvailability();
    const eligibility = context.appleProviderRuntimeEligibleSync();
    if (!eligibility.eligible) {
      return {
        valid: false,
        reason: `Apple Foundation Models runtime is unavailable: ${eligibility.reason}`,
      };
    }
    return { valid: true };
  }

  if (providerId !== "lmstudio") {
    return { valid: true };
  }

  const modelId = withProviderPrefix(providerId, modelIdRaw);
  const baseURL = context.resolveProviderBaseURL(
    providerId,
    context.providerConfigs.get(providerId)?.baseURL,
  );
  const endpoint = resolveOpenAICompatibleModelsEndpoint(baseURL);
  const detection = await context.detectOpenAICompatibleModels(baseURL, {
    forceRefresh: true,
  });
  if (!detection.serviceReachable) {
    return {
      valid: false,
      reason: detection.detectionError
        || `LM Studio runtime is unreachable at ${endpoint}. Start LM Studio server and retry.`,
    };
  }

  const detectedModels = uniqueModelIds(
    detection.models.map((entry) => withProviderPrefix(providerId, entry.id)),
  );
  if (detectedModels.length === 0) {
    return {
      valid: false,
      reason: `LM Studio runtime is reachable at ${endpoint} but returned no models. Load a model in LM Studio and retry.`,
    };
  }

  const normalizedModelId = modelId.toLowerCase();
  if (detectedModels.some((candidate) => candidate.toLowerCase() === normalizedModelId)) {
    return { valid: true };
  }

  const preview = detectedModels.slice(0, 3);
  const overflowCount = detectedModels.length - preview.length;
  const overflowSuffix = overflowCount > 0 ? ` (+${overflowCount} more)` : "";

  return {
    valid: false,
    reason: `Model ${modelId} is not loaded in LM Studio runtime. Available models: ${preview.join(", ")}${overflowSuffix}. Load the model in LM Studio or select an available model.`,
    fallbackModelId: detectedModels[0],
  };
}
