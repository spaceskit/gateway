/**
 * Phase 4: Adapter Capability Round-Trip E2E Tests
 *
 * Tests adapter client registering capabilities and regular client invoking them.
 * Note: adapter clients require auth to be enabled so the server receives clientType.
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

function echoProvider(): AdapterProviderRegistration {
  return {
    provider: {
      id: "e2e.echo",
      name: "E2E Echo Provider",
      source: "adapter",
      capabilityType: "lists",
      operations: ["echo", "error"],
    },
    handlers: {
      echo: async (args: Record<string, unknown>) => ({
        echoed: args,
      }),
      error: async () => {
        throw new Error("Intentional adapter error");
      },
    },
  };
}

describe("adapter capability round-trip", () => {
  test(
    "register capability via adapter client",
    { timeout: E2E_TIMEOUT },
    async () => {
      // Auth must be enabled for adapter clientType detection
      // Grant "lists" capability for adapter registration
      gw = await createTestGateway({
        skipAuth: false,
        gatewayCapabilityGrants: ["lists.read", "lists.write", "lists.execute"],
      });
      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [echoProvider()],
        undefined,
        gw.instance,
      );

      try {
        expect(adapter.isConnected).toBe(true);
      } finally {
        await adapter.disconnect();
      }
    },
  );

  test(
    "invoke capability round-trip: client → gateway → adapter → client",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway({ skipAuth: false, gatewayCapabilityGrants: ["lists.read", "lists.write", "lists.execute"] });
      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [echoProvider()],
        undefined,
        gw.instance,
      );
      const client = await createTestClient(gw.wsUrl);

      try {
        // Wait for the regular client's auth to complete too
        await new Promise((r) => setTimeout(r, 200));

        const result = await client.invokeCapability(
          "lists",
          "echo",
          { message: "hello" },
          "e2e.echo",
        );
        expect(result).toBeDefined();
        // The result comes from the adapter handler — check the echoed data
        const data = (result as Record<string, unknown>).data ?? result;
        expect((data as Record<string, unknown>).echoed).toEqual({
          message: "hello",
        });
      } finally {
        await client.disconnect();
        await adapter.disconnect();
      }
    },
  );

  test(
    "deregister capability and verify subsequent invocations fail",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway({ skipAuth: false, gatewayCapabilityGrants: ["lists.read", "lists.write", "lists.execute"] });
      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [echoProvider()],
        undefined,
        gw.instance,
      );
      const client = await createTestClient(gw.wsUrl);
      await new Promise((r) => setTimeout(r, 200));

      try {
        // First invocation should work
        const result = await client.invokeCapability(
          "lists",
          "echo",
          { message: "before deregister" },
          "e2e.echo",
        );
        expect(result).toBeDefined();

        // Deregister
        await adapter.deregisterProvider("e2e.echo");

        // Subsequent invocation should fail
        try {
          await client.invokeCapability(
            "echo",
            "echo",
            { message: "after deregister" },
            "e2e.echo",
          );
          expect(true).toBe(false);
        } catch {
          // Expected: capability no longer available
        }
      } finally {
        await client.disconnect();
        await adapter.disconnect();
      }
    },
  );

  test(
    "error propagation from adapter handler to client",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway({ skipAuth: false, gatewayCapabilityGrants: ["lists.read", "lists.write", "lists.execute"] });
      const adapter = await createTestAdapterClient(
        gw.wsUrl,
        [echoProvider()],
        undefined,
        gw.instance,
      );
      const client = await createTestClient(gw.wsUrl);
      await new Promise((r) => setTimeout(r, 200));

      try {
        try {
          await client.invokeCapability(
            "lists",
            "error",
            {},
            "e2e.echo",
          );
          expect(true).toBe(false);
        } catch {
          // Expected: adapter threw an error
        }
      } finally {
        await client.disconnect();
        await adapter.disconnect();
      }
    },
  );
});
