import { describe, expect, test } from "bun:test";
import {
  EventLogRepository,
  SpaceRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { SpaceTurnTraceService } from "../src/services/space-turn-trace-service.js";

describe("SpaceTurnTraceService", () => {
  test("records sanitized turn events and derives tool calls", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-trace-${crypto.randomUUID()}`,
    });
    try {
      const spaces = new SpaceRepository(db.db);
      spaces.create({
        spaceId: "space-main",
        resourceId: "resource-main",
        spaceType: "space",
        name: "Main",
        goal: "",
        turnModel: "sequential_all",
      });

      const service = new SpaceTurnTraceService({
        eventLog: new EventLogRepository(db.db),
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-1",
        agentId: "agent-1",
        eventType: "tool_call_start",
        payload: {
          type: "tool_call_start",
          prompt: "should redact",
          toolCall: {
            id: "tool-1",
            name: "filesystem.read",
          },
        },
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-1",
        agentId: "agent-1",
        eventType: "tool_result",
        payload: {
          type: "tool_result",
          result: {
            toolCallId: "tool-1",
            isError: false,
          },
          artifactId: "artifact-1",
        },
      });

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-1",
      });

      expect(trace.total).toBe(2);
      expect(trace.events[0]?.payload["prompt"]).toBe("[REDACTED]");
      expect(trace.toolCalls).toHaveLength(1);
      expect(trace.toolCalls[0]?.toolCallId).toBe("tool-1");
      expect(trace.toolCalls[0]?.status).toBe("completed");
      expect(trace.artifactIds).toContain("artifact-1");
    } finally {
      db.close();
    }
  });

  test("token count fields are NOT redacted while auth tokens still are", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-trace-${crypto.randomUUID()}`,
    });
    try {
      const spaces = new SpaceRepository(db.db);
      spaces.create({
        spaceId: "space-main",
        resourceId: "resource-main",
        spaceType: "space",
        name: "Main",
        goal: "",
        turnModel: "sequential_all",
      });

      const service = new SpaceTurnTraceService({
        eventLog: new EventLogRepository(db.db),
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-2",
        agentId: "agent-1",
        eventType: "llm_response",
        payload: {
          type: "llm_response",
          usage: {
            promptTokens: 1500,
            completionTokens: 200,
            totalTokens: 1700,
            inputTokens: 1500,
            outputTokens: 200,
          },
          apiToken: "sk-secret-key",
          secretToken: "should-be-hidden",
          authToken: "bearer-xyz",
        },
      });

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-2",
      });

      expect(trace.total).toBe(1);
      const payload = trace.events[0]!.payload;

      // Token count fields should be preserved (not redacted)
      const usage = payload["usage"] as Record<string, unknown>;
      expect(usage["promptTokens"]).toBe(1500);
      expect(usage["completionTokens"]).toBe(200);
      expect(usage["totalTokens"]).toBe(1700);
      expect(usage["inputTokens"]).toBe(1500);
      expect(usage["outputTokens"]).toBe(200);

      // Auth/secret token fields should still be redacted
      expect(payload["apiToken"]).toBe("[REDACTED]");
      expect(payload["secretToken"]).toBe("[REDACTED]");
      expect(payload["authToken"]).toBe("[REDACTED]");
    } finally {
      db.close();
    }
  });
});
