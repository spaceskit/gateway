import { USER_ESCALATION_SKILL_ID } from "@spaceskit/core";
import type { ProfileModelConfig, ProfileRepository } from "@spaceskit/persistence";
import type {
  GatewayConciergeAgentStatePayload,
  GatewayMainAgentStatePayload,
} from "@spaceskit/server";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import {
  mergeSkillIds,
  parseModelConfig,
  parseStringArray,
  throwGatewayError,
} from "./gateway-admin-model-normalizers.js";
import type { ResolvedProviderModelId } from "./gateway-admin-managed-agent-provider-model.js";

export interface GatewayAdminManagedAgentSpaceState {
  spaceUid: string;
  repaired: boolean;
  assignedProfileId?: string;
  updatedAt: string;
}

export interface GatewayAdminManagedAgentProfileState {
  repaired: boolean;
  updatedAt: string;
}

export interface GatewayAdminManagedAgentStateContext {
  gatewayProfile: GatewayCoreProfileId;
  mainProfileId: string;
  mainAgentId: string;
  conciergeProfileId: string;
  conciergeAgentId: string;
  requireProfileRepo: () => ProfileRepository;
  resolveValidatedProviderModel: (input: {
    providerHintRaw?: string;
    modelIdRaw?: string;
    repairIfInvalid: boolean;
    allowFallbackRepair?: boolean;
  }) => Promise<ResolvedProviderModelId>;
  ensureMainSpace: (repairIfMissing: boolean) => Promise<GatewayAdminManagedAgentSpaceState>;
  ensureConciergeSpace: (repairIfMissing: boolean) => Promise<GatewayAdminManagedAgentSpaceState>;
}

export async function ensureGatewayAdminMainProfileActive(
  context: GatewayAdminManagedAgentStateContext,
  repairIfMissing: boolean,
): Promise<GatewayAdminManagedAgentProfileState> {
  const profileRepo = context.requireProfileRepo();
  const profileLabel = context.gatewayProfile === "external" ? "External" : "Embedded";
  const existing = profileRepo.getById(context.mainProfileId);
  if (!existing) {
    if (!repairIfMissing) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Main profile is missing: ${context.mainProfileId}`,
      );
    }
    profileRepo.create({
      profileId: context.mainProfileId,
      name: `${profileLabel} Main Agent`,
      description: `Default ${context.gatewayProfile} gateway startup profile for the main agent.`,
      canModerate: true,
      personalityPrompt: `You are the default ${context.gatewayProfile} main gateway agent. Coordinate spaces clearly and safely.`,
      defaultSkillIds: [USER_ESCALATION_SKILL_ID],
    });
    const created = profileRepo.getById(context.mainProfileId);
    if (!created) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to create main profile: ${context.mainProfileId}`,
      );
    }
    return {
      repaired: true,
      updatedAt: created.updated_at,
    };
  }

  if (existing.archived !== 1) {
    ensureGatewayAdminProfileDefaultSkills(
      profileRepo,
      context.mainProfileId,
      [USER_ESCALATION_SKILL_ID],
      "gateway_main_defaults",
    );
    return {
      repaired: false,
      updatedAt: existing.updated_at,
    };
  }

  if (!repairIfMissing) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Main profile is archived: ${context.mainProfileId}`,
    );
  }
  profileRepo.restore(context.mainProfileId);
  const restored = profileRepo.getById(context.mainProfileId);
  if (!restored || restored.archived === 1) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Unable to restore archived main profile: ${context.mainProfileId}`,
    );
  }
  ensureGatewayAdminProfileDefaultSkills(
    profileRepo,
    context.mainProfileId,
    [USER_ESCALATION_SKILL_ID],
    "gateway_main_defaults",
  );
  return {
    repaired: true,
    updatedAt: restored.updated_at,
  };
}

export async function ensureGatewayAdminConciergeProfileActive(
  context: GatewayAdminManagedAgentStateContext,
  repairIfMissing: boolean,
): Promise<GatewayAdminManagedAgentProfileState> {
  const profileRepo = context.requireProfileRepo();
  const profileLabel = context.gatewayProfile === "external" ? "External" : "Embedded";
  const existing = profileRepo.getById(context.conciergeProfileId);
  if (!existing) {
    if (!repairIfMissing) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Concierge profile is missing: ${context.conciergeProfileId}`,
      );
    }

    profileRepo.create({
      profileId: context.conciergeProfileId,
      personaId: "",
      name: `${profileLabel} Concierge`,
      description: "General-purpose system concierge for workspace status, routing, and setup.",
      canModerate: true,
      personalityPrompt: "You are the Spaces concierge. Be concise, route users to the right workspace or settings surface, and escalate runtime issues clearly.",
      defaultSkillIds: [USER_ESCALATION_SKILL_ID],
      source: "gateway_concierge_defaults",
    });
    const created = profileRepo.getById(context.conciergeProfileId);
    if (!created) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to create concierge profile: ${context.conciergeProfileId}`,
      );
    }
    return {
      repaired: true,
      updatedAt: created.updated_at,
    };
  }

  if (existing.archived !== 1) {
    ensureGatewayAdminProfileDefaultSkills(
      profileRepo,
      context.conciergeProfileId,
      [USER_ESCALATION_SKILL_ID],
      "gateway_concierge_defaults",
    );
    return {
      repaired: false,
      updatedAt: existing.updated_at,
    };
  }

  if (!repairIfMissing) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Concierge profile is archived: ${context.conciergeProfileId}`,
    );
  }
  profileRepo.restore(context.conciergeProfileId);
  const restored = profileRepo.getById(context.conciergeProfileId);
  if (!restored || restored.archived === 1) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Unable to restore archived concierge profile: ${context.conciergeProfileId}`,
    );
  }
  ensureGatewayAdminProfileDefaultSkills(
    profileRepo,
    context.conciergeProfileId,
    [USER_ESCALATION_SKILL_ID],
    "gateway_concierge_defaults",
  );
  return {
    repaired: true,
    updatedAt: restored.updated_at,
  };
}

export async function resolveGatewayAdminMainAgentState(
  context: GatewayAdminManagedAgentStateContext,
  input: {
    spaceId: string;
    repairIfMissing: boolean;
  },
): Promise<GatewayMainAgentStatePayload> {
  const profileRepo = context.requireProfileRepo();
  const profileRepair = await ensureGatewayAdminMainProfileActive(context, input.repairIfMissing);
  const spaceRepair = await context.ensureMainSpace(input.repairIfMissing);
  let repaired = profileRepair.repaired || spaceRepair.repaired;
  let fallbackApplied = false;
  let fallbackReason: string | undefined;

  const activeRevision = profileRepo.getActiveRevision(context.mainProfileId);
  if (!activeRevision) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Active main profile revision missing: ${context.mainProfileId}`,
    );
  }

  const resolvedPinned = await context.resolveValidatedProviderModel({
    providerHintRaw: activeRevision.provider_hint,
    modelIdRaw: parseModelConfig(activeRevision.model_config_json).preferredModels[0],
    repairIfInvalid: input.repairIfMissing,
    allowFallbackRepair: true,
  });
  if (!resolvedPinned.valid || !resolvedPinned.providerHint || !resolvedPinned.modelId) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      resolvedPinned.reason || "Main profile runtime/model selection is invalid",
    );
  }
  if (resolvedPinned.fallbackApplied) {
    repaired = true;
  }
  fallbackApplied = resolvedPinned.fallbackApplied;
  fallbackReason = resolvedPinned.fallbackReason;

  const refreshedProfile = profileRepo.getById(context.mainProfileId);
  const updatedAt = new Date().toISOString();
  return {
    spaceId: input.spaceId,
    spaceUid: spaceRepair.spaceUid,
    mainAgentId: context.mainAgentId,
    mainProfileId: context.mainProfileId,
    assignedProfileId: spaceRepair.assignedProfileId,
    providerHint: resolvedPinned.providerHint,
    modelConfig: runtimeStateModelConfig(resolvedPinned.modelId),
    status: fallbackApplied ? "fallback" : repaired ? "repaired" : "healthy",
    repaired,
    fallbackApplied,
    fallbackReason,
    updatedAt: refreshedProfile?.updated_at || updatedAt,
  };
}

export async function resolveGatewayAdminConciergeAgentState(
  context: GatewayAdminManagedAgentStateContext,
  input: {
    spaceId: string;
    repairIfMissing: boolean;
  },
): Promise<GatewayConciergeAgentStatePayload> {
  const profileRepo = context.requireProfileRepo();
  const profileRepair = await ensureGatewayAdminConciergeProfileActive(context, input.repairIfMissing);
  const spaceRepair = await context.ensureConciergeSpace(input.repairIfMissing);
  let repaired = profileRepair.repaired || spaceRepair.repaired;
  let fallbackApplied = false;
  let fallbackReason: string | undefined;

  const activeRevision = profileRepo.getActiveRevision(context.conciergeProfileId);
  if (!activeRevision) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Active concierge profile revision missing: ${context.conciergeProfileId}`,
    );
  }

  const resolvedPinned = await context.resolveValidatedProviderModel({
    providerHintRaw: activeRevision.provider_hint,
    modelIdRaw: parseModelConfig(activeRevision.model_config_json).preferredModels[0],
    repairIfInvalid: input.repairIfMissing,
    allowFallbackRepair: false,
  });
  if (!resolvedPinned.valid || !resolvedPinned.providerHint || !resolvedPinned.modelId) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      resolvedPinned.reason || "Concierge profile runtime/model selection is invalid",
    );
  }
  if (resolvedPinned.fallbackApplied) {
    repaired = true;
  }
  fallbackApplied = resolvedPinned.fallbackApplied;
  fallbackReason = resolvedPinned.fallbackReason;

  const refreshedProfile = profileRepo.getById(context.conciergeProfileId);
  const updatedAt = new Date().toISOString();
  return {
    spaceId: input.spaceId,
    spaceUid: spaceRepair.spaceUid,
    conciergeAgentId: context.conciergeAgentId,
    conciergeProfileId: context.conciergeProfileId,
    assignedProfileId: spaceRepair.assignedProfileId,
    providerHint: resolvedPinned.providerHint,
    modelConfig: runtimeStateModelConfig(resolvedPinned.modelId),
    status: fallbackApplied ? "fallback" : repaired ? "repaired" : "healthy",
    repaired,
    fallbackApplied,
    fallbackReason,
    updatedAt: refreshedProfile?.updated_at || updatedAt,
  };
}

function ensureGatewayAdminProfileDefaultSkills(
  profileRepo: ProfileRepository,
  profileId: string,
  requiredSkillIds: readonly string[],
  source: string,
): void {
  const activeRevision = profileRepo.getActiveRevision(profileId);
  if (!activeRevision) return;
  const existingSkillIds = parseStringArray(activeRevision.default_skill_set_ids_json);
  const mergedSkillIds = mergeSkillIds(existingSkillIds, requiredSkillIds);
  if (mergedSkillIds.length === existingSkillIds.length) {
    return;
  }
  profileRepo.update({
    profileId,
    defaultSkillIds: mergedSkillIds,
    source,
  });
}

function runtimeStateModelConfig(modelId: string): ProfileModelConfig {
  const trimmedModelId = modelId.trim();
  return {
    preferredModels: trimmedModelId ? [trimmedModelId] : [],
    fallbackModels: [],
  };
}
