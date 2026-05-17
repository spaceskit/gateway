/**
 * Agent template read model and profile config validation.
 * Pure functions — no I/O, no logging.
 */

import type { AgentProfile, InsightStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Read Model
// ---------------------------------------------------------------------------

export interface AgentTemplateReadModel {
  profileId: string;
  name: string;
  personalitySummary: string;
  skills: string[];
  modelIds: string[];
  status: "active" | "archived";
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export function toAgentTemplateReadModel(
  profile: AgentProfile,
  usageCount?: number,
): AgentTemplateReadModel {
  return {
    profileId: profile.profileId,
    name: profile.name,
    personalitySummary: profile.personalityPrompt,
    skills: profile.defaultSkillIds,
    modelIds: [profile.providerHint, profile.modelId].filter(Boolean),
    status: profile.status,
    usageCount: usageCount ?? 0,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Model Config Validation
// ---------------------------------------------------------------------------

export interface ProfileModelConfig {
  preferredModels?: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
}

export interface ProfileModelConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateProfileModelConfig(
  config: ProfileModelConfig,
): ProfileModelConfigValidationResult {
  const errors: string[] = [];

  if (config.preferredModels) {
    if (config.preferredModels.length === 0) {
      errors.push("preferredModels must be non-empty if specified");
    }
    const dupes = config.preferredModels.filter(
      (m, i) => config.preferredModels!.indexOf(m) !== i,
    );
    if (dupes.length > 0) {
      errors.push(`Duplicate preferredModels: ${[...new Set(dupes)].join(", ")}`);
    }
  }

  if (config.fallbackModels) {
    const dupes = config.fallbackModels.filter(
      (m, i) => config.fallbackModels!.indexOf(m) !== i,
    );
    if (dupes.length > 0) {
      errors.push(`Duplicate fallbackModels: ${[...new Set(dupes)].join(", ")}`);
    }
  }

  if (config.preferredModels && config.fallbackModels) {
    const overlap = config.preferredModels.filter((m) =>
      config.fallbackModels!.includes(m),
    );
    if (overlap.length > 0) {
      errors.push(`Models in both preferred and fallback: ${overlap.join(", ")}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Personality Insight State Machine
// ---------------------------------------------------------------------------

export type InsightAction = "accept" | "reject" | "supersede";

export function transitionInsightState(
  currentStatus: InsightStatus,
  action: InsightAction,
): InsightStatus {
  switch (action) {
    case "accept":
      if (currentStatus === "proposed") return "accepted";
      return currentStatus;
    case "reject":
      if (currentStatus === "proposed") return "rejected";
      return currentStatus;
    case "supersede":
      if (currentStatus === "proposed" || currentStatus === "accepted")
        return "superseded";
      return currentStatus;
  }
}
