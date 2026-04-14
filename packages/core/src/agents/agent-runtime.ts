/**
 * AgentRuntime — owns the turn execution loop for a single agent.
 *
 * This is intentionally NOT tied to a vendor SDK agent loop. We define
 * our own loop because the product runtime needs:
 * - Feedback checkpoints that pause execution mid-turn
 * - Inter-agent communication (HANDOFF, ASSIGN, MESSAGE)
 * - Custom turn models (debate_synthesis, round_robin, etc.)
 * - Lineage tracking with hop_count for loop prevention
 *
 * Model adapters can be used inside the runtime, but they do not own the loop.
 */

import type {
  ToolCall,
  ToolResult,
  ModelMessage,
  TokenUsage,
  FinishReason,
  TurnAccessMode,
  TurnExecutionMode,
  TurnReasoningEffort,
  ProviderSessionHandle,
  TranscriptVisibility,
  StreamKind,
} from "./model-provider.js";
import type { CapabilityExecutionOrigin } from "../capabilities/registry.js";
import type { CliLaunchSnapshot } from "./cli-launch-snapshot.js";

export interface AgentConfig {
  id: string;
  profileId: string;
  systemPrompt: string;
  modelProvider: string;   // provider ID
  modelId: string;         // model ID within provider
  tools: string[];         // tool IDs this agent can use
  maxSteps: number;        // max tool-call loops before forced stop
  temperature?: number;
  workingDirectory?: string;
  accessMode?: TurnAccessMode;
  /** @deprecated Use accessMode instead. */
  nativeCliToolsEnabled?: boolean;
  resolvedSafetyProfileId?: string;
}

export interface TurnContext {
  spaceId: string;
  turnId: string;
  messages: ModelMessage[];
  lineageId: string;
  hopCount: number;
  maxHops: number;
  /** Optional authenticated caller context for capability policy decisions. */
  principalId?: string;
  /** Optional authenticated caller device for capability policy decisions. */
  deviceId?: string;
  /** Optional execution-origin hint used by backend routing policy. */
  executionOrigin?: CapabilityExecutionOrigin;
  /** Optional request-level access mode for this turn. */
  accessMode?: TurnAccessMode;
  /** Optional request-level chat mode hint for this turn. */
  mode?: TurnExecutionMode;
  /** Optional request-level reasoning effort hint for this turn. */
  effort?: TurnReasoningEffort;
  /** Opaque provider session handle from a prior turn (e.g. OpenAI previous_response_id). */
  providerSessionHandle?: ProviderSessionHandle;
  /** User-facing session title for provider-native thread naming. */
  sessionTitle?: string;
}

export type AgentState =
  | "idle"
  | "thinking"
  | "acting"
  | "needs_feedback"
  | "errored"
  | "interrupted";

export interface TurnResult {
  agentId: string;
  turnId: string;
  messages: ModelMessage[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  finalMessage: ModelMessage;
  usage: TokenUsage;
  metadata?: TurnResultMetadata;
  state: AgentState;
  feedbackRequest?: RuntimeFeedbackCheckpoint;
}

export interface TurnResultMetadata {
  providerId?: string;
  modelId?: string;
  effectiveSafetyProfileId?: string;
  finishReason?: FinishReason;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  usage?: TokenUsage;
  /** Provider session handle to pass to the next turn for session continuity. */
  providerSessionHandle?: ProviderSessionHandle;
}

/**
 * Internal feedback checkpoint — raised by the runtime when execution
 * pauses mid-turn. This is converted to the full FeedbackRequest proto
 * message by the gateway before being sent to the native app.
 */
export interface RuntimeFeedbackCheckpoint {
  id: string;
  agentId: string;
  triggerClass:
    | "permission_gate"
    | "budget_gate"
    | "loop_guard"
    | "high_impact"
    | "ambiguity"
    | "conflict"
    | "security"
    | "policy_escalation";
  description: string;
  options: ("approve" | "reject" | "revise" | "defer")[];
  context?: Record<string, unknown>;
}

export interface RuntimeApprovalSelection {
  mode: "once" | "time_window" | "durable";
  ttlSeconds?: number;
}

export type { CliLaunchSnapshot } from "./cli-launch-snapshot.js";

export interface AgentRuntime {
  readonly agentId: string;
  readonly state: AgentState;

  /**
   * Execute a single turn: send context to the model, handle tool calls
   * in a loop, and return the final result.
   *
   * May pause mid-execution if a feedback checkpoint is triggered,
   * in which case the TurnResult will have state = "needs_feedback"
   * and a feedbackRequest attached.
   */
  executeTurn(context: TurnContext): AsyncIterable<TurnEvent>;

  /** Best-effort launch-time snapshot for turn-start UI and telemetry. */
  getLaunchSnapshot?(context: TurnContext): Promise<CliLaunchSnapshot | undefined>;

  /** Resume a paused turn after feedback is provided. */
  resumeWithFeedback(
    turnId: string,
    response: "approve" | "reject" | "revise" | "defer",
    revision?: string
  ): AsyncIterable<TurnEvent>;

  /** Cancel the current turn. */
  cancel(): Promise<void>;
}

export type TurnEvent =
  | { type: "state_changed"; state: AgentState }
  | {
    type: "text_delta";
    text: string;
    transcriptVisibility?: TranscriptVisibility;
    streamKind?: StreamKind;
  }
  | { type: "reasoning_delta"; text: string; summarized?: boolean }
  | { type: "tool_call_start"; toolCall: ToolCall }
  | { type: "tool_result"; result: ToolResult }
  | {
    type: "rate_limited";
    retryAfterMs: number;
    retryAfterSeconds: number;
    attempt: number;
    maxAttempts: number;
    providerId: string;
    retryAt: string;
  }
  | { type: "feedback_requested"; request: RuntimeFeedbackCheckpoint }
  | { type: "turn_completed"; result: TurnResult }
  | { type: "turn_cancelled" }
  | { type: "error"; error: Error };
