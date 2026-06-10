import { describe, expect, test } from "bun:test";
import { ExecutionAdapterFactory } from "../src/execution/execution-adapter-factory.js";

describe("ExecutionAdapterFactory", () => {
  test("classifies Claude Agent SDK as an executor-backed provider", () => {
    const factory = new ExecutionAdapterFactory();

    expect(factory.classify("claude-agent-sdk")).toBe("executor");

    const provider = factory.createModelProvider({
      providerId: "claude-agent-sdk",
      model: "claude-agent-sdk/claude-sonnet-4-5",
      apiKey: "sk-ant-test",
      authMode: "host_login",
    });

    expect(provider.constructor.name).toBe("ClaudeAgentSdkModelProvider");
    expect(provider.id).toBe("claude-agent-sdk");
    expect(provider.isLocal).toBe(false);
    expect((provider as any).config.authMode).toBe("host_login");
  });

  test("classifies Codex App Server as an executor-backed provider", () => {
    const factory = new ExecutionAdapterFactory({
      findExecutable: (commands) => commands.includes("codex") ? "/tmp/spaces-good-codex" : null,
    });

    expect(factory.classify("codex-app-server")).toBe("executor");

    const provider = factory.createModelProvider({
      providerId: "codex-app-server",
      model: "codex-app-server/gpt-5.4",
      apiKey: "sk-openai-test",
      authMode: "api_key",
    });

    expect(provider.constructor.name).toBe("CodexAppServerModelProvider");
    expect(provider.id).toBe("codex-app-server");
    expect(provider.isLocal).toBe(false);
    expect((provider as any).config.authMode).toBe("api_key");
    expect((provider as any).config.executablePath).toBe("/tmp/spaces-good-codex");
  });

  test("classifies Antigravity CLI as an executor-backed provider", () => {
    const factory = new ExecutionAdapterFactory();

    expect(factory.classify("antigravity")).toBe("executor");

    const provider = factory.createModelProvider({
      providerId: "antigravity",
      model: "antigravity/selected",
    });

    expect(provider.constructor.name).toBe("CliExecutorModelProvider");
    expect(provider.id).toBe("antigravity");
    expect(provider.isLocal).toBe(true);
  });

  test("wires the Apple Foundation helper into apple providers when available", async () => {
    const invocations: Array<{
      executable: string;
      args: string[];
      stdin?: string;
    }> = [];
    const factory = new ExecutionAdapterFactory({
      appleHelperExecutablePath: "/tmp/spaces-apple-helper",
      appleHelperRunCommand: async (input) => {
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

    const provider = factory.createModelProvider({
      providerId: "apple",
      model: "apple/apple-on-device",
      isLocal: true,
    });
    const health = await provider.checkHealth();

    expect(health.available).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.executable).toBe("/tmp/spaces-apple-helper");
    expect(invocations[0]?.args).toEqual([]);
    expect(JSON.parse(invocations[0]?.stdin ?? "{}")).toEqual({
      operation: "checkAvailability",
    });
  });
});
