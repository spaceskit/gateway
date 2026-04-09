import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SQLiteCheckpointManager } from "../src/spaces/checkpoint.js";
import { SessionContinuityManager } from "../src/spaces/session-continuity.js";
import type { ModelMessage } from "../src/agents/model-provider.js";

describe("session-checkpoint-roundtrip", () => {
  let db: Database;
  let checkpointManager: SQLiteCheckpointManager;

  beforeEach(() => {
    db = new Database(":memory:");
    checkpointManager = new SQLiteCheckpointManager(db);
  });

  describe("SQLiteCheckpointManager with messages", () => {
    it("saves and loads agent states with messages", async () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "Tell me about TypeScript" },
        { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
      ];

      const checkpoint = await checkpointManager.save("space-1", {
        stateJson: JSON.stringify({ sessionId: "test-session" }),
        configJson: "{}",
        turnIds: ["turn-1", "turn-2"],
        agentStates: {
          "agent-a": {
            status: "active",
            lastTurnId: "turn-2",
            messages,
          },
          "agent-b": {
            status: "active",
            lastTurnId: "turn-1",
          },
        },
        label: "test-checkpoint",
      });

      expect(checkpoint.checkpointId).toBeTruthy();
      expect(checkpoint.spaceId).toBe("space-1");

      const loaded = await checkpointManager.load(checkpoint.checkpointId);
      expect(loaded).not.toBeNull();
      expect(loaded!.agentStates["agent-a"].messages).toEqual(messages);
      expect(loaded!.agentStates["agent-a"].status).toBe("active");
      expect(loaded!.agentStates["agent-a"].lastTurnId).toBe("turn-2");
      expect(loaded!.agentStates["agent-b"].messages).toBeUndefined();
      expect(loaded!.agentStates["agent-b"].status).toBe("active");
      expect(loaded!.turnIds).toEqual(["turn-1", "turn-2"]);
    });

    it("handles messages with tool calls", async () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Search for info" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "search", arguments: '{"q":"info"}' }],
        },
        { role: "tool", content: "Found: some info", toolCallId: "call-1", toolName: "search" },
        { role: "assistant", content: "I found some info for you." },
      ];

      const checkpoint = await checkpointManager.save("space-2", {
        stateJson: "{}",
        configJson: "{}",
        turnIds: ["turn-1"],
        agentStates: {
          "agent-a": { status: "active", lastTurnId: "turn-1", messages },
        },
      });

      const loaded = await checkpointManager.load(checkpoint.checkpointId);
      expect(loaded!.agentStates["agent-a"].messages).toEqual(messages);
    });

    it("backward-compatible with checkpoints without messages", async () => {
      // Directly insert a row without messages in agent states (old format)
      db.prepare(`
        INSERT INTO checkpoints (checkpoint_id, space_id, state_json, config_json, turn_ids_json, agent_states_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "old-checkpoint",
        "space-old",
        "{}",
        "{}",
        '["turn-1"]',
        '{"agent-a":{"status":"active","lastTurnId":"turn-1"}}',
        new Date().toISOString(),
      );

      const loaded = await checkpointManager.load("old-checkpoint");
      expect(loaded).not.toBeNull();
      expect(loaded!.agentStates["agent-a"].status).toBe("active");
      expect(loaded!.agentStates["agent-a"].messages).toBeUndefined();
    });
  });

  describe("SessionContinuityManager.pause() with space state", () => {
    it("creates a checkpoint with full agent state when spaceState provided", async () => {
      const continuityManager = new SessionContinuityManager({
        checkpointManager,
      });

      // Create a session first
      const session = await continuityManager.getOrCreate("space-1", "client-1", "session");
      expect(session.status).toBe("active");

      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "World" },
      ];

      // Pause with space state
      await continuityManager.pause("space-1", "client-1", {
        agentStates: {
          "agent-a": { status: "active", lastTurnId: "turn-1", messages },
        },
        turnIds: ["turn-1"],
      });

      // Verify checkpoint was created
      const checkpoints = await checkpointManager.list("space-1");
      expect(checkpoints.length).toBe(1);
      expect(checkpoints[0].label).toBe("session-pause:client-1");
      expect(checkpoints[0].agentStates["agent-a"].messages).toEqual(messages);
      expect(checkpoints[0].turnIds).toEqual(["turn-1"]);
    });

    it("creates a minimal checkpoint when no spaceState provided", async () => {
      const continuityManager = new SessionContinuityManager({
        checkpointManager,
      });

      await continuityManager.getOrCreate("space-2", "client-2", "session");
      await continuityManager.pause("space-2", "client-2");

      const checkpoints = await checkpointManager.list("space-2");
      expect(checkpoints.length).toBe(1);
      expect(checkpoints[0].agentStates).toEqual({});
      expect(checkpoints[0].turnIds).toEqual([]);
    });

    it("does not create checkpoint in stateless mode", async () => {
      const continuityManager = new SessionContinuityManager({
        checkpointManager,
      });

      await continuityManager.getOrCreate("space-3", "client-3", "stateless");
      await continuityManager.pause("space-3", "client-3", {
        agentStates: {
          "agent-a": { status: "active", messages: [{ role: "user", content: "test" }] },
        },
        turnIds: ["turn-1"],
      });

      const checkpoints = await checkpointManager.list("space-3");
      expect(checkpoints.length).toBe(0);
    });
  });

  describe("SessionContinuityManager restart recovery", () => {
    it("lists and resumes paused sessions from checkpoints after manager restart", async () => {
      const continuityManager = new SessionContinuityManager({
        checkpointManager,
      });
      await continuityManager.getOrCreate("space-restart", "principal:user-1", "session");
      await continuityManager.pause("space-restart", "principal:user-1", {
        agentStates: {
          "agent-a": { status: "active", lastTurnId: "turn-restart-1", messages: [{ role: "user", content: "hi" }] },
        },
        turnIds: ["turn-restart-1"],
      });

      // Simulate process restart: new continuity manager, same persisted checkpoints.
      const restartedContinuityManager = new SessionContinuityManager({
        checkpointManager,
      });

      const resumable = await restartedContinuityManager.listResumable("principal:user-1");
      expect(resumable.length).toBe(1);
      expect(resumable[0].spaceId).toBe("space-restart");
      expect(resumable[0].checkpointId).toBeTruthy();

      const resumed = await restartedContinuityManager.resume("space-restart", "principal:user-1");
      expect(resumed).not.toBeNull();
      expect(resumed!.status).toBe("active");
      expect(resumed!.checkpointId).toBeTruthy();
    });
  });

  describe("checkpoint data round-trip", () => {
    it("full round-trip: save → load → compare messages", async () => {
      const originalMessages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "2+2 equals 4." },
        { role: "user", content: "And 3+3?" },
        { role: "assistant", content: "3+3 equals 6." },
      ];

      const originalData = {
        stateJson: JSON.stringify({ sessionId: "sess-round-trip" }),
        configJson: JSON.stringify({ name: "test-space" }),
        turnIds: ["turn-a", "turn-b", "turn-c"],
        agentStates: {
          "agent-alpha": {
            status: "active",
            lastTurnId: "turn-c",
            messages: originalMessages,
          },
          "agent-beta": {
            status: "active",
            lastTurnId: "turn-b",
            messages: [
              { role: "user", content: "Delegate this" } as ModelMessage,
              { role: "assistant", content: "Delegated result" } as ModelMessage,
            ],
          },
        },
        label: "round-trip-test",
      };

      const saved = await checkpointManager.save("space-rt", originalData);
      const loaded = await checkpointManager.load(saved.checkpointId);

      expect(loaded).not.toBeNull();
      expect(loaded!.spaceId).toBe("space-rt");
      expect(loaded!.label).toBe("round-trip-test");
      expect(loaded!.turnIds).toEqual(originalData.turnIds);
      expect(loaded!.stateJson).toBe(originalData.stateJson);
      expect(loaded!.configJson).toBe(originalData.configJson);
      expect(loaded!.agentStates["agent-alpha"].messages).toEqual(originalMessages);
      expect(loaded!.agentStates["agent-alpha"].lastTurnId).toBe("turn-c");
      expect(loaded!.agentStates["agent-beta"].messages).toEqual([
        { role: "user", content: "Delegate this" },
        { role: "assistant", content: "Delegated result" },
      ]);

      // Verify via latest() as well
      const latest = await checkpointManager.latest("space-rt");
      expect(latest).not.toBeNull();
      expect(latest!.checkpointId).toBe(saved.checkpointId);
      expect(latest!.agentStates["agent-alpha"].messages).toEqual(originalMessages);
    });
  });
});
