/**
 * Workbench Fixtures
 *
 * Seed data definitions for the workbench gateway.
 * Creates boilerplate spaces, profiles, and agent assignments.
 */

import type { GatewayClient } from "./client.js";

export interface SeededFixtures {
  chatSpace: { id: string; spaceUid: string };
  mcpSpace: { id: string; spaceUid: string };
  orchestratorSpace: { id: string; spaceUid: string };
  profileId: string;
}

/**
 * Create all seed fixtures via the gateway client API.
 * Idempotent — uses fixed IDs so re-running won't duplicate.
 */
export async function seedFixtures(
  client: GatewayClient,
): Promise<SeededFixtures> {
  // Create a shared agent definition for bench agents.
  const profileResult = await client.createAgentDefinition({
    name: "Workbench Agent",
    instructions:
      "You are a test agent for the workbench. Respond briefly and helpfully.",
  });
  const profileId = profileResult.agentDefinition.agentDefinitionId;

  // Layer 1: Simple chat space (1 agent)
  const chatSpace = await client.createSpace({
    name: "bench-chat",
    resourceId: "resource:workbench",
    goal: "Simple chat round-trip testing",
    initialAgents: [
      {
        agentId: `bench-chat-agent`,
        profileId,
        role: "participant" as const,
        isPrimary: true,
      },
    ],
  });

  // Layer 2: MCP-enabled space
  const mcpSpace = await client.createSpace({
    name: "bench-mcp",
    resourceId: "resource:workbench",
    goal: "MCP tool invocation testing",
    initialAgents: [
      {
        agentId: `bench-mcp-agent`,
        profileId,
        role: "participant" as const,
        isPrimary: true,
      },
    ],
  });

  // Layer 3: Multi-agent orchestrator space
  const orchestratorSpace = await client.createSpace({
    name: "bench-orchestrator",
    resourceId: "resource:workbench",
    goal: "Multi-agent orchestration testing",
    turnModel: "sequential_all",
    initialAgents: [
      {
        agentId: `bench-orch-primary`,
        profileId,
        role: "global_coordinator" as const,
        isPrimary: true,
      },
      {
        agentId: `bench-orch-worker`,
        profileId,
        role: "participant" as const,
        isPrimary: false,
      },
    ],
  });

  return {
    chatSpace: {
      id: chatSpace.id,
      spaceUid: chatSpace.spaceUid ?? chatSpace.id,
    },
    mcpSpace: {
      id: mcpSpace.id,
      spaceUid: mcpSpace.spaceUid ?? mcpSpace.id,
    },
    orchestratorSpace: {
      id: orchestratorSpace.id,
      spaceUid: orchestratorSpace.spaceUid ?? orchestratorSpace.id,
    },
    profileId,
  };
}
