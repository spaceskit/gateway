import { describe, expect, test } from "bun:test";
import { GatewayClient } from "../../src/client/gateway-client.js";

describe("GatewayClient reset dispatch", () => {
  test("factoryResetGateway uses gateway.factory_reset with 180s minimum timeout", async () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:65535",
      reconnect: false,
      requestTimeoutMs: 250,
    });

    const calls: Array<{ type: string; payload: unknown; timeoutMs: number }> = [];
    (client as any).sendAndWaitForResponse = async (
      type: string,
      payload: unknown,
      timeoutMs: number,
    ) => {
      calls.push({ type, payload, timeoutMs });
      return {
        gatewayId: "resource:main",
        resetAt: "2026-03-02T22:00:00.000Z",
        tablesCleared: 17,
        rowsDeleted: 321,
      };
    };

    const result = await client.factoryResetGateway({
      confirmation: "DELETE resource:main",
    });

    expect(calls).toEqual([
      {
        type: "gateway.factory_reset",
        payload: { confirmation: "DELETE resource:main" },
        timeoutMs: 180_000,
      },
    ]);
    expect(result.rowsDeleted).toBe(321);
  });

  test("factoryResetGateway preserves a longer client timeout", async () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:65535",
      reconnect: false,
      requestTimeoutMs: 240_000,
    });

    const observedTimeouts: number[] = [];
    (client as any).sendAndWaitForResponse = async (
      _type: string,
      _payload: unknown,
      timeoutMs: number,
    ) => {
      observedTimeouts.push(timeoutMs);
      return {
        gatewayId: "resource:main",
        resetAt: "2026-03-02T22:00:00.000Z",
        tablesCleared: 1,
        rowsDeleted: 1,
      };
    };

    await client.factoryResetGateway({ confirmation: "DELETE resource:main" });
    expect(observedTimeouts).toEqual([240_000]);
  });

  test("resetSpace uses space.reset with 180s minimum timeout", async () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:65535",
      reconnect: false,
      requestTimeoutMs: 250,
    });

    const calls: Array<{ type: string; payload: unknown; timeoutMs: number }> = [];
    (client as any).sendAndWaitForResponse = async (
      type: string,
      payload: unknown,
      timeoutMs: number,
    ) => {
      calls.push({ type, payload, timeoutMs });
      return {
        spaceId: "space-reset-target",
        resetAt: "2026-03-02T22:00:00.000Z",
        tablesCleared: 9,
        rowsDeleted: 42,
      };
    };

    const result = await client.resetSpace({
      spaceId: "space-reset-target",
    });

    expect(calls).toEqual([
      {
        type: "space.reset",
        payload: { spaceId: "space-reset-target" },
        timeoutMs: 180_000,
      },
    ]);
    expect(result.rowsDeleted).toBe(42);
  });

  test("resetSpace preserves a longer client timeout", async () => {
    const client = new GatewayClient({
      url: "ws://127.0.0.1:65535",
      reconnect: false,
      requestTimeoutMs: 240_000,
    });

    const observedTimeouts: number[] = [];
    (client as any).sendAndWaitForResponse = async (
      _type: string,
      _payload: unknown,
      timeoutMs: number,
    ) => {
      observedTimeouts.push(timeoutMs);
      return {
        spaceId: "space-reset-target",
        resetAt: "2026-03-02T22:00:00.000Z",
        tablesCleared: 1,
        rowsDeleted: 1,
      };
    };

    await client.resetSpace({ spaceId: "space-reset-target" });
    expect(observedTimeouts).toEqual([240_000]);
  });
});
