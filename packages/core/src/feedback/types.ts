/**
 * Feedback types — the human-in-the-loop protocol.
 *
 * When an agent needs human input (permission approval, budget consent,
 * conflict resolution, security escalation), it creates a FeedbackRequest.
 * The native app presents this to the user. The user's response is a
 * FeedbackResponse that the gateway routes back to the agent.
 *
 * This is the formal protocol surface for the manifesto's central principle:
 * "the human stays in the loop as coordinator."
 */

// ---------------------------------------------------------------------------
// Feedback enums
// ---------------------------------------------------------------------------

export type FeedbackCategory =
  | "permission"      // Agent needs elevated permission
  | "budget"          // Budget threshold reached
  | "high_impact"     // Destructive or irreversible action
  | "ambiguity"       // Agent unsure how to proceed
  | "conflict"        // Agents disagree
  | "security";       // Security policy triggered

export type FeedbackStatus = "pending" | "resolved" | "expired";

export type FeedbackResponseType = "approve" | "reject" | "revise" | "defer";

// ---------------------------------------------------------------------------
// Feedback request/response
// ---------------------------------------------------------------------------

export interface FeedbackRequest {
  feedbackId: string;
  spaceId: string;
  agentId: string;
  /** The turn that triggered this feedback request. */
  turnId: string;

  category: FeedbackCategory;
  status: FeedbackStatus;

  /** Human-readable description of what the agent needs. */
  prompt: string;
  /** Structured context (e.g. the capability invocation that was blocked). */
  context?: Record<string, unknown>;

  /** Options the human can choose from (if applicable). */
  options: string[];
  /** Whether the agent can continue with a default action if no response. */
  hasDefaultAction: boolean;
  /** Timeout: how long to wait before falling back to default (0 = forever). */
  timeoutSeconds: number;

  createdAt: Date;
  expiresAt?: Date;
}

export interface FeedbackResponse {
  feedbackId: string;
  responseType: FeedbackResponseType;
  /** The selected option index, or -1 for free-form. */
  selectedOption: number;
  /** Free-form human input (for revise or custom responses). */
  message?: string;
  /** Structured modifications (for revise). */
  modifications?: Record<string, unknown>;
  respondedAt: Date;
}
