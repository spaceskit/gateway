/**
 * ToolExecutor — resolves and executes tool calls from agents.
 *
 * Tools come from two sources:
 * 1. Capabilities (via the CapabilityRegistry) — OS-level and cloud integrations
 * 2. Skills (installed plugins with their own tool definitions)
 *
 * The executor handles permission gating, timeout enforcement, and audit logging.
 */

import type { ToolCall, ToolResult, ToolDefinition } from "./model-provider.js";
import type { CapabilityExecutionOrigin } from "../capabilities/registry.js";

export interface ToolExecutionContext {
  spaceId: string;
  agentId: string;
  turnId: string;
  lineageId: string;
  /** Optional authenticated caller context for capability policy decisions. */
  principalId?: string;
  /** Optional authenticated caller device for capability policy decisions. */
  deviceId?: string;
  /** Optional execution-origin hint used by backend routing policy. */
  executionOrigin?: CapabilityExecutionOrigin;
}

export interface ToolPermission {
  toolName: string;
  allowed: boolean;
  reason?: string;
  reasonCode?: string;
  requiresApproval?: boolean;
}

export interface ToolExecutor {
  /** Get all tool definitions available to a specific agent in a specific space. */
  getAvailableTools(spaceId: string, agentId: string): Promise<ToolDefinition[]>;

  /** Check if a tool call is permitted before execution. */
  checkPermission(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolPermission>;

  /** Execute a tool call and return the result. */
  execute(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolResult>;
}
