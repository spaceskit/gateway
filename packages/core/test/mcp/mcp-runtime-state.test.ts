import { describe, expect, test } from "bun:test";
import {
  toExternalRuntimeState,
  deriveMcpHealthSummary,
} from "../../src/mcp/mcp-runtime-state.js";
import type {
  McpBindingStatus,
  McpDiscoveredAgent,
  McpApprovedBinding,
  SpaceExternalRuntimeState,
  ToExternalRuntimeStateInput,
} from "../../src/mcp/mcp-runtime-state.js";

describe("toExternalRuntimeState", () => {
  const baseInput: ToExternalRuntimeStateInput = {
    endpointId: "ep-001",
    spaceId: "space-001",
    transport: "sse",
    endpoint: "https://mcp.example.com",
    healthStatus: "ok",
    enabled: true,
    lastCheckedAt: "2026-02-28T12:00:00Z",
    discoveredAgents: [
      {
        remoteAgentId: "remote-1",
        displayName: "Agent One",
        description: "First agent",
      },
    ],
    approvedBindings: [
      {
        agentId: "local-1",
        remoteAgentId: "remote-1",
        displayName: "Agent One",
        status: "approved",
        approvedAt: "2026-02-28T12:00:00Z",
      },
    ],
  };

  test("maps all fields correctly", () => {
    const result = toExternalRuntimeState(baseInput);
    expect(result.endpointId).toBe("ep-001");
    expect(result.spaceId).toBe("space-001");
    expect(result.transport).toBe("sse");
    expect(result.endpoint).toBe("https://mcp.example.com");
    expect(result.healthStatus).toBe("ok");
    expect(result.enabled).toBe(true);
    expect(result.lastCheckedAt).toBe("2026-02-28T12:00:00Z");
    expect(result.discoveredAgents).toHaveLength(1);
    expect(result.discoveredAgents[0].remoteAgentId).toBe("remote-1");
    expect(result.approvedBindings).toHaveLength(1);
    expect(result.approvedBindings[0].agentId).toBe("local-1");
  });

  test("handles empty discoveredAgents and approvedBindings", () => {
    const input: ToExternalRuntimeStateInput = {
      ...baseInput,
      discoveredAgents: [],
      approvedBindings: [],
    };
    const result = toExternalRuntimeState(input);
    expect(result.discoveredAgents).toEqual([]);
    expect(result.approvedBindings).toEqual([]);
  });

  test("handles optional lastCheckedAt as undefined", () => {
    const input: ToExternalRuntimeStateInput = {
      ...baseInput,
      lastCheckedAt: undefined,
    };
    const result = toExternalRuntimeState(input);
    expect(result.lastCheckedAt).toBeUndefined();
  });

  test("handles stdio transport", () => {
    const input: ToExternalRuntimeStateInput = {
      ...baseInput,
      transport: "stdio",
    };
    const result = toExternalRuntimeState(input);
    expect(result.transport).toBe("stdio");
  });
});

describe("deriveMcpHealthSummary", () => {
  function makeState(
    overrides: Partial<SpaceExternalRuntimeState> = {},
  ): SpaceExternalRuntimeState {
    return {
      endpointId: "ep-001",
      spaceId: "space-001",
      transport: "sse",
      endpoint: "https://mcp.example.com",
      healthStatus: "ok",
      discoveredAgents: [],
      approvedBindings: [],
      enabled: true,
      ...overrides,
    };
  }

  test("ok state returns healthy with agent count", () => {
    const state = makeState({
      healthStatus: "ok",
      approvedBindings: [
        { agentId: "a1", remoteAgentId: "r1", displayName: "A", status: "approved" },
        { agentId: "a2", remoteAgentId: "r2", displayName: "B", status: "approved" },
      ],
    });
    const summary = deriveMcpHealthSummary(state);
    expect(summary).toContain("Healthy");
    expect(summary).toContain("2 agent(s) bound");
  });

  test("degraded state returns degraded with agent count", () => {
    const state = makeState({
      healthStatus: "degraded",
      approvedBindings: [
        { agentId: "a1", remoteAgentId: "r1", displayName: "A", status: "approved" },
      ],
    });
    const summary = deriveMcpHealthSummary(state);
    expect(summary).toContain("Degraded");
    expect(summary).toContain("1 agent(s) bound");
    expect(summary).toContain("check endpoint");
  });

  test("error state returns unreachable", () => {
    const state = makeState({ healthStatus: "error" });
    expect(deriveMcpHealthSummary(state)).toBe("Endpoint unreachable");
  });

  test("unknown state returns not yet checked", () => {
    const state = makeState({ healthStatus: "unknown" });
    expect(deriveMcpHealthSummary(state)).toContain("not yet checked");
  });

  test("disabled endpoint returns disabled message", () => {
    const state = makeState({ enabled: false, healthStatus: "ok" });
    expect(deriveMcpHealthSummary(state)).toBe("Endpoint disabled");
  });

  test("disabled takes priority over health status", () => {
    const state = makeState({ enabled: false, healthStatus: "error" });
    expect(deriveMcpHealthSummary(state)).toBe("Endpoint disabled");
  });
});

describe("McpBindingStatus type coverage", () => {
  test("all binding statuses are assignable", () => {
    const statuses: McpBindingStatus[] = [
      "pending_discovery",
      "discovered",
      "approved",
      "rejected",
      "error",
    ];
    expect(statuses).toHaveLength(5);
  });
});
