/**
 * Agent Capability Tiers — maps user-facing tier labels to provider/model
 * preferences for agent deployment.
 *
 * Three tiers: local (free, on-device), standard (low-cost cloud),
 * advanced (high-capability cloud). Users reference tiers by natural
 * language labels ("quick", "best", "advanced") and the system resolves
 * to concrete provider/model hints.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityTier = "local" | "standard" | "advanced";

export interface TierProviderHints {
  /** Ordered provider preference (first available wins). */
  providers: string[];
  /** Suggested model hints per provider (optional). */
  modelHints: Record<string, string>;
  /** Expected context window range. */
  contextWindow: { min: number; max: number };
  /** Relative cost class for pre-flight budget checks. */
  costClass: "free" | "low" | "high";
}

export interface TierDefinition {
  id: CapabilityTier;
  /** User-facing labels that map to this tier. */
  userLabels: string[];
  /** Default provider/model resolution strategy. */
  providerHints: TierProviderHints;
}

// ---------------------------------------------------------------------------
// Tier Definitions
// ---------------------------------------------------------------------------

const TIER_DEFINITIONS: readonly TierDefinition[] = [
  {
    id: "local",
    userLabels: ["quick", "basic", "local", "free", "fast", "simple", "on-device"],
    providerHints: {
      providers: ["apple", "ollama", "lmstudio"],
      modelHints: {},
      contextWindow: { min: 4_096, max: 32_768 },
      costClass: "free",
    },
  },
  {
    id: "standard",
    userLabels: ["good", "smart", "standard", "balanced", "default", "moderate"],
    providerHints: {
      providers: ["groq", "openrouter", "together", "mistral"],
      modelHints: {
        openrouter: "anthropic/claude-haiku",
        groq: "llama-3.3-70b-versatile",
      },
      contextWindow: { min: 32_768, max: 128_000 },
      costClass: "low",
    },
  },
  {
    id: "advanced",
    userLabels: ["advanced", "best", "powerful", "thorough", "pro", "expert", "capable"],
    providerHints: {
      providers: ["anthropic", "openai", "openrouter"],
      modelHints: {
        anthropic: "claude-sonnet-4-20250514",
        openai: "gpt-4.1",
        openrouter: "anthropic/claude-sonnet-4",
      },
      contextWindow: { min: 128_000, max: 200_000 },
      costClass: "high",
    },
  },
] as const;

const TIER_MAP = new Map<CapabilityTier, TierDefinition>(
  TIER_DEFINITIONS.map((t) => [t.id, t]),
);

const LABEL_TO_TIER = new Map<string, CapabilityTier>();
for (const tier of TIER_DEFINITIONS) {
  for (const label of tier.userLabels) {
    LABEL_TO_TIER.set(label.toLowerCase(), tier.id);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * All defined capability tiers.
 */
export function getTierDefinitions(): readonly TierDefinition[] {
  return TIER_DEFINITIONS;
}

/**
 * Get a specific tier definition by ID.
 */
export function getTierDefinition(tier: CapabilityTier): TierDefinition {
  const def = TIER_MAP.get(tier);
  if (!def) throw new Error(`Unknown capability tier: ${tier}`);
  return def;
}

/**
 * Resolve a user-facing label (e.g. "best", "quick") to a CapabilityTier.
 * Returns undefined if no match.
 */
export function resolveUserLabel(label: string): CapabilityTier | undefined {
  return LABEL_TO_TIER.get(label.trim().toLowerCase());
}

/**
 * Resolve tier to provider/model hints for agent profile construction.
 */
export function resolveTierProviderHints(tier: CapabilityTier): TierProviderHints {
  return getTierDefinition(tier).providerHints;
}

/**
 * Check if a string is a valid CapabilityTier.
 */
export function isCapabilityTier(value: string): value is CapabilityTier {
  return TIER_MAP.has(value as CapabilityTier);
}

/**
 * Map the legacy suggestModelTier output to a CapabilityTier.
 */
export function legacyTierToCapabilityTier(
  legacy: "fast" | "standard" | "capable",
): CapabilityTier {
  switch (legacy) {
    case "fast":
      return "local";
    case "standard":
      return "standard";
    case "capable":
      return "advanced";
  }
}

// ---------------------------------------------------------------------------
// Built-in Archetype Definitions
// ---------------------------------------------------------------------------

/**
 * Archetype identifiers for built-in space templates.
 */
export type ArchetypeId =
  | "research" | "analysis" | "discussion" | "debate" | "coding"
  | "concierge" | "personal-assistant" | "writing-partner" | "code-companion" | "learning-tutor" | "project-planner";

export interface ArchetypeDefinition {
  id: ArchetypeId;
  name: string;
  description: string;
  topology: "broadcast_team" | "shared_team_chat";
  turnModel: string;
  defaultAgentCount: number;
  coordinatorTier: CapabilityTier;
  workerTier: CapabilityTier;
  tags: string[];
  /** Whether the coordinator is explicitly assigned (broadcast_team). */
  hasCoordinator: boolean;
  masterModeEnabled: boolean;
}

export const ARCHETYPE_DEFINITIONS: readonly ArchetypeDefinition[] = [
  {
    id: "research",
    name: "Research Team",
    description: "Coordinator plans research tasks, workers investigate in parallel, coordinator synthesizes findings.",
    topology: "broadcast_team",
    turnModel: "primary_only",
    defaultAgentCount: 3,
    coordinatorTier: "advanced",
    workerTier: "standard",
    tags: ["research", "investigation", "analysis"],
    hasCoordinator: true,
    masterModeEnabled: true,
  },
  {
    id: "analysis",
    name: "Analysis Team",
    description: "Coordinator decomposes analysis into sub-tasks, analysts work in parallel, coordinator consolidates.",
    topology: "broadcast_team",
    turnModel: "primary_only",
    defaultAgentCount: 3,
    coordinatorTier: "advanced",
    workerTier: "standard",
    tags: ["analysis", "data", "investigation"],
    hasCoordinator: true,
    masterModeEnabled: true,
  },
  {
    id: "discussion",
    name: "Discussion Group",
    description: "Multiple agents discuss a topic in a shared conversation, building on each other's ideas.",
    topology: "shared_team_chat",
    turnModel: "sequential_all",
    defaultAgentCount: 3,
    coordinatorTier: "standard",
    workerTier: "standard",
    tags: ["discussion", "brainstorm", "collaboration"],
    hasCoordinator: false,
    masterModeEnabled: false,
  },
  {
    id: "debate",
    name: "Debate Team",
    description: "Two debaters argue positions, a synthesizer produces a balanced conclusion.",
    topology: "broadcast_team",
    turnModel: "debate_synthesis",
    defaultAgentCount: 3,
    coordinatorTier: "advanced",
    workerTier: "standard",
    tags: ["debate", "argument", "compare", "contrast"],
    hasCoordinator: true,
    masterModeEnabled: false,
  },
  {
    id: "coding",
    name: "Coding Team",
    description: "Developers collaborate in a shared workspace on implementation tasks.",
    topology: "shared_team_chat",
    turnModel: "sequential_all",
    defaultAgentCount: 2,
    coordinatorTier: "advanced",
    workerTier: "advanced",
    tags: ["coding", "development", "programming", "implementation"],
    hasCoordinator: false,
    masterModeEnabled: false,
  },
] as const;

const ARCHETYPE_MAP = new Map<ArchetypeId, ArchetypeDefinition>(
  ARCHETYPE_DEFINITIONS.map((a) => [a.id, a]),
);

/**
 * Get an archetype definition by ID.
 */
export function getArchetypeDefinition(id: ArchetypeId): ArchetypeDefinition | undefined {
  return ARCHETYPE_MAP.get(id);
}

/**
 * Find archetype by fuzzy label match (checks id, name, tags).
 */
export function resolveArchetypeHint(hint: string): ArchetypeDefinition | undefined {
  const lower = hint.trim().toLowerCase();
  // Exact ID match
  const exact = ARCHETYPE_MAP.get(lower as ArchetypeId);
  if (exact) return exact;

  // Name contains
  for (const arch of ARCHETYPE_DEFINITIONS) {
    if (arch.name.toLowerCase().includes(lower)) return arch;
  }

  // Tag match
  for (const arch of ARCHETYPE_DEFINITIONS) {
    if (arch.tags.some((t) => t.includes(lower) || lower.includes(t))) return arch;
  }

  return undefined;
}
