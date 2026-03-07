/**
 * Agent-as-Tool — allows agents to delegate tasks to other agents.
 *
 * Creates ToolDefinitions that, when invoked by an agent, trigger
 * execution in a delegation space via SpaceManager. Supports:
 * - "delegate_to_agent": Full task delegation
 * - "ask_agent": Quick question/answer
 * - Lineage tracking via hop count
 */

import type { ToolDefinition } from "./model-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDelegationConfig {
  /** Available agents for delegation. */
  availableAgents: Array<{
    agentId: string;
    name: string;
    description: string;
  }>;
  /** Max delegation depth (hop count). Default: 5. */
  maxHops?: number;
  /** Current hop count (for loop prevention). */
  currentHopCount?: number;
}

export interface DelegationRequest {
  targetAgentId: string;
  task: string;
  context?: string;
  delegatingAgentId: string;
  delegatingSpaceId: string;
  lineageId: string;
  hopCount: number;
}

export interface DelegationResult {
  success: boolean;
  turnId?: string;
  delegationSpaceId?: string;
  response?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * Create delegation tool definitions for an agent.
 * Returns tools that appear in the agent's tool list during generation.
 */
export function createDelegationTools(config: AgentDelegationConfig): ToolDefinition[] {
  const agentList = config.availableAgents
    .map((a) => `- ${a.agentId}: ${a.description}`)
    .join("\n");

  const tools: ToolDefinition[] = [
    {
      name: "delegate_to_agent",
      description: `Delegate a task to another agent for detailed work. The agent will work independently and return results.\n\nAvailable agents:\n${agentList}`,
      inputSchema: {
        type: "object",
        properties: {
          targetAgentId: {
            type: "string",
            description: "ID of the agent to delegate to",
            enum: config.availableAgents.map((a) => a.agentId),
          },
          task: {
            type: "string",
            description: "Clear description of the task to delegate",
          },
          context: {
            type: "string",
            description: "Background context or constraints for the task",
          },
        },
        required: ["targetAgentId", "task"],
      },
    },
    {
      name: "ask_agent",
      description: `Ask another agent a quick question. Use for simple queries that don't need full task delegation.\n\nAvailable agents:\n${agentList}`,
      inputSchema: {
        type: "object",
        properties: {
          targetAgentId: {
            type: "string",
            description: "ID of the agent to ask",
            enum: config.availableAgents.map((a) => a.agentId),
          },
          question: {
            type: "string",
            description: "The question to ask",
          },
        },
        required: ["targetAgentId", "question"],
      },
    },
  ];

  return tools;
}

export interface DelegationValidationResult {
  allowed: boolean;
  /** Hard rejection reason (e.g., self-delegation) — caller should NOT allow override */
  rejection?: string;
  /** Soft gate — caller should pause for user approval via feedback checkpoint */
  gate?: "loop_guard";
  /** Description for the feedback checkpoint */
  gateDescription?: string;
}

/**
 * Validate a delegation request against hop limits.
 * Returns a structured result indicating whether the delegation is allowed,
 * hard-rejected, or requires a user-approval gate (loop_guard).
 */
export function validateDelegation(
  request: DelegationRequest,
  maxHops: number,
): DelegationValidationResult {
  if (request.targetAgentId === request.delegatingAgentId) {
    return { allowed: false, rejection: "Delegation rejected: agent cannot delegate to itself" };
  }
  if (request.hopCount >= maxHops) {
    return {
      allowed: false,
      gate: "loop_guard",
      gateDescription: `Agent delegation chain reached maximum hop count (${maxHops}). Lineage: ${request.lineageId}. Approve to allow one more hop, or reject to stop.`,
    };
  }
  return { allowed: true };
}
