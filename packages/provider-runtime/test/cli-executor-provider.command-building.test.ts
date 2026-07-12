import { describe, expect, test } from "bun:test";
import { CliExecutorModelProvider } from "../src/cli-executor-provider.js";

describe("CliExecutorModelProvider command building", () => {
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

  test("builds the OpenCode CLI run command", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "opencode",
      name: "OpenCode CLI",
      model: "opencode/openai/gpt-5.5",
      runCommand: async (spec) => {
        seenSpec = spec;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });

    const result = await provider.generate("opencode/openai/gpt-5.5", {
      messages: [{ role: "user", content: "Say done." }],
      workingDirectory: "/tmp/opencode-space",
    });

    expect(seenSpec).toEqual({
      executable: "opencode",
      args: [
        "run",
        "--model",
        "openai/gpt-5.5",
        "--prompt",
        "USER:\nSay done.",
      ],
      cwd: "/tmp/opencode-space",
    });
    expect(result.message).toEqual({
      role: "assistant",
      content: "done",
    });
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

  test("builds the Antigravity print command without unsupported model or output flags", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "antigravity",
      name: "Antigravity CLI",
      model: "antigravity/selected",
      runCommand: async (spec) => {
        seenSpec = spec;
        return { exitCode: 0, stdout: "done\n", stderr: "" };
      },
    });

    const result = await provider.generate("antigravity/selected", {
      messages: [{ role: "user", content: "Say done." }],
      workingDirectory: "/tmp/antigravity-space",
    });

    expect(seenSpec).toEqual({
      executable: "agy",
      args: [
        "--print",
        "--sandbox",
        "--add-dir",
        "/tmp/antigravity-space",
        "USER:\nSay done.",
      ],
      cwd: "/tmp/antigravity-space",
    });
    expect(seenSpec?.stdin).toBeUndefined();
    expect(seenSpec?.args).not.toContain("--model");
    expect(seenSpec?.args).not.toContain("--json");
    expect(seenSpec?.args).not.toContain("--output-format");
    expect(result.message.content).toBe("done");
  });

  test("maps Antigravity full-access approval bypass to dangerously skip permissions", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "antigravity",
      name: "Antigravity CLI",
      model: "antigravity/selected",
      runCommand: async (spec) => {
        seenSpec = spec;
        return { exitCode: 0, stdout: "done\n", stderr: "" };
      },
    });

    await provider.generate("antigravity/selected", {
      messages: [{ role: "user", content: "Modify files." }],
      accessMode: "full_access",
      approvalBypassEnabled: true,
      workingDirectory: "/tmp/antigravity-space",
    });

    expect(seenSpec?.args).toEqual([
      "--print",
      "--dangerously-skip-permissions",
      "--add-dir",
      "/tmp/antigravity-space",
      "USER:\nModify files.",
    ]);
    expect(seenSpec?.args).not.toContain("--sandbox");
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
      gatewayToolBridgeConfig: {
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
});
