import { describe, expect, test } from "bun:test";
import { CliExecutorModelProvider } from "../src/cli-executor-provider.js";

describe("CliExecutorModelProvider", () => {
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

  test("uses tool-enabled Claude launch profile inside the selected workspace", async () => {
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
        return {
          exitCode: 0,
          stdout: "done",
          stderr: "",
        };
      },
    });

    await provider.generate("claude/sonnet", {
      messages: [{ role: "user", content: "Summarize this repo." }],
      nativeCliToolsEnabled: true,
      workingDirectory: "/tmp/workspace-root",
    });

    expect(seenSpec).toEqual({
      executable: "claude",
      args: [
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
      ],
      stdin: "USER:\nSummarize this repo.",
      cwd: "/tmp/workspace-root",
    });
  });

  test("uses tool-enabled Codex launch profile inside the selected workspace", async () => {
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
      runCommand: async (spec) => {
        seenSpec = spec;
        return {
          exitCode: 0,
          stdout: "{\"type\":\"final\",\"data\":{\"text\":\"done\"}}\n",
          stderr: "",
        };
      },
    });

    await provider.generate("codex/gpt-5.2-codex", {
      messages: [{ role: "user", content: "Make the tests pass." }],
      nativeCliToolsEnabled: true,
      workingDirectory: "/tmp/codex-space",
    });

    expect(seenSpec).toEqual({
      executable: "codex",
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--full-auto",
        "--color",
        "never",
        "-C",
        "/tmp/codex-space",
        "--model",
        "gpt-5.2-codex",
        "-",
      ],
      stdin: "USER:\nMake the tests pass.",
      cwd: "/tmp/codex-space",
    });
  });
});
