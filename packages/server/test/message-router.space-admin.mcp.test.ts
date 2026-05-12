import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import {
  defaultAssignment,
  defaultSpace,
  makeClient,
  makeMessage,
  makeRouter,
} from "./message-router.space-admin-test-helpers.js";

describe("MessageRouter space admin handlers", () => {
  test("routes MCP endpoint lifecycle operations", async () => {
    const router = makeRouter(
      {
        getSpace: async () => ({ ...defaultSpace }),
      },
      {
        spaceMcpService: {
          isConfiguredForSpace: () => true,
          getSpaceEndpoint: () => ({
            endpointId: "endpoint-1",
            spaceId: "space-main",
            transport: "sse",
            endpoint: "https://mcp.example/sse",
            args: [],
            enabled: true,
            healthStatus: "ok",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          setSpaceEndpoint: async () => ({
            endpointId: "endpoint-1",
            spaceId: "space-main",
            transport: "sse",
            endpoint: "https://mcp.example/sse",
            args: [],
            enabled: true,
            healthStatus: "ok",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          clearSpaceEndpoint: async () => true,
          discoverSpaceAgents: async () => ({ endpointId: "endpoint-1", agents: [] }),
          approveSpaceAgent: async () => ({
            assignment: defaultAssignment,
            binding: {
              runtimeKind: "external_mcp",
              spaceId: "space-main",
              agentId: "agent-main",
              endpointId: "endpoint-1",
              remoteAgentId: "remote-1",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          listBindings: () => [],
          removeBinding: () => true,
        },
      },
    );

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_MCP_ENDPOINT, { spaceId: "space-main" }),
    );
    expect(getResponse?.type).toBe(MessageTypes.SPACE_GET_MCP_ENDPOINT);
    expect((getResponse?.payload as any).endpoint.endpointId).toBe("endpoint-1");

    const setResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SET_MCP_ENDPOINT, {
        spaceId: "space-main",
        transport: "sse",
        endpoint: "https://mcp.example/sse",
      }),
    );
    expect(setResponse?.type).toBe(MessageTypes.SPACE_SET_MCP_ENDPOINT);
    expect((setResponse?.payload as any).endpoint.spaceId).toBe("space-main");

    const clearResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_CLEAR_MCP_ENDPOINT, { spaceId: "space-main" }),
    );
    expect(clearResponse?.type).toBe(MessageTypes.SPACE_CLEAR_MCP_ENDPOINT);
    expect((clearResponse?.payload as any).cleared).toBe(true);
  });

  test("decorates assignment responses with external MCP runtime metadata", async () => {
    const router = makeRouter(
      {
        listAgentAssignments: async () => [defaultAssignment],
      },
      {
        spaceMcpService: {
          isConfiguredForSpace: () => true,
          getSpaceEndpoint: () => null,
          setSpaceEndpoint: async () => null,
          clearSpaceEndpoint: async () => true,
          discoverSpaceAgents: async () => ({ endpointId: "endpoint-1", agents: [] }),
          approveSpaceAgent: async () => ({
            assignment: defaultAssignment,
            binding: {
              runtimeKind: "external_mcp",
              spaceId: "space-main",
              agentId: "agent-main",
              endpointId: "endpoint-1",
              remoteAgentId: "remote-1",
              displayName: "Remote Agent",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          listBindings: () => [{
            agentId: "agent-main",
            endpointId: "endpoint-1",
            remoteAgentId: "remote-1",
            displayName: "Remote Agent",
          }],
          removeBinding: () => true,
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS, { spaceId: "space-main" }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS);
    expect((response?.payload as any).assignments[0].runtimeKind).toBe("external_mcp");
    expect((response?.payload as any).assignments[0].endpointId).toBe("endpoint-1");
    expect((response?.payload as any).assignments[0].remoteAgentId).toBe("remote-1");
  });
});
