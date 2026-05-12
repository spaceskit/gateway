import { describe, expect, test } from "bun:test";
import { CliExecutorModelProvider } from "../src/cli-executor-provider.js";
import { collectChunks } from "./cli-executor-provider-test-helpers.js";

describe("CliExecutorModelProvider Codex streaming", () => {
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
