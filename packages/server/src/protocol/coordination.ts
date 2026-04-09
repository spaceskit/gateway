// ---------------------------------------------------------------------------
// Inter-agent messaging (bidirectional)
// ---------------------------------------------------------------------------

/**
 * Send a message directly to a specific agent within a space.
 * Does not consume a turn slot — used for coordination signals like
 * "I'm working on X", "I need your output from turn Y", etc.
 */
export interface AgentMessagePayload {
  spaceId: string;
  spaceUid: string;
  /** Sending agent ID. Set by the gateway if the sender is authenticated as an agent. */
  fromAgentId: string;
  /** Target agent ID. Use "*" for broadcast to all agents in the space. */
  toAgentId: string;
  /** Message content (natural language or structured JSON stringified). */
  content: string;
  /** Optional structured metadata (e.g. { ref: "turn-42", kind: "dependency_ready" }). */
  metadata?: Record<string, unknown>;
}

/**
 * Notify an idle agent to resume work.
 * Sent by the coordinator or lead agent when a dependency is resolved
 * or when the agent has been idle too long.
 */
export interface AgentPokePayload {
  spaceId: string;
  spaceUid: string;
  /** Agent to poke. */
  targetAgentId: string;
  /** Reason for the poke (human-readable). */
  reason: string;
  /** Optional: turn ID that unblocked the agent. */
  unblockedByTurnId?: string;
}

/**
 * Gateway → Client: agent idle notification.
 * Emitted when an agent's runtime transitions to idle state and stays
 * idle for longer than the configured threshold.
 */
export interface AgentIdlePayload {
  spaceId: string;
  spaceUid: string;
  agentId: string;
  /** How long the agent has been idle, in milliseconds. */
  idleDurationMs: number;
  /** The last turn ID this agent executed, if any. */
  lastTurnId?: string;
}

// ---------------------------------------------------------------------------
// Task dependencies
// ---------------------------------------------------------------------------

/**
 * Declare a dependency between tasks/turns within a space.
 * The gateway will hold `blockedTurnId` until `dependsOnTurnId` completes.
 */
export interface TaskDependencyPayload {
  spaceId: string;
  spaceUid: string;
  /** The turn/task that is blocked. */
  blockedTurnId: string;
  /** The turn/task that must complete first. */
  dependsOnTurnId: string;
}

/**
 * Gateway → Client: dependency resolved notification.
 */
export interface TaskDependencyResolvedPayload {
  spaceId: string;
  spaceUid: string;
  /** The turn that was blocked and is now unblocked. */
  unblockedTurnId: string;
  /** The turn that completed, resolving the dependency. */
  resolvedByTurnId: string;
}
