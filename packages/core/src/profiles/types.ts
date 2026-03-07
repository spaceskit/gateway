/**
 * Profile types — agent identity and personality management.
 *
 * A profile defines who an agent *is*: its personality prompt, default
 * skills and actions, preferred model, and security posture. Profiles
 * are versioned through revisions. Experiences propose profile changes
 * via PersonalityInsight; the human reviews and accepts/rejects them.
 *
 * This closes the growth loop described in the manifesto:
 *   Space → Experience → Insight → Profile revision → better agent.
 */

import type { AgentSecurityScope } from "../security/types.js";

// ---------------------------------------------------------------------------
// Agent profiles
// ---------------------------------------------------------------------------

export type ProfileStatus = "active" | "archived";

export interface AgentProfile {
  profileId: string;
  name: string;
  description: string;

  /** The core personality prompt injected into the agent's system context. */
  personalityPrompt: string;

  /** Default skills attached to this profile. */
  defaultSkillIds: string[];
  /** Default actions this profile can execute. */
  defaultActionIds: string[];

  /** Provider and model preferences (hints, not hard locks). */
  providerHint: string;
  modelHint: string;

  /** Whether this profile can act as a space moderator. */
  canModerate: boolean;
  /** Whether this is the default profile for new spaces. */
  isDefault: boolean;

  /**
   * Security scope template: when this agent joins a space,
   * these are the default permissions it starts with.
   */
  defaultSecurityScope?: AgentSecurityScope;

  /** Current active revision number. */
  activeRevision: number;
  status: ProfileStatus;

  /** Source attribution (e.g. "user", "import", "sync"). */
  source: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface AgentProfileRevision {
  profileId: string;
  revision: number;

  name: string;
  description: string;
  personalityPrompt: string;
  defaultSkillIds: string[];
  defaultActionIds: string[];
  providerHint: string;
  modelHint: string;
  canModerate: boolean;
  isDefault: boolean;
  defaultSecurityScope?: AgentSecurityScope;
  source: string;

  /** What triggered this revision (e.g. "manual edit", "insight:ins_abc123"). */
  changeReason: string;

  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Personality insights — the bridge between experiences and profiles
// ---------------------------------------------------------------------------

export type InsightStatus = "proposed" | "accepted" | "rejected" | "superseded";

export interface PersonalityInsight {
  insightId: string;
  /** The experience that produced this insight. */
  experienceId: string;
  /** The space where the experience occurred. */
  spaceId: string;
  /** The profile this insight applies to. */
  profileId: string;
  /** The revision the insight was generated against. */
  baseRevision: number;

  /** The proposed patch to the personality prompt. */
  proposedPromptDelta: string;
  /** Skills to add or remove. */
  addSkillIds: string[];
  removeSkillIds: string[];
  /** Actions to add or remove. */
  addActionIds: string[];
  removeActionIds: string[];

  /** Why this change is being proposed. */
  rationale: string;
  /** Confidence score: how strongly the gateway recommends this change. */
  confidence: number;

  status: InsightStatus;
  /** If accepted, which revision was created. */
  appliedRevision?: number;
  /** If the human edited the insight before applying. */
  humanEditNote?: string;

  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Moderator profiles
// ---------------------------------------------------------------------------

export interface ModeratorPolicy {
  enforceTurnOrder: boolean;
  requireFinalSynthesis: boolean;
  allowDirectAgentDialogue: boolean;
  maxConsecutiveTurnsPerAgent: number;
  interveneOnBudgetThreshold: boolean;
  interveneOnPermissionDenial: boolean;
  interveneOnSecurityViolation: boolean;
}

export interface ModeratorProfile {
  profileId: string;
  name: string;
  description: string;
  /** The moderation prompt (distinct from personality prompt). */
  moderationPrompt: string;
  defaultSkillIds: string[];
  policy: ModeratorPolicy;
  isDefault: boolean;
  status: ProfileStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MODERATOR_POLICY: ModeratorPolicy = {
  enforceTurnOrder: true,
  requireFinalSynthesis: false,
  allowDirectAgentDialogue: false,
  maxConsecutiveTurnsPerAgent: 3,
  interveneOnBudgetThreshold: true,
  interveneOnPermissionDenial: true,
  interveneOnSecurityViolation: true,
};
