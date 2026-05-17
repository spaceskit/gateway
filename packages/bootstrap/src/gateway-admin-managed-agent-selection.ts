import type { ProfileModelConfig, ProfileRepository } from "@spaceskit/persistence";
import { USER_ESCALATION_SKILL_ID } from "@spaceskit/core";
import {
  deriveProviderFromModel,
  mergeSkillIds,
  normalizeProviderId,
  parseModelConfig,
  parseStringArray,
  throwGatewayError,
  withProviderPrefix,
} from "./gateway-admin-model-normalizers.js";

interface ManagedAgentProviderConfig {
  providerId: string;
  model: string;
  allowedModels: string[];
  allowCustomModel: boolean;
}

interface ProviderRuntimeValidationResult {
  valid: boolean;
  reason?: string;
}

interface PinnedProviderModelValidationResult {
  valid: boolean;
  providerHint?: string;
  modelId?: string;
  reason?: string;
}

export interface ManagedAgentSelectionContext {
  profileRepo: ProfileRepository;
  profileId: string;
  updateSource: string;
  listProviderConfigs: () => ManagedAgentProviderConfig[];
  mergeAllowedModels: (providerId: string, model: string, modelIds: string[]) => string[];
  validateProviderRuntimeSelection: (
    providerId: string,
    modelId: string,
  ) => Promise<ProviderRuntimeValidationResult>;
  validateProfileModelSelection: (input: {
    providerHint?: string;
    modelId?: string;
    modelConfig?: ProfileModelConfig;
  }) => void;
  validatePinnedProviderModel: (
    providerHint?: string,
    modelId?: string,
  ) => PinnedProviderModelValidationResult;
}

export async function applyManagedAgentProviderModelSelection(
  input: {
    providerId?: string;
    modelId?: string;
  },
  context: ManagedAgentSelectionContext,
): Promise<void> {
  const providerId = normalizeProviderId(input.providerId);
  const modelIdRaw = input.modelId?.trim();
  if (!providerId || !modelIdRaw) {
    throwGatewayError(
      "INVALID_ARGUMENT",
      "providerId and modelId are required for provider_model selection",
    );
  }

  const modelProviderPrefix = deriveProviderFromModel(modelIdRaw);
  if (modelProviderPrefix && modelProviderPrefix !== providerId) {
    throwGatewayError(
      "INVALID_ARGUMENT",
      `modelId provider prefix ${modelProviderPrefix} does not match providerId ${providerId}`,
    );
  }

  const providerConfig = context.listProviderConfigs()
    .find((entry) => entry.providerId.trim().toLowerCase() === providerId);
  if (!providerConfig) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Provider is not configured: ${providerId}`,
    );
  }

  const modelId = withProviderPrefix(providerId, modelIdRaw);
  const allowedModels = context.mergeAllowedModels(
    providerId,
    providerConfig.model,
    providerConfig.allowedModels,
  );
  if (!providerConfig.allowCustomModel && !allowedModels.includes(modelId)) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Model ${modelId} is not allowed for provider ${providerId}.`,
    );
  }

  const runtimeValidation = await context.validateProviderRuntimeSelection(providerId, modelId);
  if (!runtimeValidation.valid) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      runtimeValidation.reason
        || `Provider runtime rejected model ${modelId} for ${providerId}.`,
    );
  }

  context.profileRepo.update({
    profileId: context.profileId,
    providerHint: providerId,
    defaultSkillIds: mergeSkillIds(
      parseStringArray(
        context.profileRepo.getActiveRevision(context.profileId)?.default_skill_set_ids_json,
      ),
      [USER_ESCALATION_SKILL_ID],
    ),
    modelConfig: {
      preferredModels: [modelId],
      fallbackModels: [],
    },
    source: context.updateSource,
  });
}

export async function applyManagedAgentDefinitionSelection(
  input: {
    sourceAgentDefinitionId?: string;
    applyPersonaInstructions?: boolean;
  },
  context: ManagedAgentSelectionContext,
): Promise<void> {
  const sourceAgentDefinitionId = input.sourceAgentDefinitionId?.trim();
  if (!sourceAgentDefinitionId) {
    throwGatewayError(
      "INVALID_ARGUMENT",
      "sourceAgentDefinitionId is required for agent_definition selection",
    );
  }

  const sourceProfile = context.profileRepo.getActiveById(sourceAgentDefinitionId);
  if (!sourceProfile) {
    throwGatewayError("NOT_FOUND", `Agent Definition not found: ${sourceAgentDefinitionId}`);
  }
  const sourceRevision = context.profileRepo.getActiveRevision(sourceAgentDefinitionId);
  if (!sourceRevision) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Active agent definition revision not found: ${sourceAgentDefinitionId}`,
    );
  }

  const applyPersonaInstructions = input.applyPersonaInstructions ?? true;
  const sourceModelConfig = parseModelConfig(sourceRevision.model_config_json);
  const sourceModelId = sourceModelConfig.preferredModels[0];
  const sourceProviderHint = normalizeProviderId(sourceRevision.provider_hint)
    || deriveProviderFromModel(sourceModelId);
  context.validateProfileModelSelection({
    providerHint: sourceProviderHint ?? undefined,
    modelId: sourceModelId,
    modelConfig: sourceModelConfig,
  });
  const sourcePinned = context.validatePinnedProviderModel(
    sourceProviderHint ?? undefined,
    sourceModelId,
  );
  if (!sourcePinned.valid || !sourcePinned.providerHint || !sourcePinned.modelId) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      sourcePinned.reason
        || `Agent Definition ${sourceAgentDefinitionId} is missing a valid runtime/model configuration.`,
    );
  }
  const runtimeValidation = await context.validateProviderRuntimeSelection(
    sourcePinned.providerHint,
    sourcePinned.modelId,
  );
  if (!runtimeValidation.valid) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      runtimeValidation.reason
        || `Agent Definition ${sourceAgentDefinitionId} is pinned to a runtime model that is unavailable.`,
    );
  }

  context.profileRepo.update({
    profileId: context.profileId,
    personalityPrompt: applyPersonaInstructions ? sourceRevision.personality_prompt : undefined,
    defaultSkillIds: mergeSkillIds(
      parseStringArray(sourceRevision.default_skill_set_ids_json),
      [USER_ESCALATION_SKILL_ID],
    ),
    providerHint: sourceProviderHint ?? undefined,
    modelConfig: sourceModelConfig,
    source: context.updateSource,
  });
}
