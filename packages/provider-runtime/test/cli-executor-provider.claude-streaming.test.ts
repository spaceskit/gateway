import { describe, expect, test } from "bun:test";
import { CliExecutorModelProvider } from "../src/cli-executor-provider.js";
import { collectChunks } from "./cli-executor-provider-test-helpers.js";

describe("CliExecutorModelProvider Claude streaming", () => {
  test("streams claude text, tool progress, and reported usage", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "claude",
      name: "Claude Code",
      model: "claude/sonnet",
      runCommandStream: (spec) => ({
        async *[Symbol.asyncIterator]() {
          seenSpec = spec;
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "stream_event",
                event: {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "Hel" },
                },
              }),
              JSON.stringify({
                type: "assistant",
                message: {
                  content: [{
                    type: "tool_use",
                    id: "tool-1",
                    name: "workspace_search",
                    input: { query: "src" },
                  }],
                },
              }),
              JSON.stringify({
                type: "stream_event",
                event: {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "lo" },
                },
              }),
              JSON.stringify({
                type: "result",
                usage: {
                  input_tokens: 12,
                  output_tokens: 5,
                  cache_read_input_tokens: 3,
                },
              }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("claude/sonnet", {
      messages: [{ role: "user", content: "Say hello and search." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/claude-space",
    }));

    expect(seenSpec?.args).toEqual([
      "--print",
      "--verbose",
      "--input-format",
      "text",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      "acceptEdits",
      "--tools",
      "default",
      "--add-dir",
      "/tmp/claude-space",
      "--model",
      "sonnet",
    ]);
    expect(chunks).toEqual([
      { type: "state_changed", state: "thinking" },
      { type: "text_delta", text: "Hel" },
      { type: "state_changed", state: "acting" },
      {
        type: "tool_call_start",
        toolCall: {
          id: "tool-1",
          name: "workspace_search",
          arguments: { query: "src" },
        },
      },
      { type: "state_changed", state: "thinking" },
      { type: "text_delta", text: "lo" },
      { type: "state_changed", state: "idle" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          promptTokens: 12,
          completionTokens: 5,
          totalTokens: 17,
          tokenAccuracy: "reported",
          usageSource: "ledger",
          usageDetails: {
            inputNoCacheTokens: 12,
            inputCacheReadTokens: 3,
            outputTextTokens: 5,
            raw: {
              input_tokens: 12,
              output_tokens: 5,
              cache_read_input_tokens: 3,
            },
          },
        },
      },
    ]);
  });

  test("emits CLI execution observer events for generate commands", async () => {
    const observed: Array<Record<string, unknown>> = [];

    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.1-codex",
      runCommand: async () => ({
        exitCode: 0,
        stdout: "{\"type\":\"final\",\"data\":{\"text\":\"done\"}}\n",
        stderr: "warning: sample stderr\n",
      }),
    });

    await provider.generate("codex/gpt-5.1-codex", {
      messages: [{ role: "user", content: "Say done." }],
      workingDirectory: "/tmp/codex-space",
      cliExecutionObserver: async (event) => {
        observed.push(event as unknown as Record<string, unknown>);
      },
    });

    expect(observed.map((event) => event.type)).toEqual([
      "started",
      "stdout",
      "stderr",
      "completed",
    ]);
    expect(observed[0]).toMatchObject({
      type: "started",
      mode: "generate",
      providerId: "codex",
      modelId: "codex/gpt-5.1-codex",
      workingDirectory: "/tmp/codex-space",
      commandPreview: "cd /tmp/codex-space && codex exec --skip-git-repo-check --sandbox read-only --color never -C /tmp/codex-space -c 'model_reasoning_effort=\"high\"' --model gpt-5.1-codex -",
    });
    expect(observed[1]).toMatchObject({
      type: "stdout",
      chunk: "{\"type\":\"final\",\"data\":{\"text\":\"done\"}}\n",
    });
    expect(observed[2]).toMatchObject({
      type: "stderr",
      chunk: "warning: sample stderr\n",
    });
    expect(observed[3]).toMatchObject({
      type: "completed",
      exitCode: 0,
    });
  });

  test("emits parsed CLI execution observer events for streaming commands", async () => {
    const observed: Array<Record<string, unknown>> = [];

    const provider = new CliExecutorModelProvider({
      id: "claude",
      name: "Claude Code",
      model: "claude/sonnet",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "stream_event",
                event: {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "Hi" },
                },
              }),
              JSON.stringify({
                type: "result",
                usage: {
                  input_tokens: 4,
                  output_tokens: 2,
                },
              }),
            ].join("\n") + "\n",
          };
          yield {
            type: "stderr" as const,
            chunk: "stderr chunk\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("claude/sonnet", {
      messages: [{ role: "user", content: "Say hi." }],
      cliExecutionObserver: async (event) => {
        observed.push(event as unknown as Record<string, unknown>);
      },
    }));

    expect(chunks.at(0)).toEqual({ type: "state_changed", state: "thinking" });
    expect(chunks.at(1)).toEqual({ type: "text_delta", text: "Hi" });
    expect(observed.map((event) => event.type)).toEqual([
      "started",
      "stdout",
      "parsed",
      "parsed",
      "parsed",
      "parsed",
      "stderr",
      "completed",
    ]);
    expect(observed[2]).toMatchObject({
      type: "parsed",
      chunk: {
        type: "state_changed",
        state: "thinking",
      },
    });
    expect(observed[3]).toMatchObject({
      type: "parsed",
      chunk: {
        type: "text_delta",
        text: "Hi",
      },
    });
    expect(observed[4]).toMatchObject({
      type: "parsed",
      chunk: {
        type: "state_changed",
        state: "idle",
      },
    });
    expect(observed[5]).toMatchObject({
      type: "parsed",
      chunk: {
        type: "finish",
        finishReason: "stop",
      },
    });
    expect(observed[6]).toMatchObject({
      type: "stderr",
      chunk: "stderr chunk\n",
    });
  });

  test("surfaces stdout-only stream failures instead of a generic exit message", async () => {
    const provider = new CliExecutorModelProvider({
      id: "claude",
      name: "Claude Code",
      model: "claude/sonnet",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: "Failed to authenticate. API Error: 401 OAuth token has expired.",
          };
          yield { type: "exit" as const, exitCode: 1 };
        },
      }),
    });

    await expect(collectChunks(provider.stream("claude/sonnet", {
      messages: [{ role: "user", content: "hi" }],
    }))).rejects.toThrow("OAuth token has expired");
  });

  test("parses claude JSON-string tool arguments into structured payloads", async () => {
    const provider = new CliExecutorModelProvider({
      id: "claude",
      name: "Claude Code",
      model: "claude/sonnet",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "assistant",
                message: {
                  content: [{
                    type: "tool_use",
                    id: "tool-json-1",
                    name: "workspace_search",
                    input: "{\"query\":\"src\"}",
                  }],
                },
              }),
              JSON.stringify({ type: "result" }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("claude/sonnet", {
      messages: [{ role: "user", content: "Search src." }],
    }));

    expect(chunks).toContainEqual({
      type: "tool_call_start",
      toolCall: {
        id: "tool-json-1",
        name: "workspace_search",
        arguments: { query: "src" },
      },
    });
  });

  test("streams claude rate-limit records without inventing reasoning deltas", async () => {
    const provider = new CliExecutorModelProvider({
      id: "claude",
      name: "Claude Code",
      model: "claude/sonnet",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "rate_limit_event",
                retry_after_ms: 2500,
              }),
              JSON.stringify({
                type: "result",
              }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("claude/sonnet", {
      messages: [{ role: "user", content: "Rate limit me." }],
    }));

    expect(chunks.some((chunk) => chunk.type === "reasoning_delta")).toBe(false);
    expect(chunks[0]).toMatchObject({
      type: "rate_limited",
      retryAfterMs: 2500,
      retryAfterSeconds: 3,
      attempt: 1,
      maxAttempts: 1,
      providerId: "claude",
    });
    expect(chunks[chunks.length - 2]).toEqual({ type: "state_changed", state: "idle" });
    expect(chunks[chunks.length - 1]).toEqual({ type: "finish", finishReason: "stop" });
  });
});
