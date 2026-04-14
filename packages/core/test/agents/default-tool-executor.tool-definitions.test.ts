import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "../../src/agents/model-provider.js";
import { DefaultToolExecutor } from "../../src/agents/default-tool-executor.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { AgentSecurityScope } from "../../src/security/types.js";
import { EventBus } from "../../src/events/event-bus.js";

function buildExecutor(options?: {
  scope?: Partial<AgentSecurityScope>;
  approvableCliTools?: ToolDefinition[];
}) {
  const eventBus = new EventBus();
  const registry = new CapabilityRegistry(eventBus);

  registry.register(
    {
      id: "apple-reminders-eventkit",
      name: "Apple Reminders",
      source: "adapter",
      capabilityType: "lists",
      operations: [
        "listLists",
        "createList",
        "updateList",
        "deleteList",
        "listItems",
        "createItem",
        "updateItem",
        "completeItem",
        "deleteItem",
      ],
      available: true,
    },
    {
      invoke: async () => ({ ok: true }),
    },
  );

  registry.register(
    {
      id: "apple-calendar-eventkit",
      name: "Apple Calendar",
      source: "adapter",
      capabilityType: "calendar",
      operations: [
        "listCalendars",
        "listEvents",
        "getEvent",
        "createEvent",
        "updateEvent",
        "deleteEvent",
      ],
      available: true,
    },
    {
      invoke: async () => ({ ok: true }),
    },
  );

  registry.register(
    {
      id: "apple-mail-mailkit",
      name: "Apple Mail",
      source: "adapter",
      capabilityType: "email",
      operations: [
        "listAccounts",
        "listMailboxes",
        "listMessages",
        "getMessage",
        "listComposeSessions",
        "getComposeSession",
      ],
      available: true,
    },
    {
      invoke: async () => ({ ok: true }),
    },
  );

  return new DefaultToolExecutor({
    capabilityRegistry: registry,
    eventBus,
    resolveSecurityScope: async () => ({
      agentId: "agent-1",
      permissionMode: "sandbox",
      allowedCapabilities: ["lists", "calendar", "email"],
      filesystemScope: "",
      allowNetwork: true,
      allowShell: false,
      commandAllowlist: [],
      maxTokensPerTurn: 4096,
      maxToolCallsPerTurn: 10,
      requireOutputReview: false,
      ...options?.scope,
    }),
    getApprovableCliTools: options?.approvableCliTools
      ? () => options.approvableCliTools ?? []
      : undefined,
  });
}

function schemaFor(tool: ToolDefinition): {
  required?: string[];
  properties?: Record<string, Record<string, unknown>>;
} {
  return tool.inputSchema as {
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
  };
}

describe("DefaultToolExecutor tool definitions", () => {
  test("exposes explicit reminder and calendar schemas instead of fallback metadata", async () => {
    const executor = buildExecutor();
    const tools = await executor.getAvailableTools("space-main", "agent-1");
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

    expect(tools.filter((tool) => tool.name.startsWith("lists.")).map((tool) => tool.name).sort()).toEqual([
      "lists.completeItem",
      "lists.createItem",
      "lists.createList",
      "lists.deleteItem",
      "lists.deleteList",
      "lists.listItems",
      "lists.listLists",
      "lists.updateItem",
      "lists.updateList",
    ]);
    expect(tools.filter((tool) => tool.name.startsWith("calendar.")).map((tool) => tool.name).sort()).toEqual([
      "calendar.createEvent",
      "calendar.deleteEvent",
      "calendar.getEvent",
      "calendar.listCalendars",
      "calendar.listEvents",
      "calendar.updateEvent",
    ]);
    expect(tools.filter((tool) => tool.name.startsWith("email.")).map((tool) => tool.name).sort()).toEqual([
      "email.getComposeSession",
      "email.getMessage",
      "email.listAccounts",
      "email.listComposeSessions",
      "email.listMailboxes",
      "email.listMessages",
    ]);

    const createItem = toolMap.get("lists.createItem");
    expect(createItem?.description).toContain("lists.listLists");
    expect(schemaFor(createItem!).required).toEqual(["listId", "title"]);
    expect(schemaFor(createItem!).properties).toHaveProperty("priority");
    expect(schemaFor(createItem!).properties).toHaveProperty("startAt");

    const updateItem = toolMap.get("lists.updateItem");
    expect(updateItem?.description).toContain("isCompleted: false");
    expect(schemaFor(updateItem!).required).toEqual(["itemId"]);
    expect(schemaFor(updateItem!).properties?.isCompleted?.description).toContain("reopen");

    const completeItem = toolMap.get("lists.completeItem");
    expect(completeItem?.description).toContain("mark done");
    expect(schemaFor(completeItem!).required).toEqual(["itemId"]);
    expect(schemaFor(completeItem!).properties).toHaveProperty("itemId");

    const listEvents = toolMap.get("calendar.listEvents");
    expect(listEvents?.description).toContain("calendar.listCalendars");
    expect(schemaFor(listEvents!).properties).toHaveProperty("startAt");
    expect(schemaFor(listEvents!).properties).toHaveProperty("limit");

    const createEvent = toolMap.get("calendar.createEvent");
    expect(createEvent?.description).toContain("calendar.listCalendars");
    expect(schemaFor(createEvent!).required).toEqual(["calendarId", "title", "startAt", "endAt"]);
    expect(schemaFor(createEvent!).properties).toHaveProperty("recurrence");

    const updateEvent = toolMap.get("calendar.updateEvent");
    expect(updateEvent?.description).toContain("recurrence");
    expect(schemaFor(updateEvent!).required).toEqual(["eventId"]);
    expect(schemaFor(updateEvent!).properties).toHaveProperty("notes");

    const listMailboxes = toolMap.get("email.listMailboxes");
    expect(listMailboxes?.description).toContain("email.listAccounts");
    expect(schemaFor(listMailboxes!).properties).toHaveProperty("accountId");

    const listMessages = toolMap.get("email.listMessages");
    expect(listMessages?.description).toContain("not a full mailbox sync");
    expect(schemaFor(listMessages!).properties).toHaveProperty("mailboxId");
    expect(schemaFor(listMessages!).properties).toHaveProperty("limit");

    const getMessage = toolMap.get("email.getMessage");
    expect(schemaFor(getMessage!).required).toEqual(["messageId"]);

    const getComposeSession = toolMap.get("email.getComposeSession");
    expect(schemaFor(getComposeSession!).required).toEqual(["composeSessionId"]);
  });

  test("filters approvable CLI tools when shell is outside the allowed capability scope", async () => {
    const executor = buildExecutor({
      scope: {
        allowedCapabilities: ["lists"],
      },
      approvableCliTools: [{
        name: "shell.hrvst.projects.list",
        description: "List Harvest projects",
        inputSchema: { type: "object", properties: {} },
      }],
    });

    const tools = await executor.getAvailableTools("space-main", "agent-1");
    expect(tools.some((tool) => tool.name === "shell.hrvst.projects.list")).toBe(false);
    expect(tools.some((tool) => tool.name === "lists.listLists")).toBe(true);
  });

  test("keeps approvable CLI tools visible when shell is explicitly allowed", async () => {
    const executor = buildExecutor({
      scope: {
        allowedCapabilities: ["lists", "shell"],
        allowShell: true,
      },
      approvableCliTools: [{
        name: "shell.hrvst.projects.list",
        description: "List Harvest projects",
        inputSchema: { type: "object", properties: {} },
      }],
    });

    const tools = await executor.getAvailableTools("space-main", "agent-1");
    expect(tools.some((tool) => tool.name === "shell.hrvst.projects.list")).toBe(true);
  });
});
