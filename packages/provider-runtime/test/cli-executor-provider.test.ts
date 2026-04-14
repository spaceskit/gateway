import { describe, expect, test } from "bun:test";
import type { StreamChunk } from "@spaceskit/core";
import { CliExecutorModelProvider } from "../src/cli-executor-provider.js";

async function collectChunks(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("CliExecutorModelProvider", () => {
  test("reports gateway-tool support across CLI catalog models for default-mode turns", async () => {
    const provider = new CliExecutorModelProvider({
      id: "gemini",
      name: "Gemini CLI",
      model: "gemini/gemini-2.5-flash",
    });

    const models = await provider.listModels();

    expect(models.map((model) => model.id)).toEqual([
      "gemini/gemini-2.5-flash",
      "gemini/gemini-3-pro-preview",
      "gemini/gemini-3-flash-preview",
      "gemini/gemini-2.5-pro",
    ]);
    expect(models.every((model) => model.supportsTools)).toBe(true);
  });

  test("reports executor health from the native CLI probe", async () => {
    const provider = new CliExecutorModelProvider({
      id: "claude",
      name: "Claude Code",
      model: "claude/sonnet",
      runCommandSync: () => ({
        pid: 1,
        output: [],
        stdout: "claude 1.0.0",
        stderr: "",
        status: 0,
        signal: null,
      }),
    });

    await expect(provider.checkHealth()).resolves.toMatchObject({
      available: true,
    });
  });

  test("surfaces stdout-only generate failures instead of a generic exit message", async () => {
    const provider = new CliExecutorModelProvider({
      id: "claude",
      name: "Claude Code",
      model: "claude/sonnet",
      runCommand: async () => ({
        exitCode: 1,
        stdout: "Failed to authenticate. API Error: 401 OAuth token has expired.",
        stderr: "",
      }),
    });

    await expect(provider.generate("claude/sonnet", {
      messages: [{ role: "user", content: "hi" }],
    })).rejects.toThrow("OAuth token has expired");
  });

  test("rejects gateway tool execution for native CLIs", async () => {
    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.1-codex",
      runCommand: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
    });

    await expect(provider.generate("codex/gpt-5.1-codex", {
      messages: [{ role: "user", content: "run tool" }],
      tools: [{
        name: "workspace_search",
        description: "Search the workspace",
        inputSchema: { type: "object", properties: {} },
      }],
    })).rejects.toMatchObject({
      code: "TOOLS_UNSUPPORTED",
    });
  });

  test("builds the text-only codex command and returns extracted text output", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.1-codex",
      runCommand: async (spec) => {
        seenSpec = spec;
        return {
          exitCode: 0,
          stdout: "{\"type\":\"final\",\"data\":{\"text\":\"done\"}}\n",
          stderr: "",
        };
      },
    });

    const result = await provider.generate("codex/gpt-5.1-codex", {
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Say done." },
      ],
    });

    expect(seenSpec).toEqual({
      executable: "codex",
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "-c",
        "model_reasoning_effort=\"high\"",
        "--model",
        "gpt-5.1-codex",
        "-",
      ],
      stdin: "SYSTEM:\nYou are concise.\n\nUSER:\nSay done.",
    });
    expect(result.message).toEqual({
      role: "assistant",
      content: "done",
    });
    expect(result.usage?.tokenAccuracy).toBe("estimated");
    expect(result.finishReason).toBe("stop");
  });

  test("applies a safe default reasoning effort override to codex CLI invocations", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.1-codex",
      runCommand: async (spec) => {
        seenSpec = spec;
        return {
          exitCode: 0,
          stdout: "{\"type\":\"final\",\"data\":{\"text\":\"done\"}}\n",
          stderr: "",
        };
      },
    });

    await provider.generate("codex/gpt-5.1-codex", {
      messages: [{ role: "user", content: "Say done." }],
    });

    expect(seenSpec?.args).toContain("-c");
    expect(seenSpec?.args).toContain("model_reasoning_effort=\"high\"");
  });

  test("maps gateway max effort to codex high reasoning effort", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.1-codex",
      runCommand: async (spec) => {
        seenSpec = spec;
        return {
          exitCode: 0,
          stdout: "{\"type\":\"final\",\"data\":{\"text\":\"done\"}}\n",
          stderr: "",
        };
      },
    });

    await provider.generate("codex/gpt-5.1-codex", {
      messages: [{ role: "user", content: "Say done." }],
      effort: "max",
    });

    expect(seenSpec?.args).toContain("model_reasoning_effort=\"high\"");
  });

  test("maps full_access for claude to acceptEdits unless unsafe host bypass is enabled", async () => {
    let safeSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;
    let unsafeSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    let capturedSpec: typeof safeSpec;
    const provider = new CliExecutorModelProvider({
      id: "claude",
      name: "Claude Code",
      model: "claude/sonnet",
      runCommand: async (spec) => {
        capturedSpec = spec;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });
    await provider.generate("claude/sonnet", {
      messages: [{ role: "user", content: "Summarize this repo." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/workspace-root",
    });
    safeSpec = capturedSpec;
    await provider.generate("claude/sonnet", {
      messages: [{ role: "user", content: "Summarize this repo." }],
      accessMode: "full_access",
      approvalBypassEnabled: true,
      workingDirectory: "/tmp/workspace-root",
    });
    unsafeSpec = capturedSpec;

    expect(safeSpec?.args).toEqual([
      "--print",
      "--input-format",
      "text",
      "--output-format",
      "text",
      "--permission-mode",
      "acceptEdits",
      "--tools",
      "default",
      "--add-dir",
      "/tmp/workspace-root",
      "--model",
      "sonnet",
    ]);
    expect(unsafeSpec?.args).toEqual([
      "--print",
      "--input-format",
      "text",
      "--output-format",
      "text",
      "--permission-mode",
      "bypassPermissions",
      "--tools",
      "default",
      "--add-dir",
      "/tmp/workspace-root",
      "--model",
      "sonnet",
    ]);
  });

  test("passes requested effort through to claude CLI invocations", async () => {
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
      runCommand: async (spec) => {
        seenSpec = spec;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });

    await provider.generate("claude/sonnet", {
      messages: [{ role: "user", content: "Summarize this repo." }],
      effort: "high",
    });

    expect(seenSpec?.args).toEqual([
      "--print",
      "--input-format",
      "text",
      "--output-format",
      "text",
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob,Grep,WebSearch,WebFetch",
      "--effort",
      "high",
      "--model",
      "sonnet",
    ]);
  });

  test("passes --thinking-level to Gemini CLI based on effort", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "gemini",
      name: "Gemini CLI",
      model: "gemini/gemini-2.5-pro",
      runCommand: async (spec) => {
        seenSpec = spec;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });

    await provider.generate("gemini/gemini-2.5-pro", {
      messages: [{ role: "user", content: "Analyze this." }],
      effort: "high",
    });

    // Gemini CLI does not have a --thinking-level flag (configured via config.json).
    expect(seenSpec?.args).not.toContain("--thinking-level");
  });

  test("does not pass --thinking-level to Gemini even with effort max", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "gemini",
      name: "Gemini CLI",
      model: "gemini/gemini-2.5-pro",
      runCommand: async (spec) => {
        seenSpec = spec;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });

    await provider.generate("gemini/gemini-2.5-pro", {
      messages: [{ role: "user", content: "Analyze this." }],
      effort: "max",
    });

    // Gemini CLI does not have a --thinking-level flag.
    expect(seenSpec?.args).not.toContain("--thinking-level");
  });

  test("omits --thinking-level for Gemini when no effort is set", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "gemini",
      name: "Gemini CLI",
      model: "gemini/gemini-2.5-pro",
      runCommand: async (spec) => {
        seenSpec = spec;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });

    await provider.generate("gemini/gemini-2.5-pro", {
      messages: [{ role: "user", content: "Analyze this." }],
    });

    expect(seenSpec?.args).not.toContain("--thinking-level");
  });

  test("adds strict MCP bridge config and explicit allowed bridge tools for Claude", async () => {
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
      runCommand: async (spec) => {
        seenSpec = spec;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });

    await provider.generate("claude/sonnet", {
      messages: [{ role: "user", content: "Run the Jira bridge." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/workspace-root",
      mcpBridgeConfig: {
        bridgeScriptPath: "/tmp/gateway-mcp-bridge-stdio.ts",
        toolDefsJson: JSON.stringify([
          { name: "shell.jira.me" },
          { name: "shell.exec" },
        ]),
        socketPath: "/tmp/spaceskit-mcp-bridge.sock",
      },
    });

    const args = seenSpec?.args ?? [];
    const mcpConfigIndex = args.indexOf("--mcp-config");
    const allowedToolsIndex = args.indexOf("--allowedTools");
    expect(mcpConfigIndex).toBeGreaterThanOrEqual(0);
    expect(args).toContain("--strict-mcp-config");
    expect(allowedToolsIndex).toBeGreaterThanOrEqual(0);
    expect(args[allowedToolsIndex + 1]).toBe(
      "mcp__spaceskit-gateway__shell_jira_me,mcp__spaceskit-gateway__shell_exec",
    );

    const mcpConfig = JSON.parse(args[mcpConfigIndex + 1] ?? "{}") as {
      mcpServers?: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    expect(mcpConfig).toEqual({
      mcpServers: {
        "spaceskit-gateway": {
          command: "bun",
          args: ["run", "/tmp/gateway-mcp-bridge-stdio.ts"],
          env: {
            GATEWAY_TOOLS_JSON: JSON.stringify([
              { name: "shell.jira.me" },
              { name: "shell.exec" },
            ]),
            GATEWAY_SOCKET_PATH: "/tmp/spaceskit-mcp-bridge.sock",
          },
        },
      },
    });
  });

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

  test("streams codex reasoning, tool progress, and final usage", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.2-codex",
      runCommandStream: (spec) => ({
        async *[Symbol.asyncIterator]() {
          seenSpec = spec;
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "event_msg",
                msg: { type: "agent_reasoning", text: "Checking files" },
              }),
              JSON.stringify({
                type: "item.started",
                item: {
                  id: "call-1",
                  type: "exec_command",
                  name: "shell.exec",
                  arguments: { cmd: "rg TODO" },
                },
              }),
              JSON.stringify({
                type: "item.completed",
                item: { id: "item-1", type: "agent_message", text: "done" },
              }),
              JSON.stringify({
                type: "turn.completed",
                usage: {
                  input_tokens: 100,
                  cached_input_tokens: 20,
                  output_tokens: 10,
                },
              }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("codex/gpt-5.2-codex", {
      messages: [{ role: "user", content: "Inspect the repo." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/codex-space",
    }));

    expect(seenSpec?.args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--json",
      "--color",
      "never",
      "-C",
      "/tmp/codex-space",
      "-c",
      "model_reasoning_effort=\"high\"",
      "--model",
      "gpt-5.2-codex",
      "-",
    ]);
    expect(chunks).toEqual([
      { type: "state_changed", state: "thinking" },
      { type: "reasoning_delta", text: "Checking files" },
      { type: "state_changed", state: "acting" },
      {
        type: "tool_call_start",
        toolCall: {
          id: "call-1",
          name: "shell.exec",
          arguments: { cmd: "rg TODO" },
        },
      },
      { type: "state_changed", state: "thinking" },
      {
        type: "text_delta",
        text: "done",
        transcriptVisibility: "visible",
        streamKind: "assistant_output",
      },
      { type: "state_changed", state: "idle" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          promptTokens: 100,
          completionTokens: 10,
          totalTokens: 110,
          tokenAccuracy: "reported",
          usageSource: "ledger",
          usageDetails: {
            inputNoCacheTokens: 100,
            inputCacheReadTokens: 20,
            outputTextTokens: 10,
            outputReasoningTokens: undefined,
            raw: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 10,
            },
          },
        },
      },
    ]);
  });

  test("parses codex JSON-string tool arguments into structured payloads", async () => {
    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.2-codex",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "item.started",
                item: {
                  id: "call-json-1",
                  type: "exec_command",
                  name: "shell.exec",
                  arguments: "{\"cmd\":\"rg TODO\"}",
                },
              }),
              JSON.stringify({ type: "turn.completed" }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("codex/gpt-5.2-codex", {
      messages: [{ role: "user", content: "Find TODOs." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/codex-space",
    }));

    expect(chunks).toContainEqual({
      type: "tool_call_start",
      toolCall: {
        id: "call-json-1",
        name: "shell.exec",
        arguments: { cmd: "rg TODO" },
      },
    });
  });

  test("preserves invalid codex tool-argument strings without collapsing to an empty object", async () => {
    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.2-codex",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "item.started",
                item: {
                  id: "call-raw-1",
                  type: "exec_command",
                  name: "shell.exec",
                  arguments: "{not-json}",
                },
              }),
              JSON.stringify({ type: "turn.completed" }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("codex/gpt-5.2-codex", {
      messages: [{ role: "user", content: "Run raw args." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/codex-space",
    }));

    expect(chunks).toContainEqual({
      type: "tool_call_start",
      toolCall: {
        id: "call-raw-1",
        name: "shell.exec",
        arguments: { __rawArguments: "{not-json}" },
      },
    });
  });

  test("parses codex mcp_tool_call items into canonical tool start and result chunks", async () => {
    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.2-codex",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "item.started",
                item: {
                  id: "item_0",
                  type: "mcp_tool_call",
                  server: "spaceskit-gateway",
                  tool: "lists.echo",
                  arguments: { message: "marker-123" },
                  result: null,
                  error: null,
                  status: "in_progress",
                },
              }),
              JSON.stringify({
                type: "item.completed",
                item: {
                  id: "item_0",
                  type: "mcp_tool_call",
                  server: "spaceskit-gateway",
                  tool: "lists.echo",
                  arguments: { message: "marker-123" },
                  result: { echoed: "marker-123" },
                  error: null,
                  status: "completed",
                },
              }),
              JSON.stringify({ type: "turn.completed" }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("codex/gpt-5.2-codex", {
      messages: [{ role: "user", content: "Call lists.echo." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/codex-space",
    }));

    expect(chunks).toContainEqual({
      type: "tool_call_start",
      toolCall: {
        id: "item_0",
        name: "lists.echo",
        arguments: { message: "marker-123" },
      },
    });
    expect(chunks).toContainEqual({
      type: "tool_result",
      toolResult: {
        toolCallId: "item_0",
        name: "lists.echo",
        result: { echoed: "marker-123" },
      },
    });
  });

  test("streams gemini assistant/tool events with reported usage", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "gemini",
      name: "Gemini CLI",
      model: "gemini/gemini-2.5-flash",
      runCommandStream: (spec) => ({
        async *[Symbol.asyncIterator]() {
          seenSpec = spec;
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "message",
                role: "assistant",
                content: [{ text: "Working" }],
              }),
              JSON.stringify({
                type: "tool_use",
                id: "tool-9",
                name: "read_file",
                arguments: { path: "README.md" },
              }),
              JSON.stringify({
                type: "tool_result",
                toolCallId: "tool-9",
                result: { ok: true },
              }),
              JSON.stringify({
                type: "result",
                usageMetadata: {
                  promptTokenCount: 8,
                  candidatesTokenCount: 4,
                  totalTokenCount: 12,
                },
              }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("gemini/gemini-2.5-flash", {
      messages: [{ role: "user", content: "Inspect the readme." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/gemini-space",
    }));

    expect(seenSpec?.args).toEqual([
      "--prompt",
      "",
      "--output-format",
      "stream-json",
      "--approval-mode",
      "auto_edit",
      "--include-directories",
      "/tmp/gemini-space",
      "--model",
      "gemini-2.5-flash",
    ]);
    expect(chunks).toEqual([
      { type: "state_changed", state: "thinking" },
      { type: "text_delta", text: "Working" },
      { type: "state_changed", state: "acting" },
      {
        type: "tool_call_start",
        toolCall: {
          id: "tool-9",
          name: "read_file",
          arguments: { path: "README.md" },
        },
      },
      { type: "state_changed", state: "thinking" },
      {
        type: "tool_result",
        toolResult: {
          toolCallId: "tool-9",
          name: "read_file",
          result: { ok: true },
        },
      },
      { type: "state_changed", state: "idle" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          promptTokens: 8,
          completionTokens: 4,
          totalTokens: 12,
          tokenAccuracy: "reported",
          usageSource: "ledger",
          usageDetails: {
            inputNoCacheTokens: 8,
            outputTextTokens: 4,
            raw: {
              promptTokenCount: 8,
              candidatesTokenCount: 4,
              totalTokenCount: 12,
            },
          },
        },
      },
    ]);
  });

  test("maps codex approval events to canonical needs_feedback state", async () => {
    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.2-codex",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "event_msg",
                msg: { type: "state_changed", state: "thinking" },
              }),
              JSON.stringify({
                type: "event_msg",
                msg: { type: "approval_request", description: "Need permission for shell.exec" },
              }),
              JSON.stringify({
                type: "turn.completed",
              }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("codex/gpt-5.2-codex", {
      messages: [{ role: "user", content: "Need approvals" }],
    }));

    expect(chunks).toEqual([
      { type: "state_changed", state: "thinking" },
      { type: "state_changed", state: "needs_feedback" },
      { type: "state_changed", state: "idle" },
      {
        type: "finish",
        finishReason: "stop",
      },
    ]);
  });

  test("parses gemini JSON-string tool arguments into structured payloads", async () => {
    const provider = new CliExecutorModelProvider({
      id: "gemini",
      name: "Gemini CLI",
      model: "gemini/gemini-2.5-flash",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "stdout" as const,
            chunk: [
              JSON.stringify({
                type: "tool_use",
                id: "tool-json-9",
                name: "read_file",
                arguments: "{\"path\":\"README.md\"}",
              }),
              JSON.stringify({ type: "result" }),
            ].join("\n") + "\n",
          };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("gemini/gemini-2.5-flash", {
      messages: [{ role: "user", content: "Inspect README." }],
      accessMode: "full_access",
      workingDirectory: "/tmp/gemini-space",
    }));

    expect(chunks).toContainEqual({
      type: "tool_call_start",
      toolCall: {
        id: "tool-json-9",
        name: "read_file",
        arguments: { path: "README.md" },
      },
    });
  });

  test("routes codex in-progress agent narration to provider-client activity and emits one final visible answer", async () => {
    const provider = new CliExecutorModelProvider({
      id: "codex",
      name: "Codex CLI",
      model: "codex/gpt-5.1-codex",
      runCommandStream: () => ({
        async *[Symbol.asyncIterator](): AsyncIterator<
          | { type: "stdout"; chunk: string }
          | { type: "stderr"; chunk: string }
          | { type: "exit"; exitCode: number }
        > {
          yield {
            type: "stdout",
            chunk: `${JSON.stringify({
              type: "event_msg",
              msg: {
                type: "agent_message",
                text: "Checking the workspace guidance first...",
              },
            })}\n`,
          };
          yield {
            type: "stdout",
            chunk: `${JSON.stringify({
              type: "item.completed",
              item: {
                id: "agent-message-1",
                type: "agent_message",
                text: "Final answer.",
              },
            })}\n`,
          };
          yield {
            type: "stdout",
            chunk: `${JSON.stringify({
              type: "turn.completed",
              finish_reason: "stop",
              usage: {
                input_tokens: 7,
                output_tokens: 3,
                total_tokens: 10,
              },
            })}\n`,
          };
          yield { type: "exit", exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("codex/gpt-5.1-codex", {
      messages: [{ role: "user", content: "Say hello." }],
    }));

    expect(chunks).toEqual([
      { type: "state_changed", state: "thinking" },
      {
        type: "text_delta",
        text: "Checking the workspace guidance first...",
        transcriptVisibility: "activity_only",
        streamKind: "provider_client",
      },
      {
        type: "text_delta",
        text: "Final answer.",
        transcriptVisibility: "visible",
        streamKind: "assistant_output",
      },
      { type: "state_changed", state: "idle" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          promptTokens: 7,
          completionTokens: 3,
          totalTokens: 10,
          tokenAccuracy: "reported",
          usageSource: "ledger",
          usageDetails: {
            inputNoCacheTokens: 7,
            outputTextTokens: 3,
            raw: {
              input_tokens: 7,
              output_tokens: 3,
              total_tokens: 10,
            },
          },
        },
      },
    ]);
  });
});
