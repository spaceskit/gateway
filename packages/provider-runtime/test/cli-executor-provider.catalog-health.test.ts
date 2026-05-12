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
});
