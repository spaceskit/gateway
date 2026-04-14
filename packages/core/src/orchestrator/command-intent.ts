/**
 * Command intent grammar for main screen orchestrator actions.
 * Maps user text commands to gateway operations.
 */

export type CommandIntentType =
  | "list_spaces"
  | "create_space"
  | "add_agent"
  | "remove_agent"
  | "list_agents"
  | "share_space"
  | "orchestrate_task"
  | "check_task_progress"
  | "search_knowledge"
  | "navigate_to_space"
  | "unknown";

export type CommandComplexity = "simple" | "moderate" | "complex";

export interface CommandIntent {
  type: CommandIntentType;
  complexity: CommandComplexity;
  /** Extracted parameters from the command text */
  params: Record<string, string>;
  /** Original raw text */
  rawText: string;
  /** Confidence score 0-1 */
  confidence: number;
}

export interface CommandIntentResult {
  intent: CommandIntent;
  /** Suggested gateway message type to invoke */
  targetMessageType?: string;
  /** Whether this needs model inference or can be dispatched directly */
  requiresInference: boolean;
  details: string;
}

interface IntentPattern {
  type: CommandIntentType;
  complexity: CommandComplexity;
  keywords: string[][];
  confidence: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  { type: "list_spaces", complexity: "simple", keywords: [["list", "space"]], confidence: 1.0 },
  { type: "create_space", complexity: "moderate", keywords: [["create", "space"]], confidence: 1.0 },
  { type: "add_agent", complexity: "moderate", keywords: [["add", "agent"]], confidence: 1.0 },
  { type: "remove_agent", complexity: "moderate", keywords: [["remove", "agent"]], confidence: 1.0 },
  { type: "list_agents", complexity: "simple", keywords: [["list", "agent"]], confidence: 1.0 },
  { type: "share_space", complexity: "complex", keywords: [["share"]], confidence: 0.5 },
  {
    type: "orchestrate_task",
    complexity: "complex",
    keywords: [["research"], ["investigate"], ["orchestrate"], ["coordinate"]],
    confidence: 0.8,
  },
  {
    type: "check_task_progress",
    complexity: "simple",
    keywords: [["task", "progress"], ["check", "progress"], ["task", "status"]],
    confidence: 0.9,
  },
  {
    type: "search_knowledge",
    complexity: "moderate",
    keywords: [["what do we know"], ["search", "knowledge"], ["knowledge"], ["remember"]],
    confidence: 0.8,
  },
  {
    type: "navigate_to_space",
    complexity: "simple",
    keywords: [["open", "space"], ["go to", "space"], ["navigate", "space"]],
    confidence: 0.9,
  },
];

const TARGET_MESSAGE_TYPES: Record<CommandIntentType, string | undefined> = {
  list_spaces: "space.list",
  create_space: "space.create",
  add_agent: "space.add_agent",
  remove_agent: "space.remove_agent",
  list_agents: "space.list_agent_assignments",
  share_space: "space.share_create_invite",
  orchestrate_task: undefined,
  check_task_progress: undefined,
  search_knowledge: undefined,
  navigate_to_space: undefined,
  unknown: undefined,
};

const REQUIRES_INFERENCE: Record<CommandIntentType, boolean> = {
  list_spaces: false,
  create_space: true,
  add_agent: true,
  remove_agent: false,
  list_agents: false,
  share_space: true,
  orchestrate_task: true,
  check_task_progress: true,
  search_knowledge: true,
  navigate_to_space: true,
  unknown: true,
};

/**
 * Extract quoted strings from text as named params.
 * First quoted string becomes params.name, subsequent become params.param1, params.param2, etc.
 */
function extractQuotedParams(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  const matches = text.match(/"([^"]+)"/g);
  if (!matches) return params;

  for (let i = 0; i < matches.length; i++) {
    const value = matches[i].slice(1, -1);
    if (i === 0) {
      params.name = value;
    } else {
      params[`param${i}`] = value;
    }
  }
  return params;
}

/**
 * Parse a text command into an intent.
 * Uses simple keyword matching -- NOT LLM inference.
 * Returns unknown type for unrecognized commands.
 */
export function parseCommandIntent(text: string): CommandIntent {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const keywordSearchText = lower.replace(/"[^"]*"/g, "").replace(/\s+/g, " ").trim();
  const params = extractQuotedParams(trimmed);

  for (const pattern of INTENT_PATTERNS) {
    for (const keywordGroup of pattern.keywords) {
      const allMatch = keywordGroup.every((kw) => keywordSearchText.includes(kw));
      if (allMatch) {
        return {
          type: pattern.type,
          complexity: pattern.complexity,
          params,
          rawText: trimmed,
          confidence: pattern.confidence,
        };
      }
    }
  }

  return {
    type: "unknown",
    complexity: "simple",
    params,
    rawText: trimmed,
    confidence: 0,
  };
}

/**
 * Route a parsed intent to the appropriate gateway operation.
 */
export function routeCommandIntent(intent: CommandIntent): CommandIntentResult {
  const targetMessageType = TARGET_MESSAGE_TYPES[intent.type];
  const requiresInference = REQUIRES_INFERENCE[intent.type];

  const details =
    intent.type === "unknown"
      ? "Unrecognized command; requires model inference to determine action."
      : !targetMessageType
        ? "Intent recognized and reserved for concierge inference routing."
      : `Mapped to ${targetMessageType}${requiresInference ? " (needs inference for params)" : ""}`;

  return {
    intent,
    targetMessageType,
    requiresInference,
    details,
  };
}

/**
 * Suggest model tier based on command complexity.
 * Simple -> cheap/fast model, Complex -> capable model.
 */
export function suggestModelTier(complexity: CommandComplexity): "fast" | "standard" | "capable" {
  switch (complexity) {
    case "simple":
      return "fast";
    case "moderate":
      return "standard";
    case "complex":
      return "capable";
  }
}
