/**
 * MCP external runtime state — app-local aggregate types.
 * Pure functions — no I/O, no logging.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpEndpointHealthModel = "unknown" | "ok" | "degraded" | "error";
export type McpBindingStatus = "pending_discovery" | "discovered" | "approved" | "rejected" | "error";
export type McpTransport = "sse" | "stdio";

export interface McpDiscoveredAgent {
  remoteAgentId: string;
  displayName: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface McpApprovedBinding {
  agentId: string;
  remoteAgentId: string;
  displayName: string;
  status: McpBindingStatus;
  approvedAt?: string;
}

export interface SpaceExternalRuntimeState {
  endpointId: string;
  spaceId: string;
  transport: McpTransport;
  endpoint: string;
  healthStatus: McpEndpointHealthModel;
  discoveredAgents: McpDiscoveredAgent[];
  approvedBindings: McpApprovedBinding[];
  lastCheckedAt?: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export interface ToExternalRuntimeStateInput {
  endpointId: string;
  spaceId: string;
  transport: McpTransport;
  endpoint: string;
  healthStatus: McpEndpointHealthModel;
  enabled: boolean;
  lastCheckedAt?: string;
  discoveredAgents: McpDiscoveredAgent[];
  approvedBindings: McpApprovedBinding[];
}

export function toExternalRuntimeState(
  input: ToExternalRuntimeStateInput,
): SpaceExternalRuntimeState {
  return {
    endpointId: input.endpointId,
    spaceId: input.spaceId,
    transport: input.transport,
    endpoint: input.endpoint,
    healthStatus: input.healthStatus,
    discoveredAgents: input.discoveredAgents,
    approvedBindings: input.approvedBindings,
    lastCheckedAt: input.lastCheckedAt,
    enabled: input.enabled,
  };
}

// ---------------------------------------------------------------------------
// Health Summary
// ---------------------------------------------------------------------------

export function deriveMcpHealthSummary(state: SpaceExternalRuntimeState): string {
  if (!state.enabled) return "Endpoint disabled";
  switch (state.healthStatus) {
    case "ok": return `Healthy — ${state.approvedBindings.length} agent(s) bound`;
    case "degraded": return `Degraded — ${state.approvedBindings.length} agent(s) bound, check endpoint`;
    case "error": return "Endpoint unreachable";
    case "unknown": return "Health unknown — not yet checked";
  }
}
