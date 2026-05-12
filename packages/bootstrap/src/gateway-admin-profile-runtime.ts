import type { Logger } from "@spaceskit/observability";
import type {
  ProfileModelConfig,
  ProfileRepository,
} from "@spaceskit/persistence";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type {
  GatewayProviderAuthModePayload,
  ProviderRuntimeConfigPayload,
} from "@spaceskit/server";
import type { ProviderSecretRefService } from "./services/provider-secret-ref-service.js";
import type { GatewayAdminProviderRuntimeConfig } from "./gateway-admin-provider-config-support.js";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  isCliExecutorProvider,
  isLikelyLocalBaseURL,
  isLocalProvider,
  keyFromEnvironment,
  resolveProviderAuthMode,
} from "./services/provider-catalog-support.js";
import {
  collectProfileModelCandidates,
  deriveProviderFromModel,
  normalizeProviderId,
  normalizeProviderModelList,
  parseModelConfig,
  parseStringArray,
  throwGatewayError,
  withProviderPrefix,
} from "./gateway-admin-model-normalizers.js";

export interface ExactProviderRuntimeSelection {
  providerId: string;
  model: string;
  apiKey?: string;
  apiKeySecretRef?: string;
  authMode?: GatewayProviderAuthModePayload;
  baseURL?: string;
  isLocal: boolean;
  nativeCliToolsEnabled: boolean;
}

export interface ProvisionLocalProfileInput {
  localClientId: string;
  profileId?: string;
  profileName?: string;
  agentId?: string;
  spaceId?: string;
}

export interface ProvisionLocalProfileResult {
  profileId: string;
  profileName: string;
  created: boolean;
  providerId: string;
  model: string;
  agentId?: string;
  assignmentCreated?: boolean;
}

export interface ProfileRuntimeContext {
  profileId: string;
  systemPrompt: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfig;
}

export interface GatewayAdminLocalClientTemplate {
  id: string;
  name: string;
  recommendedProviderId: string;
  recommendedModel: string;
  defaultProfileName: string;
  defaultPersonalityPrompt: string;
}

export interface GatewayAdminResolvedProviderModelHint {
  valid: boolean;
  providerHint?: string;
  modelHint?: string;
  fallbackApplied: boolean;
  fallbackReason?: string;
  reason?: string;
}

export interface GatewayAdminProfileRuntimeContext {
  logger: Logger;
  profileRepo: ProfileRepository | null;
  gatewayProfile: GatewayCoreProfileId;
  providerConfigs: Map<string, GatewayAdminProviderRuntimeConfig>;
  providerSecretRefService?: ProviderSecretRefService;
  defaultProviderId?: string;
  defaultModelId?: string;
  getLocalClientTemplate(localClientId: string): GatewayAdminLocalClientTemplate | undefined;
  embeddedLocalIntegrationsAllowed(): boolean;
  ensureAgentAssignment(spaceId: string, agentId: string, profileId: string): Promise<boolean>;
  resolveEmbeddedMacDefaultProvider(): string | undefined;
  providerPolicyRestrictionReason(providerId: string): string | undefined;
  resolveFallbackProviderModel(): { providerHint: string; modelHint: string } | null;
  resolveValidatedProviderModel(input: {
    providerHintRaw?: string;
    modelHintRaw?: string;
    repairIfInvalid: boolean;
    allowFallbackRepair?: boolean;
  }): Promise<GatewayAdminResolvedProviderModelHint>;
  ensureAppleProviderRuntimeEligibleSync(operation: string): void;
  ensureAppleProviderEnabledSync(operation: string): void;
  resolveProviderBaseURL(providerId: string, configuredBaseURL?: string): string | undefined;
  resolveConfiguredProviderApiKey(
    providerId: string,
    config?: GatewayAdminProviderRuntimeConfig,
  ): string | undefined;
  getProviderSettings(providerId: string): ProviderRuntimeConfigPayload;
}

export async function provisionGatewayAdminLocalProfile(
  context: GatewayAdminProfileRuntimeContext,
  input: ProvisionLocalProfileInput,
): Promise<ProvisionLocalProfileResult> {
  const template = context.getLocalClientTemplate(input.localClientId);

  if (context.gatewayProfile === "embedded" && !context.embeddedLocalIntegrationsAllowed()) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      "Local profile provisioning requires embedded macOS on Apple Silicon or an external gateway profile.",
    );
  }
  if (!template) {
    throw new Error(`Unsupported localClientId: ${input.localClientId}`);
  }

  if (!context.profileRepo) {
    throw new Error("Profile repository unavailable");
  }

  const profileId = (input.profileId?.trim() || `local-${template.id}-profile`);
  const profileName = input.profileName?.trim() || template.defaultProfileName;

  const providerConfig = context.providerConfigs.get(template.recommendedProviderId);
  const providerId = providerConfig?.providerId ?? template.recommendedProviderId;
  const model = providerConfig?.model ?? template.recommendedModel;

  const existing = context.profileRepo.getById(profileId);
  let created = false;
  if (!existing) {
    context.profileRepo.create({
      profileId,
      name: profileName,
      description: `Auto-provisioned profile for ${template.name}.`,
      canModerate: false,
      personalityPrompt: template.defaultPersonalityPrompt,
      providerHint: providerId,
      modelHint: model,
    });
    created = true;
  }

  let assignmentCreated: boolean | undefined;
  const agentId = input.agentId?.trim();
  const spaceId = input.spaceId?.trim();
  if (agentId && spaceId) {
    assignmentCreated = await context.ensureAgentAssignment(spaceId, agentId, profileId);
  }

  context.logger.info("Local profile provisioned", {
    localClientId: template.id,
    profileId,
    created,
    providerId,
    model,
    agentId: agentId ?? "",
    spaceId: spaceId ?? "",
    assignmentCreated: assignmentCreated ?? false,
  });

  return {
    profileId,
    profileName,
    created,
    providerId,
    model,
    agentId: agentId || undefined,
    assignmentCreated,
  };
}

export function loadGatewayAdminProfileRuntime(
  context: GatewayAdminProfileRuntimeContext,
  profileIdRaw?: string,
): ProfileRuntimeContext | null {
  if (!context.profileRepo || !profileIdRaw?.trim()) {
    return null;
  }

  const profileId = profileIdRaw.trim();
  const row = context.profileRepo.getById(profileId);
  if (!row || row.archived === 1) {
    return null;
  }

  const revision = context.profileRepo.getActiveRevision(profileId);
  const modelConfig = parseModelConfig(revision?.model_config_json, revision?.model_hint);
  const preferredModelHint = modelConfig.preferredModels[0] || revision?.model_hint?.trim() || undefined;
  return {
    profileId,
    systemPrompt: revision?.personality_prompt?.trim() || "",
    defaultSkillIds: parseStringArray(revision?.default_skill_set_ids_json),
    providerHint: revision?.provider_hint?.trim() || undefined,
    modelHint: preferredModelHint,
    modelConfig,
  };
}

export async function resolveGatewayAdminProviderForProfile(
  context: GatewayAdminProfileRuntimeContext,
  providerHintRaw?: string,
  modelHint?: string,
): Promise<ExactProviderRuntimeSelection> {
  const providerHint = normalizeProviderId(providerHintRaw);
  const providerFromModel = deriveProviderFromModel(modelHint);
  if (providerHint && providerFromModel && providerHint !== providerFromModel) {
    context.logger.warn("Profile provider hint mismatches model hint prefix; preferring model hint provider", {
      providerHint,
      modelHint,
      selectedProvider: providerFromModel,
    });
  }
  let selectedProvider = providerFromModel
    || providerHint
    || context.defaultProviderId
    || deriveProviderFromModel(context.defaultModelId)
    || context.resolveEmbeddedMacDefaultProvider()
    || "openrouter";
  let enforcedModelHint = modelHint?.trim() || undefined;
  const explicitSelection = Boolean(providerFromModel || providerHint);
  const policyRestrictionReason = context.providerPolicyRestrictionReason(selectedProvider);
  if (policyRestrictionReason) {
    const fallback = context.resolveFallbackProviderModel();
    if (!fallback) {
      throwGatewayError("FAILED_PRECONDITION", policyRestrictionReason);
    }
    context.logger.warn("Profile runtime blocked by embedded policy; using fallback runtime/model", {
      requestedProvider: selectedProvider,
      fallbackProvider: fallback.providerHint,
      fallbackModel: fallback.modelHint,
    });
    selectedProvider = fallback.providerHint;
    enforcedModelHint = fallback.modelHint;
  }

  const configuredSelection = context.providerConfigs.get(selectedProvider);
  if (explicitSelection || configuredSelection) {
    const resolvedModel = await context.resolveValidatedProviderModel({
      providerHintRaw: selectedProvider,
      modelHintRaw: enforcedModelHint || configuredSelection?.model,
      repairIfInvalid: true,
      allowFallbackRepair: selectedProvider !== "apple",
    });
    if (!resolvedModel.valid || !resolvedModel.providerHint || !resolvedModel.modelHint) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        resolvedModel.reason || "Runtime/model selection is invalid",
      );
    }
    if (resolvedModel.fallbackApplied) {
      context.logger.warn("Profile runtime unavailable; using fallback runtime/model", {
        requestedProvider: selectedProvider,
        requestedModel: enforcedModelHint || configuredSelection?.model || "",
        fallbackProvider: resolvedModel.providerHint,
        fallbackModel: resolvedModel.modelHint,
        reason: resolvedModel.fallbackReason,
      });
    }
    selectedProvider = resolvedModel.providerHint;
    enforcedModelHint = resolvedModel.modelHint;
  }

  if (selectedProvider === "apple") {
    context.ensureAppleProviderRuntimeEligibleSync("resolveProviderForProfile");
  }

  const config = context.providerConfigs.get(selectedProvider);
  const modelRaw = enforcedModelHint
    || config?.model
    || DEFAULT_MODEL_BY_PROVIDER[selectedProvider]
    || context.defaultModelId
    || "";

  if (!modelRaw) {
    throw new Error(`No model configured for provider ${selectedProvider}`);
  }
  const model = withProviderPrefix(selectedProvider, modelRaw);

  const baseURL = context.resolveProviderBaseURL(selectedProvider, config?.baseURL);
  const apiKeySecretRef = config?.apiKeySecretRef;
  const authMode = resolveProviderAuthMode(selectedProvider, config?.authMode);
  let apiKey = authMode === "api_key"
    ? (config?.apiKey || keyFromEnvironment(selectedProvider))
    : undefined;
  if (!apiKey && apiKeySecretRef && authMode === "api_key") {
    if (!context.providerSecretRefService) {
      throw new Error(`Provider secret ref service unavailable for ref: ${apiKeySecretRef}`);
    }
    const resolved = context.providerSecretRefService.resolveSecret(apiKeySecretRef);
    if (!resolved) {
      throw new Error(`Provider secret ref not found: ${apiKeySecretRef}`);
    }
    apiKey = resolved.secret;
  }

  return {
    providerId: selectedProvider,
    model,
    apiKey,
    apiKeySecretRef,
    authMode,
    baseURL,
    isLocal: isLocalProvider(selectedProvider)
      || (selectedProvider === "openai" && isLikelyLocalBaseURL(baseURL)),
    nativeCliToolsEnabled: config?.nativeCliToolsEnabled ?? false,
  };
}

export function resolveGatewayAdminExactProviderRuntimeConfig(
  context: GatewayAdminProfileRuntimeContext,
  input: {
    providerId: string;
    model?: string;
  },
): ExactProviderRuntimeSelection {
  const providerId = normalizeProviderId(input.providerId);
  if (!providerId) {
    throw new Error("providerId is required");
  }
  if (providerId === "apple") {
    context.ensureAppleProviderEnabledSync("resolveExactProviderRuntimeConfig");
  }

  const requestedModel = input.model?.trim();
  const requestedProviderFromModel = deriveProviderFromModel(requestedModel);
  if (requestedProviderFromModel && requestedProviderFromModel !== providerId) {
    throw new Error(
      `Model ${requestedModel} belongs to provider ${requestedProviderFromModel} but providerId is ${providerId}.`,
    );
  }

  const config = context.providerConfigs.get(providerId);
  const modelRaw = requestedModel
    || config?.model
    || DEFAULT_MODEL_BY_PROVIDER[providerId]
    || `${providerId}/default`;
  const model = withProviderPrefix(providerId, modelRaw);
  const authMode = resolveProviderAuthMode(providerId, config?.authMode);
  const baseURL = context.resolveProviderBaseURL(providerId, config?.baseURL);

  return {
    providerId,
    model,
    apiKey: authMode === "api_key"
      ? context.resolveConfiguredProviderApiKey(providerId, config)
      : undefined,
    apiKeySecretRef: config?.apiKeySecretRef,
    authMode,
    baseURL,
    isLocal: isLocalProvider(providerId)
      || (providerId === "openai" && isLikelyLocalBaseURL(baseURL)),
    nativeCliToolsEnabled: isCliExecutorProvider(providerId)
      ? (config?.nativeCliToolsEnabled ?? false)
      : false,
  };
}

export function validateGatewayAdminProfileModelSelection(
  context: GatewayAdminProfileRuntimeContext,
  input: {
    providerHint?: string;
    modelHint?: string;
    modelConfig?: ProfileModelConfig;
  },
): void {
  const providerHint = normalizeProviderId(input.providerHint);
  const candidateModels = collectProfileModelCandidates(input.modelHint, input.modelConfig);
  if (candidateModels.length === 0) {
    return;
  }

  for (const candidateModel of candidateModels) {
    const candidateProviderFromModel = deriveProviderFromModel(candidateModel);
    if (providerHint && candidateProviderFromModel && providerHint !== candidateProviderFromModel) {
      throwGatewayError(
        "INVALID_ARGUMENT",
        `Model ${candidateModel} belongs to provider ${candidateProviderFromModel} but providerHint is ${providerHint}. Update providerHint/modelHint together.`,
      );
    }
    const candidateProvider = candidateProviderFromModel
      || providerHint
      || context.defaultProviderId
      || deriveProviderFromModel(context.defaultModelId)
      || "openai";
    const policyRestrictionReason = context.providerPolicyRestrictionReason(candidateProvider);
    if (policyRestrictionReason) {
      throwGatewayError("FAILED_PRECONDITION", policyRestrictionReason);
    }
    const modelId = withProviderPrefix(candidateProvider, candidateModel);
    const settings = context.getProviderSettings(candidateProvider);
    const allowedModels = normalizeProviderModelList(
      candidateProvider,
      settings.allowedModels.length > 0
        ? settings.allowedModels
        : [settings.model],
    );
    if (settings.allowCustomModel) {
      continue;
    }
    if (!allowedModels.includes(modelId)) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Model ${modelId} is not allowed for provider ${candidateProvider}. Configure provider allowed models first.`,
      );
    }
  }
}
