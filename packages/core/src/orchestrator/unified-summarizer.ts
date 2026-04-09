/**
 * Unified Summarizer — LLM-powered synthesis for multi-agent orchestration results.
 *
 * Replaces the naive `buildSummaryText()` heuristic with a model-generated
 * summary that keys on turnModel + conversationTopology for prompt framing.
 *
 * Pattern: optional ModelProvider injection with heuristic fallback on failure.
 */

import type { ModelProvider } from "../agents/model-provider.js";
import type { ConversationTopology, TurnModelStrategy } from "../spaces/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SummaryParticipantData {
  agentId: string;
  isPrimary: boolean;
  status: "pending" | "completed" | "failed";
  finalMessage?: string;
  error?: string;
}

export interface SynthesizeSummaryInput {
  conversationTopology: ConversationTopology;
  turnModel: TurnModelStrategy;
  userInput: string;
  participants: SummaryParticipantData[];
  peerReview: {
    enabled: boolean;
    status: "not_run" | "skipped" | "completed" | "degraded";
    completed: number;
    assignments: number;
    failed: number;
  };
  highlights: Array<{ agentId: string; text: string }>;
}

export interface SynthesizeSummaryDeps {
  modelProvider: ModelProvider;
  modelId: string;
}

// ---------------------------------------------------------------------------
// Prompt framing
// ---------------------------------------------------------------------------

function resolveFraming(
  turnModel: TurnModelStrategy,
  topology: ConversationTopology,
): string {
  if (turnModel === "debate_synthesis") {
    return "Debaters argued opposing positions; a synthesizer produced a balanced conclusion.";
  }
  if (turnModel === "primary_only" && topology === "broadcast_team") {
    return "A coordinator delegated tasks to worker agents, collected reports, and produced a synthesis.";
  }
  if (turnModel === "sequential_all" && topology === "shared_team_chat") {
    return "Agents collaborated in a shared discussion, each building on prior contributions.";
  }
  if (topology === "direct") {
    return "A single agent responded to the user's request.";
  }
  // Fallback
  return "Multiple agents collaborated to address the user's request.";
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const MAX_INPUT_CHARS = 500;
const MAX_MESSAGE_CHARS = 500;
const MAX_PARTICIPANTS = 5;
const MAX_HIGHLIGHTS = 5;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function buildPromptMessages(
  input: SynthesizeSummaryInput,
): { system: string; user: string } {
  const framing = resolveFraming(input.turnModel, input.conversationTopology);

  const system = [
    "You are an orchestration summarizer. You receive the results of a multi-agent task and produce a concise, coherent summary for the user.",
    "",
    `Context: ${framing}`,
    "",
    "Rules:",
    "- Write 1-3 sentences that capture the key outcome.",
    "- If agents failed, mention it briefly.",
    "- Do not use markdown formatting.",
    "- Be factual and concise.",
  ].join("\n");

  const userParts: string[] = [];

  userParts.push(`User request: ${truncate(input.userInput, MAX_INPUT_CHARS)}`);
  userParts.push("");

  const participants = input.participants.slice(0, MAX_PARTICIPANTS);
  for (const p of participants) {
    const label = p.isPrimary ? `${p.agentId} (primary)` : p.agentId;
    if (p.status === "failed") {
      userParts.push(`${label}: FAILED — ${p.error ?? "unknown error"}`);
    } else if (p.finalMessage) {
      userParts.push(`${label}: ${truncate(p.finalMessage, MAX_MESSAGE_CHARS)}`);
    } else {
      userParts.push(`${label}: completed (no message)`);
    }
  }

  if (input.peerReview.status === "completed" || input.peerReview.status === "degraded") {
    userParts.push("");
    userParts.push(`Peer review: ${input.peerReview.completed}/${input.peerReview.assignments} reviews completed`);
    if (input.peerReview.failed > 0) {
      userParts.push(`Peer review failures: ${input.peerReview.failed}`);
    }
  }

  const highlights = input.highlights.slice(0, MAX_HIGHLIGHTS);
  if (highlights.length > 0) {
    userParts.push("");
    userParts.push("Key highlights:");
    for (const h of highlights) {
      userParts.push(`- [${h.agentId}] ${truncate(h.text, MAX_MESSAGE_CHARS)}`);
    }
  }

  return { system, user: userParts.join("\n") };
}

// ---------------------------------------------------------------------------
// Core synthesis function
// ---------------------------------------------------------------------------

/**
 * Synthesize a readable summary from multi-agent orchestration results.
 *
 * Throws on empty LLM response so callers can fall back to heuristic.
 */
export async function synthesizeSummary(
  input: SynthesizeSummaryInput,
  deps: SynthesizeSummaryDeps,
): Promise<string> {
  const { system, user } = buildPromptMessages(input);

  const result = await deps.modelProvider.generate(deps.modelId, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 300,
    temperature: 0.3,
  });

  const text = result.message.content.trim();
  if (!text) {
    throw new Error("Summarizer returned empty response");
  }
  return text;
}

// Exported for testing
export { resolveFraming, buildPromptMessages };
