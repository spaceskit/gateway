import { describe, expect, test } from "bun:test";
import { buildToolUsageGuidance } from "@spaceskit/core";
import {
  AppleFoundationModelProvider,
  checkAppleFoundationAvailability,
} from "../src/apple-foundation-provider.js";

describe("AppleFoundationModelProvider", () => {
  test("reports the conservative on-device context window for Apple models", async () => {
    const provider = new AppleFoundationModelProvider({
      id: "apple",
      name: "Apple Foundation",
      model: "apple/apple-on-device",
      helperExecutablePath: "/tmp/spaces-apple-helper",
      runCommand: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ available: true }),
        stderr: "",
      }),
    });

    const models = await provider.listModels();
    expect(models).toEqual([{
      id: "apple/apple-on-device",
      name: "apple-on-device",
      provider: "apple",
      contextWindow: 4096,
      supportsTools: true,
      isLocal: true,
    }]);
  });

  test("maps helper tool-call responses into model tool calls", async () => {
    const invocations: Array<{
      executable: string;
      args: string[];
      stdin?: string;
    }> = [];
    const provider = new AppleFoundationModelProvider({
      id: "apple",
      name: "Apple Foundation",
      model: "apple/apple-on-device",
      helperExecutablePath: "/tmp/spaces-apple-helper",
      runCommand: async (input) => {
        invocations.push(input);
        return {
        exitCode: 0,
        stdout: JSON.stringify({
          toolCall: {
            name: "lists.listLists",
            arguments: {},
          },
          finishReason: "tool_calls",
          usage: {
            promptTokens: 12,
            completionTokens: 3,
            totalTokens: 15,
            tokenAccuracy: "estimated",
            usageSource: "ledger",
          },
        }),
        stderr: "",
        };
      },
    });

    const result = await provider.generate("apple/apple-on-device", {
      messages: [{ role: "user", content: "What are my reminders?" }],
      tools: [{
        name: "lists.listLists",
        description: "List reminder lists",
        inputSchema: { type: "object", properties: {} },
      }],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls).toEqual([{
      id: expect.any(String),
      name: "lists.listLists",
      arguments: {},
    }]);
    expect(result.usage?.totalTokens).toBe(15);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args).toEqual([]);
    const request = JSON.parse(invocations[0]?.stdin ?? "{}") as {
      operation?: string;
      tools?: Array<{ name?: string }>;
      messages?: Array<{ role?: string; content?: string }>;
    };
    expect(request.operation).toBe("generate");
    expect(request.tools?.map((tool) => tool.name)).toEqual(["lists.listLists"]);
    const systemMessages = request.messages?.filter((message) => message.role === "system") ?? [];
    expect(systemMessages.some((message) =>
      typeof message.content === "string" && message.content.includes("Available tools:")
    )).toBe(true);
  });

  test("adds only helper response-format guidance when tool guidance is already present", async () => {
    const invocations: Array<{
      executable: string;
      args: string[];
      stdin?: string;
    }> = [];
    const tools = [{
      name: "lists.echo",
      description: "Echo a marker",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
      },
    }];
    const provider = new AppleFoundationModelProvider({
      id: "apple",
      name: "Apple Foundation",
      model: "apple/apple-on-device",
      helperExecutablePath: "/tmp/spaces-apple-helper",
      runCommand: async (input) => {
        invocations.push(input);
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            text: "ok",
            finishReason: "stop",
          }),
          stderr: "",
        };
      },
    });

    await provider.generate("apple/apple-on-device", {
      messages: [
        { role: "system", content: buildToolUsageGuidance(tools) },
        { role: "user", content: "Use lists.echo exactly once." },
      ],
      tools,
    });

    const request = JSON.parse(invocations[0]?.stdin ?? "{}") as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const systemMessages = request.messages?.filter((message) => message.role === "system") ?? [];
    expect(systemMessages).toHaveLength(2);
    expect(systemMessages.filter((message) =>
      typeof message.content === "string" && message.content.includes("Available tools:")
    )).toHaveLength(1);
    expect(systemMessages.some((message) =>
      typeof message.content === "string" && message.content.includes("When using the structured Apple helper response format:")
    )).toBe(true);
  });

  test("passes through helper final text responses", async () => {
    const provider = new AppleFoundationModelProvider({
      id: "apple",
      name: "Apple Foundation",
      model: "apple/apple-on-device",
      helperExecutablePath: "/tmp/spaces-apple-helper",
      runCommand: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          text: "Here are your reminder lists.",
          finishReason: "stop",
        }),
        stderr: "",
      }),
    });

    const result = await provider.generate("apple/apple-on-device", {
      messages: [{ role: "user", content: "Summarize my reminders." }],
    });

    expect(result.finishReason).toBe("stop");
    expect(result.message.content).toBe("Here are your reminder lists.");
  });

  test("surfaces helper stdout reasons when the helper exits non-zero", async () => {
    const provider = new AppleFoundationModelProvider({
      id: "apple",
      name: "Apple Foundation",
      model: "apple/apple-on-device",
      helperExecutablePath: "/tmp/spaces-apple-helper",
      runCommand: async () => ({
        exitCode: 1,
        stdout: JSON.stringify({
          reason: "Generation schema rejected the response.",
          finishReason: "error",
        }),
        stderr: "",
      }),
    });

    await expect(provider.generate("apple/apple-on-device", {
      messages: [{ role: "user", content: "Use the echo tool." }],
      tools: [{
        name: "lists.echo",
        description: "Echo a marker",
        inputSchema: { type: "object", properties: {} },
      }],
    })).rejects.toThrow("Generation schema rejected the response.");
  });
});

describe("checkAppleFoundationAvailability", () => {
  test("returns helper availability responses when the host is eligible", async () => {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      return;
    }

    const invocations: Array<{
      executable: string;
      args: string[];
      stdin?: string;
    }> = [];
    const availability = await checkAppleFoundationAvailability({
      helperExecutablePath: "/tmp/spaces-apple-helper",
      runCommand: async (input) => {
        invocations.push(input);
        return {
        exitCode: 0,
        stdout: JSON.stringify({
          available: true,
          reason: "Apple Intelligence available.",
        }),
        stderr: "",
        };
      },
    });

    expect(availability).toEqual({
      available: true,
      reason: "Apple Intelligence available.",
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args).toEqual([]);
    expect(JSON.parse(invocations[0]?.stdin ?? "{}")).toEqual({
      operation: "checkAvailability",
    });
  });
});
