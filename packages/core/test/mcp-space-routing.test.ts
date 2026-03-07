import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/event-bus.js";
import { CapabilityNotAvailableError, CapabilityRegistry } from "../src/capabilities/registry.js";
import { DefaultToolExecutor } from "../src/agents/default-tool-executor.js";

describe("MCP space-aware routing", () => {
  test("requires explicit default/space override for MCP invocation", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    registry.register(
      {
        id: "mcp-a",
        name: "MCP A",
        source: "connector",
        capabilityType: "mcp",
        operations: ["alpha"],
        available: true,
      },
      {
        invoke: async () => ({ ok: true }),
      },
    );

    await expect(async () =>
      registry.invoke({
        capability: "mcp",
        operation: "alpha",
        args: {},
      })
    ).toThrow(CapabilityNotAvailableError);
  });

  test("routes MCP invocation by space override, then system default", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    registry.register(
      {
        id: "mcp-global",
        name: "MCP Global",
        source: "connector",
        capabilityType: "mcp",
        operations: ["global_op"],
        available: true,
      },
      {
        invoke: async () => ({ provider: "global" }),
      },
    );
    registry.register(
      {
        id: "mcp-space-a",
        name: "MCP Space A",
        source: "connector",
        capabilityType: "mcp",
        operations: ["space_op"],
        available: true,
      },
      {
        invoke: async () => ({ provider: "space-a" }),
      },
    );

    registry.setPreferences({
      defaults: { mcp: "mcp-global" },
      spaceOverrides: {
        "space-a": { mcp: "mcp-space-a" },
      },
    });

    const spaceResult = await registry.invoke(
      {
        capability: "mcp",
        operation: "space_op",
        args: {},
      },
      { spaceId: "space-a" },
    );
    expect("providerId" in spaceResult && spaceResult.providerId).toBe("mcp-space-a");

    const defaultResult = await registry.invoke(
      {
        capability: "mcp",
        operation: "global_op",
        args: {},
      },
      { spaceId: "space-b" },
    );
    expect("providerId" in defaultResult && defaultResult.providerId).toBe("mcp-global");
  });

  test("tool listing exposes only effective MCP provider operations per space", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    registry.register(
      {
        id: "mcp-global",
        name: "MCP Global",
        source: "connector",
        capabilityType: "mcp",
        operations: ["global_op"],
        available: true,
      },
      { invoke: async () => null },
    );
    registry.register(
      {
        id: "mcp-space-a",
        name: "MCP Space A",
        source: "connector",
        capabilityType: "mcp",
        operations: ["space_op"],
        available: true,
      },
      { invoke: async () => null },
    );
    registry.setPreferences({
      defaults: { mcp: "mcp-global" },
      spaceOverrides: {
        "space-a": { mcp: "mcp-space-a" },
      },
    });

    const executor = new DefaultToolExecutor({
      capabilityRegistry: registry,
      eventBus: new EventBus(),
      resolveSecurityScope: async () => ({
        agentId: "agent-1",
        permissionMode: "sandbox",
        allowedCapabilities: ["mcp"],
        filesystemScope: "",
        allowNetwork: false,
        allowShell: false,
        commandAllowlist: [],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 10,
        requireOutputReview: false,
      }),
    });

    const spaceATools = await executor.getAvailableTools("space-a", "agent-1");
    expect(spaceATools.map((tool) => tool.name)).toEqual(["mcp.space_op"]);

    const spaceBTools = await executor.getAvailableTools("space-b", "agent-1");
    expect(spaceBTools.map((tool) => tool.name)).toEqual(["mcp.global_op"]);
  });
});
