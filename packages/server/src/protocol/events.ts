export interface AuthResultPayload {
  success: boolean;
  reason?: string;
  challenge?: string;
}

// ---------------------------------------------------------------------------
// Typed event payload union — granular subtype truth via `kind` discriminator.
// ---------------------------------------------------------------------------

export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TurnMetadata {
  modelId?: string;
  providerId?: string;
  durationMs?: number;
  finishReason?: string;
  startedAt?: string;
  completedAt?: string;
  tokensPerSecond?: number;
}

export type AgentActivityState =
  | "idle"
  | "thinking"
  | "acting"
  | "needs_feedback"
  | "errored";

export type TypedTurnEventPayload =
  // Turn lifecycle
  | {
    kind: "turn.started";
    agentId: string;
    turnId: string;
    rootTurnId?: string;
    conversationTopology?: string;
    transcriptVisibility?: string;
    launchSnapshots?: CliLaunchSnapshot[];
  }
  | { kind: "turn.completed"; agentId: string; usage?: TurnUsage; metadata?: TurnMetadata; finalMessage?: string; effectiveSafetyProfileId?: string }
  | { kind: "turn.cancelled"; agentId?: string }
  | { kind: "turn.failed"; errorMessage: string; errorCode?: string }
  // Streaming
  | { kind: "reasoning.delta"; text: string }
  // Tool calls
  | { kind: "tool.started"; toolCallId: string; toolName: string; arguments?: Record<string, unknown>; agentId?: string }
  | { kind: "tool.completed"; toolCallId: string; toolName?: string; result: unknown; isError: boolean; agentId?: string }
  // State
  | { kind: "state.changed"; state: AgentActivityState }
  // Approval (human-in-the-loop)
  | { kind: "approval.requested"; requestId: string; agentId: string; description: string; options: string[]; context?: Record<string, unknown> }
  | { kind: "approval.resolved"; requestId: string; response: string; agentId?: string }
  // Rate limiting
  | { kind: "rate_limited"; retryAfterMs: number; attempt: number; maxAttempts: number; providerId: string; retryAt: string };

// ---------------------------------------------------------------------------
// TurnEventPayload — the wire envelope. `typedPayload.kind` is the sole turn
// event discriminator.
// ---------------------------------------------------------------------------

export interface TurnEventPayload {
  spaceId: string;
  spaceUid: string;
  turnId: string;
  rootTurnId?: string;
  agentId?: string;
  conversationTopology?: string;
  transcriptVisibility?: string;
  typedPayload: TypedTurnEventPayload;
  ts?: string;
}

export interface TurnStreamPayload {
  spaceId: string;
  spaceUid: string;
  turnId: string;
  rootTurnId?: string;
  agentId: string;
  conversationTopology?: string;
  transcriptVisibility?: "visible" | "activity_only" | "summary";
  summaryTurnId?: string;
  streamKind?: "assistant_output" | "provider_client";
  delta: string;
  seq: number;
  done: boolean;
}

export interface SpaceStatePayload {
  spaceId: string;
  spaceUid: string;
  state: AgentActivityState;
  turnCount: number;
  activeAgentId?: string;
  pendingFeedback: number;
}

export interface NotificationPayload {
  notificationId: string;
  category: string;
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  body: string;
  spaceId?: string;
  spaceUid?: string;
  agentId?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface AppNavigatePayload {
  destination: string;
  gatewayId?: string;
  spaceId?: string;
  jobId?: string;
  promptText?: string;
}

export type ConciergeActionRequestType =
  | "create_space"
  | "open_workspace"
  | "update_space"
  | "add_agent"
  | "remove_agent"
  | "run_space_prompt"
  | "draft_scheduler_job";

export interface AppConciergeActionRequestPayload {
  requestId: string;
  action: ConciergeActionRequestType;
  gatewayId?: string;
  params?: Record<string, unknown>;
}

export type ConciergeActionResultStatus = "ok" | "error";

export interface ConciergeActionResultPayload {
  requestId: string;
  status: ConciergeActionResultStatus;
  payload?: Record<string, unknown>;
  error?: string;
}

export interface ConciergeActionResultAckPayload {
  acknowledged: boolean;
  requestId: string;
}

export interface SpaceAgentUpdatedEventPayload {
  spaceId: string;
  spaceUid: string;
  agentId: string;
  oldProfileId: string;
  newProfileId: string;
  updatedAt: string;
}

export interface SubscribeNotificationsPayload {
  categories: string[];
}

export interface UnsubscribeNotificationsPayload {
  categories: string[];
}

export interface ErrorPayload {
  code: GatewayErrorCode;
  message: string;
  details?: unknown;
  retryable: boolean;
  correlationId: string;
}

export type GatewayErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN"
  | "UNAUTHENTICATED"
  | "INTERNAL"
  | "UNAVAILABLE"
  | "DEADLINE_EXCEEDED";
import type { CliLaunchSnapshot } from "@spaceskit/core";
