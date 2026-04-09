import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ModelMessage, ToolDefinition } from "./model-provider.js";
import type { ToolExecutor } from "./tool-executor.js";
import { sleepWithAbort } from "./agent-runtime-async.js";

const TOOL_GUIDANCE_MARKER = "[[SPACESKIT_TOOL_GUIDANCE_V1]]";
const MEDIATED_TOOL_MARKER = "[[SPACESKIT_MEDIATED_TOOLS_V1]]";
const TOOL_DISCOVERY_RETRY_ATTEMPTS = 4;
const TOOL_DISCOVERY_RETRY_DELAY_MS = 250;

export function normalizeApprovalContext(
  value: Record<string, unknown> | undefined,
  toolName: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const context = { ...value };
  context.toolName = typeof context.toolName === "string" && context.toolName.trim().length > 0
    ? context.toolName
    : toolName;
  context.requestedCapability = typeof context.requestedCapability === "string"
    && context.requestedCapability.trim().length > 0
    ? context.requestedCapability
    : toolName;
  return context;
}

export async function resolveToolDefinitionsForTurn(
  toolExecutor: ToolExecutor,
  spaceId: string,
  agentId: string,
  signal: AbortSignal,
  contextMessages: ModelMessage[],
  suppressInjectedTools: boolean,
): Promise<ToolDefinition[]> {
  let toolDefs = await toolExecutor.getAvailableTools(spaceId, agentId, {
    suppressInjectedTools,
  });
  if (toolDefs.length > 0 || signal.aborted) {
    return toolDefs;
  }
  if (!shouldRetryToolDiscovery(contextMessages)) {
    return toolDefs;
  }

  for (let attempt = 0; attempt < TOOL_DISCOVERY_RETRY_ATTEMPTS; attempt += 1) {
    const delayCompleted = await sleepWithAbort(TOOL_DISCOVERY_RETRY_DELAY_MS, signal);
    if (!delayCompleted || signal.aborted) {
      break;
    }
    toolDefs = await toolExecutor.getAvailableTools(spaceId, agentId, {
      suppressInjectedTools,
    });
    if (toolDefs.length > 0) {
      return toolDefs;
    }
  }

  return toolDefs;
}

function buildShellToolGuidance(toolNames: string[]): string {
  const lines: string[] = [];
  const hasJira = toolNames.some((name) => name.startsWith("shell.jira."));
  if (hasJira) {
    lines.push(
      "- For 'shell.jira.*' tools: call 'shell.jira.me' first to verify Jira connectivity. Use the structured shell.jira.* tools instead of raw shell commands. Prefer reads (shell.jira.issue.list, shell.jira.issue.view) before mutations. Jira tools return JSON envelopes with ok, operation, summary, and optional data/refs fields.",
    );
  }
  const hasHrvst = toolNames.some((name) => name.startsWith("shell.hrvst."));
  if (hasHrvst) {
    lines.push(
      "- For 'shell.hrvst.*' tools: call 'shell.hrvst.me' first to verify Harvest connectivity. Use the structured shell.hrvst.* tools instead of raw shell commands.",
    );
  }
  const hasOp = toolNames.some((name) => name.startsWith("shell.op."));
  if (hasOp) {
    lines.push(
      "- For 'shell.op.*' tools: call 'shell.op.whoami' first to verify 1Password connectivity. Use the structured shell.op.* tools instead of raw shell commands.",
    );
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

export function buildToolUsageGuidance(toolDefs: ToolDefinition[]): string {
  const toolList = toolDefs
    .map((tool) => tool.name.trim())
    .filter((toolName) => toolName.length > 0)
    .slice(0, 40);
  const listedTools = toolList.length > 0 ? toolList.join(", ") : "none";

  return `${TOOL_GUIDANCE_MARKER}
You can use tools in this conversation.
- Prefer tool calls when the user asks for live data, external state, reminders/calendars/lists, filesystem changes, or actions.
- Do not use platform introspection tools for greetings, acknowledgments, or other trivial social messages.
- Do not claim you lack access before attempting relevant tool calls.
- If tool calls fail, explain the failure and provide the next best action.
- For 'lists.*' tools: call 'lists.listLists' first when listId is unknown. Use 'lists.completeItem' to mark a reminder done when that tool is available; use 'lists.updateItem' for general edits or to reopen with isCompleted: false. Only set targetProvider when you know an exact provider id; never use placeholders like "none" or "default".
- For 'calendar.*' tools: call 'calendar.listCalendars' first when calendarId is unknown.
- For 'email.*' tools: Apple Mail is observed-state driven. Use 'email.listAccounts' or 'email.listMailboxes' first when accountId or mailboxId is unknown, and do not assume the result is a full mailbox sync.
${buildShellToolGuidance(toolList)}Available tools: ${listedTools}`;
}

export function hasInjectedToolGuidance(messages: ModelMessage[]): boolean {
  return messages.some((message) =>
    message.role === "system"
    && (
      message.content.includes(TOOL_GUIDANCE_MARKER)
      || message.content.includes(MEDIATED_TOOL_MARKER)
    ));
}

/**
 * Build a system-prompt description of gateway tools for mediated providers
 * (CLI executors, Apple Foundation) that cannot accept structured tool defs.
 * The model sees the tools and can reference them; gateway does not parse/execute
 * tool calls from the response in this stopgap — full mediated loop is US-57.
 */
export function buildMediatedToolPrompt(toolDefs: ToolDefinition[]): string {
  const toolDescriptions = toolDefs
    .slice(0, 40)
    .map((tool) => {
      const name = tool.name.trim();
      const desc = tool.description?.trim() ?? "";
      const schema = tool.inputSchema ?? {};
      const props = schema.properties as Record<string, unknown> | undefined;
      const params = props ? Object.keys(props).join(", ") : "";
      return `- ${name}${desc ? `: ${desc}` : ""}${params ? ` (params: ${params})` : ""}`;
    })
    .join("\n");

  return `${MEDIATED_TOOL_MARKER}
The following gateway tools are available in this space.

To call a tool, emit one or more fenced JSON blocks exactly like this:
\`\`\`tool_call
{"name": "tool_name", "arguments": {"param": "value"}}
\`\`\`

You can include short explanatory text outside the fenced blocks. After the gateway executes the tools, you will receive the results and can continue with a normal assistant response.

Available tools:
${toolDescriptions}
- For 'lists.*' tools: call 'lists.listLists' first when listId is unknown. Use 'lists.completeItem' to mark a reminder done when available, and use 'lists.updateItem' for general edits or to reopen with isCompleted: false.
- For 'calendar.*' tools: call 'calendar.listCalendars' first when calendarId is unknown.
- For 'email.*' tools: Apple Mail results come from observed MailKit state, so list accounts or mailboxes first when identifiers are unknown and avoid claiming full mailbox coverage.
${buildShellToolGuidance(toolDefs.map((t) => t.name.trim()))}- Do not claim you lack access to these tools.
- Emit the fenced blocks only when you are actually requesting tool execution.
- The gateway will handle tool execution and surface results or approval prompts as needed.`;
}

export function shouldSuppressInjectedToolsForPrompt(messages: ModelMessage[]): boolean {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const prompt = latestUserMessage?.content.trim().toLowerCase();
  if (!prompt) return false;

  const normalizedPrompt = prompt
    .replace(/[`"'()[\]{}]/g, " ")
    .replace(/[!?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedPrompt) return false;

  const exactSocialPrompts = new Set([
    "hi",
    "hello",
    "hey",
    "hey there",
    "hi there",
    "hello there",
    "yo",
    "sup",
    "what's up",
    "whats up",
    "how are you",
    "good morning",
    "good afternoon",
    "good evening",
    "morning",
    "afternoon",
    "evening",
    "thanks",
    "thank you",
    "ok thanks",
    "okay thanks",
    "cool thanks",
  ]);
  if (exactSocialPrompts.has(normalizedPrompt)) {
    return true;
  }

  const tokens = normalizedPrompt.split(" ").filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  const greetingTokens = new Set([
    "hi",
    "hello",
    "hey",
    "yo",
    "sup",
    "morning",
    "afternoon",
    "evening",
    "there",
    "team",
    "everyone",
    "all",
  ]);
  return tokens.every((token) => greetingTokens.has(token));
}

function shouldRetryToolDiscovery(messages: ModelMessage[]): boolean {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const prompt = latestUserMessage?.content.trim().toLowerCase();
  if (!prompt) return false;
  const hints = [
    "reminder",
    "todo",
    "task",
    "calendar",
    "schedule",
    "event",
    "list",
    "file",
    "folder",
    "workspace",
    "shell",
    "terminal",
    "run command",
    "open",
    "fetch",
    "check",
    "jira",
    "issue",
    "ticket",
    "sprint",
    "harvest",
    "1password",
  ];
  return hints.some((hint) => prompt.includes(hint));
}

// ---------------------------------------------------------------------------
// MCP discovery config — .mcp.json file management for CLI executors
// ---------------------------------------------------------------------------

const MCP_DISCOVERY_FILENAME = ".mcp.json";
const MCP_BRIDGE_SERVER_NAME = "spaceskit-gateway";

export interface McpDiscoveryConfig {
  bridgeScriptPath: string;
  toolDefsJson: string;
  socketPath: string;
}

/**
 * Write a `.mcp.json` file to the workspace directory so CLI executors
 * (Claude, Codex, Gemini) auto-discover the gateway tool bridge on startup.
 *
 * Returns the absolute path of the written file for cleanup.
 */
export async function writeMcpDiscoveryConfig(
  workingDirectory: string,
  config: McpDiscoveryConfig,
): Promise<string> {
  const mcpConfig = {
    mcpServers: {
      [MCP_BRIDGE_SERVER_NAME]: {
        command: "bun",
        args: ["run", config.bridgeScriptPath],
        env: {
          GATEWAY_TOOLS_JSON: config.toolDefsJson,
          GATEWAY_SOCKET_PATH: config.socketPath,
        },
      },
    },
  };
  const filePath = join(workingDirectory, MCP_DISCOVERY_FILENAME);
  await writeFile(filePath, JSON.stringify(mcpConfig, null, 2), "utf-8");
  return filePath;
}

/**
 * Remove the `.mcp.json` file written by `writeMcpDiscoveryConfig`.
 * Silently ignores missing files (already cleaned up or never written).
 */
export async function cleanupMcpDiscoveryConfig(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // File already removed or never written — safe to ignore.
  }
}
