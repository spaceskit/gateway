import { describe, expect, test } from "bun:test";
import {
  AuditEventsRepository,
  SpaceRepository,
  SpaceToolPolicyRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { CapabilityRegistry, EventBus } from "@spaceskit/core";
import { SpaceToolPolicyService } from "../src/services/space-tool-policy-service.js";

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-tool-policy-${crypto.randomUUID()}`,
  });
  const capabilities = new CapabilityRegistry(new EventBus());
  const spaces = new SpaceRepository(db.db);
  const toolPolicies = new SpaceToolPolicyRepository(db.db);
  const auditRepo = new AuditEventsRepository(db.db);

  spaces.create({
    spaceId: "space-main",
    resourceId: "resource-main",
    spaceType: "space",
    name: "Main Space",
    goal: "",
    turnModel: "sequential_all",
    configJson: JSON.stringify({
      spaceUid: "11111111-1111-1111-8111-111111111111",
    }),
  });

  const service = new SpaceToolPolicyService({
    capabilities,
    spaceAdminService: {
      getSpace: async (spaceId: string) => ({
        id: spaceId,
        agents: [],
      }),
    } as any,
    toolPolicies,
    gatewayProfile: "external",
    cliToolService: {
      getTool: (toolId: string) => {
        if (toolId === "diagnose") {
          return {
            id: toolId,
            bundleId: "ops-tools",
          };
        }
        return undefined;
      },
    },
    auditRepo,
    now: () => new Date("2026-03-11T10:00:00.000Z"),
  });

  capabilities.register(
    {
      id: "apple-calendar-eventkit",
      name: "Apple Calendar",
      source: "adapter",
      capabilityType: "calendar",
      operations: ["listCalendars"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );
  capabilities.register(
    {
      id: "apple-reminders-eventkit",
      name: "Apple Reminders",
      source: "adapter",
      capabilityType: "lists",
      operations: ["listLists"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );
  capabilities.register(
    {
      id: "apple-mail-mailkit",
      name: "Apple Mail",
      source: "adapter",
      capabilityType: "email",
      operations: ["listMessages"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );
  capabilities.register(
    {
      id: "shell-local",
      name: "Diagnostics",
      source: "builtin",
      capabilityType: "shell",
      operations: ["diagnose"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );
  capabilities.register(
    {
      id: "connector-slack",
      name: "Slack",
      source: "connector",
      capabilityType: "messaging",
      operations: ["sendMessage"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );

  return { db, capabilities, toolPolicies, auditRepo, service };
}

function parseJsonList(raw: string | undefined): string[] {
  if (!raw) return [];
  return JSON.parse(raw) as string[];
}

describe("SpaceToolPolicyService", () => {
  test("updates connector selectors without dropping existing raw tool rules", async () => {
    const context = createContext();

    try {
      context.toolPolicies.upsert({
        spaceId: "space-main",
        allowedTools: ["lists.*"],
        deniedTools: ["shell.run"],
        policyVersion: "raw-v1",
        updatedBy: "raw-user",
      });

      const policy = await context.service.updateConnectorPolicy({
        spaceId: "space-main",
        mode: "custom",
        entries: [
          {
            sourceKind: "connector_family",
            sourceId: "apple-reminders-eventkit",
            state: "disabled",
          },
          {
            sourceKind: "cli_bundle",
            sourceId: "ops-tools",
            state: "enabled",
          },
        ],
        updatedBy: "principal-owner",
      });

      expect(policy.mode).toBe("custom");
      expect(policy.entries).toEqual([
        {
          sourceKind: "connector_family",
          sourceId: "apple-reminders-eventkit",
          state: "disabled",
        },
        {
          sourceKind: "cli_bundle",
          sourceId: "ops-tools",
          state: "enabled",
        },
      ]);

      const row = context.toolPolicies.getBySpace("space-main");
      expect(parseJsonList(row?.allowed_tools_json)).toEqual([
        "lists.*",
        "cli_bundle:ops-tools",
      ]);
      expect(parseJsonList(row?.denied_tools_json)).toEqual([
        "shell.run",
        "connector_family:apple-reminders-eventkit",
      ]);
    } finally {
      context.db.close();
    }
  });

  test("maps built-in, CLI bundle, and connector providers to connector selectors and resets to all enabled", async () => {
    const context = createContext();

    try {
      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "calendar",
        operation: "listCalendars",
      })).toMatchObject({
        visibleProviderIds: ["apple-calendar-eventkit"],
        deniedProviderIds: [],
      });

      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "lists",
        operation: "listLists",
      })).toMatchObject({
        visibleProviderIds: ["apple-reminders-eventkit"],
        deniedProviderIds: [],
      });

      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "email",
        operation: "listMessages",
      })).toMatchObject({
        visibleProviderIds: ["apple-mail-mailkit"],
        deniedProviderIds: [],
      });

      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "shell",
        operation: "diagnose",
      })).toMatchObject({
        visibleProviderIds: ["shell-local"],
        deniedProviderIds: [],
      });

      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "messaging",
        operation: "sendMessage",
      })).toMatchObject({
        visibleProviderIds: ["connector-slack"],
        deniedProviderIds: [],
      });

      await context.service.updateConnectorPolicy({
        spaceId: "space-main",
        mode: "custom",
        entries: [
          {
            sourceKind: "connector_family",
            sourceId: "apple-calendar-eventkit",
            state: "disabled",
          },
          {
            sourceKind: "connector_family",
            sourceId: "apple-mail-mailkit",
            state: "disabled",
          },
          {
            sourceKind: "connector_family",
            sourceId: "apple-reminders-eventkit",
            state: "disabled",
          },
          {
            sourceKind: "cli_bundle",
            sourceId: "ops-tools",
            state: "disabled",
          },
          {
            sourceKind: "connector_instance",
            sourceId: "connector-slack",
            state: "disabled",
          },
        ],
      });

      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "calendar",
        operation: "listCalendars",
      })).toMatchObject({
        visibleProviderIds: [],
        deniedProviderIds: ["apple-calendar-eventkit"],
        denyReasonCode: "space_connector_disabled",
      });

      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "lists",
        operation: "listLists",
      })).toMatchObject({
        visibleProviderIds: [],
        deniedProviderIds: ["apple-reminders-eventkit"],
        denyReasonCode: "space_connector_disabled",
      });

      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "shell",
        operation: "diagnose",
      })).toMatchObject({
        visibleProviderIds: [],
        deniedProviderIds: ["shell-local"],
        denyReasonCode: "space_connector_disabled",
      });

      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "messaging",
        operation: "sendMessage",
      })).toMatchObject({
        visibleProviderIds: [],
        deniedProviderIds: ["connector-slack"],
        denyReasonCode: "space_connector_disabled",
      });

      const matrix = await context.service.getEffectiveTools({
        spaceId: "space-main",
      });
      expect(matrix.operations.find((entry) => entry.operationId === "calendar.listCalendars")?.denyReasons).toContainEqual({
        code: "space_connector_disabled",
        message: "All providers for calendar.listCalendars are disabled by space connector policy.",
      });
      expect(matrix.operations.find((entry) => entry.operationId === "lists.listLists")?.denyReasons).toContainEqual({
        code: "space_connector_disabled",
        message: "All providers for lists.listLists are disabled by space connector policy.",
      });

      await context.service.updateConnectorPolicy({
        spaceId: "space-main",
        mode: "all_enabled",
      });

      const resetPolicy = await context.service.getConnectorPolicy({ spaceId: "space-main" });
      expect(resetPolicy.mode).toBe("all_enabled");
      expect(resetPolicy.entries).toEqual([]);
      expect(context.service.resolveToolProviderVisibility({
        spaceId: "space-main",
        capability: "lists",
        operation: "listLists",
      }).visibleProviderIds).toEqual(["apple-reminders-eventkit"]);
    } finally {
      context.db.close();
    }
  });

  test("records audit events for policy updates and blocked tool calls", async () => {
    const context = createContext();

    try {
      await context.service.updateConnectorPolicy({
        spaceId: "space-main",
        mode: "custom",
        entries: [{
          sourceKind: "connector_family",
          sourceId: "apple-reminders-eventkit",
          state: "disabled",
        }],
        updatedBy: "principal-owner",
      });

      context.service.recordBlockedToolInvocation({
        spaceId: "space-main",
        agentId: "agent-1",
        toolName: "lists.listLists",
        reasonCode: "space_connector_disabled",
        reason: "Apple Reminders disabled for this space.",
        principalId: "principal-owner",
        deviceId: "device-1",
      });

      const events = context.auditRepo.list();
      expect(events.map((event) => event.event_type)).toEqual([
        "space_connector_policy.updated",
        "space_connector_policy.blocked_tool_call",
      ]);
      expect(JSON.parse(events[0].payload_json)).toMatchObject({
        mode: "custom",
        entries: [{
          sourceKind: "connector_family",
          sourceId: "apple-reminders-eventkit",
          state: "disabled",
        }],
      });
      expect(JSON.parse(events[1].payload_json)).toMatchObject({
        toolName: "lists.listLists",
        reasonCode: "space_connector_disabled",
      });
    } finally {
      context.db.close();
    }
  });
});
