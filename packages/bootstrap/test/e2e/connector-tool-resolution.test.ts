/**
 * Connector Tool Resolution E2E Tests
 *
 * Verifies that connector tools (lists/calendar) registered by adapter clients
 * are correctly resolved by the gateway capability registry and invokable by
 * regular clients. This is the foundation for verifying that CLI executors and
 * Apple Foundation can access Reminders/Calendar through the mediated tool path.
 */

import { describe, expect, test, afterAll } from "bun:test";
import {
  createTestGateway,
  createTestClient,
  createTestAdapterClient,
  E2E_TIMEOUT,
  type TestGateway,
} from "./harness.js";
import type { AdapterProviderRegistration } from "../../../../../client-ts/src/index.js";

let gw: TestGateway;

afterAll(async () => {
  await gw?.cleanup();
});

// ---------------------------------------------------------------------------
// Mock connector providers
// ---------------------------------------------------------------------------

function listsProvider(): AdapterProviderRegistration {
  return {
    provider: {
      id: "test.reminders",
      name: "Test Reminders",
      source: "adapter",
      capabilityType: "lists",
      operations: ["listLists", "listItems", "createItem", "completeItem"],
    },
    handlers: {
      listLists: async () => ({
        lists: [
          { id: "list-1", name: "Groceries" },
          { id: "list-2", name: "Work Tasks" },
        ],
      }),
      listItems: async (args: Record<string, unknown>) => ({
        items: [
          { id: "item-1", title: "Milk", listId: args.listId, isCompleted: false },
          { id: "item-2", title: "Eggs", listId: args.listId, isCompleted: true },
        ],
      }),
      createItem: async (args: Record<string, unknown>) => ({
        id: `item-${Date.now()}`,
        title: args.title,
        listId: args.listId,
      }),
      completeItem: async (args: Record<string, unknown>) => ({
        id: args.itemId,
        isCompleted: true,
      }),
    },
  };
}

function calendarProvider(): AdapterProviderRegistration {
  return {
    provider: {
      id: "test.calendar",
      name: "Test Calendar",
      source: "adapter",
      capabilityType: "calendar",
      operations: ["listCalendars", "listEvents"],
    },
    handlers: {
      listCalendars: async () => ({
        calendars: [
          { id: "cal-1", name: "Work" },
          { id: "cal-2", name: "Personal" },
        ],
      }),
      listEvents: async (args: Record<string, unknown>) => ({
        events: [
          { id: "evt-1", title: "Standup", calendarId: args.calendarId },
        ],
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("connector tool resolution", () => {
  test(
    "lists provider registers and capability registry has providers",
    { timeout: E2E_TIMEOUT },
    async () => {
      gw = await createTestGateway({
        skipAuth: false,
        gatewayCapabilityGrants: [
          "lists.read", "lists.write", "lists.execute",
          "calendar.read", "calendar.write", "calendar.execute",
        ],
      });

      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [listsProvider()],
        undefined,
        gw.instance,
      );

      try {
        const availableCapabilities = gw.instance.capabilities.getAvailableCapabilities();
        expect(availableCapabilities).toContain("lists");

        const providers = gw.instance.capabilities.getProviders("lists");
        expect(providers.length).toBeGreaterThan(0);
        expect(providers.some((p) => p.id === "test.reminders")).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    },
  );

  test(
    "calendar provider registers and capability registry has providers",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) {
        gw = await createTestGateway({
          skipAuth: false,
          gatewayCapabilityGrants: [
            "lists.read", "lists.write", "lists.execute",
            "calendar.read", "calendar.write", "calendar.execute",
          ],
        });
      }

      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [calendarProvider()],
        undefined,
        gw.instance,
      );

      try {
        const availableCapabilities = gw.instance.capabilities.getAvailableCapabilities();
        expect(availableCapabilities).toContain("calendar");

        const providers = gw.instance.capabilities.getProviders("calendar");
        expect(providers.length).toBeGreaterThan(0);
        expect(providers.some((p) => p.id === "test.calendar")).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    },
  );

  test(
    "invoke lists.listLists through capability registry",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) {
        gw = await createTestGateway({
          skipAuth: false,
          gatewayCapabilityGrants: [
            "lists.read", "lists.write", "lists.execute",
            "calendar.read", "calendar.write", "calendar.execute",
          ],
        });
      }

      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [listsProvider()],
        undefined,
        gw.instance,
      );
      const client = await createTestClient(gw.wsUrl);
      await new Promise((r) => setTimeout(r, 200));

      try {
        const result = await client.invokeCapability(
          "lists",
          "listLists",
          {},
          "test.reminders",
        );
        expect(result).toBeDefined();
        const data = (result as Record<string, unknown>).data ?? result;
        const lists = (data as Record<string, unknown>).lists;
        expect(Array.isArray(lists)).toBe(true);
        expect((lists as unknown[]).length).toBe(2);
      } finally {
        await client.disconnect();
        await adapter.disconnect();
      }
    },
  );

  test(
    "invoke lists.listItems with listId argument",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) {
        gw = await createTestGateway({
          skipAuth: false,
          gatewayCapabilityGrants: [
            "lists.read", "lists.write", "lists.execute",
          ],
        });
      }

      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [listsProvider()],
        undefined,
        gw.instance,
      );
      const client = await createTestClient(gw.wsUrl);
      await new Promise((r) => setTimeout(r, 200));

      try {
        const result = await client.invokeCapability(
          "lists",
          "listItems",
          { listId: "list-1" },
          "test.reminders",
        );
        expect(result).toBeDefined();
        const data = (result as Record<string, unknown>).data ?? result;
        const items = (data as Record<string, unknown>).items;
        expect(Array.isArray(items)).toBe(true);
        expect((items as unknown[]).length).toBe(2);
      } finally {
        await client.disconnect();
        await adapter.disconnect();
      }
    },
  );

  test(
    "invoke calendar.listCalendars through capability registry",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) {
        gw = await createTestGateway({
          skipAuth: false,
          gatewayCapabilityGrants: [
            "calendar.read", "calendar.write", "calendar.execute",
          ],
        });
      }

      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [calendarProvider()],
        undefined,
        gw.instance,
      );
      const client = await createTestClient(gw.wsUrl);
      await new Promise((r) => setTimeout(r, 200));

      try {
        const result = await client.invokeCapability(
          "calendar",
          "listCalendars",
          {},
          "test.calendar",
        );
        expect(result).toBeDefined();
        const data = (result as Record<string, unknown>).data ?? result;
        const calendars = (data as Record<string, unknown>).calendars;
        expect(Array.isArray(calendars)).toBe(true);
        expect((calendars as unknown[]).length).toBe(2);
      } finally {
        await client.disconnect();
        await adapter.disconnect();
      }
    },
  );

  test(
    "both providers registered simultaneously",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) {
        gw = await createTestGateway({
          skipAuth: false,
          gatewayCapabilityGrants: [
            "lists.read", "lists.write", "lists.execute",
            "calendar.read", "calendar.write", "calendar.execute",
          ],
        });
      }

      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [listsProvider(), calendarProvider()],
        undefined,
        gw.instance,
      );

      try {
        const capabilities = gw.instance.capabilities.getAvailableCapabilities();
        expect(capabilities).toContain("lists");
        expect(capabilities).toContain("calendar");

        const listsProviders = gw.instance.capabilities.getProviders("lists");
        const calProviders = gw.instance.capabilities.getProviders("calendar");
        expect(listsProviders.some((p) => p.id === "test.reminders")).toBe(true);
        expect(calProviders.some((p) => p.id === "test.calendar")).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    },
  );

  test(
    "deregistered provider removes capability",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) {
        gw = await createTestGateway({
          skipAuth: false,
          gatewayCapabilityGrants: [
            "lists.read", "lists.write", "lists.execute",
          ],
        });
      }

      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [listsProvider()],
        undefined,
        gw.instance,
      );

      try {
        // Verify registered
        expect(gw.instance.capabilities.getAvailableCapabilities()).toContain("lists");

        // Deregister
        await adapter.deregisterProvider("test.reminders");

        // Verify removed
        const listsProviders = gw.instance.capabilities.getProviders("lists");
        expect(listsProviders.some((p) => p.id === "test.reminders")).toBe(false);
      } finally {
        await adapter.disconnect();
      }
    },
  );
});
