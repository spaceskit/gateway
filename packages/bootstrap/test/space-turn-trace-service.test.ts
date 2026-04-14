import { describe, expect, test } from "bun:test";
import {
  EventLogRepository,
  OrchestrationJournalRepository,
  SpaceRepository,
  TurnRepository,
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
      expect(trace.activities).toHaveLength(2);
      expect(trace.events[0]?.payload["prompt"]).toBe("[REDACTED]");
      expect(trace.toolCalls).toHaveLength(1);
      expect(trace.toolCalls[0]?.toolCallId).toBe("tool-1");
      expect(trace.toolCalls[0]?.status).toBe("completed");
      expect(trace.artifactIds).toContain("artifact-1");
    } finally {
      db.close();
    }
  });

  test("derives execution runs from CLI execution replay events", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-trace-execution-runs-${crypto.randomUUID()}`,
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
        turnId: "turn-exec-1",
        agentId: "agent-1",
        eventType: "cli_execution.started",
        payload: {
          type: "cli_execution.started",
          executionId: "exec-1",
          stepIndex: 0,
          agentId: "agent-1",
          providerId: "claude",
          modelId: "claude/sonnet",
          status: "running",
          startedAt: "2026-03-29T10:00:00.000Z",
          workingDirectory: "/tmp/workspace",
          commandPreview: "claude --print --output-format stream-json --model sonnet",
        },
      });
      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-exec-1",
        agentId: "agent-1",
        eventType: "cli_execution.completed",
        payload: {
          type: "cli_execution.completed",
          executionId: "exec-1",
          stepIndex: 0,
          agentId: "agent-1",
          providerId: "claude",
          modelId: "claude/sonnet",
          status: "completed",
          startedAt: "2026-03-29T10:00:00.000Z",
          completedAt: "2026-03-29T10:00:02.000Z",
          durationMs: 2000,
          workingDirectory: "/tmp/workspace",
          exitCode: 0,
          commandPreview: "claude --print --output-format stream-json --model sonnet",
          transcriptArtifactId: "artifact-debug-1",
          transcriptTruncated: false,
        },
      });

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-exec-1",
      });

      expect(trace.executionRuns).toHaveLength(1);
      expect(trace.executionRuns[0]).toEqual({
        executionId: "exec-1",
        stepIndex: 0,
        agentId: "agent-1",
        providerId: "claude",
        modelId: "claude/sonnet",
        status: "completed",
        startedAt: "2026-03-29T10:00:00.000Z",
        completedAt: "2026-03-29T10:00:02.000Z",
        durationMs: 2000,
        workingDirectory: "/tmp/workspace",
        exitCode: 0,
        commandPreview: "claude --print --output-format stream-json --model sonnet",
        transcriptArtifactId: "artifact-debug-1",
        transcriptTruncated: false,
      });
      expect(trace.activities.map((activity) => activity.visibility)).toContain("deep_trace");
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

  test("drops reasoning deltas from persisted replay when thinking capture is OFF", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-thinking-off-${crypto.randomUUID()}`,
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

      const eventLog = new EventLogRepository(db.db);
      const service = new SpaceTurnTraceService({
        eventLog,
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-thinking-off",
        agentId: "agent-1",
        eventType: "reasoning_delta",
        payload: {
          type: "reasoning_delta",
          text: "Inspecting the repo",
        },
        thinkingCapturePolicy: "OFF",
        createdAt: "2026-03-17T10:00:00.000Z",
      });
      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-thinking-off",
        agentId: "agent-1",
        eventType: "turn_completed",
        payload: {
          type: "turn_completed",
        },
        createdAt: "2026-03-17T10:00:01.000Z",
      });

      expect(eventLog.count("space-main", "turn-thinking-off")).toBe(1);

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-thinking-off",
      });

      expect(trace.events.map((event) => event.eventType)).toEqual([
        "turn_completed",
      ]);
      expect(trace.activities.some((activity) => activity.eventType == "reasoning_delta")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("persists one summarized reasoning event per turn when thinking capture is SUMMARY", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-thinking-summary-${crypto.randomUUID()}`,
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

      const eventLog = new EventLogRepository(db.db);
      const service = new SpaceTurnTraceService({
        eventLog,
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-thinking-summary",
        agentId: "agent-1",
        eventType: "reasoning_delta",
        payload: {
          type: "reasoning_delta",
          text: "Inspecting the repo",
        },
        thinkingCapturePolicy: "SUMMARY",
        createdAt: "2026-03-17T10:00:00.000Z",
      });
      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-thinking-summary",
        agentId: "agent-1",
        eventType: "reasoning_delta",
        payload: {
          type: "reasoning_delta",
          text: "Preparing the patch",
        },
        thinkingCapturePolicy: "SUMMARY",
        createdAt: "2026-03-17T10:00:00.500Z",
      });
      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-thinking-summary",
        agentId: "agent-1",
        eventType: "turn_completed",
        payload: {
          type: "turn_completed",
        },
        createdAt: "2026-03-17T10:00:01.000Z",
      });

      expect(eventLog.count("space-main", "turn-thinking-summary")).toBe(2);

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-thinking-summary",
      });
      const reasoningEvents = trace.events.filter((event) => event.eventType === "reasoning_delta");
      expect(reasoningEvents).toHaveLength(1);
      expect(reasoningEvents[0]?.payload).toMatchObject({
        type: "reasoning_delta",
        summarized: true,
        text: "Inspecting the repo\n\nPreparing the patch",
      });

      const reasoningActivity = trace.activities.find((activity) => activity.eventType === "reasoning_delta");
      expect(reasoningActivity?.title).toBe("Working summary");
      expect(reasoningActivity?.status).toBe("completed");
    } finally {
      db.close();
    }
  });

  test("persists raw reasoning deltas when thinking capture is FULL", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-thinking-full-${crypto.randomUUID()}`,
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

      const eventLog = new EventLogRepository(db.db);
      const service = new SpaceTurnTraceService({
        eventLog,
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-thinking-full",
        agentId: "agent-1",
        eventType: "reasoning_delta",
        payload: {
          type: "reasoning_delta",
          text: "Inspecting the repo",
        },
        thinkingCapturePolicy: "FULL",
        createdAt: "2026-03-17T10:00:00.000Z",
      });
      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-thinking-full",
        agentId: "agent-1",
        eventType: "reasoning_delta",
        payload: {
          type: "reasoning_delta",
          text: "Preparing the patch",
        },
        thinkingCapturePolicy: "FULL",
        createdAt: "2026-03-17T10:00:00.500Z",
      });
      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-thinking-full",
        agentId: "agent-1",
        eventType: "turn_completed",
        payload: {
          type: "turn_completed",
        },
        createdAt: "2026-03-17T10:00:01.000Z",
      });

      expect(eventLog.count("space-main", "turn-thinking-full")).toBe(3);

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-thinking-full",
      });
      const reasoningEvents = trace.events.filter((event) => event.eventType === "reasoning_delta");
      expect(reasoningEvents).toHaveLength(2);
      expect(reasoningEvents.map((event) => event.payload["text"])).toEqual([
        "Inspecting the repo",
        "Preparing the patch",
      ]);
      expect(reasoningEvents.every((event) => event.payload["summarized"] !== true)).toBe(true);
    } finally {
      db.close();
    }
  });

  test("builds a merged activity log from event log, orchestration journal, and persisted turns", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-activity-log-${crypto.randomUUID()}`,
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

      const turns = new TurnRepository(db.db);
      turns.create({
        turnId: "worker-turn-1",
        spaceId: "space-main",
        actorType: "agent",
        actorId: "agent-worker",
        inputJson: JSON.stringify({ text: "run" }),
        userTurnId: "turn-root",
      });
      turns.complete("worker-turn-1", {
        outputJson: JSON.stringify({ text: "worker result" }),
        tokenInput: 12,
        tokenOutput: 8,
      });

      const journal = new OrchestrationJournalRepository(db.db);
      journal.create({
        eventId: "journal-1",
        spaceId: "space-main",
        turnId: "turn-root",
        eventType: "planner.output",
        actorId: "agent-planner",
        payloadJson: JSON.stringify({
          source: "planner",
          globalInstruction: "Coordinate the worker turn",
        }),
        createdAt: "2026-03-17T10:00:02.000Z",
      });

      const eventLog = new EventLogRepository(db.db);
      const service = new SpaceTurnTraceService({
        eventLog,
        orchestrationJournal: journal,
        turns,
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-root",
        agentId: "agent-planner",
        eventType: "turn_started",
        payload: {
          type: "turn_started",
        },
        createdAt: "2026-03-17T10:00:01.000Z",
      });
      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-root",
        agentId: "agent-worker",
        eventType: "feedback_requested",
        payload: {
          type: "feedback_requested",
          request: {
            description: "Need approval",
          },
        },
        createdAt: "2026-03-17T10:00:03.000Z",
      });

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-root",
      });
      expect(trace.activities.map((activity) => activity.eventType)).toEqual([
        "turn_started",
        "planner.output",
        "feedback_requested",
        "persisted_turn.completed",
      ]);

      const activityLog = service.listActivityLog({
        spaceId: "space-main",
        turnId: "turn-root",
        limit: 10,
        offset: 0,
      });
      expect(activityLog.total).toBe(4);
      expect(activityLog.entries.map((entry) => entry.source)).toEqual([
        "event_log",
        "orchestration_journal",
        "event_log",
        "turns",
      ]);
      expect(activityLog.entries[3]?.rootTurnId).toBe("turn-root");
      expect(activityLog.entries[3]?.agentId).toBe("agent-worker");
    } finally {
      db.close();
    }
  });

  test("skips text deltas in persisted traces and activity log output", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-text-delta-filter-${crypto.randomUUID()}`,
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

      const eventLog = new EventLogRepository(db.db);
      const service = new SpaceTurnTraceService({
        eventLog,
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-1",
        agentId: "agent-1",
        eventType: "text_delta",
        payload: {
          type: "text_delta",
          text: "partial output",
        },
      });

      eventLog.create({
        eventId: "legacy-text-delta",
        spaceId: "space-main",
        turnId: "turn-1",
        agentId: "agent-1",
        eventType: "text_delta",
        payloadJson: JSON.stringify({
          type: "text_delta",
          text: "legacy partial output",
        }),
        createdAt: "2026-03-17T10:00:01.000Z",
      });

      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-1",
        agentId: "agent-1",
        eventType: "turn_completed",
        payload: {
          type: "turn_completed",
        },
        createdAt: "2026-03-17T10:00:02.000Z",
      });

      expect(eventLog.count("space-main", "turn-1")).toBe(2);

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-1",
      });
      expect(trace.events.map((event) => event.eventType)).toEqual([
        "text_delta",
        "turn_completed",
      ]);
      expect(trace.activities.map((activity) => activity.eventType)).toEqual([
        "turn_completed",
      ]);

      const activityLog = service.listActivityLog({
        spaceId: "space-main",
        turnId: "turn-1",
        limit: 10,
        offset: 0,
      });
      expect(activityLog.entries.map((entry) => entry.eventType)).toEqual([
        "turn_completed",
      ]);
    } finally {
      db.close();
    }
  });

  test("persists activity-only provider-client text as replayable client_delta events", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-client-delta-${crypto.randomUUID()}`,
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
        turnId: "turn-client-1",
        agentId: "agent-1",
        eventType: "text_delta",
        payload: {
          type: "text_delta",
          text: "Checking workspace guidance...",
          transcriptVisibility: "activity_only",
          streamKind: "provider_client",
        },
      });
      service.recordTurnEvent({
        spaceId: "space-main",
        turnId: "turn-client-1",
        agentId: "agent-1",
        eventType: "turn_completed",
        payload: {
          type: "turn_completed",
        },
      });

      const trace = service.getTurnTrace({
        spaceId: "space-main",
        turnId: "turn-client-1",
      });

      expect(trace.events.some((event) => event.eventType === "text_delta")).toBe(false);
      const clientDelta = trace.events.find((event) => event.eventType === "client_delta");
      expect(clientDelta?.payload["text"]).toBe("Checking workspace guidance...");
      expect(clientDelta?.payload["streamKind"]).toBe("provider_client");
      expect(trace.activities.some((activity) => activity.eventType === "client_delta")).toBe(true);
    } finally {
      db.close();
    }
  });
});
