import type { CapabilityExecutionOrigin } from "../capabilities/registry.js";
import type {
  ProviderSessionHandle,
  TurnAccessMode,
  TurnExecutionMode,
  TurnReasoningEffort,
} from "../agents/model-provider.js";
import type { ConversationTopology } from "./types.js";

export interface TurnExecutionIdentity {
  principalId?: string;
  deviceId?: string;
  executionOrigin?: CapabilityExecutionOrigin;
  accessMode?: TurnAccessMode;
  mode?: TurnExecutionMode;
  effort?: TurnReasoningEffort;
  targetAgentIds?: string[];
  replyToTurnId?: string;
  conversationTopology?: ConversationTopology;
}

export function normalizeExecutionIdentity(
  input?: TurnExecutionIdentity,
): TurnExecutionIdentity | undefined {
  if (!input) return undefined;
  const principalId = normalizeOptionalString(input.principalId);
  const deviceId = normalizeOptionalString(input.deviceId);
  const executionOrigin = normalizeExecutionOrigin(input.executionOrigin);
  const accessMode = normalizeAccessMode(input.accessMode);
  const mode = normalizeExecutionMode(input.mode);
  const effort = normalizeReasoningEffort(input.effort);
  const targetAgentIds = normalizeAgentIdentifiers(input.targetAgentIds);
  const replyToTurnId = normalizeOptionalString(input.replyToTurnId);
  const conversationTopology = normalizeConversationTopology(input.conversationTopology);
  if (
    !principalId
    && !deviceId
    && !executionOrigin
    && !accessMode
    && !mode
    && !effort
    && targetAgentIds.length === 0
    && !replyToTurnId
    && !conversationTopology
  ) {
    return undefined;
  }
  return {
    principalId,
    deviceId,
    executionOrigin,
    accessMode,
    mode,
    effort,
    ...(targetAgentIds.length > 0 ? { targetAgentIds } : {}),
    ...(replyToTurnId ? { replyToTurnId } : {}),
    ...(conversationTopology ? { conversationTopology } : {}),
  };
}

export function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function normalizeProviderSessionHandle(value?: ProviderSessionHandle): ProviderSessionHandle | undefined {
  if (!value || value.type === "none") {
    return undefined;
  }
  if (value.type === "openai_response" && normalizeOptionalString(value.previousResponseId)) {
    return value;
  }
  if (value.type === "codex_app_server_thread" && normalizeOptionalString(value.threadId)) {
    return value;
  }
  return undefined;
}

export function sanitizeSessionTitle(input: string): string {
  const normalized = input
    .replace(/```[a-zA-Z0-9_-]*\s*/g, " ")
    .replace(/```/g, " ")
    .replace(/^\s*(user|assistant|system|tool)\s*:\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = normalized.toLowerCase();
  if (
    normalized.length < 3
    || lower === "hi"
    || lower === "hello"
    || lower === "hey"
    || lower === "help"
    || lower === "test"
  ) {
    return "";
  }
  return truncateSessionTitle(normalized);
}

export function truncateSessionTitle(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 77).trimEnd()}...`;
}

export function normalizeAgentIdentifier(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function normalizeAgentIdentifiers(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const agentId = normalizeAgentIdentifier(value);
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);
    normalized.push(agentId);
  }
  return normalized;
}

export function normalizeConversationTopology(value?: ConversationTopology): ConversationTopology | undefined {
  if (value === "direct" || value === "shared_team_chat" || value === "broadcast_team") {
    return value;
  }
  return undefined;
}

function normalizeExecutionOrigin(value?: CapabilityExecutionOrigin): CapabilityExecutionOrigin | undefined {
  if (!value) return undefined;
  if (
    value === "owner"
    || value === "guest"
    || value === "connector"
    || value === "system"
    || value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function normalizeAccessMode(value?: TurnAccessMode): TurnAccessMode | undefined {
  if (value === "default" || value === "full_access") {
    return value;
  }
  return undefined;
}

function normalizeExecutionMode(value?: TurnExecutionMode): TurnExecutionMode | undefined {
  if (value === "ask" || value === "plan" || value === "execute") {
    return value;
  }
  return undefined;
}

function normalizeReasoningEffort(value?: TurnReasoningEffort): TurnReasoningEffort | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }
  return undefined;
}
