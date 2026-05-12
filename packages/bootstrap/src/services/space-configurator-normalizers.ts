import type { TurnModelStrategy } from "@spaceskit/core";
import type {
  CommunicationMode,
  ConversationTopology,
  PresetDetail,
  PresetSource,
  PresetSummary,
  TemplateAgentDefinition,
  TemplateAgentProfileBinding,
} from "./space-configurator-service.js";

export interface StoredTemplateConfig {
  schemaVersion: number;
  communicationMode: CommunicationMode;
  turnModel: TurnModelStrategy;
  baseAgents: TemplateAgentDefinition[];
  agentPresetIds: string[];
  tags: string[];
  metadata: {
    createdBy: string;
    source: PresetSource;
    category?: string;
    complexityTier?: string;
    icon?: string;
    featured?: boolean;
    sortOrder?: number;
  };
}

export interface StoredAgentPresetConfig {
  schemaVersion: number;
  defaultAgents: TemplateAgentDefinition[];
  tags: string[];
  metadata: {
    createdBy: string;
    source: PresetSource;
  };
}

export const COMMUNICATION_MODE_TO_TURN_MODEL: Record<CommunicationMode, TurnModelStrategy> = {
  async_notes: "sequential_all",
  chat_first: "primary_only",
  structured_handoff: "round_robin",
};

export const TURN_MODEL_TO_COMMUNICATION_MODE: Record<TurnModelStrategy, CommunicationMode> = {
  sequential_all: "async_notes",
  primary_only: "chat_first",
  first_success: "chat_first",
  round_robin: "structured_handoff",
  parallel_race: "structured_handoff",
  debate_synthesis: "structured_handoff",
  adaptive_auto: "chat_first",
};

const COMMUNICATION_MODE_TO_CONVERSATION_TOPOLOGY: Record<CommunicationMode, ConversationTopology> = {
  async_notes: "shared_team_chat",
  chat_first: "direct",
  structured_handoff: "broadcast_team",
};

const CONVERSATION_TOPOLOGY_TO_PROMPT_PACK_ID: Record<ConversationTopology, string> = {
  direct: "single-agent-v1",
  shared_team_chat: "shared-team-chat-v1",
  broadcast_team: "broadcast-team-v1",
};

export function toPresetSummary(detail: PresetDetail): PresetSummary {
  return {
    presetId: detail.presetId,
    kind: detail.kind,
    title: detail.title,
    description: detail.description,
    source: detail.source,
    version: detail.version,
    tags: detail.tags,
  };
}

export function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeTemplateAgents(input: TemplateAgentDefinition[]): TemplateAgentDefinition[] {
  return input
    .filter((entry) => typeof entry?.agentId === "string")
    .map((entry, index) => {
      const profileBinding: TemplateAgentProfileBinding = entry.profileBinding === "gateway_default_main"
        ? "gateway_default_main"
        : "explicit";
      return {
        agentId: entry.agentId.trim(),
        profileId: (entry.profileId ?? "").trim() || undefined,
        profileBinding,
        role: entry.role ?? "participant",
        turnOrder: typeof entry.turnOrder === "number" ? entry.turnOrder : index,
        isPrimary: entry.isPrimary ?? false,
      };
    })
    .filter((entry) => entry.agentId.length > 0);
}

export function conversationTopologyForCommunicationMode(mode: CommunicationMode): ConversationTopology {
  return COMMUNICATION_MODE_TO_CONVERSATION_TOPOLOGY[mode] ?? "direct";
}

export function promptPackIdForConversationTopology(topology: ConversationTopology): string {
  return CONVERSATION_TOPOLOGY_TO_PROMPT_PACK_ID[topology] ?? "single-agent-v1";
}

export function parseTemplateConfig(rawJson: string): StoredTemplateConfig {
  const fallback: StoredTemplateConfig = {
    schemaVersion: 1,
    communicationMode: "chat_first",
    turnModel: "primary_only",
    baseAgents: [],
    agentPresetIds: [],
    tags: [],
    metadata: {
      createdBy: "unknown",
      source: "user",
    },
  };

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const communicationMode = normalizeCommunicationMode(parsed.communicationMode);
    const turnModel = normalizeTurnModel(parsed.turnModel)
      ?? COMMUNICATION_MODE_TO_TURN_MODEL[communicationMode];
    const baseAgents = normalizeTemplateAgents(
      (parsed.baseAgents as TemplateAgentDefinition[] | undefined)
        ?? (parsed.agents as TemplateAgentDefinition[] | undefined)
        ?? [],
    );
    const agentPresetIds = normalizeStringArray(parsed.agentPresetIds);
    const tags = normalizeStringArray(parsed.tags);

    const metadataCandidate = parsed.metadata;
    const metadata = (typeof metadataCandidate === "object" && metadataCandidate !== null)
      ? metadataCandidate as Record<string, unknown>
      : {};

    return {
      schemaVersion: Number(parsed.schemaVersion ?? 1) || 1,
      communicationMode,
      turnModel,
      baseAgents,
      agentPresetIds,
      tags,
      metadata: {
        createdBy: typeof metadata.createdBy === "string" ? metadata.createdBy : "unknown",
        source: metadata.source === "system" ? "system" : "user",
        category: typeof metadata.category === "string" ? metadata.category : undefined,
        complexityTier: typeof metadata.complexityTier === "string" ? metadata.complexityTier : undefined,
        icon: typeof metadata.icon === "string" ? metadata.icon : undefined,
        featured: typeof metadata.featured === "boolean" ? metadata.featured : undefined,
        sortOrder: typeof metadata.sortOrder === "number" ? metadata.sortOrder : undefined,
      },
    };
  } catch {
    return fallback;
  }
}

export function parseAgentPresetConfig(rawJson: string): StoredAgentPresetConfig {
  const fallback: StoredAgentPresetConfig = {
    schemaVersion: 1,
    defaultAgents: [],
    tags: [],
    metadata: {
      createdBy: "unknown",
      source: "user",
    },
  };

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const defaultAgents = normalizeTemplateAgents(
      (parsed.defaultAgents as TemplateAgentDefinition[] | undefined) ?? [],
    );
    const tags = normalizeStringArray(parsed.tags);

    const metadataCandidate = parsed.metadata;
    const metadata = (typeof metadataCandidate === "object" && metadataCandidate !== null)
      ? metadataCandidate as Record<string, unknown>
      : {};

    return {
      schemaVersion: Number(parsed.schemaVersion ?? 1) || 1,
      defaultAgents,
      tags,
      metadata: {
        createdBy: typeof metadata.createdBy === "string" ? metadata.createdBy : "unknown",
        source: metadata.source === "system" ? "system" : "user",
      },
    };
  } catch {
    return fallback;
  }
}

function normalizeCommunicationMode(value: unknown): CommunicationMode {
  if (value === "async_notes" || value === "chat_first" || value === "structured_handoff") {
    return value;
  }
  return "chat_first";
}

function normalizeTurnModel(value: unknown): TurnModelStrategy | null {
  if (
    value === "sequential_all"
    || value === "primary_only"
    || value === "first_success"
    || value === "round_robin"
    || value === "parallel_race"
    || value === "debate_synthesis"
    || value === "adaptive_auto"
  ) {
    return value;
  }

  return null;
}
