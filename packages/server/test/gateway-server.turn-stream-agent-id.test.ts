import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";
import { resolveGatewayTurnAgentId } from "../src/gateway-event-broadcaster.js";
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

  test("preserves transcript visibility and stream kind on turn-stream payloads", async () => {
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
      turnId: "turn-visibility-1",
      rootTurnId: "root-turn-1",
      conversationTopology: "shared_team_chat",
      event: {
        type: "text_delta",
        text: "checking",
        agentId: "agent-stream-2",
        transcriptVisibility: "activity_only",
        streamKind: "provider_client",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.msg.type).toBe(MessageTypes.TURN_STREAM);
    expect(published[0]?.msg.payload.agentId).toBe("agent-stream-2");
    expect(published[0]?.msg.payload.rootTurnId).toBe("root-turn-1");
    expect(published[0]?.msg.payload.conversationTopology).toBe("shared_team_chat");
    expect(published[0]?.msg.payload.transcriptVisibility).toBe("activity_only");
    expect(published[0]?.msg.payload.streamKind).toBe("provider_client");
  });

  test("does not recover agentId from nested turn_completed.result payloads", () => {
    const resolvedAgentId = resolveGatewayTurnAgentId(
      {},
      {
        type: "turn_completed",
        result: {
          agentId: "agent-from-result",
        },
      },
    );

    expect(resolvedAgentId).toBe("unknown-agent");
  });

  test("uses unknown-agent only when no agent id source exists", async () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    const resolvedAgentId = resolveGatewayTurnAgentId(
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
    expect(published[0]?.msg.payload.eventType).toBeUndefined();
    expect(published[0]?.msg.payload.data).toBeUndefined();
    expect(published[0]?.msg.payload.typedPayload.kind).toBe("rate_limited");
    expect(published[0]?.msg.payload.typedPayload.retryAfterMs).toBe(1200);
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
    expect(published[0]?.msg.payload.eventType).toBeUndefined();
    expect(published[0]?.msg.payload.data).toBeUndefined();
    expect(published[0]?.msg.payload.typedPayload.kind).toBe("state.changed");
    expect(published[0]?.msg.payload.typedPayload.state).toBe("needs_feedback");
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
    expect(published[0]?.msg.payload.eventType).toBeUndefined();
    expect(published[0]?.msg.payload.data).toBeUndefined();
    expect(published[0]?.msg.payload.typedPayload.kind).toBe("reasoning.delta");
    expect(published[0]?.msg.payload.typedPayload.text).toBe("thinking");
  });
});
