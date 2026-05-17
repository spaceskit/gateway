import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GenerateOptions,
  TurnAccessMode,
} from "@spaceskit/core";
import type {
  CommandMode,
  CommandSpec,
  ModelReference,
} from "./cli-executor-command-types.js";

const CLAUDE_MCP_BRIDGE_SERVER_NAME = "spaceskit-gateway";

export function buildCommand(
  reference: ModelReference,
  prompt: string,
  options: GenerateOptions,
  mode: CommandMode,
): CommandSpec {
  const accessMode = resolveCliAccessMode(options);
  const approvalBypass = options.approvalBypassEnabled === true;
  const cwd = normalizeWorkingDirectory(options.workingDirectory);

  switch (reference.providerId) {
    case "claude": {
      const permissionMode = resolveClaudePermissionMode(accessMode, approvalBypass);
      const bridgeArgs = buildMcpBridgeArgs(options);
      return {
        executable: "claude",
        args: [
          "--print",
          ...(mode === "stream" ? ["--verbose"] : []),
          "--input-format",
          "text",
          "--output-format",
          mode === "stream" ? "stream-json" : "text",
          ...(mode === "stream" ? ["--include-partial-messages"] : []),
          "--permission-mode",
          permissionMode,
          "--tools",
          accessMode === "full_access" ? "default" : "Read,Glob,Grep,WebSearch,WebFetch",
          ...(accessMode === "full_access" && cwd ? ["--add-dir", cwd] : []),
          ...bridgeArgs,
          ...buildClaudeEffortArgs(options),
          "--model",
          reference.providerModelId,
        ],
        stdin: prompt,
        ...(cwd ? { cwd } : {}),
      };
    }
    case "codex": {
      const codexBridgeArgs = buildCodexMcpBridgeArgs(options);
      const codexReasoningArgs = buildCodexReasoningArgs(options);
      // Gateway bridge tools are already permission-checked by the gateway, so
      // the Codex subprocess must not pause on its own MCP approval prompt.
      const hasBridgeTools = codexBridgeArgs.length > 0;
      const needsFullBypass = hasBridgeTools;
      const needsAutoApproval = !needsFullBypass && (accessMode === "full_access" && approvalBypass);
      return {
        executable: "codex",
        args: [
          "exec",
          "--skip-git-repo-check",
          ...(needsFullBypass
            ? ["--dangerously-bypass-approvals-and-sandbox"]
            : [
              "--sandbox",
              accessMode === "full_access" ? "workspace-write" : "read-only",
              ...(needsAutoApproval ? ["--full-auto"] : []),
            ]),
          ...(mode === "stream" ? ["--json"] : []),
          "--color",
          "never",
          ...(cwd ? ["-C", cwd] : []),
          ...codexReasoningArgs,
          ...codexBridgeArgs,
          "--model",
          reference.providerModelId,
          "-",
        ],
        stdin: prompt,
        ...(cwd ? { cwd } : {}),
      };
    }
    case "gemini":
      return {
        executable: "gemini",
        args: [
          "--prompt",
          "",
          "--output-format",
          mode === "stream" ? "stream-json" : "text",
          "--approval-mode",
          resolveGeminiApprovalMode(accessMode, approvalBypass),
          ...(accessMode === "full_access" && cwd ? ["--include-directories", cwd] : []),
          ...buildGeminiThinkingArgs(options),
          "--model",
          reference.providerModelId,
        ],
        stdin: prompt,
        ...(cwd ? { cwd } : {}),
      };
  }
}

function normalizeWorkingDirectory(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveCliAccessMode(options: GenerateOptions): TurnAccessMode {
  if (options.accessMode === "default" || options.accessMode === "full_access") {
    return options.accessMode;
  }
  return "default";
}

function resolveClaudePermissionMode(accessMode: TurnAccessMode, approvalBypassEnabled: boolean): string {
  if (accessMode !== "full_access") {
    return "plan";
  }
  return approvalBypassEnabled ? "bypassPermissions" : "acceptEdits";
}

function resolveGeminiApprovalMode(accessMode: TurnAccessMode, approvalBypassEnabled: boolean): string {
  if (accessMode !== "full_access") {
    return "plan";
  }
  return approvalBypassEnabled ? "yolo" : "auto_edit";
}

function buildMcpBridgeArgs(options: GenerateOptions): string[] {
  if (!options.gatewayToolBridgeConfig) return [];
  const { bridgeScriptPath, toolDefsJson, socketPath } = options.gatewayToolBridgeConfig;
  const mcpConfig = JSON.stringify({
    mcpServers: {
      [CLAUDE_MCP_BRIDGE_SERVER_NAME]: {
        command: "bun",
        args: ["run", bridgeScriptPath],
        env: {
          GATEWAY_TOOLS_JSON: toolDefsJson,
          GATEWAY_SOCKET_PATH: socketPath,
        },
      },
    },
  });
  const allowedTools = buildClaudeAllowedBridgeToolNames(toolDefsJson);
  return [
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    ...(allowedTools.length > 0
      ? ["--allowedTools", allowedTools.join(",")]
      : []),
  ];
}

function buildCodexMcpBridgeArgs(options: GenerateOptions): string[] {
  if (!options.gatewayToolBridgeConfig) return [];
  const { bridgeScriptPath, toolDefsJson, socketPath } = options.gatewayToolBridgeConfig;
  const toolDefsPath = writeToolDefsToTempFile(toolDefsJson);
  return [
    "-c", `mcp_servers.spaceskit-gateway.command="bun"`,
    "-c", `mcp_servers.spaceskit-gateway.args=["run", ${JSON.stringify(bridgeScriptPath)}]`,
    "-c", `mcp_servers.spaceskit-gateway.env.GATEWAY_TOOLS_PATH=${JSON.stringify(toolDefsPath)}`,
    "-c", `mcp_servers.spaceskit-gateway.env.GATEWAY_SOCKET_PATH=${JSON.stringify(socketPath)}`,
  ];
}

function buildCodexReasoningArgs(options: GenerateOptions): string[] {
  const effort = normalizeCodexEffort(options.effort) ?? "high";
  return ["-c", `model_reasoning_effort=${JSON.stringify(effort)}`];
}

function writeToolDefsToTempFile(toolDefsJson: string): string {
  const filePath = join(tmpdir(), `spaceskit-tool-defs-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(filePath, toolDefsJson, "utf-8");
  return filePath;
}

function buildClaudeEffortArgs(options: GenerateOptions): string[] {
  const effort = normalizeClaudeEffort(options.effort);
  if (effort) return ["--effort", effort];
  if (options.thinkingConfig?.enabled) return ["--effort", "high"];
  return [];
}

function normalizeClaudeEffort(value?: GenerateOptions["effort"]): "low" | "medium" | "high" | "max" | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }
  return undefined;
}

function normalizeCodexEffort(value?: GenerateOptions["effort"]): "low" | "medium" | "high" | undefined {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  if (value === "max") {
    return "high";
  }
  return undefined;
}

function buildGeminiThinkingArgs(_options: GenerateOptions): string[] {
  return [];
}

function buildClaudeAllowedBridgeToolNames(toolDefsJson: string): string[] {
  try {
    const toolDefs = JSON.parse(toolDefsJson) as Array<{ name?: string }>;
    return toolDefs
      .map((tool) => normalizeClaudeBridgeToolName(tool.name))
      .filter((toolName): toolName is string => Boolean(toolName))
      .map((toolName) => `mcp__${CLAUDE_MCP_BRIDGE_SERVER_NAME}__${toolName}`);
  } catch {
    return [];
  }
}

function normalizeClaudeBridgeToolName(value: string | undefined): string | undefined {
  const normalized = value?.trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized && normalized.length > 0 ? normalized : undefined;
}
