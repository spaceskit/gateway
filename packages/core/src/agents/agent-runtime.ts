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

import type { ToolCall, ToolResult, ModelMessage, TokenUsage, FinishReason } from "./model-provider.js";
import type { CapabilityExecutionOrigin } from "../capabilities/registry.js";

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
  nativeCliToolsEnabled?: boolean;
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
}

export type AgentState =
  | "idle"
  | "thinking"
  | "acting"
  | "needs_feedback"
  | "errored";

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
  finishReason?: FinishReason;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  usage?: TokenUsage;
}

/**
 * Internal feedback checkpoint — raised by the runtime when execution
 * pauses mid-turn. This is converted to the full FeedbackRequest proto
 * message by the gateway before being sent to the native app.
 */
export interface RuntimeFeedbackCheckpoint {
  id: string;
  agentId: string;
  triggerClass: "permission_gate" | "budget_gate" | "loop_guard" | "high_impact" | "ambiguity" | "conflict" | "security";
  description: string;
  options: ("approve" | "reject" | "revise" | "defer")[];
}

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
  | { type: "text_delta"; text: string }
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
  | { type: "error"; error: Error };
