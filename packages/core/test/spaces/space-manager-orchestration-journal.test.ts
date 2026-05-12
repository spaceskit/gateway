import { describe, expect, test } from "bun:test";
import {
  appendRedactedOrchestrationJournalEntry,
  redactOrchestrationPayload,
  type OrchestrationJournalEntry,
} from "../../src/spaces/space-manager-orchestration-journal.js";

describe("space manager orchestration journal helpers", () => {
  test("redacts sensitive prompt and message fields while keeping safe payload data", () => {
    const redacted = redactOrchestrationPayload({
      phase: "planner",
      systemPrompt: "secret prompt",
      nested: {
        messages: ["user text"],
        status: "ok",
        tool_trace: { value: "secret trace" },
      },
    });

    expect(redacted.phase).toBe("planner");
    expect(redacted.systemPrompt).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).messages).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).status).toBe("ok");
    expect((redacted.nested as Record<string, unknown>).tool_trace).toBe("[REDACTED]");
  });

  test("truncates long string fields", () => {
    const redacted = redactOrchestrationPayload({
      output: "a".repeat(2_010),
    });

    expect((redacted.output as string).length).toBe(2_003);
    expect(redacted.output).toEndWith("...");
  });

  test("records journal write success and failure metrics", async () => {
    const entry: OrchestrationJournalEntry = {
      spaceId: "space-1",
      turnId: "turn-1",
      eventType: "planner.result",
      actorId: "agent-1",
      payload: { instruction: "secret", status: "ok" },
    };
    const appended: OrchestrationJournalEntry[] = [];
    const metrics: Array<{ name: string; tags?: Record<string, string> }> = [];

    await appendRedactedOrchestrationJournalEntry({
      entry,
      append: async (value) => {
        appended.push(value);
      },
      recordMetric: (name, _value, tags) => {
        metrics.push({ name, tags });
      },
    });

    await appendRedactedOrchestrationJournalEntry({
      entry,
      append: async () => {
        throw new Error("write failed");
      },
      recordMetric: (name, _value, tags) => {
        metrics.push({ name, tags });
      },
    });

    expect(appended[0].payload.instruction).toBe("[REDACTED]");
    expect(appended[0].payload.status).toBe("ok");
    expect(metrics.map((metric) => metric.tags?.status)).toEqual(["ok", "failed"]);
  });
});
