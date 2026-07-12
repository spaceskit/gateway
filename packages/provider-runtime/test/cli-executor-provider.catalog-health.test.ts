import { describe, expect, test } from "bun:test";
import { CliExecutorModelProvider } from "../src/cli-executor-provider.js";

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

  test("exposes the selected Antigravity CLI model", async () => {
    const provider = new CliExecutorModelProvider({
      id: "antigravity",
      name: "Antigravity CLI",
      model: "antigravity/selected",
    });

    const models = await provider.listModels();

    expect(models).toEqual([{
      id: "antigravity/selected",
      name: "selected",
      provider: "antigravity",
      supportsTools: true,
      isLocal: true,
    }]);
  });

  test("discovers and normalizes opencode models from `opencode models` output", async () => {
    const provider = new CliExecutorModelProvider({
      id: "opencode",
      name: "OpenCode CLI",
      model: "opencode/openai/gpt-5.5",
      runCommand: async () => ({
        exitCode: 0,
        stdout: [
          "openai/gpt-5.5",
          "openai/gpt-5.4",
          "openai/gpt-5.5",
          "openai/gpt-5.4-mini",
          "bad-line",
        ].join("\n"),
        stderr: "",
      }),
    });

    const models = await provider.listModels();

    expect(models.map((model) => model.id)).toEqual([
      "opencode/openai/gpt-5.5",
      "opencode/openai/gpt-5.4",
      "opencode/openai/gpt-5.4-mini",
    ]);
  });

  test("falls back to manifest models when `opencode models` fails", async () => {
    const provider = new CliExecutorModelProvider({
      id: "opencode",
      name: "OpenCode CLI",
      model: "opencode/openai/gpt-5.5",
      runCommand: async () => ({
        exitCode: 1,
        stdout: "openai/gpt-5.5\nopenai/gpt-5.4",
        stderr: "command failed",
      }),
    });

    const models = await provider.listModels();

    expect(models.map((model) => model.id)).toEqual([
      "opencode/openai/gpt-5.5",
    ]);
  });

  test("reports executor health from the native CLI probe", async () => {
    const probes: Array<{ command: string; args: string[] }> = [];
    const provider = new CliExecutorModelProvider({
      id: "antigravity",
      name: "Antigravity CLI",
      model: "antigravity/selected",
      runCommandSync: (command, args) => {
        probes.push({ command, args });
        return {
        pid: 1,
        output: [],
        stdout: "agy 1.0.1",
        stderr: "",
        status: 0,
        signal: null,
        };
      },
    });

    await expect(provider.checkHealth()).resolves.toMatchObject({
      available: true,
    });
    expect(probes).toEqual([{ command: "agy", args: ["--version"] }]);
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
});
