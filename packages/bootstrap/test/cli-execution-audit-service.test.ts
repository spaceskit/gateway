import { describe, expect, test } from "bun:test";
import { EventBus, type GatewayEvent } from "@spaceskit/core";
import {
  ArtifactRepository,
  SpaceRepository,
  initDatabase,
} from "@spaceskit/persistence";
import {
  CLI_EXECUTION_TRANSCRIPT_ARTIFACT_TYPE,
  CliExecutionAuditService,
} from "../src/services/cli-execution-audit-service.js";

describe("CliExecutionAuditService", () => {
  test("persists private CLI transcript artifacts and emits sanitized replay events", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-cli-execution-audit-${crypto.randomUUID()}`,
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

      const artifacts = new ArtifactRepository(db.db);
      const eventBus = new EventBus();
      const emitted: GatewayEvent[] = [];
      eventBus.on("space.turn_event", (event) => emitted.push(event));

      const service = new CliExecutionAuditService({
        artifacts,
        spaces,
        eventBus,
      });

      const observer = service.createObserver({
        spaceId: "space-main",
        turnId: "turn-1",
        agentId: "agent-1",
        stepIndex: 0,
        providerId: "claude",
        modelId: "claude/sonnet",
      });

      await observer({
        type: "started",
        mode: "stream",
        startedAt: "2026-03-29T10:00:00.000Z",
        providerId: "claude",
        modelId: "claude/sonnet",
        commandPreview: "claude --print --output-format stream-json --model sonnet",
        workingDirectory: "/tmp/workspace",
      });
      await observer({ type: "stdout", chunk: "{\"type\":\"message_start\"}\n" });
      await observer({ type: "stderr", chunk: "warning on stderr\n" });
      await observer({
        type: "parsed",
        chunk: {
          type: "tool_call_start",
          toolCall: {
            id: "tool-1",
            name: "filesystem.read",
          },
        },
      });
      await observer({
        type: "completed",
        completedAt: "2026-03-29T10:00:02.000Z",
        durationMs: 2000,
        exitCode: 0,
      });

      expect(emitted).toHaveLength(2);
      expect((emitted[0] as any).event?.type).toBe("cli_execution.started");
      expect((emitted[1] as any).event?.type).toBe("cli_execution.completed");
      expect((emitted[1] as any).event?.chunk).toBeUndefined();

      const stored = artifacts.listBySpace("space-main");
      expect(stored).toHaveLength(1);
      expect(stored[0]?.artifact_type).toBe(CLI_EXECUTION_TRANSCRIPT_ARTIFACT_TYPE);
      expect(stored[0]?.visibility).toBe("private");

      const transcript = JSON.parse(stored[0]!.content_json) as string;
      expect(transcript).toContain("\"type\":\"stdout\"");
      expect(transcript).toContain("warning on stderr");
      expect(transcript).toContain("\"type\":\"parsed\"");
      expect((emitted[1] as any).event?.transcriptArtifactId).toBe(stored[0]?.artifact_id);
      expect((emitted[1] as any).event?.transcriptTruncated).toBe(false);
    } finally {
      db.close();
    }
  });

  test("marks transcripts as truncated when the capture exceeds the configured limit", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-cli-execution-truncation-${crypto.randomUUID()}`,
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

      const artifacts = new ArtifactRepository(db.db);
      const eventBus = new EventBus();
      const emitted: GatewayEvent[] = [];
      eventBus.on("space.turn_event", (event) => emitted.push(event));

      const service = new CliExecutionAuditService({
        artifacts,
        spaces,
        eventBus,
        maxTranscriptBytes: 120,
      });

      const observer = service.createObserver({
        spaceId: "space-main",
        turnId: "turn-1",
        agentId: "agent-1",
        stepIndex: 1,
        providerId: "codex",
        modelId: "codex/gpt-5.2-codex",
      });

      await observer({
        type: "started",
        mode: "stream",
        startedAt: "2026-03-29T10:00:00.000Z",
        providerId: "codex",
        modelId: "codex/gpt-5.2-codex",
        commandPreview: "codex exec --json --model gpt-5.2-codex -",
      });
      await observer({ type: "stdout", chunk: "x".repeat(500) });
      await observer({
        type: "completed",
        completedAt: "2026-03-29T10:00:01.000Z",
        durationMs: 1000,
        exitCode: 0,
      });

      expect((emitted[1] as any).event?.transcriptTruncated).toBe(true);

      const stored = artifacts.listBySpace("space-main");
      expect(stored).toHaveLength(1);
      const transcript = JSON.parse(stored[0]!.content_json) as string;
      expect(transcript.length).toBeLessThan(500);
    } finally {
      db.close();
    }
  });
});
