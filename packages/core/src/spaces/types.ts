/**
 * Space model — renamed from v1 "Room".
 *
 * A space is a persistent environment where agents collaborate.
 * All v1 room state machine semantics carry forward unchanged.
 */

import type { AgentSecurityScope } from "../security/types.js";

export type SpaceState = "created" | "active" | "paused" | "completed" | "failed";

export type TurnModelStrategy =
  | "sequential_all"
  | "primary_only"
  | "first_success"
  | "round_robin"
  | "parallel_race"
  | "debate_synthesis"
  | "adaptive_auto";

export type CoordinatorRole = "global_coordinator" | "space_moderator";

export interface SpaceConfig {
  id: string;
  /** Immutable, globally unique space identifier used across communication surfaces. */
  spaceUid: string;
  resourceId: string;
  name: string;
  goal?: string;
  orchestratorProfileId?: string;
  templateId?: string;
  turnModel: TurnModelStrategy;
  turnModelConfig?: TurnModelConfig;
  /** Space-level skills applied to all assigned agents (additive). */
  skillIds?: string[];
  agents: SpaceAgentAssignment[];
  capabilities: string[];            // Capability types available in this space
  capabilityOverrides: Record<string, string>;  // capability type -> preferred provider ID
  maxTurns?: number;
  visibility: "shared" | "private";  // For cross-space artifact access
  moderatorProfileId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceAgentAssignment {
  spaceId: string;
  agentId: string;
  profileId: string;
  /** Override the profile's default security scope for this space. */
  securityScope?: AgentSecurityScope;
  role: CoordinatorRole | "participant";
  /** Turn order position (for sequential strategies). */
  turnOrder: number;
  /** Whether this is the primary agent (for primary_only strategy). */
  isPrimary: boolean;
  assignedAt: Date;
  /**
   * Per-space context injected into the agent's prompt at spawn time.
   * Analogous to Claude Code's "spawn prompt" — task-specific instructions
   * layered on top of the agent's profile personality/skills.
   * Example: "Focus only on the database migration. Do not modify the API layer."
   */
  spawnContext?: string;
  /**
   * Additional structured context for this agent in this space.
   * Merged with the profile's default context at runtime.
   */
  contextOverrides?: Record<string, unknown>;
}

export type SpaceResourceType = "folder" | "url";

export interface SpaceResource {
  resourceId: string;
  spaceId: string;
  uri: string;
  type: SpaceResourceType;
  label?: string;
  addedAt: Date;
}

/** A declared dependency between two turns/tasks within a space. */
export interface TaskDependency {
  /** The turn/task that is blocked until the dependency resolves. */
  blockedTurnId: string;
  /** The turn/task that must complete before blockedTurnId can proceed. */
  dependsOnTurnId: string;
  /** When the dependency was declared. */
  declaredAt: Date;
  /** When the dependency was resolved (null if still pending). */
  resolvedAt: Date | null;
}

/** Detailed turn model configuration per strategy. */
export interface TurnModelConfig {
  strategy: TurnModelStrategy;
  /** For DEBATE_SYNTHESIS: number of rounds before synthesis. */
  debateRounds?: number;
  /** For DEBATE_SYNTHESIS: who synthesizes (empty = moderator). */
  synthesizerAgentId?: string;
  /** For PARALLEL_RACE: how long to wait for all agents. */
  raceTimeoutSeconds?: number;
  /** For ROUND_ROBIN: max full rotations (0 = unlimited). */
  maxRounds?: number;
  /** For ADAPTIVE_AUTO: e.g. "cost_optimize", "quality_first". */
  adaptationPolicy?: string;
  /** For SEQUENTIAL_ALL: whether one agent failing stops the chain. */
  stopOnFirstFailure?: boolean;
  /** Enable or disable coordinator-led master mode for this space. */
  masterModeEnabled?: boolean;
  /** Per-space override for the master planner prompt template. */
  masterPlannerPromptTemplate?: string;
  /** Per-space override for the guest prompt template. */
  guestAgentPromptTemplate?: string;
  /** Enable/disable structured peer review in master mode (default true). */
  peerReviewEnabled?: boolean;
  /** Peer-review topology (phase-1 supports ring only). */
  peerReviewTopology?: "ring";
  /** Per-space override for the peer review prompt template. */
  peerReviewPromptTemplate?: string;
  /** Per-space override for the master synthesis prompt template. */
  masterSynthesisPromptTemplate?: string;
}

export interface SpaceSnapshot {
  spaceId: string;
  state: SpaceState;
  turnCount: number;
  activeAgentId?: string;
  pendingFeedback: number;
  lastActivityAt: Date;
}

/** Artifact produced by a space — addressable across spaces on the same resource. */
export interface SpaceArtifact {
  id: string;
  spaceId: string;
  resourceId: string;
  type: "summary" | "decision" | "document" | "structured" | "export";
  title: string;
  content: string | Record<string, unknown>;
  tags: string[];
  visibility: "shared" | "private";
  createdAt: Date;
  updatedAt: Date;
}

/** Inter-agent communication patterns (unchanged from v1). */
export type InterAgentMode = "handoff" | "assign" | "message";

export interface InterAgentCall {
  mode: InterAgentMode;
  sourceAgentId: string;
  targetAgentId: string;
  payload: string;
  lineageId: string;
  hopCount: number;
  maxHops: number;
}
