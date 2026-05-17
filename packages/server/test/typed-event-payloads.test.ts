import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";
import { MessageTypes } from "../src/protocol.js";

function createServer() {
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

  return { server, published };
}

describe("Typed event payloads", () => {
  test("turn.started payload is emitted for space.turn_started events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_started",
      spaceId: "space-1",
      turnId: "turn-1",
      agentId: "agent-1",
      rootTurnId: "root-1",
      conversationTopology: "direct",
      launchSnapshots: [{
        agentId: "agent-1",
        providerId: "codex",
        modelId: "gpt-5.2-codex",
        contextWindowTokens: 1_048_576,
        estimatedPromptTokens: 4_000,
        estimatedRemainingTokens: 1_044_576,
        source: "preflight",
      }],
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.eventType).toBeUndefined();
    expect(payload.data).toBeUndefined();
    expect(payload.typedPayload).toBeDefined();
    expect(payload.typedPayload.kind).toBe("turn.started");
    expect(payload.typedPayload.agentId).toBe("agent-1");
    expect(payload.typedPayload.turnId).toBe("turn-1");
    expect(payload.typedPayload.rootTurnId).toBe("root-1");
    expect(payload.typedPayload.launchSnapshots?.[0]).toMatchObject({
      agentId: "agent-1",
      providerId: "codex",
      modelId: "gpt-5.2-codex",
      contextWindowTokens: 1_048_576,
      estimatedRemainingTokens: 1_044_576,
      source: "preflight",
    });
    expect(payload.ts).toBeDefined();
    expect(payload.rootTurnId).toBe("root-1");
    expect(payload.agentId).toBe("agent-1");
  });

  test("turn.started payload falls back to the first agent when agentId is missing", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_started",
      spaceId: "space-1",
      turnId: "turn-1",
      agents: ["agent-2", "agent-3"],
      launchSnapshots: [{
        agentId: "agent-2",
        providerId: "claude",
        modelId: "claude-sonnet-4",
        contextWindowTokens: 1_000_000,
        estimatedPromptTokens: 2_000,
        estimatedRemainingTokens: 998_000,
        source: "registry",
      }],
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.agentId).toBe("agent-2");
    expect(payload.typedPayload.launchSnapshots?.[0].agentId).toBe("agent-2");
  });

  test("reasoning.delta payload is emitted for reasoning_delta events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-2",
      event: { type: "reasoning_delta", text: "Let me think..." },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.eventType).toBeUndefined();
    expect(payload.data).toBeUndefined();
    expect(payload.typedPayload).toBeDefined();
    expect(payload.typedPayload.kind).toBe("reasoning.delta");
    expect(payload.typedPayload.text).toBe("Let me think...");
  });

  test("tool.started payload is emitted for tool_call_start events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-3",
      agentId: "agent-1",
      event: {
        type: "tool_call_start",
        toolCallId: "tc-1",
        toolName: "read_file",
        arguments: { path: "/tmp/test.txt" },
        agentId: "agent-1",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.eventType).toBeUndefined();
    expect(payload.data).toBeUndefined();
    expect(payload.typedPayload.kind).toBe("tool.started");
    expect(payload.typedPayload.toolCallId).toBe("tc-1");
    expect(payload.typedPayload.toolName).toBe("read_file");
    expect(payload.typedPayload.arguments).toEqual({ path: "/tmp/test.txt" });
  });

  test("tool.completed payload is emitted for tool_result events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-3",
      event: {
        type: "tool_result",
        toolCallId: "tc-1",
        toolName: "read_file",
        result: "file contents",
        isError: false,
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.typedPayload.kind).toBe("tool.completed");
    expect(payload.typedPayload.toolCallId).toBe("tc-1");
    expect(payload.typedPayload.result).toBe("file contents");
    expect(payload.typedPayload.isError).toBe(false);
  });

  test("state.changed payload is emitted for state_changed events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-4",
      event: { type: "state_changed", state: "thinking" },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.typedPayload.kind).toBe("state.changed");
    expect(payload.typedPayload.state).toBe("thinking");
  });

  test("approval.requested payload is emitted for feedback_requested events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-5",
      agentId: "agent-1",
      event: {
        type: "feedback_requested",
        requestId: "req-1",
        description: "Run rm -rf?",
        options: ["approve", "reject"],
        agentId: "agent-1",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.typedPayload.kind).toBe("approval.requested");
    expect(payload.typedPayload.requestId).toBe("req-1");
    expect(payload.typedPayload.description).toBe("Run rm -rf?");
    expect(payload.typedPayload.options).toEqual(["approve", "reject"]);
  });

  test("approval.resolved payload is emitted for feedback_resolved events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-5b",
      agentId: "agent-1",
      event: {
        type: "feedback_resolved",
        requestId: "req-1",
        response: "approved",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.eventType).toBeUndefined();
    expect(payload.data).toBeUndefined();
    expect(payload.typedPayload.kind).toBe("approval.resolved");
    expect(payload.typedPayload.requestId).toBe("req-1");
    expect(payload.typedPayload.response).toBe("approved");
  });

  test("rate_limited payload is emitted for rate_limited events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-6",
      event: {
        type: "rate_limited",
        retryAfterMs: 5000,
        attempt: 2,
        maxAttempts: 5,
        providerId: "openai",
        retryAt: "2026-03-16T12:00:00.000Z",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.typedPayload.kind).toBe("rate_limited");
    expect(payload.typedPayload.retryAfterMs).toBe(5000);
    expect(payload.typedPayload.attempt).toBe(2);
    expect(payload.typedPayload.maxAttempts).toBe(5);
    expect(payload.typedPayload.providerId).toBe("openai");
  });

  test("turn.completed payload is emitted for turn_completed events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-7",
      agentId: "agent-1",
      event: {
        type: "turn_completed",
        result: {
          agentId: "agent-1",
          output: "Done!",
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          modelId: "gpt-4",
          providerId: "openai",
          durationMs: 2500,
          finishReason: "stop",
        },
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.typedPayload.kind).toBe("turn.completed");
    expect(payload.typedPayload.agentId).toBe("agent-1");
    expect(payload.typedPayload.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(payload.typedPayload.finalMessage).toBe("Done!");
    expect(payload.typedPayload.metadata?.modelId).toBe("gpt-4");
  });

  test("turn.failed payload is emitted for error events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-8",
      event: {
        type: "error",
        message: "Provider timeout",
        code: "DEADLINE_EXCEEDED",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.typedPayload.kind).toBe("turn.failed");
    expect(payload.typedPayload.errorMessage).toBe("Provider timeout");
    expect(payload.typedPayload.errorCode).toBe("DEADLINE_EXCEEDED");
  });

  test("turn.cancelled payload is emitted for turn_cancelled events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-8b",
      agentId: "agent-1",
      event: {
        type: "turn_cancelled",
      },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(1);
    const payload = published[0]?.msg.payload;
    expect(payload.eventType).toBeUndefined();
    expect(payload.data).toBeUndefined();
    expect(payload.typedPayload.kind).toBe("turn.cancelled");
  });

  test("typedPayload.kind is the only turn-event discriminator", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-9",
      event: { type: "state_changed", state: "acting" },
      timestamp: new Date(),
    });

    const payload = published[0]?.msg.payload;
    expect(payload.eventType).toBeUndefined();
    expect(payload.data).toBeUndefined();
    expect(payload.typedPayload).toBeDefined();
    expect(payload.typedPayload.kind).toBe("state.changed");
    expect(typeof payload.ts).toBe("string");
  });

  test("unknown event subtypes are not projected as turn events", async () => {
    const { server, published } = createServer();

    await (server as any).broadcastEvent({
      type: "space.turn_event",
      spaceId: "space-1",
      turnId: "turn-10",
      event: { type: "context_summarizing", progress: 0.5 },
      timestamp: new Date(),
    });

    expect(published).toHaveLength(0);
  });
});
