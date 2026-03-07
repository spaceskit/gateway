/**
 * Experience types — structured reflections produced by spaces.
 *
 * An experience captures what happened in a space: the goal, outcomes,
 * agent performance observations, and suggestions for profile evolution.
 *
 * Experiences are the mechanism for identity continuity. When an agent
 * enters a new space, the gateway selects relevant experiences and
 * injects them alongside the agent's personality prompt. The gateway
 * curates what to surface — not the agent.
 */

export type ExperienceStatus = "draft" | "accepted" | "rejected" | "archived";

export interface AgentObservation {
  agentId: string;
  profileId: string;
  /** What this agent did well or poorly. */
  observation: string;
  /** Optional suggestion for profile adjustment. */
  profileDeltaSuggestion?: string;
  /**
   * Relevance score: how much this observation should influence
   * future context assembly. 0.0 = ignore, 1.0 = always include.
   */
  relevance: number;
}

export interface Experience {
  experienceId: string;
  spaceId: string;
  resourceId: string;
  status: ExperienceStatus;

  /** What the space was trying to do. */
  goal: string;
  /** Compressed narrative of what happened. */
  summary: string;
  /** What worked well. */
  strengths: string[];
  /** What didn't work or could improve. */
  weaknesses: string[];
  /** Specific observations about agent performance. */
  agentObservations: AgentObservation[];
  /** Free-form tags for retrieval. */
  tags: string[];

  /** Path to the .md file on disk (human-readable, editable). */
  sourcePath: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface ScoredExperience {
  experience: Experience;
  relevanceScore: number;
  /** Why this experience was selected. */
  matchReason: string;
}
