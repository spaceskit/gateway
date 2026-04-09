import type { ConversationTopology, TurnModelStrategy } from "./types.js";

export interface PromptPackDefinition {
  id: string;
  title: string;
  topology: ConversationTopology;
  // Conversation-level system prompt appended after agent/workspace context.
  conversationPrompt: string;
  // Broadcast-team prompt packs can override master-mode templates.
  masterPlannerPromptTemplate?: string;
  guestAgentPromptTemplate?: string;
  masterSynthesisPromptTemplate?: string;
  peerReviewEnabled?: boolean;
}

export const PROMPT_PACKS: PromptPackDefinition[] = [
  {
    id: "single-agent-v1",
    title: "Single Agent",
    topology: "direct",
    conversationPrompt: [
      "Conversation topology: direct single-agent chat.",
      "Reply directly to the user.",
      "Do not simulate hidden collaborators or committee workflows.",
    ].join("\n"),
  },
  {
    id: "shared-team-chat-v1",
    title: "Shared Team Chat",
    topology: "shared_team_chat",
    conversationPrompt: [
      "Conversation topology: shared team chat.",
      "Multiple agents may answer the same user turn in parallel.",
      "Keep your response self-contained and easy for both the user and peer agents to build on.",
      "If you coordinate with another agent, stay within the current lineage and avoid unnecessary loops.",
    ].join("\n"),
  },
  {
    id: "broadcast-team-v1",
    title: "Broadcast Team",
    topology: "broadcast_team",
    conversationPrompt: [
      "Conversation topology: broadcast team.",
      "The coordinator is responsible for the single final user-facing answer.",
      "Worker agents should produce concise internal reports for synthesis rather than polished end-user prose.",
    ].join("\n"),
    masterPlannerPromptTemplate: [
      "You are the coordinator for a broadcast-team turn.",
      "Plan the worker fan-out and return strict JSON only.",
      "Use this exact schema:",
      "{\"globalInstruction\":\"string\",\"guestInstructions\":{\"<guest_agent_id>\":\"string\"}}",
      "Do not include markdown, prose, or code fences.",
      "",
      "User input:",
      "{{user_input}}",
      "",
      "Relevant prior knowledge (if any):",
      "{{global_instruction}}",
      "",
      "Workers:",
      "{{guest_list}}",
    ].join("\n"),
    guestAgentPromptTemplate: [
      "You are a worker agent in a broadcast-team turn.",
      "Return a concise internal report for the coordinator.",
      "Do not address the user directly.",
      "",
      "Original user input:",
      "{{user_input}}",
      "",
      "Coordinator instruction:",
      "{{global_instruction}}",
      "",
      "Your worker id:",
      "{{guest_agent_id}}",
      "",
      "Your delegated task:",
      "{{guest_instruction}}",
    ].join("\n"),
    masterSynthesisPromptTemplate: [
      "You are the coordinator for a broadcast-team turn and must produce the only user-facing reply.",
      "Original user input:",
      "{{user_input}}",
      "",
      "Workers:",
      "{{guest_list}}",
      "",
      "Worker reports:",
      "{{guest_reports}}",
      "",
      "Resolve disagreement explicitly and produce one coherent final answer for the user.",
    ].join("\n"),
    peerReviewEnabled: false,
  },
];

const PROMPT_PACK_BY_ID = new Map(PROMPT_PACKS.map((pack) => [pack.id, pack]));

const LEGACY_TURN_MODEL_TO_TOPOLOGY: Record<TurnModelStrategy, ConversationTopology> = {
  sequential_all: "shared_team_chat",
  primary_only: "direct",
  first_success: "direct",
  round_robin: "shared_team_chat",
  parallel_race: "shared_team_chat",
  debate_synthesis: "broadcast_team",
  adaptive_auto: "direct",
};

export function resolveConversationTopology(
  topology: string | undefined,
  turnModel?: TurnModelStrategy,
): ConversationTopology {
  const normalized = topology?.trim().toLowerCase();
  if (normalized === "direct") return "direct";
  if (normalized === "shared_team_chat") return "shared_team_chat";
  if (normalized === "broadcast_team") return "broadcast_team";
  if (turnModel) {
    return LEGACY_TURN_MODEL_TO_TOPOLOGY[turnModel] ?? "direct";
  }
  return "direct";
}

export function defaultTurnModelForTopology(topology: ConversationTopology): TurnModelStrategy {
  switch (topology) {
    case "shared_team_chat":
      return "sequential_all";
    case "broadcast_team":
      return "primary_only";
    case "direct":
    default:
      return "primary_only";
  }
}

export function defaultPromptPackIdForTopology(topology: ConversationTopology): string {
  switch (topology) {
    case "shared_team_chat":
      return "shared-team-chat-v1";
    case "broadcast_team":
      return "broadcast-team-v1";
    case "direct":
    default:
      return "single-agent-v1";
  }
}

export function getPromptPackById(id?: string | null): PromptPackDefinition | null {
  if (!id) return null;
  return PROMPT_PACK_BY_ID.get(id.trim()) ?? null;
}

export function resolvePromptPack(
  promptPackId: string | undefined,
  topology: ConversationTopology,
): PromptPackDefinition {
  return getPromptPackById(promptPackId)
    ?? PROMPT_PACK_BY_ID.get(defaultPromptPackIdForTopology(topology))!;
}
