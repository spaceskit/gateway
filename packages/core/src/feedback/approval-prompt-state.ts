/**
 * Approval prompt state machine for watch companion and phone fallback.
 * Pure functions — no I/O, no logging.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalPromptPhase =
  | "pending"
  | "delivered_to_watch"
  | "delivered_to_phone"
  | "acted"
  | "expired"
  | "fallback_to_phone";

export type ApprovalPromptEvent =
  | "watch_delivered"
  | "phone_delivered"
  | "approved"
  | "denied"
  | "revised"
  | "timed_out"
  | "watch_delivery_failed";

export type ApprovalActionResult = "approved" | "denied" | "revised";

export interface ApprovalPromptState {
  correlationId: string;
  feedbackId: string;
  spaceId: string;
  phase: ApprovalPromptPhase;
  deliveredAt?: string;
  actedAt?: string;
  actionResult?: ApprovalActionResult;
  timeoutSeconds: number;
}

export interface WatchApprovalPrompt {
  correlationId: string;
  feedbackId: string;
  category: string;
  prompt: string;
  options: string[];
  timeoutSeconds: number;
}

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

export const INITIAL_APPROVAL_PROMPT_PHASE: ApprovalPromptPhase = "pending";

export function createInitialApprovalPromptState(opts: {
  correlationId: string;
  feedbackId: string;
  spaceId: string;
  timeoutSeconds?: number;
}): ApprovalPromptState {
  return {
    correlationId: opts.correlationId,
    feedbackId: opts.feedbackId,
    spaceId: opts.spaceId,
    phase: "pending",
    timeoutSeconds: opts.timeoutSeconds ?? 30,
  };
}

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export function transitionApprovalPrompt(
  state: ApprovalPromptState,
  event: ApprovalPromptEvent,
  nowIso?: string,
): ApprovalPromptState {
  const now = nowIso ?? new Date().toISOString();

  switch (state.phase) {
    case "pending":
      switch (event) {
        case "watch_delivered":
          return { ...state, phase: "delivered_to_watch", deliveredAt: now };
        case "phone_delivered":
          return { ...state, phase: "delivered_to_phone", deliveredAt: now };
        case "watch_delivery_failed":
          return { ...state, phase: "fallback_to_phone" };
        case "timed_out":
          return { ...state, phase: "expired" };
        default:
          return state;
      }

    case "delivered_to_watch":
      switch (event) {
        case "approved":
          return { ...state, phase: "acted", actedAt: now, actionResult: "approved" };
        case "denied":
          return { ...state, phase: "acted", actedAt: now, actionResult: "denied" };
        case "revised":
          return { ...state, phase: "acted", actedAt: now, actionResult: "revised" };
        case "timed_out":
          return { ...state, phase: "fallback_to_phone" };
        case "watch_delivery_failed":
          return { ...state, phase: "fallback_to_phone" };
        default:
          return state;
      }

    case "fallback_to_phone":
      switch (event) {
        case "phone_delivered":
          return { ...state, phase: "delivered_to_phone", deliveredAt: now };
        case "timed_out":
          return { ...state, phase: "expired" };
        default:
          return state;
      }

    case "delivered_to_phone":
      switch (event) {
        case "approved":
          return { ...state, phase: "acted", actedAt: now, actionResult: "approved" };
        case "denied":
          return { ...state, phase: "acted", actedAt: now, actionResult: "denied" };
        case "revised":
          return { ...state, phase: "acted", actedAt: now, actionResult: "revised" };
        case "timed_out":
          return { ...state, phase: "expired" };
        default:
          return state;
      }

    // Terminal states — no transitions
    case "acted":
    case "expired":
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function shouldFallbackToPhone(state: ApprovalPromptState, nowMs: number): boolean {
  if (state.phase !== "delivered_to_watch") return false;
  if (!state.deliveredAt) return false;
  const deliveredMs = new Date(state.deliveredAt).getTime();
  const elapsed = nowMs - deliveredMs;
  return elapsed >= state.timeoutSeconds * 1000;
}

export function toWatchPrompt(feedbackRequest: {
  feedbackId: string;
  category: string;
  prompt: string;
  options?: string[];
  timeoutSeconds?: number;
}, correlationId: string): WatchApprovalPrompt {
  return {
    correlationId,
    feedbackId: feedbackRequest.feedbackId,
    category: feedbackRequest.category,
    prompt: feedbackRequest.prompt,
    options: feedbackRequest.options ?? ["Approve", "Deny"],
    timeoutSeconds: feedbackRequest.timeoutSeconds ?? 30,
  };
}
