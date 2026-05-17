/**
 * Archetype Templates — built-in space templates and agent profiles seeded
 * during gateway bootstrap.
 *
 * These are real SpaceTemplate + AgentProfile records that users can browse,
 * customize, and clone. They provide the 5 core orchestration patterns:
 * research, analysis, discussion, debate, coding.
 */

import type { CreateProfileInput } from "@spaceskit/persistence";
import { ARCHETYPE_PROFILES, type ArchetypeProfileSeed } from "./archetype-profile-seeds.js";
import { ARCHETYPE_TEMPLATES, type ArchetypeTemplateSeed } from "./archetype-template-seeds.js";

export { ARCHETYPE_PROFILES } from "./archetype-profile-seeds.js";
export type { ArchetypeProfileSeed } from "./archetype-profile-seeds.js";
export { ARCHETYPE_TEMPLATES } from "./archetype-template-seeds.js";
export type { ArchetypeTemplateSeed, ComplexityTier, TemplateCategory } from "./archetype-template-seeds.js";

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Build a SpaceTemplate JSON config for persisting via SpaceTemplateRepository.
 */
export function buildTemplateConfigJson(seed: ArchetypeTemplateSeed): string {
  const usesManagedDefaultMainBinding = seed.category === "quick_start"
    && seed.agents.length === 1
    && seed.agents[0]?.isPrimary !== false;
  const communicationMode = seed.turnModel === "sequential_all"
    ? "async_notes"
    : seed.turnModel === "round_robin"
      ? "structured_handoff"
      : "chat_first";

  return JSON.stringify({
    schemaVersion: 1,
    communicationMode,
    turnModel: seed.turnModel,
    baseAgents: seed.agents.map((a, index) => ({
      agentId: a.agentId,
      profileId: usesManagedDefaultMainBinding ? undefined : a.profileId,
      profileBinding: usesManagedDefaultMainBinding ? "gateway_default_main" : "explicit",
      role: a.role,
      turnOrder: index,
      isPrimary: a.isPrimary,
    })),
    agentPresetIds: [],
    tags: seed.tags,
    metadata: {
      createdBy: "system",
      source: "system",
      archetypeId: seed.archetypeId,
      topology: seed.topology,
      masterModeEnabled: seed.masterModeEnabled,
      peerReviewEnabled: seed.peerReviewEnabled,
      masterModeMaxIterations: seed.masterModeMaxIterations,
      masterModeConvergenceThreshold: seed.masterModeConvergenceThreshold,
      category: seed.category,
      complexityTier: seed.complexityTier,
      icon: seed.icon,
      featured: seed.featured,
      sortOrder: seed.sortOrder,
    },
  });
}

/**
 * Convert an ArchetypeProfileSeed to a CreateProfileInput.
 */
export function toCreateProfileInput(seed: ArchetypeProfileSeed): CreateProfileInput {
  return {
    profileId: seed.profileId,
    name: seed.name,
    description: seed.description,
    personalityPrompt: seed.personalityPrompt,
    canModerate: seed.canModerate,
    providerHint: seed.providerHint,
    modelConfig: seed.modelConfig,
  };
}

/**
 * Seed archetype profiles and templates into the database.
 * Idempotent: skips profiles/templates that already exist.
 */
export function seedArchetypeTemplates(deps: {
  profileRepo: {
    getById(id: string): unknown | undefined;
    create(input: CreateProfileInput): unknown;
  };
  templateRepo: {
    getById(id: string): unknown | undefined;
    upsertWithNewRevision(input: {
      templateId: string;
      ownerPrincipalId: string;
      name: string;
      description?: string;
      spaceConfigJson: string;
    }): unknown;
  };
  db: { exec(sql: string): void; query(sql: string): { run(...args: unknown[]): unknown } };
}): { profilesCreated: number; templatesCreated: number } {
  let profilesCreated = 0;
  let templatesCreated = 0;

  // Seed profiles
  for (const seed of ARCHETYPE_PROFILES) {
    const existing = deps.profileRepo.getById(seed.profileId);
    if (!existing) {
      deps.profileRepo.create(toCreateProfileInput(seed));
      profilesCreated++;
    }
    // Set preferred_tier on the profile row (column may not exist in older schemas)
    try {
      deps.db.query(
        `UPDATE agent_profiles SET preferred_tier = ? WHERE profile_id = ?`,
      ).run(seed.preferredTier, seed.profileId);
    } catch {
      // Column not yet available — skip preferred_tier update
    }
  }

  // Seed templates
  for (const seed of ARCHETYPE_TEMPLATES) {
    const existing = deps.templateRepo.getById(seed.templateId);
    if (!existing) {
      deps.templateRepo.upsertWithNewRevision({
        templateId: seed.templateId,
        ownerPrincipalId: "system",
        name: seed.name,
        description: seed.description,
        spaceConfigJson: buildTemplateConfigJson(seed),
      });
      templatesCreated++;
    }
  }

  return { profilesCreated, templatesCreated };
}
