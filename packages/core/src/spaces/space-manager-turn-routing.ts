import type { TurnExecutionIdentity } from "./space-manager-normalizers.js";
import {
  normalizeAgentIdentifier,
  normalizeAgentIdentifiers,
  normalizeConversationTopology,
} from "./space-manager-normalizers.js";
import { sortSpaceAgentAssignments } from "./space-manager-master-mode-helpers.js";
import type { ActiveSpace } from "./space-manager-agent-sessions.js";
import type {
  ConversationTopology,
  SpaceAgentAssignment,
  SpaceConfig,
  TurnModelStrategy,
} from "./types.js";

export function resolveTurnScopedSpace(
  space: ActiveSpace,
  targetAgentId?: string,
  executionIdentity?: TurnExecutionIdentity,
): ActiveSpace {
  const conversationTopology = normalizeConversationTopology(executionIdentity?.conversationTopology);
  const hasSingleTarget = normalizeAgentIdentifier(targetAgentId) !== undefined;
  const targetAgentIds = hasSingleTarget
    ? []
    : normalizeAgentIdentifiers(executionIdentity?.targetAgentIds);
  const hasAgentSubset = targetAgentIds.length > 0;

  if (!conversationTopology && !hasAgentSubset) {
    return space;
  }

  const agents = hasAgentSubset
    ? filterAgentsByTargetIds(space.config.agents, targetAgentIds)
    : space.config.agents;
  const nextConfig: SpaceConfig = {
    ...space.config,
    agents,
    ...(conversationTopology ? { conversationTopology } : {}),
  };

  if (conversationTopology) {
    const turnModel = turnModelForConversationTopology(conversationTopology);
    nextConfig.turnModel = turnModel;
    nextConfig.turnModelConfig = {
      ...(space.config.turnModelConfig ?? { strategy: turnModel }),
      strategy: turnModel,
      masterModeEnabled: conversationTopology === "broadcast_team",
    };
  }

  return {
    ...space,
    config: nextConfig,
  };
}

export function selectAgents(
  space: ActiveSpace,
  targetAgentId?: string,
): SpaceAgentAssignment[] {
  const agents = space.config.agents;

  if (targetAgentId) {
    const normalizedTargetAgentId = normalizeAgentIdentifier(targetAgentId);
    if (normalizedTargetAgentId) {
      const match = agents.find(
        (agent) => normalizeAgentIdentifier(agent.agentId) === normalizedTargetAgentId,
      );
      if (match) {
        return [match];
      }
    }
  }

  switch (space.config.turnModel) {
    case "primary_only": {
      const primary = agents.find((agent) => agent.isPrimary);
      return primary ? [primary] : agents.slice(0, 1);
    }

    case "round_robin": {
      if (agents.length === 0) return [];
      const index = space.roundRobinIndex % agents.length;
      space.roundRobinIndex++;
      return [agents[index]!];
    }

    case "sequential_all":
    case "first_success":
      return [...agents].sort((lhs, rhs) => lhs.turnOrder - rhs.turnOrder);

    case "parallel_race":
    case "debate_synthesis":
      return [...agents];

    case "adaptive_auto":
      return [...agents].sort((lhs, rhs) => lhs.turnOrder - rhs.turnOrder);

    default:
      return agents.slice(0, 1);
  }
}

function filterAgentsByTargetIds(
  agents: SpaceAgentAssignment[],
  targetAgentIds: string[],
): SpaceAgentAssignment[] {
  if (targetAgentIds.length === 0) return agents;
  const targets = new Set(targetAgentIds);
  return sortSpaceAgentAssignments(agents).filter((assignment) => {
    const agentId = normalizeAgentIdentifier(assignment.agentId);
    return Boolean(agentId && targets.has(agentId));
  });
}

function turnModelForConversationTopology(
  conversationTopology: ConversationTopology,
): TurnModelStrategy {
  switch (conversationTopology) {
    case "broadcast_team":
    case "direct":
      return "primary_only";
    case "shared_team_chat":
      return "sequential_all";
  }
}
