import type { SpaceAdminService } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { DatabaseManager, ProfileRepository } from "@spaceskit/persistence";
import type { GatewayConfig } from "./config.js";
import type { PublicProviderRuntimeConfig } from "./gateway-admin-service.js";
import type { GatewaySkillCatalogService } from "./services/gateway-skill-catalog-service.js";
import { DEFAULT_PERSONA_ID } from "./services/gateway-identity-service.js";
import {
  CONCIERGE_SKILLS,
  MAIN_SPACE_SYSTEM_SKILLS,
  MAIN_SPACE_SYSTEM_SKILL_IDS,
  TRUSTED_AGENT_SYSTEM_SKILL_IDS,
} from "./seed/main-space-system-skills.js";

export interface EnsureMainDefaultsResult {
  profile: "created" | "restored" | "reused";
  space: "created" | "reused";
  assignment: "created" | "updated" | "reused";
  orchestrator: "updated" | "reused" | "skipped";
}

export interface EnsureConciergeDefaultsResult {
  profile: "created" | "restored" | "reused" | "migrated";
  space: "created" | "reused";
  assignment: "created" | "updated" | "reused";
  orchestrator: "updated" | "reused" | "skipped";
}

export interface EnsureMainSpaceSystemSkillsResult {
  seeded: number;
  attached: number;
}

export interface MainProfileRuntimeSelection {
  providerHint: string;
  modelHint: string;
}

export function resolveMainProfileRuntimeSelection(
  config: GatewayConfig,
  providerConfigs: Pick<PublicProviderRuntimeConfig, "providerId" | "model">[],
): MainProfileRuntimeSelection {
  const priorityOrder = [
    "claude",
    "codex",
    "gemini",
    "openrouter",
    "openai",
    "groq",
    "together",
    "mistral",
    "lmstudio",
    "ollama",
    "apple",
  ];
  const configuredProviderHint = config.modelProvider?.trim() ?? "";
  const configuredModelHint = config.defaultModelId?.trim() ?? "";
  if (configuredProviderHint && configuredModelHint) {
    const configuredProviderAvailable = providerConfigs.some((entry) =>
      entry.providerId.trim().toLowerCase() === configuredProviderHint.toLowerCase(),
    );
    if (configuredProviderAvailable) {
      return { providerHint: configuredProviderHint, modelHint: configuredModelHint };
    }
  }

  for (const providerId of priorityOrder) {
    const preferred = providerConfigs.find((entry) =>
      entry.providerId?.trim().toLowerCase() === providerId && Boolean(entry.model?.trim())
    );
    if (preferred) {
      return { providerHint: preferred.providerId.trim(), modelHint: preferred.model.trim() };
    }
  }

  const firstAvailable = providerConfigs.find((entry) =>
    Boolean(entry.providerId?.trim()) && Boolean(entry.model?.trim())
  );
  if (firstAvailable) {
    return { providerHint: firstAvailable.providerId.trim(), modelHint: firstAvailable.model.trim() };
  }

  return { providerHint: "", modelHint: "" };
}

export async function ensureMainDefaults(
  config: GatewayConfig,
  logger: Logger,
  profileRepo: ProfileRepository | null,
  spaceAdminService: SpaceAdminService,
  runtimeSelection: MainProfileRuntimeSelection,
  defaultPersonaId = DEFAULT_PERSONA_ID,
): Promise<EnsureMainDefaultsResult | null> {
  if (!profileRepo) {
    logger.warn("Skipping main defaults bootstrap: profile persistence unavailable");
    return null;
  }

  let profileStatus: EnsureMainDefaultsResult["profile"] = "reused";
  let spaceStatus: EnsureMainDefaultsResult["space"] = "reused";
  let assignmentStatus: EnsureMainDefaultsResult["assignment"] = "reused";
  let orchestratorStatus: EnsureMainDefaultsResult["orchestrator"] = "reused";
  const profileLabel = config.gatewayProfile === "external" ? "External" : "Embedded";

  const existingProfile = profileRepo.getById(config.mainProfileId);
  if (!existingProfile) {
    profileRepo.create({
      profileId: config.mainProfileId,
      personaId: defaultPersonaId,
      name: `${profileLabel} Main Agent`,
      description: `Default ${config.gatewayProfile} gateway startup profile for the main agent.`,
      canModerate: true,
      personalityPrompt: `You are the default ${config.gatewayProfile} main gateway agent. Coordinate spaces clearly and safely.`,
      defaultSkillIds: [...TRUSTED_AGENT_SYSTEM_SKILL_IDS],
      providerHint: runtimeSelection.providerHint,
      modelHint: runtimeSelection.modelHint,
    });
    profileStatus = "created";
  } else if (existingProfile.archived === 1) {
    profileRepo.restore(config.mainProfileId);
    profileStatus = "restored";
  }
  ensureRequiredProfileSkills(profileRepo, config.mainProfileId, TRUSTED_AGENT_SYSTEM_SKILL_IDS, "gateway_main_defaults");

  const desiredOrchestratorProfileId = config.mainOrchestratorProfileId || config.mainProfileId;
  const orchestratorProfile = profileRepo.getById(desiredOrchestratorProfileId);
  if (!orchestratorProfile || orchestratorProfile.archived === 1) {
    logger.warn("Configured orchestrator profile is unavailable; falling back to main profile", {
      configuredProfileId: desiredOrchestratorProfileId,
      fallbackProfileId: config.mainProfileId,
    });
    orchestratorStatus = "skipped";
  }
  const effectiveOrchestratorProfileId = (!orchestratorProfile || orchestratorProfile.archived === 1)
    ? config.mainProfileId
    : desiredOrchestratorProfileId;
  ensureRequiredProfileSkills(
    profileRepo,
    effectiveOrchestratorProfileId,
    TRUSTED_AGENT_SYSTEM_SKILL_IDS,
    "gateway_main_defaults",
  );

  const existingSpace = await spaceAdminService.getSpace(config.mainSpaceId);
  if (!existingSpace) {
    await spaceAdminService.createSpace({
      spaceId: config.mainSpaceId,
      resourceId: config.mainSpaceResourceId,
      spaceType: "main",
      name: config.mainSpaceName,
      goal: config.mainSpaceGoal,
      turnModel: "sequential_all",
      visibility: "shared",
      initialAgents: [{
        agentId: config.mainAgentId,
        profileId: config.mainProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      }],
    });
    spaceStatus = "created";
    assignmentStatus = "created";
  } else {
    const existingAssignment = existingSpace.agents.find((assignment) => assignment.agentId === config.mainAgentId);
    if (!existingAssignment) {
      await spaceAdminService.addAgent({
        spaceId: config.mainSpaceId,
        agentId: config.mainAgentId,
        profileId: config.mainProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      });
      assignmentStatus = "created";
    } else {
      const needsUpdate =
        existingAssignment.profileId !== config.mainProfileId
        || existingAssignment.role !== "global_coordinator"
        || existingAssignment.turnOrder !== 0
        || !existingAssignment.isPrimary;
      if (needsUpdate) {
        await spaceAdminService.updateAgentAssignment({
          spaceId: config.mainSpaceId,
          agentId: config.mainAgentId,
          profileId: config.mainProfileId,
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        });
        assignmentStatus = "updated";
      }
    }
  }

  const refreshedMainSpace = await spaceAdminService.getSpace(config.mainSpaceId);
  if (!refreshedMainSpace) {
    throw new Error(`Failed to load main space after bootstrap: ${config.mainSpaceId}`);
  }
  if (refreshedMainSpace.orchestratorProfileId !== effectiveOrchestratorProfileId) {
    await spaceAdminService.setSpaceOrchestrator({
      spaceId: config.mainSpaceId,
      profileId: effectiveOrchestratorProfileId,
    });
    orchestratorStatus = "updated";
  }

  return {
    profile: profileStatus,
    space: spaceStatus,
    assignment: assignmentStatus,
    orchestrator: orchestratorStatus,
  };
}

export async function ensureConciergeDefaults(
  config: GatewayConfig,
  logger: Logger,
  profileRepo: ProfileRepository | null,
  spaceAdminService: SpaceAdminService,
  runtimeSelection: MainProfileRuntimeSelection,
  defaultPersonaId = DEFAULT_PERSONA_ID,
): Promise<EnsureConciergeDefaultsResult | null> {
  if (!profileRepo) {
    logger.warn("Skipping concierge defaults bootstrap: profile persistence unavailable");
    return null;
  }

  let profileStatus: EnsureConciergeDefaultsResult["profile"] = "reused";
  let spaceStatus: EnsureConciergeDefaultsResult["space"] = "reused";
  let assignmentStatus: EnsureConciergeDefaultsResult["assignment"] = "reused";
  let orchestratorStatus: EnsureConciergeDefaultsResult["orchestrator"] = "reused";
  const profileLabel = config.gatewayProfile === "external" ? "External" : "Embedded";

  const legacyProfile = findLegacyConciergeProfile(profileRepo);
  const existingProfile = profileRepo.getById(config.conciergeProfileId);
  if (!existingProfile) {
    const legacyRevision = legacyProfile
      ? profileRepo.getActiveRevision(legacyProfile.profile_id)
      : undefined;
    profileRepo.create({
      profileId: config.conciergeProfileId,
      personaId: legacyProfile?.persona_id || defaultPersonaId,
      name: `${profileLabel} Concierge`,
      description: "General-purpose system concierge for workspace status, routing, and setup.",
      canModerate: true,
      personalityPrompt: legacyRevision?.personality_prompt
        || "You are the Spaces concierge. Be concise, route users to the right workspace or settings surface, and escalate runtime issues clearly.",
      defaultSkillIds: mergeSkillIds(
        legacyRevision ? parseStringArray(legacyRevision.default_skill_set_ids_json) : [],
        TRUSTED_AGENT_SYSTEM_SKILL_IDS,
      ),
      providerHint: legacyRevision?.provider_hint?.trim() || runtimeSelection.providerHint,
      modelHint: legacyRevision?.model_hint?.trim() || runtimeSelection.modelHint,
      modelConfig: legacyRevision
        ? parseModelConfig(legacyRevision.model_config_json, legacyRevision.model_hint)
        : {
          preferredModels: runtimeSelection.modelHint ? [runtimeSelection.modelHint] : [],
          fallbackModels: [],
        },
      source: legacyProfile ? "gateway_concierge_profile_migration" : "gateway_concierge_defaults",
    });
    profileStatus = legacyProfile ? "migrated" : "created";
  } else if (existingProfile.archived === 1) {
    profileRepo.restore(config.conciergeProfileId);
    profileStatus = "restored";
  }
  ensureRequiredProfileSkills(profileRepo, config.conciergeProfileId, TRUSTED_AGENT_SYSTEM_SKILL_IDS, "gateway_concierge_defaults");

  const existingSpace = await spaceAdminService.getSpace(config.conciergeSpaceId);
  if (!existingSpace) {
    await spaceAdminService.createSpace({
      spaceId: config.conciergeSpaceId,
      resourceId: config.conciergeSpaceResourceId,
      spaceType: "concierge",
      name: config.conciergeSpaceName,
      goal: config.conciergeSpaceGoal,
      turnModel: "sequential_all",
      visibility: "private",
      initialAgents: [{
        agentId: config.conciergeAgentId,
        profileId: config.conciergeProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      }],
    });
    spaceStatus = "created";
    assignmentStatus = "created";
  } else {
    const existingAssignment = existingSpace.agents.find((assignment) => assignment.agentId === config.conciergeAgentId);
    if (!existingAssignment) {
      await spaceAdminService.addAgent({
        spaceId: config.conciergeSpaceId,
        agentId: config.conciergeAgentId,
        profileId: config.conciergeProfileId,
        role: "global_coordinator",
        turnOrder: 0,
        isPrimary: true,
      });
      assignmentStatus = "created";
    } else {
      const needsUpdate =
        existingAssignment.profileId !== config.conciergeProfileId
        || existingAssignment.role !== "global_coordinator"
        || existingAssignment.turnOrder !== 0
        || !existingAssignment.isPrimary;
      if (needsUpdate) {
        await spaceAdminService.updateAgentAssignment({
          spaceId: config.conciergeSpaceId,
          agentId: config.conciergeAgentId,
          profileId: config.conciergeProfileId,
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        });
        assignmentStatus = "updated";
      }
    }
  }

  const refreshedConciergeSpace = await spaceAdminService.getSpace(config.conciergeSpaceId);
  if (!refreshedConciergeSpace) {
    throw new Error(`Failed to load concierge space after bootstrap: ${config.conciergeSpaceId}`);
  }
  if (refreshedConciergeSpace.orchestratorProfileId !== config.conciergeProfileId) {
    await spaceAdminService.setSpaceOrchestrator({
      spaceId: config.conciergeSpaceId,
      profileId: config.conciergeProfileId,
    });
    orchestratorStatus = "updated";
  }

  return {
    profile: profileStatus,
    space: spaceStatus,
    assignment: assignmentStatus,
    orchestrator: orchestratorStatus,
  };
}

export function repairProfilePersonaAssignments(
  db: DatabaseManager | null,
  defaultPersonaId = DEFAULT_PERSONA_ID,
): number {
  if (!db) return 0;
  const now = new Date().toISOString();
  db.db.query(
    `UPDATE agent_profiles AS profiles
     SET persona_id = ?, updated_at = ?
     WHERE TRIM(COALESCE(profiles.persona_id, '')) = ''
        OR NOT EXISTS (
          SELECT 1 FROM personas
          WHERE personas.persona_id = profiles.persona_id
            AND personas.archived = 0
        )`,
  ).run(defaultPersonaId, now);
  const row = db.db.query("SELECT changes() AS count").get() as { count?: number } | null;
  return Number(row?.count ?? 0);
}

export async function ensureMainSpaceSystemSkills(
  config: GatewayConfig,
  logger: Logger,
  spaceAdminService: SpaceAdminService,
  gatewaySkillCatalogService: GatewaySkillCatalogService | null,
): Promise<EnsureMainSpaceSystemSkillsResult> {
  if (!gatewaySkillCatalogService) {
    logger.warn("Skipping main-space skill seed: gateway skill catalog service unavailable");
    return { seeded: 0, attached: 0 };
  }

  let seeded = 0;
  for (const skill of [...MAIN_SPACE_SYSTEM_SKILLS, ...CONCIERGE_SKILLS]) {
    gatewaySkillCatalogService.upsertSkill({
      skillId: skill.skillId,
      name: skill.name,
      description: skill.description,
      contentMarkdown: skill.contentMarkdown,
      sourceRef: skill.sourceRef,
      tags: skill.tags,
      status: skill.status,
    });
    seeded += 1;
  }

  let attached = 0;
  for (const skillId of MAIN_SPACE_SYSTEM_SKILL_IDS) {
    await spaceAdminService.addSkillToSpace({ spaceId: config.mainSpaceId, skillId });
    attached += 1;
  }

  return { seeded, attached };
}

function findLegacyConciergeProfile(profileRepo: ProfileRepository): ReturnType<ProfileRepository["getById"]> {
  const candidates = profileRepo
    .list({ includeArchived: true })
    .filter((entry) => entry.profile_id.startsWith("system.concierge.profile."));
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.sort((lhs, rhs) => rhs.updated_at.localeCompare(lhs.updated_at))[0];
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function parseModelConfig(
  value: string | null | undefined,
  fallbackModelHint: string | null | undefined,
): { preferredModels: string[]; fallbackModels: string[] } {
  const fallback = fallbackModelHint?.trim() ? [fallbackModelHint.trim()] : [];
  if (!value?.trim()) {
    return { preferredModels: fallback, fallbackModels: [] };
  }
  try {
    const parsed = JSON.parse(value) as {
      preferredModels?: unknown;
      fallbackModels?: unknown;
    };
    const preferredModels = Array.isArray(parsed.preferredModels)
      ? parsed.preferredModels.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : fallback;
    const fallbackModels = Array.isArray(parsed.fallbackModels)
      ? parsed.fallbackModels.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    return { preferredModels, fallbackModels };
  } catch {
    return { preferredModels: fallback, fallbackModels: [] };
  }
}

function ensureRequiredProfileSkills(
  profileRepo: ProfileRepository,
  profileId: string,
  requiredSkillIds: readonly string[],
  source: string,
): void {
  const activeRevision = profileRepo.getActiveRevision(profileId);
  if (!activeRevision) return;
  const mergedSkillIds = mergeSkillIds(parseStringArray(activeRevision.default_skill_set_ids_json), requiredSkillIds);
  if (mergedSkillIds.length === parseStringArray(activeRevision.default_skill_set_ids_json).length) {
    return;
  }
  profileRepo.update({
    profileId,
    defaultSkillIds: mergedSkillIds,
    source,
  });
}

function mergeSkillIds(existing: string[], required: readonly string[]): string[] {
  return Array.from(new Set([...existing, ...required].map((entry) => entry.trim()).filter(Boolean)));
}
