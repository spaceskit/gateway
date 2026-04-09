/**
 * Phase 2: Client ↔ Gateway WebSocket E2E Tests
 *
 * Real GatewayClient connecting to a real in-process gateway over WebSocket.
 */

import { describe, expect, test, afterAll } from "bun:test";
import {
  createTestGateway,
  createTestClient,
  E2E_TIMEOUT,
  type TestGateway,
} from "./harness.js";

let gw: TestGateway;

afterAll(async () => {
  await gw?.cleanup();
});

describe("client ↔ gateway WebSocket", () => {
  test(
    "connect and ping",
    { timeout: E2E_TIMEOUT },
    async () => {
      gw = await createTestGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        expect(client.isConnected).toBe(true);
        await client.ping();
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "create space",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        const space = await client.createSpace({
          name: "E2E Test Space",
          resourceId: `e2e-res-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test space creation",
        });
        expect(space).toBeDefined();
        expect(space.id).toBeTruthy();
        expect(space.name).toBe("E2E Test Space");
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "subscribe and execute turn (ack)",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        const space = await client.createSpace({
          name: "Subscribe Test",
          resourceId: `e2e-res-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test subscriptions",
        });
        await client.subscribe([space.id]);

        // Execute turn — gets ack'd by message router even without a provider
        const result = await client.executeTurn(
          space.spaceUid ?? space.id,
          "hello",
        );
        expect(result.turnId).toBeTruthy();
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "execute turn returns ack with turnId",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        const space = await client.createSpace({
          name: "Turn Test",
          resourceId: `e2e-res-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test turn execution",
        });

        const result = await client.executeTurn(
          space.spaceUid ?? space.id,
          "test message",
        );
        expect(result).toBeDefined();
        expect(result.turnId).toBeTruthy();
        expect(result.spaceId).toBeTruthy();
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "bootstrap main space",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        const result = await client.connectAndBootstrapMainSpace();
        expect(result).toBeDefined();
        expect(result.space).toBeDefined();
        expect(result.space.id).toBeTruthy();
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "agent-definition CRUD",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        // Create
        const createResult = await client.createAgentDefinition({
          name: "E2E Test Agent Definition",
          instructions: "You are a test agent",
        });
        expect(createResult.agentDefinition).toBeDefined();
        expect(createResult.agentDefinition.agentDefinitionId).toBeTruthy();
        expect(createResult.agentDefinition.name).toBe("E2E Test Agent Definition");

        const agentDefinitionId = createResult.agentDefinition.agentDefinitionId;

        // Get
        const fetched = await client.getAgentDefinition(agentDefinitionId);
        expect(fetched.name).toBe("E2E Test Agent Definition");

        // Update
        const updateResult = await client.updateAgentDefinition({
          agentDefinitionId,
          name: "Updated E2E Agent Definition",
        });
        expect(updateResult.agentDefinition.name).toBe("Updated E2E Agent Definition");

        // List
        const agentDefinitions = await client.listAgentDefinitions();
        expect(agentDefinitions.length).toBeGreaterThan(0);
        const found = agentDefinitions.find((entry) => entry.agentDefinitionId === agentDefinitionId);
        expect(found).toBeDefined();

        // Archive
        const archived = await client.archiveAgentDefinition({ agentDefinitionId });
        expect(archived).toBeDefined();
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "agent assignment to space",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        const createResult = await client.createAgentDefinition({
          name: "Agent Definition",
          instructions: "Test",
        });
        const profileId = createResult.agentDefinition.agentDefinitionId;

        const space = await client.createSpace({
          name: "Agent Assignment Test",
          resourceId: `e2e-res-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test agent assignment",
        });

        const agentId = `test-agent-${crypto.randomUUID().slice(0, 8)}`;

        // Add agent
        const addResult = await client.addAgent({
          spaceId: space.id,
          agentId,
          profileId,
          role: "participant",
        });
        expect(addResult).toBeDefined();

        // List assignments
        const assignments = await client.listAgentAssignments(space.id);
        expect(assignments.length).toBeGreaterThanOrEqual(1);

        // Remove agent
        const removeResult = await client.removeAgent({
          spaceId: space.id,
          agentId,
        });
        expect(removeResult).toBeDefined();
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "archive and delete space round-trip",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        const space = await client.createSpace({
          name: "Lifecycle Test",
          resourceId: `e2e-res-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test archive and delete lifecycle",
        });

        const archived = await client.archiveSpace({
          spaceId: space.id,
        });
        expect(archived.archived).toBe(true);
        expect(archived.space.status).toBe("archived");

        const defaultSpacesAfterArchive = await client.listSpaces();
        expect(defaultSpacesAfterArchive.some((entry) => entry.id === space.id)).toBe(false);

        const archivedSpaces = await client.listSpaces({
          statuses: ["archived"],
        });
        expect(archivedSpaces.some((entry) => entry.id === space.id)).toBe(true);

        const deleted = await client.deleteSpace({
          spaceId: space.id,
        });
        expect(deleted.deleted).toBe(true);
        expect(deleted.space?.status).toBe("deleted");

        const defaultSpacesAfterDelete = await client.listSpaces();
        expect(defaultSpacesAfterDelete.some((entry) => entry.id === space.id)).toBe(false);

        const deletedSpaces = await client.listSpaces({
          statuses: ["deleted"],
        });
        expect(deletedSpaces.some((entry) => entry.id === space.id)).toBe(true);
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "two clients subscribe to same space",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const client1 = await createTestClient(gw.wsUrl);
      const client2 = await createTestClient(gw.wsUrl);

      try {
        const space = await client1.createSpace({
          name: "Multi-Client Test",
          resourceId: `e2e-res-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test multi-client subscriptions",
        });

        await client1.subscribe([space.id]);
        await client2.subscribe([space.id]);

        // Both clients can see the space
        const space1 = await client1.getSpace(space.id);
        const space2 = await client2.getSpace(space.id);
        expect(space1.id).toBe(space2.id);

        // Execute turn from client1
        const result = await client1.executeTurn(
          space.spaceUid ?? space.id,
          "hello from client1",
        );
        expect(result.turnId).toBeTruthy();
      } finally {
        await client1.disconnect();
        await client2.disconnect();
      }
    },
  );
});
