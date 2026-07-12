/**
 * Agent-presence "departure board" — JSON WebSocket transport payloads.
 *
 * `proto/proto/spaceskit/v2/agent_presence_service.proto` is the canonical
 * contract; this file is the JSON envelope mirror used by the gateway
 * WebSocket router (camelCase fields, string-union enums) for the
 * AgentPresenceService RPCs:
 *   - ListActiveAgents       (unary)
 *   - SubscribeAgentPresence (server-streaming via the gateway pub/sub topic)
 *   - AnswerAgent            (mutation -> infra-pulse over HTTP)
 *
 * Enums are mapped to honest string unions matching the proto enum value
 * suffixes (lower_snake_case), so an unknown future value never silently
 * decodes to a wrong typed enum.
 */

// ---------------------------------------------------------------------------
// Enums (string-union mirrors of the proto enums)
// ---------------------------------------------------------------------------

/** Mirrors spaceskit.v2.AgentProvider. */
export type AgentProviderPayload = "unspecified" | "claude" | "codex" | "opencode";

/** Mirrors spaceskit.v2.AgentWaitStatus. */
export type AgentWaitStatusPayload =
  | "unspecified"
  | "question"
  | "plan"
  | "permission"
  | "turn_end"
  | "working"
  | "idle_dead";

/**
 * Mirrors spaceskit.v2.AnswerDeliveryMode. This value MUST be reported
 * honestly: `fork_resume` means the answer spawned a NEW run and the original
 * session was NOT continued in place (Claude, and unreachable foreign Codex
 * threads); `in_place` means the live session received the answer (opencode,
 * gateway-owned Codex threads); `read_only` means delivery is disabled.
 */
export type AnswerDeliveryModePayload = "unspecified" | "in_place" | "fork_resume" | "read_only";

// ---------------------------------------------------------------------------
// Rows / snapshots
// ---------------------------------------------------------------------------

/** Mirrors spaceskit.v2.AgentWaitOption. */
export interface AgentWaitOptionPayload {
  label: string;
  description: string;
}

/** Mirrors spaceskit.v2.AgentPresenceRow. */
export interface AgentPresenceRowPayload {
  /** Stable routing identity (`<provider>:<sessionId>`). */
  key: string;
  provider: AgentProviderPayload;
  sessionId: string;
  cwd: string;
  status: AgentWaitStatusPayload;
  summary: string;
  /**
   * Session title as assigned by the producing CLI (Claude summary line,
   * Codex thread_name) or derived from the first prompt. JSON-transport
   * extension ahead of the proto (additive/optional; absent on older rows).
   */
  title?: string;
  options: AgentWaitOptionPayload[];
  hash: string;
  /** Fractional epoch milliseconds (carries a sub-ms fraction). */
  at: number;
  live: boolean;
}

/**
 * Mirrors spaceskit.v2.AgentPresenceSnapshot / ListActiveAgentsResponse.
 * The full current set is always sent (not deltas) so late subscribers stay
 * consistent.
 */
export interface AgentPresenceSnapshotPayload {
  agents: AgentPresenceRowPayload[];
  /** Fractional epoch milliseconds the snapshot was produced. */
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Requests / responses
// ---------------------------------------------------------------------------

/** Mirrors spaceskit.v2.ListActiveAgentsRequest. */
export interface ListActiveAgentsPayload {
  apiVersion?: string;
  providers?: AgentProviderPayload[];
  includeInactive?: boolean;
  limit?: number;
}

/** Mirrors spaceskit.v2.ListActiveAgentsResponse. */
export interface ListActiveAgentsResponsePayload {
  agents: AgentPresenceRowPayload[];
  generatedAt: number;
}

/** Mirrors spaceskit.v2.SubscribeAgentPresenceRequest. */
export interface SubscribeAgentPresencePayload {
  apiVersion?: string;
  providers?: AgentProviderPayload[];
  includeInactive?: boolean;
  /** Send the current snapshot immediately on subscribe (default true). */
  includeInitialSnapshot?: boolean;
}

/** Ack returned by the SubscribeAgentPresence handler. */
export interface SubscribeAgentPresenceResponsePayload {
  subscribed: boolean;
}

/** Mirrors spaceskit.v2.AnswerAgentRequest. */
export interface AnswerAgentPayload {
  apiVersion?: string;
  /** Target agent key (`<provider>:<sessionId>`). */
  key: string;
  /** Index into the row's options, or -1 for free-text only. */
  optionIndex?: number;
  /** Alternative to optionIndex: choose by label. */
  optionLabel?: string;
  /** Optional free-text answer. */
  text?: string;
  /** Reject a stale answer to a superseded ask. */
  expectedHash?: string;
  idempotencyKey?: string;
}

/**
 * Mirrors spaceskit.v2.AnswerAgentResponse. `deliveryMode` round-trips the
 * honest per-provider truth back to the app.
 */
export interface AnswerAgentResponsePayload {
  ok: boolean;
  deliveredAnswer: string;
  error?: AnswerAgentErrorPayload;
  agent?: AgentPresenceRowPayload;
  deliveryMode: AnswerDeliveryModePayload;
}

/** Mirror of spaceskit.v2.ErrorInfo as embedded in AnswerAgentResponse. */
export interface AnswerAgentErrorPayload {
  code?: string;
  message?: string;
}
