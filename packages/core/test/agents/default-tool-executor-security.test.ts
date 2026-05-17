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
  test("returns approval required for shell tool calls when evaluateToolAccess requires it", async () => {
    const { eventBus, registry } = makeContext();
    const accessChecks: Array<Record<string, unknown>> = [];

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
      evaluateToolAccess: async (input) => {
        accessChecks.push(input);
        return {
          allowed: false,
          requiresApproval: true,
          reason: "Managed shell requires approval",
          reasonCode: "managed_shell_requires_approval",
          approvalContext: { policy: "managed-cli" },
        };
      },
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

    expect(accessChecks).toHaveLength(1);
    expect(accessChecks[0]).toMatchObject({
      spaceId: "space-main",
      agentId: "agent-1",
      capability: "shell",
      operation: "run",
    });
    expect(permission.allowed).toBe(true);
    expect(permission.requiresApproval).toBe(true);
    expect(permission.reasonCode).toBe("managed_shell_requires_approval");
    expect(permission.reason).toBe("Managed shell requires approval");
    expect(permission.approvalContext).toEqual({ policy: "managed-cli" });
  });

  test("denies shell tool calls when evaluateToolAccess explicitly rejects them", async () => {
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
      evaluateToolAccess: async () => ({
        allowed: false,
        reason: "Managed shell denied",
        reasonCode: "managed_shell_denied",
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
    expect(permission.reasonCode).toBe("managed_shell_denied");
    expect(deniedEvents).toHaveLength(1);
    expect(deniedEvents[0]).toMatchObject({
      toolName: "shell.run",
      reasonCode: "managed_shell_denied",
    });
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

  test("routes shell approval decisions through unified tool access policy before stale allowShell denial", async () => {
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
        allowShell: false,
        commandAllowlist: [],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 10,
        requireOutputReview: false,
      }),
      evaluateToolAccess: async () => ({
        allowed: false,
        requiresApproval: true,
        reasonCode: "policy_escalation_required",
        reason: "shell.run requires approval",
        approvalContext: {
          kind: "policy_escalation",
          targetKind: "tool_operation",
          targetId: "tool_operation:shell.run",
          toolName: "run",
          requestedCapability: "shell",
          blockingScope: "gateway_profile",
          persistentApprovalSupported: true,
          approvalModes: ["once", "time_window", "durable"],
          defaultTtlSeconds: 3600,
        },
      }),
    });

    const permission = await executor.checkPermission(
      {
        id: "tool-approval",
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

    expect(permission.allowed).toBe(true);
    expect(permission.requiresApproval).toBe(true);
    expect(permission.reasonCode).toBe("policy_escalation_required");
  });

  test("routes shell denials through unified tool access policy before stale allowShell denial", async () => {
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
        allowShell: false,
        commandAllowlist: [],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 10,
        requireOutputReview: false,
      }),
      evaluateToolAccess: async () => ({
        allowed: false,
        reasonCode: "dangerous_access_requires_owner_full_access",
        reason: "full access required",
      }),
    });

    const permission = await executor.checkPermission(
      {
        id: "tool-denied-by-policy",
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
    expect(permission.reasonCode).toBe("dangerous_access_requires_owner_full_access");
  });

  test("routes injected-tool approval requirements through the injected-tool policy hook", async () => {
    const { eventBus, registry } = makeContext();
    const executor = new DefaultToolExecutor({
      capabilityRegistry: registry,
      eventBus,
      injectedToolDefinitions: [{
        name: "concierge.request_user_input",
        description: "Request user input through concierge escalation.",
        inputSchema: { type: "object", properties: {} },
      }],
      injectedToolFilter: async () => true,
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
      evaluateInjectedToolAccess: async () => ({
        allowed: false,
        requiresApproval: true,
        reasonCode: "policy_escalation_required",
        reason: "concierge.request_user_input requires approval",
        approvalContext: {
          kind: "policy_escalation",
          targetKind: "tool_selector",
          targetId: "tool_operation:concierge.request_user_input",
        },
      }),
    });

    const permission = await executor.checkPermission(
      {
        id: "tool-concierge-1",
        name: "concierge.request_user_input",
        arguments: {},
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-1",
        lineageId: "lineage-1",
      },
    );

    expect(permission.allowed).toBe(true);
    expect(permission.requiresApproval).toBe(true);
    expect(permission.reasonCode).toBe("policy_escalation_required");
    expect(permission.approvalContext).toEqual({
      kind: "policy_escalation",
      targetKind: "tool_selector",
      targetId: "tool_operation:concierge.request_user_input",
    });
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

  test("normalizes targetProvider aliases for email tools", async () => {
    const { eventBus, registry } = makeContext();
    registry.register(
      {
        id: "apple-mail-mailkit",
        name: "Apple Mail",
        source: "adapter",
        capabilityType: "email",
        operations: ["listAccounts"],
        available: true,
      },
      {
        invoke: async () => ({ provider: "apple-mail-mailkit" }),
      },
    );

    const executor = new DefaultToolExecutor({
      capabilityRegistry: registry,
      eventBus,
      resolveSecurityScope: async () => ({
        agentId: "agent-1",
        permissionMode: "sandbox",
        allowedCapabilities: ["email"],
        filesystemScope: "",
        allowNetwork: true,
        allowShell: false,
        commandAllowlist: [],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 10,
        requireOutputReview: false,
      }),
    });

    const fromMailAlias = await executor.execute(
      {
        id: "tool-mail",
        name: "email.listAccounts",
        arguments: { targetProvider: "mail" },
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-1",
        lineageId: "lineage-1",
      },
    );
    expect(fromMailAlias.isError).toBe(false);
    expect(fromMailAlias.result).toEqual({ provider: "apple-mail-mailkit" });
  });

  test("passes accessMode through capability policy context during execution", async () => {
    const { eventBus, registry } = makeContext();
    let receivedAccessMode: string | undefined;

    registry.setGatewayPolicyEvaluator((_capability, _operation, _args, context) => {
      receivedAccessMode = context?.accessMode;
      return { allowed: true };
    });

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
        commandAllowlist: [],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 10,
        requireOutputReview: false,
      }),
    });

    const result = await executor.execute(
      {
        id: "tool-shell",
        name: "shell.run",
        arguments: { command: "echo hello" },
      },
      {
        spaceId: "space-main",
        agentId: "agent-1",
        turnId: "turn-1",
        lineageId: "lineage-1",
        accessMode: "full_access",
      },
    );

    expect(result.isError).toBeFalsy();
    expect(receivedAccessMode).toBe("full_access");
  });
});
