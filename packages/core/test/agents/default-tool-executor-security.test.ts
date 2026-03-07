import { describe, expect, test } from "bun:test";
import { DefaultToolExecutor } from "../../src/agents/default-tool-executor.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import { EventBus } from "../../src/events/event-bus.js";

function makeContext() {
  const eventBus = new EventBus();
  const registry = new CapabilityRegistry(eventBus);
  registry.register(
    {
      id: "shell-local",
      name: "Shell Local",
      source: "builtin",
      capabilityType: "shell",
      operations: ["run"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );
  registry.register(
    {
      id: "mcp-default",
      name: "MCP Default",
      source: "connector",
      capabilityType: "mcp",
      operations: ["query"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );
  registry.setPreferences({
    defaults: { mcp: "mcp-default" },
  });

  return { eventBus, registry };
}

describe("DefaultToolExecutor security scope enforcement", () => {
  test("denies shell tool call when allowShell is false", async () => {
    const { eventBus, registry } = makeContext();
    const deniedEvents: Array<Record<string, unknown>> = [];
    eventBus.on("tool.permission_denied", (event) => deniedEvents.push(event));

    const executor = new DefaultToolExecutor({
      capabilityRegistry: registry,
      eventBus,
      resolveSecurityScope: async () => ({
        agentId: "agent-1",
        permissionMode: "sandbox",
        allowedCapabilities: ["shell"],
        filesystemScope: "",
        allowNetwork: true,
        allowShell: false,
        commandAllowlist: [],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 10,
        requireOutputReview: false,
      }),
    });

    const permission = await executor.checkPermission(
      {
        id: "tool-1",
        name: "shell.run",
        arguments: { command: "echo hello" },
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-1",
        lineageId: "lineage-1",
      },
    );

    expect(permission.allowed).toBe(false);
    expect(permission.reasonCode).toBe("shell_not_allowed");
    expect(deniedEvents.length).toBe(1);
    expect(deniedEvents[0].reasonCode).toBe("shell_not_allowed");
  });

  test("denies network-requiring tool call when allowNetwork is false", async () => {
    const { eventBus, registry } = makeContext();
    const executor = new DefaultToolExecutor({
      capabilityRegistry: registry,
      eventBus,
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

    const permission = await executor.checkPermission(
      {
        id: "tool-1",
        name: "mcp.query",
        arguments: {},
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-1",
        lineageId: "lineage-1",
      },
    );

    expect(permission.allowed).toBe(false);
    expect(permission.reasonCode).toBe("network_not_allowed");
  });

  test("enforces commandAllowlist for shell operations", async () => {
    const { eventBus, registry } = makeContext();
    const executor = new DefaultToolExecutor({
      capabilityRegistry: registry,
      eventBus,
      resolveSecurityScope: async () => ({
        agentId: "agent-1",
        permissionMode: "sandbox",
        allowedCapabilities: ["shell"],
        filesystemScope: "",
        allowNetwork: true,
        allowShell: true,
        commandAllowlist: ["git *"],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 10,
        requireOutputReview: false,
      }),
    });

    const denied = await executor.checkPermission(
      {
        id: "tool-denied",
        name: "shell.run",
        arguments: { command: "rm -rf /" },
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-1",
        lineageId: "lineage-1",
      },
    );
    expect(denied.allowed).toBe(false);
    expect(denied.reasonCode).toBe("command_not_allowlisted");

    const allowed = await executor.checkPermission(
      {
        id: "tool-allowed",
        name: "shell.run",
        arguments: { command: "git status" },
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-1",
        lineageId: "lineage-1",
      },
    );
    expect(allowed.allowed).toBe(true);
  });

  test("normalizes targetProvider aliases for lists tools", async () => {
    const { eventBus, registry } = makeContext();
    registry.register(
      {
        id: "apple-reminders-eventkit",
        name: "Apple Reminders",
        source: "adapter",
        capabilityType: "lists",
        operations: ["listLists"],
        available: true,
      },
      {
        invoke: async () => ({ provider: "apple-reminders-eventkit" }),
      },
    );

    const executor = new DefaultToolExecutor({
      capabilityRegistry: registry,
      eventBus,
      resolveSecurityScope: async () => ({
        agentId: "agent-1",
        permissionMode: "sandbox",
        allowedCapabilities: ["lists"],
        filesystemScope: "",
        allowNetwork: true,
        allowShell: false,
        commandAllowlist: [],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 10,
        requireOutputReview: false,
      }),
    });

    const fromAppleAlias = await executor.execute(
      {
        id: "tool-apple",
        name: "lists.listLists",
        arguments: { targetProvider: "apple" },
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-1",
        lineageId: "lineage-1",
      },
    );
    expect(fromAppleAlias.isError).toBe(false);
    expect(fromAppleAlias.result).toEqual({ provider: "apple-reminders-eventkit" });

    const fromNoneAlias = await executor.execute(
      {
        id: "tool-none",
        name: "lists.listLists",
        arguments: { targetProvider: "none" },
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-2",
        lineageId: "lineage-2",
      },
    );
    expect(fromNoneAlias.isError).toBe(false);
    expect(fromNoneAlias.result).toEqual({ provider: "apple-reminders-eventkit" });
  });
});
