import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeTokenCount } from "./state-utils.js";

export interface PersistedTurnRowLike {
  turn_id: string;
  user_turn_id?: string | null;
  actor_id: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  token_input_count?: number | null;
  token_output_count?: number | null;
  created_at: string;
  completed_at: string | null;
  reply_to_turn_id?: string | null;
}

export function mapTurnRowToSpaceTurnPayload(row: PersistedTurnRowLike): {
  turnId: string;
  agentId: string;
  status: string;
  inputText?: string;
  outputText?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
  completedAt?: string;
  replyToTurnId?: string;
} {
  const inputText = parseTurnText(row.input_json);
  const outputText = parseTurnText(row.output_json);
  const promptTokens = normalizeTokenCount(row.token_input_count);
  const completionTokens = normalizeTokenCount(row.token_output_count);
  const userTurnId = row.user_turn_id?.trim();
  const logicalTurnId = userTurnId && userTurnId.length > 0 ? userTurnId : row.turn_id;
  return {
    turnId: logicalTurnId,
    agentId: row.actor_id || "unknown-agent",
    status: row.status,
    inputText,
    outputText,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    replyToTurnId: row.reply_to_turn_id?.trim() || undefined,
  };
}

export function parseTurnText(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string") {
      const normalized = parsed.trim();
      return normalized.length > 0 ? normalized : undefined;
    }
    if (parsed && typeof parsed === "object") {
      const object = parsed as Record<string, unknown>;
      for (const key of ["text", "content", "message", "error"]) {
        const value = object[key];
        if (typeof value === "string") {
          const normalized = value.trim();
          if (normalized.length > 0) return normalized;
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface HandoffTurnLike {
  turn_id: string;
  created_at: string;
  input_json: string | null;
  output_json: string | null;
}

export interface SessionBoundaryTurnLike extends HandoffTurnLike {
  user_turn_id: string;
}

export interface SessionBoundaryTurnRepository {
  listBySpaceAndAgent: (
    spaceId: string,
    agentId: string,
    limit?: number,
    offset?: number,
  ) => SessionBoundaryTurnLike[];
  listBySpaceAndAgentSince?: (
    spaceId: string,
    agentId: string,
    sinceIso: string,
    limit?: number,
  ) => SessionBoundaryTurnLike[];
}

export function listTurnsForActiveSessionBoundary(
  turnRepo: SessionBoundaryTurnRepository,
  spaceId: string,
  agentId: string,
  startedAtIso: string,
  limit: number,
): SessionBoundaryTurnLike[] {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (typeof turnRepo.listBySpaceAndAgentSince === "function") {
    return turnRepo.listBySpaceAndAgentSince(spaceId, agentId, startedAtIso, normalizedLimit);
  }

  return turnRepo
    .listBySpaceAndAgent(spaceId, agentId, normalizedLimit)
    .filter((turn) => turn.created_at >= startedAtIso);
}

export function buildDeterministicHandoffDigest(turns: HandoffTurnLike[], maxExchanges = 8): string {
  const sortedTurns = [...turns].sort((lhs, rhs) => {
    if (lhs.created_at !== rhs.created_at) {
      return lhs.created_at.localeCompare(rhs.created_at);
    }
    return lhs.turn_id.localeCompare(rhs.turn_id);
  });
  const exchanges = sortedTurns
    .map((turn) => ({
      user: normalizeDigestText(parseTurnText(turn.input_json)),
      assistant: normalizeDigestText(parseTurnText(turn.output_json)),
    }))
    .filter((exchange) => Boolean(exchange.user || exchange.assistant));
  const selectedExchanges = exchanges.slice(-Math.max(1, Math.floor(maxExchanges)));

  const lines: string[] = [
    "# Mock Handoff Digest",
    "",
    "Deterministic summary of recent turns from before the active usage-session boundary.",
    "Use this as prior context only; runtime state for the current session is otherwise fresh.",
    "",
  ];

  if (selectedExchanges.length === 0) {
    lines.push("No usable pre-boundary turns were found.");
    return lines.join("\n");
  }

  selectedExchanges.forEach((exchange, index) => {
    lines.push(`${index + 1}. User: ${clipDigestText(exchange.user ?? "(none)")}`);
    lines.push(`   Assistant: ${clipDigestText(exchange.assistant ?? "(none)")}`);
  });

  return lines.join("\n");
}

function normalizeDigestText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function clipDigestText(value: string, maxLength = 280): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

export async function writeDeterministicHandoffDigest(
  sharedContextPath: string,
  agentId: string,
  digestMarkdown: string,
): Promise<string> {
  const safeAgentPath = sanitizePathSegment(agentId);
  const handoffDirectory = join(sharedContextPath, "agent-handoff", safeAgentPath);
  await mkdir(handoffDirectory, { recursive: true });
  const filePath = join(handoffDirectory, "latest.md");
  await writeFile(filePath, digestMarkdown, "utf8");
  return filePath;
}

function sanitizePathSegment(value: string): string {
  const normalized = value.trim().replace(/[\\/]+/g, "_");
  return normalized.length > 0 ? normalized : "agent";
}
