import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { CodexSessionScanner } from "../src/services/scan-codex-sessions.js";
import { ClaudeSessionScanner } from "../src/services/scan-claude-sessions.js";
import { GeminiSessionScanner } from "../src/services/scan-gemini-sessions.js";

describe("Local usage scanners", () => {
  test("codex scanner handles total_token_usage + last_token_usage deltas", async () => {
    const root = await mkdtemp(join(tmpdir(), "spaceskit-codex-scan-"));
    const sessionsDir = join(root, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "session-codex-1.jsonl");
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "session_meta",
          session_meta: {
            session_id: "session-codex-1",
            model: "codex/gpt-5.1-codex",
          },
          timestamp: "2026-02-28T08:00:00.000Z",
        }),
        JSON.stringify({
          type: "turn_context",
          session_id: "session-codex-1",
          turn_context: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 10,
              output_tokens: 40,
            },
          },
          timestamp: "2026-02-28T08:10:00.000Z",
        }),
        JSON.stringify({
          type: "event_msg",
          session_id: "session-codex-1",
          event_msg: {
            last_token_usage: {
              input_tokens: 5,
              output_tokens: 2,
            },
          },
          timestamp: "2026-02-28T08:11:00.000Z",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const scanner = new CodexSessionScanner({
        roots: [sessionsDir, join(root, "archived_sessions")],
      });
      const sessions = await scanner.scan(Date.parse("2026-01-01T00:00:00.000Z"));
      expect(sessions.length).toBe(1);
      expect(sessions[0]?.inputTokens).toBe(105);
      expect(sessions[0]?.cachedInputTokens).toBe(10);
      expect(sessions[0]?.outputTokens).toBe(42);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("claude scanner deduplicates repeated message.id + requestId entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "spaceskit-claude-scan-"));
    const projectsDir = join(root, "projects");
    await mkdir(projectsDir, { recursive: true });
    const logPath = join(projectsDir, "session-claude-1.json");

    await writeFile(
      logPath,
      JSON.stringify({
        sessionId: "session-claude-1",
        messages: [
          {
            id: "msg-1",
            requestId: "req-1",
            timestamp: "2026-02-28T09:00:00.000Z",
            usage: {
              input_tokens: 10,
              output_tokens: 2,
            },
          },
          {
            id: "msg-1",
            requestId: "req-1",
            timestamp: "2026-02-28T09:00:01.000Z",
            usage: {
              input_tokens: 10,
              output_tokens: 2,
            },
          },
          {
            id: "msg-2",
            requestId: "req-2",
            timestamp: "2026-02-28T09:05:00.000Z",
            usage: {
              input_tokens: 5,
              output_tokens: 1,
            },
          },
        ],
      }),
      "utf8",
    );

    try {
      const scanner = new ClaudeSessionScanner({ roots: [projectsDir] });
      const sessions = await scanner.scan(Date.parse("2026-01-01T00:00:00.000Z"));
      expect(sessions.length).toBe(1);
      expect(sessions[0]?.inputTokens).toBe(15);
      expect(sessions[0]?.outputTokens).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("gemini scanner aggregates tokens from session-*.json chat logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "spaceskit-gemini-scan-"));
    const chatDir = join(root, "abc", "chats");
    await mkdir(chatDir, { recursive: true });
    const sessionPath = join(chatDir, "session-gemini-1.json");

    await writeFile(
      sessionPath,
      JSON.stringify({
        sessionId: "session-gemini-1",
        model: "gemini/gemini-2.5-pro",
        messages: [
          {
            timestamp: "2026-02-28T10:00:00.000Z",
            tokens: 30,
          },
          {
            timestamp: "2026-02-28T10:02:00.000Z",
            usage: {
              inputTokens: 10,
              outputTokens: 5,
            },
          },
          {
            timestamp: "2026-02-28T10:03:00.000Z",
            inputTokens: 4,
            outputTokens: 1,
          },
        ],
      }),
      "utf8",
    );

    try {
      const scanner = new GeminiSessionScanner({ roots: [root] });
      const sessions = await scanner.scan(Date.parse("2026-01-01T00:00:00.000Z"));
      expect(sessions.length).toBe(1);
      expect(sessions[0]?.inputTokens).toBe(44);
      expect(sessions[0]?.outputTokens).toBe(6);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
