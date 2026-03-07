/**
 * A2A (Agent-to-Agent) protocol types.
 *
 * Implements the core A2A specification types needed for interop with
 * CrewAI, AutoGen, Microsoft Agent Framework, and any other A2A-compliant
 * framework.
 *
 * Spaceskit's profiles become A2A agent cards. Spaces become A2A tasks.
 * Turns become A2A messages.
 *
 * Reference: https://a2a-protocol.org/latest/specification/
 */

// ---------------------------------------------------------------------------
// Agent Card — served at GET /.well-known/agent.json or /a2a/agents/:id
// ---------------------------------------------------------------------------

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: A2ACapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills?: A2ASkill[];
  authentication?: A2AAuthScheme;
}

export interface A2ACapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

export interface A2ASkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
}

export interface A2AAuthScheme {
  type: "bearer" | "apiKey" | "oauth2" | "none";
  description?: string;
}

// ---------------------------------------------------------------------------
// Task — the unit of work in A2A
// ---------------------------------------------------------------------------

export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed";

export interface A2ATask {
  id: string;
  state: A2ATaskState;
  messages: A2AMessage[];
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown>;
}

export interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
}

export type A2APart =
  | { type: "text"; text: string }
  | { type: "data"; mimeType: string; data: string }
  | { type: "file"; uri: string; mimeType?: string };

export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
}

// ---------------------------------------------------------------------------
// A2A JSON-RPC Request/Response (simplified for HTTP+JSON transport)
// ---------------------------------------------------------------------------

export interface A2ATaskRequest {
  /** Input message from the requesting agent. */
  message: A2AMessage;
  /** Optional: which agent profile to use. */
  agentId?: string;
  /** Optional: continue existing task. */
  taskId?: string;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

export interface A2ATaskResponse {
  task: A2ATask;
}

// ---------------------------------------------------------------------------
// SSE Event types for streaming
// ---------------------------------------------------------------------------

export type A2AStreamEvent =
  | { type: "task.started"; taskId: string }
  | { type: "task.progress"; taskId: string; message: A2AMessage }
  | { type: "task.artifact"; taskId: string; artifact: A2AArtifact }
  | { type: "task.completed"; task: A2ATask }
  | { type: "task.failed"; taskId: string; error: string }
  | { type: "task.input-required"; taskId: string; message: A2AMessage };
