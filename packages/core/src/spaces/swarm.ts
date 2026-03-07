/**
 * Swarm pattern — peer-to-peer agent handoffs.
 *
 * Enables agents to directly hand off tasks to peers without a coordinator.
 * Each agent decides when to hand off and to whom, based on the task context.
 * 40% faster than supervisor pattern for simple delegations (per LangGraph benchmarks).
 *
 * Protocol:
 * 1. Agent A decides it needs help and creates a handoff offer
 * 2. Target agent B receives the offer
 * 3. Agent B accepts or rejects
 * 4. If accepted, Agent B takes over with the provided context
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SwarmHandoffStatus = "pending" | "accepted" | "rejected" | "expired" | "completed";

export interface SwarmHandoff {
  handoffId: string;
  /** Agent initiating the handoff. */
  fromAgentId: string;
  fromSpaceId: string;
  /** Agent receiving the handoff. */
  toAgentId: string;
  toSpaceId?: string;
  /** Context transferred with the handoff. */
  context: string;
  /** Specific task or question for the target agent. */
  task: string;
  status: SwarmHandoffStatus;
  /** Result from the target agent (if completed). */
  result?: string;
  createdAt: Date;
  resolvedAt?: Date;
  /** Timeout in ms. Default: 30000. */
  timeoutMs?: number;
}

export interface SwarmConfig {
  /** Agents participating in the swarm. */
  agents: Array<{
    agentId: string;
    name: string;
    description: string;
    /** Capabilities this agent can handle. */
    capabilities: string[];
  }>;
  /** Max concurrent handoffs per agent. Default: 3. */
  maxConcurrentHandoffs?: number;
  /** Default timeout for handoff acceptance in ms. Default: 30000. */
  defaultTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Swarm Manager
// ---------------------------------------------------------------------------

export class SwarmManager {
  private handoffs = new Map<string, SwarmHandoff>();
  private config: SwarmConfig;

  constructor(config: SwarmConfig) {
    this.config = config;
  }

  /**
   * Create a handoff offer from one agent to another.
   */
  createHandoff(
    fromAgentId: string,
    fromSpaceId: string,
    toAgentId: string,
    task: string,
    context: string,
  ): SwarmHandoff {
    // Validate agents exist in swarm
    const fromAgent = this.config.agents.find((a) => a.agentId === fromAgentId);
    const toAgent = this.config.agents.find((a) => a.agentId === toAgentId);

    if (!fromAgent) throw new Error(`Agent ${fromAgentId} not in swarm`);
    if (!toAgent) throw new Error(`Agent ${toAgentId} not in swarm`);

    // Check concurrent handoff limit
    const maxConcurrent = this.config.maxConcurrentHandoffs ?? 3;
    const active = this.getActiveHandoffsForAgent(fromAgentId);
    if (active.length >= maxConcurrent) {
      throw new Error(`Agent ${fromAgentId} has ${active.length} active handoffs (max: ${maxConcurrent})`);
    }

    const handoff: SwarmHandoff = {
      handoffId: randomUUID(),
      fromAgentId,
      fromSpaceId,
      toAgentId,
      context,
      task,
      status: "pending",
      createdAt: new Date(),
      timeoutMs: this.config.defaultTimeoutMs ?? 30000,
    };

    this.handoffs.set(handoff.handoffId, handoff);
    return handoff;
  }

  /**
   * Accept a pending handoff.
   */
  acceptHandoff(handoffId: string, toSpaceId?: string): SwarmHandoff {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) throw new Error(`Handoff ${handoffId} not found`);
    if (handoff.status !== "pending") throw new Error(`Handoff ${handoffId} is ${handoff.status}, not pending`);

    // Check timeout
    if (this.isExpired(handoff)) {
      handoff.status = "expired";
      throw new Error(`Handoff ${handoffId} has expired`);
    }

    handoff.status = "accepted";
    handoff.toSpaceId = toSpaceId;
    return handoff;
  }

  /**
   * Reject a pending handoff.
   */
  rejectHandoff(handoffId: string, reason?: string): SwarmHandoff {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) throw new Error(`Handoff ${handoffId} not found`);
    if (handoff.status !== "pending") throw new Error(`Handoff ${handoffId} is ${handoff.status}, not pending`);

    handoff.status = "rejected";
    handoff.resolvedAt = new Date();
    if (reason) handoff.result = reason;
    return handoff;
  }

  /**
   * Complete a handoff with a result.
   */
  completeHandoff(handoffId: string, result: string): SwarmHandoff {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) throw new Error(`Handoff ${handoffId} not found`);
    if (handoff.status !== "accepted") throw new Error(`Handoff ${handoffId} is ${handoff.status}, not accepted`);

    handoff.status = "completed";
    handoff.result = result;
    handoff.resolvedAt = new Date();
    return handoff;
  }

  /**
   * Get pending handoffs for a specific agent (incoming).
   */
  getPendingHandoffsFor(agentId: string): SwarmHandoff[] {
    return Array.from(this.handoffs.values())
      .filter((h) => h.toAgentId === agentId && h.status === "pending" && !this.isExpired(h));
  }

  /**
   * Get active handoffs initiated by an agent (outgoing).
   */
  getActiveHandoffsForAgent(agentId: string): SwarmHandoff[] {
    return Array.from(this.handoffs.values())
      .filter((h) => h.fromAgentId === agentId && (h.status === "pending" || h.status === "accepted"));
  }

  /**
   * Find the best agent to hand off to based on task description.
   * Simple keyword matching against agent capabilities.
   */
  findBestAgent(task: string, excludeAgentId?: string): string | null {
    const taskLower = task.toLowerCase();
    let bestAgent: string | null = null;
    let bestScore = 0;

    for (const agent of this.config.agents) {
      if (agent.agentId === excludeAgentId) continue;

      let score = 0;
      for (const cap of agent.capabilities) {
        if (taskLower.includes(cap.toLowerCase())) score++;
      }
      // Also match against agent description
      const descWords = agent.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length > 3 && taskLower.includes(word)) score += 0.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent.agentId;
      }
    }

    return bestAgent;
  }

  /**
   * Clean up expired handoffs.
   */
  cleanupExpired(): number {
    let cleaned = 0;
    for (const [id, handoff] of this.handoffs) {
      // Mark expired pending handoffs
      if (this.isExpired(handoff) && handoff.status === "pending") {
        handoff.status = "expired";
        handoff.resolvedAt = new Date();
        cleaned++;
      }
      // Purge resolved handoffs (completed, rejected, expired) to prevent memory leak
      if (handoff.status === "completed" || handoff.status === "rejected" || handoff.status === "expired") {
        this.handoffs.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  private isExpired(handoff: SwarmHandoff): boolean {
    const timeout = handoff.timeoutMs ?? 30000;
    return Date.now() - handoff.createdAt.getTime() > timeout;
  }
}
