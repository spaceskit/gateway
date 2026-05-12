import { describe, expect, test } from "bun:test";
import { CliExecutorModelProvider } from "../src/cli-executor-provider.js";
import { collectChunks } from "./cli-executor-provider-test-helpers.js";

describe("CliExecutorModelProvider Gemini streaming", () => {
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
});
