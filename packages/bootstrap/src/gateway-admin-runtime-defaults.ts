import { USER_ESCALATION_SKILL_ID } from "@spaceskit/core";
import type {
  GatewayRuntimeDefaultsRepository,
  ProfileRepository,
} from "@spaceskit/persistence";
import type {
  GatewayModelProviderCatalogPayload,
  GatewayRuntimeDefaultSelectionPayload,
  GatewayRuntimeDefaultsPayload,
  ProviderRuntimeConfigPayload,
} from "@spaceskit/server";
import { DEFAULT_MODEL_BY_PROVIDER } from "./services/provider-catalog-support.js";
import {
  deriveProviderFromModel,
  mergeSkillIds,
  normalizeProviderId,
  parseModelConfig,
  normalizeRuntimeDefaultSelection,
  parseStringArray,
  runtimeDefaultPriority,
  throwGatewayError,
  withProviderPrefix,
} from "./gateway-admin-model-normalizers.js";

export interface GatewayAdminRuntimeDefaultsContext {
  profileRepo: ProfileRepository | null;
  gatewayRuntimeDefaultsRepo?: GatewayRuntimeDefaultsRepository;
  mainProfileId: string;
  conciergeProfileId: string;
  defaultProviderId?: string;
  defaultModelId?: string;
  listProviderConfigs(): ProviderRuntimeConfigPayload[];
  listProviderCatalogs(input?: {
    providerId?: string;
    refresh?: boolean;
  }): Promise<GatewayModelProviderCatalogPayload[]>;
  isProviderConfigAllowed(providerId: string): boolean;
  mergeAllowedModels(providerId: string, model: string, modelIds: string[]): string[];
  validateProviderRuntimeSelection(
    providerId: string,
    modelId: string,
  ): Promise<{ valid: boolean; reason?: string }>;
  requireProfileRepo(): ProfileRepository;
}

export async function resolveGatewayAdminRuntimeDefaults(
  context: GatewayAdminRuntimeDefaultsContext,
): Promise<GatewayRuntimeDefaultsPayload> {
  const stored = context.gatewayRuntimeDefaultsRepo?.get();
  const mainProfileSelection = runtimeDefaultSelectionFromProfile(context, context.mainProfileId);
  const conciergeProfileSelection = runtimeDefaultSelectionFromProfile(context, context.conciergeProfileId);
  const recommended = await recommendRuntimeDefaultSelection(context);
  const fallback = fallbackRuntimeDefaultSelection(context);

  const main = normalizeRuntimeDefaultSelection(
    stored?.main_provider_id,
    stored?.main_model_id,
  ) ?? mainProfileSelection ?? recommended ?? fallback;
  const concierge = normalizeRuntimeDefaultSelection(
    stored?.concierge_provider_id,
    stored?.concierge_model_id,
  ) ?? conciergeProfileSelection ?? recommended ?? main;

  return {
    main,
    concierge,
    updatedAt: stored?.updated_at ?? new Date().toISOString(),
  };
}

export async function validateGatewayAdminRuntimeDefaultSelection(
  context: GatewayAdminRuntimeDefaultsContext,
  selection: GatewayRuntimeDefaultSelectionPayload,
  branch: "main" | "concierge",
): Promise<GatewayRuntimeDefaultSelectionPayload> {
  const providerId = normalizeProviderId(selection.providerId);
  const modelIdRaw = selection.modelId?.trim();
  if (!providerId || !modelIdRaw) {
    throwGatewayError(
      "INVALID_ARGUMENT",
      `${branch} runtime defaults require both providerId and modelId.`,
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

  return {
    providerId,
    modelId,
  };
}

export function updateGatewayAdminManagedRuntimeProfile(
  context: GatewayAdminRuntimeDefaultsContext,
  profileId: string,
  selection: GatewayRuntimeDefaultSelectionPayload,
  isDefault: boolean,
  source: string,
): void {
  const profileRepo = context.requireProfileRepo();
  const activeRevision = profileRepo.getActiveRevision(profileId);

  profileRepo.update({
    profileId,
    providerHint: selection.providerId,
    defaultSkillIds: mergeSkillIds(
      parseStringArray(activeRevision?.default_skill_set_ids_json),
      [USER_ESCALATION_SKILL_ID],
    ),
    modelConfig: {
      preferredModels: [selection.modelId],
      fallbackModels: [],
    },
    isDefault,
    source,
  });
}

function fallbackRuntimeDefaultSelection(
  context: GatewayAdminRuntimeDefaultsContext,
): GatewayRuntimeDefaultSelectionPayload {
  const configuredProvider = context.listProviderConfigs().find((entry) =>
    context.isProviderConfigAllowed(entry.providerId)
  );
  if (configuredProvider) {
    return {
      providerId: configuredProvider.providerId,
      modelId: configuredProvider.model,
    };
  }

  const providerId = context.defaultProviderId
    || deriveProviderFromModel(context.defaultModelId)
    || "openai";
  const modelId = withProviderPrefix(
    providerId,
    context.defaultModelId ?? DEFAULT_MODEL_BY_PROVIDER[providerId] ?? `${providerId}/default`,
  );
  return { providerId, modelId };
}

function runtimeDefaultSelectionFromProfile(
  context: GatewayAdminRuntimeDefaultsContext,
  profileId: string,
): GatewayRuntimeDefaultSelectionPayload | null {
  const profileRepo = context.profileRepo;
  if (!profileRepo) {
    return null;
  }

  const revision = profileRepo.getActiveRevision(profileId);
  const modelConfig = parseModelConfig(revision?.model_config_json);
  return normalizeRuntimeDefaultSelection(
    revision?.provider_hint ?? undefined,
    modelConfig.preferredModels[0],
  );
}

async function recommendRuntimeDefaultSelection(
  context: GatewayAdminRuntimeDefaultsContext,
): Promise<GatewayRuntimeDefaultSelectionPayload | null> {
  const catalogs = await context.listProviderCatalogs({ refresh: false });
  const candidates = catalogs
    .filter((catalog) => catalog.configAllowed !== false)
    .filter((catalog) => catalog.models.length > 0)
    .sort((lhs, rhs) => {
      const lhsRank = runtimeDefaultPriority(lhs.providerId);
      const rhsRank = runtimeDefaultPriority(rhs.providerId);
      if (lhsRank !== rhsRank) {
        return lhsRank - rhsRank;
      }
      if (Boolean(lhs.recommended) !== Boolean(rhs.recommended)) {
        return lhs.recommended ? -1 : 1;
      }
      return lhs.displayName.localeCompare(rhs.displayName);
    });

  const selected = candidates[0];
  const modelId = selected?.models[0]?.id?.trim();
  if (!selected || !modelId) {
    return null;
  }

  return {
    providerId: selected.providerId,
    modelId,
  };
}
