import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";
import { MessageTypes } from "../src/protocol.js";

describe("GatewayServer turn stream agent id propagation", () => {
  test("preserves agentId from space manager events for streaming chunks", async () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    const published: Array<{ spaceUid: string; msg: any }> = [];
    server.broadcastToSpace = ((spaceUid: string, msg: any) => {
      published.push({ spaceUid, msg });
    }) as GatewayServer["broadcastToSpace"];

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-1",
      event: {
        type: "text_delta",
        text: "hello",
        agentId: "agent-stream-1",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.msg.type).toBe(MessageTypes.TURN_STREAM);
    expect(published[0]?.msg.payload.agentId).toBe("agent-stream-1");
  });

  test("falls back to nested turn_completed.result.agentId when top-level id is absent", () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    const resolvedAgentId = (server as any).resolveTurnAgentId(
      {},
      {
        type: "turn_completed",
        result: {
          agentId: "agent-from-result",
        },
      },
    );

    expect(resolvedAgentId).toBe("agent-from-result");
  });

  test("uses unknown-agent only when no agent id source exists", async () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    const resolvedAgentId = (server as any).resolveTurnAgentId(
      {},
      {
        type: "text_delta",
        text: "partial",
      },
    );
    expect(resolvedAgentId).toBe("unknown-agent");

    const published: Array<{ msg: any }> = [];
    server.broadcastToSpace = ((_: string, msg: any) => {
      published.push({ msg });
    }) as GatewayServer["broadcastToSpace"];

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-2",
      event: {
        type: "text_delta",
        text: "no id available",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.msg.type).toBe(MessageTypes.TURN_STREAM);
    expect(published[0]?.msg.payload.agentId).toBe("unknown-agent");
  });

  test("maps runtime rate_limited events to turn_event lifecycle payload", async () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    const published: Array<{ spaceUid: string; msg: any }> = [];
    server.broadcastToSpace = ((spaceUid: string, msg: any) => {
      published.push({ spaceUid, msg });
    }) as GatewayServer["broadcastToSpace"];

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-3",
      event: {
        type: "rate_limited",
        retryAfterMs: 1200,
        retryAfterSeconds: 2,
        attempt: 1,
        maxAttempts: 3,
        providerId: "stub-provider",
        retryAt: "2026-03-02T12:00:00.000Z",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.msg.type).toBe(MessageTypes.TURN_EVENT);
    expect(published[0]?.msg.payload.eventType).toBe("rate_limited");
    expect((published[0]?.msg.payload.data as any).type).toBe("rate_limited");
    expect((published[0]?.msg.payload.data as any).retryAfterMs).toBe(1200);
  });

  test("maps runtime state_changed events to canonical lifecycle payload", async () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    const published: Array<{ spaceUid: string; msg: any }> = [];
    server.broadcastToSpace = ((spaceUid: string, msg: any) => {
      published.push({ spaceUid, msg });
    }) as GatewayServer["broadcastToSpace"];

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-4",
      event: {
        type: "state_changed",
        state: "needs_feedback",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.msg.type).toBe(MessageTypes.TURN_EVENT);
    expect(published[0]?.msg.payload.eventType).toBe("state_changed");
    expect((published[0]?.msg.payload.data as any).type).toBe("state_changed");
    expect((published[0]?.msg.payload.data as any).state).toBe("needs_feedback");
  });

  test("maps reasoning_delta lifecycle chunks to streaming turn_event category", async () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    const published: Array<{ spaceUid: string; msg: any }> = [];
    server.broadcastToSpace = ((spaceUid: string, msg: any) => {
      published.push({ spaceUid, msg });
    }) as GatewayServer["broadcastToSpace"];

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-5",
      event: {
        type: "reasoning_delta",
        text: "thinking",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.msg.type).toBe(MessageTypes.TURN_EVENT);
    expect(published[0]?.msg.payload.eventType).toBe("streaming");
    expect((published[0]?.msg.payload.data as any).type).toBe("reasoning_delta");
  });
});
