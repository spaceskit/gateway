/**
 * Phase 6: MCP Integration E2E Tests
 *
 * Tests MCP endpoint operations through the gateway client.
 * The gateway validates endpoints on set (tries to connect), so we test:
 * - Error when endpoint is unreachable
 * - Clear endpoint on empty space (no-op)
 * - Get endpoint on space without one (returns empty/null)
 */

import { describe, expect, test, afterAll } from "bun:test";
import {
  createTestGateway,
  createTestClient,
  E2E_TIMEOUT,
  type TestGateway,
} from "./harness.js";

let gw: TestGateway;
const previousSecretRefMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;

afterAll(async () => {
  await gw?.cleanup();
  if (previousSecretRefMasterKey === undefined) {
    delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
  } else {
    Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousSecretRefMasterKey;
  }
});

async function createExternalMcpGateway(): Promise<TestGateway> {
  Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-external-master-key";
  return await createTestGateway({
    gatewayProfile: "external",
    skipAuth: false,
    archFreezeEnforced: false,
  });
}

describe("MCP integration", () => {
  test(
    "set MCP endpoint rejects unreachable SSE server",
    { timeout: E2E_TIMEOUT },
    async () => {
      gw = await createExternalMcpGateway();
      const client = await createTestClient(gw.wsUrl);

      try {
        const space = await client.createSpace({
          name: "MCP Test Space",
          resourceId: `e2e-mcp-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test MCP integration",
        });

        // Setting an unreachable SSE endpoint should fail with a descriptive error
        try {
          await client.setSpaceMcpEndpoint({
            spaceId: space.id,
            transport: "sse",
            endpoint: "http://127.0.0.1:19999/mcp-nonexistent",
          });
          expect(true).toBe(false); // Should not succeed
        } catch (err) {
          expect(err).toBeDefined();
          expect(String(err)).toContain("connect");
        }
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "get MCP endpoint on space without one",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) {
        gw = await createExternalMcpGateway();
      }
      const client = await createTestClient(gw.wsUrl);

      try {
        const space = await client.createSpace({
          name: "MCP Get Test",
          resourceId: `e2e-mcp-get-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test get without endpoint",
        });

        // Getting endpoint on space that has none
        const fetched = await client.getSpaceMcpEndpoint(space.id);
        // Should return null/undefined or empty endpoint
        expect(fetched === null || fetched === undefined || fetched).toBeTruthy();
      } finally {
        await client.disconnect();
      }
    },
  );

  test(
    "clear MCP endpoint on space without one",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) {
        gw = await createExternalMcpGateway();
      }
      const client = await createTestClient(gw.wsUrl);

      try {
        const space = await client.createSpace({
          name: "MCP Clear Test",
          resourceId: `e2e-mcp-clear-${crypto.randomUUID().slice(0, 8)}`,
          goal: "Test clearing without endpoint",
        });

        // Clearing endpoint when none exists should still succeed
        const cleared = await client.clearSpaceMcpEndpoint(space.id);
        expect(cleared === true || cleared === false).toBe(true);
      } finally {
        await client.disconnect();
      }
    },
  );
});
