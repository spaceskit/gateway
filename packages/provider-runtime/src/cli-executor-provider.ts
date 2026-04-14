import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnSyncReturns } from "node:child_process";
import type {
  CliExecutionObserver,
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolResult,
  TurnAccessMode,
} from "@spaceskit/core";
import { ToolsUnsupportedError, UnsupportedProviderError } from "./provider-errors.js";

type SupportedProviderId = "claude" | "codex" | "gemini";
type CommandMode = "generate" | "stream";

interface ModelReference {
  providerId: SupportedProviderId;
  fullModelId: string;
  providerModelId: string;
}

interface CommandSpec {
  executable: string;
  args: string[];
  stdin?: string;
  cwd?: string;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type CommandRunner = (spec: CommandSpec, signal?: AbortSignal) => Promise<CommandResult>;
type CommandRunnerSync = (command: string, args: string[]) => SpawnSyncReturns<string>;
type CommandStreamEvent =
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "exit"; exitCode: number };
type CommandStreamRunner = (spec: CommandSpec, signal?: AbortSignal) => AsyncIterable<CommandStreamEvent>;

export interface CliExecutorProviderConfig {
  id: string;
  name: string;
  model: string;
  isLocal?: boolean;
  /** @deprecated Approval bypass is now per-turn via GenerateOptions.approvalBypassEnabled. */
  allowUnsafeHostBypass?: boolean;
  runCommand?: CommandRunner;
  runCommandSync?: CommandRunnerSync;
  runCommandStream?: CommandStreamRunner;
}

const PROVIDER_ALIASES: Record<string, SupportedProviderId> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

const MODEL_MANIFEST: Record<SupportedProviderId, string[]> = {
  claude: ["claude/sonnet", "claude/opus", "claude/haiku"],
  codex: [
    "codex/gpt-5.2-codex",
    "codex/gpt-5.2-codex-max",
    "codex/gpt-5.2-codex-mini",
    "codex/gpt-5.1-codex",
  ],
  gemini: [
    "gemini/gemini-3-pro-preview",
    "gemini/gemini-3-flash-preview",
    "gemini/gemini-2.5-pro",
    "gemini/gemini-2.5-flash",
  ],
};

const CLAUDE_MCP_BRIDGE_SERVER_NAME = "spaceskit-gateway";
const RAW_TOOL_ARGUMENTS_KEY = "__rawArguments";

export class CliExecutorModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: CliExecutorProviderConfig;
  private readonly runCommand: CommandRunner;
  private readonly runCommandSync: CommandRunnerSync;
  private readonly runCommandStream: CommandStreamRunner;

  constructor(config: CliExecutorProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? true;
    this.config = config;
    this.runCommand = config.runCommand ?? defaultRunCommand;
    this.runCommandSync = config.runCommandSync ?? defaultRunCommandSync;
    this.runCommandStream = config.runCommandStream ?? defaultRunCommandStream;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    const executable = executableForProvider(normalizeProviderId(this.id));
    if (!executable) {
      return { available: false, latencyMs: Date.now() - startedAt };
    }

    const result = this.runCommandSync(executable, ["--version"]);
    const available = !result.error && result.status === 0;
    return {
      available,
      latencyMs: Date.now() - startedAt,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const reference = this.parseModelReference(this.config.model, this.id);
    const models = Array.from(new Set([reference.fullModelId, ...MODEL_MANIFEST[reference.providerId]]));
    return models.map((modelId) => {
      const parsed = this.parseModelReference(modelId, reference.providerId);
      return {
        id: parsed.fullModelId,
        name: parsed.providerModelId,
        provider: parsed.providerId,
        supportsTools: true,
        isLocal: true,
      };
    });
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    if (options.tools?.length) {
      throw new ToolsUnsupportedError(reference.providerId);
    }

    const prompt = renderPrompt(options.messages);
    const spec = buildCommand(reference, prompt, options, "generate");
    const observer = options.cliExecutionObserver;
    const startedAtMs = Date.now();
    await notifyCliExecutionObserver(observer, {
      type: "started",
      mode: "generate",
      startedAt: new Date(startedAtMs).toISOString(),
      providerId: reference.providerId,
      modelId: reference.fullModelId,
      commandPreview: commandPreview(spec),
      workingDirectory: spec.cwd,
    });

    let result: CommandResult;
    try {
      result = await this.runCommand(spec, options.signal);
    } catch (error) {
      await notifyCliExecutionObserver(observer, {
        type: "failed",
        completedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (result.stdout.length > 0) {
      await notifyCliExecutionObserver(observer, { type: "stdout", chunk: result.stdout });
    }
    if (result.stderr.length > 0) {
      await notifyCliExecutionObserver(observer, { type: "stderr", chunk: result.stderr });
    }
    await notifyCliExecutionObserver(observer, {
      type: "completed",
      completedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      exitCode: result.exitCode,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim()
          || result.stdout.trim()
          || `${reference.providerId} exited with status ${result.exitCode}`,
      );
    }

    const content = extractCliOutput(reference.providerId, result.stdout);
    const usage = estimateUsage(options.messages, content);
    return {
      message: {
        role: "assistant",
        content,
      },
      usage,
      finishReason: "stop",
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    if (options.tools?.length) {
      throw new ToolsUnsupportedError(reference.providerId);
    }

    const prompt = renderPrompt(options.messages);
    const spec = buildCommand(reference, prompt, options, "stream");
    const parser = createCliStreamParser(reference.providerId, options.messages);
    const observer = options.cliExecutionObserver;
    const startedAtMs = Date.now();
    await notifyCliExecutionObserver(observer, {
      type: "started",
      mode: "stream",
      startedAt: new Date(startedAtMs).toISOString(),
      providerId: reference.providerId,
      modelId: reference.fullModelId,
      commandPreview: commandPreview(spec),
      workingDirectory: spec.cwd,
    });
    let exitCode = 0;
    let stdout = "";
    let stderr = "";

    try {
      for await (const event of this.runCommandStream(spec, options.signal)) {
        if (event.type === "stdout") {
          stdout += event.chunk;
          await notifyCliExecutionObserver(observer, { type: "stdout", chunk: event.chunk });
          for (const chunk of parser.push(event.chunk)) {
            await notifyCliExecutionObserver(observer, { type: "parsed", chunk });
            yield chunk;
          }
          continue;
        }

        if (event.type === "stderr") {
          stderr += event.chunk;
          await notifyCliExecutionObserver(observer, { type: "stderr", chunk: event.chunk });
          continue;
        }

        exitCode = event.exitCode;
      }
    } catch (error) {
      await notifyCliExecutionObserver(observer, {
        type: "failed",
        completedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    for (const chunk of parser.finish()) {
      await notifyCliExecutionObserver(observer, { type: "parsed", chunk });
      yield chunk;
    }

    await notifyCliExecutionObserver(observer, {
      type: "completed",
      completedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      exitCode,
    });

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `${reference.providerId} exited with status ${exitCode}`);
    }
  }

  private parseModelReference(modelIdRaw: string, providerHintRaw?: string): ModelReference {
    const modelId = modelIdRaw.trim();
    if (!modelId) {
      throw new Error("Model ID is required");
    }

    const [prefixRaw, ...rest] = modelId.split("/");
    if (rest.length > 0) {
      const providerId = normalizeProviderId(prefixRaw);
      if (!providerId) {
        throw new UnsupportedProviderError(prefixRaw, "Unsupported native CLI executor.");
      }
      const providerModelId = rest.join("/").trim();
      if (!providerModelId) {
        throw new Error(`Invalid model ID: ${modelId}`);
      }
      const hintedProviderId = normalizeProviderId(providerHintRaw);
      if (hintedProviderId && hintedProviderId !== providerId) {
        throw new UnsupportedProviderError(
          `${hintedProviderId}/${providerModelId}`,
          `Model "${modelId}" does not belong to provider ${hintedProviderId}.`,
        );
      }
      return {
        providerId,
        fullModelId: `${providerId}/${providerModelId}`,
        providerModelId,
      };
    }

    const providerId = normalizeProviderId(providerHintRaw);
    if (!providerId) {
      throw new Error(`Model "${modelId}" is missing a provider prefix.`);
    }
    return {
      providerId,
      fullModelId: `${providerId}/${modelId}`,
      providerModelId: modelId,
    };
  }
}

function normalizeProviderId(value?: string): SupportedProviderId | undefined {
  if (!value) return undefined;
  return PROVIDER_ALIASES[value.trim().toLowerCase()];
}

function executableForProvider(providerId?: SupportedProviderId): string | undefined {
  switch (providerId) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    default:
      return undefined;
  }
}

function buildCommand(
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
      // When gateway bridge tools are present, bypass Codex's approval system entirely.
      // The gateway validates tool permissions server-side via toolExecutor.checkPermission(),
      // so Codex's own approval is redundant and blocks MCP tool calls in non-interactive mode.
      // --full-auto alone is insufficient — it only auto-approves native tools, not MCP server calls.
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

/**
 * Build --mcp-config and --strict-mcp-config args when the gateway has
 * an MCP bridge configured for this turn. This makes gateway-registered
 * tools available to the CLI subprocess as real callable MCP tools.
 */
function buildMcpBridgeArgs(options: GenerateOptions): string[] {
  if (!options.mcpBridgeConfig) return [];
  const { bridgeScriptPath, toolDefsJson, socketPath } = options.mcpBridgeConfig;
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

/**
 * Build Codex `-c` config overrides to inject the gateway MCP bridge server.
 * Codex reads MCP servers from config.toml `[mcp_servers]` sections, and
 * `-c key=value` overrides these at runtime without touching the user's config.
 *
 * GATEWAY_TOOLS_JSON is written to a temp file and the path passed via env
 * to avoid TOML escaping issues with large JSON payloads. The bridge script
 * reads from GATEWAY_TOOLS_PATH when GATEWAY_TOOLS_JSON is not set directly.
 */
function buildCodexMcpBridgeArgs(options: GenerateOptions): string[] {
  if (!options.mcpBridgeConfig) return [];
  const { bridgeScriptPath, toolDefsJson, socketPath } = options.mcpBridgeConfig;

  // Write tool defs to a temp file to avoid TOML escaping issues
  const toolDefsPath = writeToolDefsToTempFile(toolDefsJson);

  // Codex -c flag uses TOML syntax for values
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
  const tmpDir = require("node:os").tmpdir();
  const filePath = require("node:path").join(tmpDir, `spaceskit-tool-defs-${crypto.randomUUID().slice(0, 8)}.json`);
  require("node:fs").writeFileSync(filePath, toolDefsJson, "utf-8");
  return filePath;
}

// NOTE: Claude CLI does not currently expose thinking/reasoning content in
// stream-json output. The parser at parseClaudeStreamRecord() handles
// thinking_delta events and will surface them when the CLI adds support.
// The --effort flag controls the API-level thinking budget.
function buildClaudeEffortArgs(options: GenerateOptions): string[] {
  const effort = normalizeClaudeEffort(options.effort);
  if (effort) return ["--effort", effort];
  // If thinking is enabled but no effort specified, default to high
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

// Gemini CLI does not have a --thinking-level flag.
// Thinking level is configured via ~/.gemini/config.json (thinkingLevel: "HIGH").
// AgentThoughtChunk events are also not currently emitted in stream-json
// output (see https://github.com/google-gemini/gemini-cli/issues/20977).
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

function renderPrompt(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase();
      const suffix = message.role === "tool" && message.toolName
        ? ` (${message.toolName})`
        : "";
      return `${role}${suffix}:\n${message.content}`.trim();
    })
    .join("\n\n");
}

function extractCliOutput(providerId: SupportedProviderId, stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }

  if (providerId === "codex") {
    const parsed = extractLastJsonText(trimmed);
    if (parsed) {
      return parsed;
    }
  }

  return trimmed;
}

function extractLastJsonText(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as Record<string, unknown>;
      const directText = asString(parsed.text) || asString(parsed.message);
      if (directText) {
        return directText.trim();
      }
      const data = asRecord(parsed.data);
      const dataText = asString(data?.text) || asString(data?.message);
      if (dataText) {
        return dataText.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

function estimateUsage(messages: ModelMessage[], output: string): TokenUsage {
  const promptChars = messages.reduce((total, message) => total + message.content.length, 0);
  const promptTokens = Math.ceil(promptChars / 4);
  const completionTokens = Math.ceil(output.length / 4);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    tokenAccuracy: "estimated",
    usageSource: "ledger",
  };
}

async function defaultRunCommand(spec: CommandSpec, signal?: AbortSignal): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(spec.executable, spec.args, {
      stdio: "pipe",
      env: process.env,
      cwd: spec.cwd,
      signal,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        stderr += `\n${error.message}`;
        return;
      }
      reject(error);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    if (spec.stdin) {
      proc.stdin.write(spec.stdin);
    }
    proc.stdin.end();
  });
}

async function* defaultRunCommandStream(
  spec: CommandSpec,
  signal?: AbortSignal,
): AsyncIterable<CommandStreamEvent> {
  const queue = new AsyncStreamQueue<CommandStreamEvent>();
  const proc: ChildProcessWithoutNullStreams = spawn(spec.executable, spec.args, {
    stdio: "pipe",
    env: process.env,
    cwd: spec.cwd,
    signal,
  });

  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    queue.push({ type: "stdout", chunk });
  });
  proc.stderr.on("data", (chunk: string) => {
    queue.push({ type: "stderr", chunk });
  });
  proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      queue.push({ type: "stderr", chunk: `\n${error.message}` });
      return;
    }
    queue.fail(error);
  });
  proc.on("error", (error) => {
    queue.fail(error);
  });
  proc.on("close", (code) => {
    queue.push({ type: "exit", exitCode: code ?? 1 });
    queue.close();
  });

  if (spec.stdin) {
    proc.stdin.write(spec.stdin);
  }
  proc.stdin.end();

  for await (const event of queue) {
    yield event;
  }
}

function defaultRunCommandSync(command: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1_500,
  });
}

function normalizeWorkingDirectory(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveCliAccessMode(options: GenerateOptions): TurnAccessMode {
  if (options.accessMode === "default" || options.accessMode === "full_access") {
    return options.accessMode;
  }
  return options.nativeCliToolsEnabled === true ? "full_access" : "default";
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

function commandPreview(spec: CommandSpec): string {
  const args = spec.args.map(shellEscape).join(" ");
  const cwdPrefix = spec.cwd ? `cd ${shellEscape(spec.cwd)} && ` : "";
  return `${cwdPrefix}${shellEscape(spec.executable)}${args ? ` ${args}` : ""}`;
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function notifyCliExecutionObserver(
  observer: CliExecutionObserver | undefined,
  event: Parameters<CliExecutionObserver>[0],
): Promise<void> {
  if (!observer) return;
  await observer(event);
}

interface CliStreamParser {
  push(chunk: string): StreamChunk[];
  finish(): StreamChunk[];
}

function createCliStreamParser(providerId: SupportedProviderId, messages: ModelMessage[]): CliStreamParser {
  switch (providerId) {
    case "claude":
      return new JsonLineCliStreamParser((record, state) => parseClaudeStreamRecord(record, state), messages);
    case "codex":
      return new JsonLineCliStreamParser((record, state) => parseCodexStreamRecord(record, state), messages);
    case "gemini":
      return new JsonLineCliStreamParser((record, state) => parseGeminiStreamRecord(record, state), messages);
  }
}

interface JsonLineParserState {
  readonly messages: ModelMessage[];
  readonly toolCalls: Map<string, ToolCall>;
  readonly emittedToolStarts: Set<string>;
  assistantText: string;
  sawFinish: boolean;
  lastState: NormalizedAgentState | null;
  sawVisibleAssistantOutput: boolean;
  latestCompletedAgentMessage?: string;
}

class JsonLineCliStreamParser implements CliStreamParser {
  private readonly state: JsonLineParserState;
  private lineBuffer = "";

  constructor(
    private readonly parseRecord: (record: Record<string, unknown>, state: JsonLineParserState) => StreamChunk[],
    messages: ModelMessage[],
  ) {
    this.state = {
      messages,
      toolCalls: new Map<string, ToolCall>(),
      emittedToolStarts: new Set<string>(),
      assistantText: "",
      sawFinish: false,
      lastState: null,
      sawVisibleAssistantOutput: false,
      latestCompletedAgentMessage: undefined,
    };
  }

  push(chunk: string): StreamChunk[] {
    this.lineBuffer += chunk;
    const output: StreamChunk[] = [];

    while (true) {
      const newlineIndex = this.lineBuffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      output.push(...this.parseLine(line));
    }

    return output;
  }

  finish(): StreamChunk[] {
    const output: StreamChunk[] = [];
    const trailing = this.lineBuffer.trim();
    this.lineBuffer = "";
    if (trailing) {
      output.push(...this.parseLine(trailing));
    }
    if (!this.state.sawFinish && this.state.assistantText.length > 0) {
      output.push({
        type: "finish",
        finishReason: "stop",
        usage: estimateUsage(this.state.messages, this.state.assistantText),
      });
      this.state.sawFinish = true;
    }
    return output;
  }

  private parseLine(line: string): StreamChunk[] {
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const chunks = normalizeParsedStreamChunks(this.parseRecord(record, this.state), this.state);
      for (const chunk of chunks) {
        if (chunk.type === "text_delta" && typeof chunk.text === "string" && isVisibleAssistantTextChunk(chunk)) {
          this.state.assistantText += chunk.text;
          this.state.sawVisibleAssistantOutput = true;
        }
        if (chunk.type === "finish") {
          this.state.sawFinish = true;
        }
      }
      return chunks;
    } catch {
      return [];
    }
  }
}

function parseClaudeStreamRecord(record: Record<string, unknown>, state: JsonLineParserState): StreamChunk[] {
  const type = asString(record.type);
  if (type === "state_changed") {
    const normalized = normalizeAgentStateValue(record.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(type)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (type === "stream_event") {
    return parseClaudeStreamEvent(asRecord(record.event), state);
  }

  if (type === "assistant") {
    return parseClaudeAssistantMessage(asRecord(record.message) ?? record, state);
  }

  if (type === "result") {
    return [{
      type: "finish",
      finishReason: "stop",
      ...(parseAnthropicUsage(asRecord(record.usage) ?? record) ? { usage: parseAnthropicUsage(asRecord(record.usage) ?? record)! } : {}),
    }];
  }

  if (type === "rate_limit_event") {
    const retryAfterMs = Math.max(
      1,
      asNumber(record.retry_after_ms)
        ?? Math.round((asNumber(record.retry_after_seconds) ?? 1) * 1000),
    );
    return [{
      type: "rate_limited",
      retryAfterMs,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      attempt: 1,
      maxAttempts: 1,
      providerId: "claude",
      retryAt: new Date(Date.now() + retryAfterMs).toISOString(),
    }];
  }

  return [];
}

function parseClaudeStreamEvent(
  event: Record<string, unknown> | undefined,
  state: JsonLineParserState,
): StreamChunk[] {
  if (!event) return [];
  const eventType = asString(event.type);
  if (eventType === "state_changed") {
    const normalized = normalizeAgentStateValue(event.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(eventType)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (eventType === "content_block_start") {
    const block = asRecord(event.content_block) ?? asRecord(event.contentBlock);
    const blockType = asString(block?.type);
    // Track thinking blocks so we can tag deltas correctly
    if (blockType === "thinking") {
      return [{ type: "state_changed", state: "thinking" }];
    }
    return maybeEmitToolCallStart(block, state);
  }
  if (eventType === "content_block_delta") {
    const delta = asRecord(event.delta);
    const deltaType = asString(delta?.type);
    if (deltaType === "text_delta") {
      const text = asString(delta?.text)?.trimEnd();
      return text ? [{ type: "text_delta", text }] : [];
    }
    if (deltaType === "thinking_delta") {
      const text = asString(delta?.thinking) ?? asString(delta?.text);
      return text ? [{ type: "reasoning_delta", text }] : [];
    }
  }
  return [];
}

function parseClaudeAssistantMessage(
  message: Record<string, unknown>,
  state: JsonLineParserState,
): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  for (const block of asArray(message.content)) {
    const record = asRecord(block);
    if (!record) continue;
    const blockType = asString(record.type);
    if (blockType === "tool_use") {
      chunks.push(...maybeEmitToolCallStart(record, state));
      continue;
    }
    if (blockType === "thinking") {
      const text = asString(record.thinking) ?? asString(record.text);
      if (text) chunks.push({ type: "reasoning_delta", text });
    }
  }
  return chunks;
}

function maybeEmitToolCallStart(toolRecord: Record<string, unknown> | undefined, state: JsonLineParserState): StreamChunk[] {
  if (!toolRecord) return [];
  const toolCall = buildToolCall(toolRecord);
  if (!toolCall) return [];
  state.toolCalls.set(toolCall.id, toolCall);
  if (state.emittedToolStarts.has(toolCall.id)) {
    return [];
  }
  state.emittedToolStarts.add(toolCall.id);
  return [{
    type: "tool_call_start",
    toolCall,
  }];
}

function parseCodexStreamRecord(record: Record<string, unknown>, state: JsonLineParserState): StreamChunk[] {
  const type = asString(record.type);
  if (type === "state_changed") {
    const normalized = normalizeAgentStateValue(record.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(type)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (type === "event_msg") {
    return parseCodexEventMessage(asRecord(record.msg), state);
  }
  if (type === "item.started" || type === "item.completed") {
    return parseCodexItem(asRecord(record.item), type === "item.completed", state);
  }
  if (type === "response_item") {
    return parseCodexItem(asRecord(record.item) ?? asRecord(record.response_item), false, state);
  }
  if (type === "turn.completed") {
    const chunks: StreamChunk[] = [];
    if (state.latestCompletedAgentMessage && !state.sawVisibleAssistantOutput) {
      chunks.push({
        type: "text_delta",
        text: state.latestCompletedAgentMessage,
        transcriptVisibility: "visible",
        streamKind: "assistant_output",
      });
    }
    chunks.push({
      type: "finish",
      finishReason: normalizeFinishReason(asString(record.finish_reason) ?? asString(record.stop_reason)),
      ...(parseCodexUsage(asRecord(record.usage)) ? { usage: parseCodexUsage(asRecord(record.usage))! } : {}),
    });
    return chunks;
  }
  return [];
}

function parseCodexEventMessage(
  message: Record<string, unknown> | undefined,
  state: JsonLineParserState,
): StreamChunk[] {
  if (!message) return [];
  const messageType = asString(message.type);
  if (messageType === "state_changed") {
    const normalized = normalizeAgentStateValue(message.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(messageType)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (messageType === "agent_message") {
    const text = extractTextPayload(message);
    return text
      ? [{
        type: "text_delta",
        text,
        transcriptVisibility: "activity_only",
        streamKind: "provider_client",
      }]
      : [];
  }
  if (messageType === "agent_reasoning") {
    const text = extractTextPayload(message);
    return text ? [{ type: "reasoning_delta", text }] : [];
  }
  if (messageType === "tool_call_start" || messageType === "tool_call") {
    return maybeEmitToolCallStart(message, state);
  }
  if (messageType === "tool_result") {
    const toolResult = buildToolResult(message, state);
    return toolResult ? [{ type: "tool_result", toolResult }] : [];
  }
  return [];
}

function parseCodexItem(
  item: Record<string, unknown> | undefined,
  completed: boolean,
  state: JsonLineParserState,
): StreamChunk[] {
  if (!item) return [];
  const itemType = asString(item.type);
  if (itemType === "agent_message" && completed) {
    const text = extractTextPayload(item);
    if (text) {
      state.latestCompletedAgentMessage = text;
    }
    return [];
  }
  if (itemType === "reasoning") {
    const text = extractTextPayload(item);
    return text ? [{ type: "reasoning_delta", text }] : [];
  }
  if (
    itemType === "function_call"
    || itemType === "tool_call"
    || itemType === "tool_use"
    || itemType === "exec_command"
    || itemType === "mcp_tool_call"
  ) {
    if (!completed) {
      return maybeEmitToolCallStart(item, state);
    }
    const toolResult = buildToolResult(item, state);
    return toolResult ? [{ type: "tool_result", toolResult }] : [];
  }
  return [];
}

function parseGeminiStreamRecord(record: Record<string, unknown>, state: JsonLineParserState): StreamChunk[] {
  const type = asString(record.type);
  if (type === "state_changed") {
    const normalized = normalizeAgentStateValue(record.state);
    return normalized ? [{ type: "state_changed", state: normalized }] : [];
  }
  if (isApprovalEventType(type)) {
    return [{ type: "state_changed", state: "needs_feedback" }];
  }
  if (type === "message") {
    const role = asString(record.role);
    if (role !== "assistant") return [];
    const text = extractTextPayload(record);
    return text ? [{ type: "text_delta", text }] : [];
  }
  if (type === "tool_use") {
    return maybeEmitToolCallStart(record, state);
  }
  if (type === "tool_result") {
    const toolResult = buildToolResult(record, state);
    return toolResult ? [{ type: "tool_result", toolResult }] : [];
  }
  if (type === "result") {
    return [{
      type: "finish",
      finishReason: normalizeFinishReason(asString(record.finishReason) ?? asString(record.stopReason)),
      ...(parseGeminiUsage(record) ? { usage: parseGeminiUsage(record)! } : {}),
    }];
  }
  return [];
}

function buildToolCall(record: Record<string, unknown>): ToolCall | null {
  const id = asString(record.id) ?? asString(record.toolCallId) ?? asString(record.call_id);
  const name =
    asString(record.name)
    ?? asString(record.tool_name)
    ?? asString(record.tool)
    ?? asString(record.command)
    ?? asString(record.operation)
    ?? asString(record.title);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    arguments: coerceToolArgumentsRecord(record.arguments)
      ?? coerceToolArgumentsRecord(record.input)
      ?? coerceToolArgumentsRecord(record.parameters)
      ?? coerceToolArgumentsRecord(asRecord(record.function)?.arguments)
      ?? {},
  };
}

function buildToolResult(record: Record<string, unknown>, state: JsonLineParserState): ToolResult | null {
  const toolCallId =
    asString(record.toolCallId)
    ?? asString(record.id)
    ?? asString(record.call_id);
  if (!toolCallId) {
    return null;
  }
  const knownCall = state.toolCalls.get(toolCallId);
  if (knownCall && !state.emittedToolStarts.has(toolCallId)) {
    state.emittedToolStarts.add(toolCallId);
  }
  return {
    toolCallId,
    result: record.result ?? record.output ?? record.data ?? extractTextPayload(record) ?? {},
    ...(knownCall?.name ? { name: knownCall.name } : {}),
    ...(typeof record.isError === "boolean"
      ? { isError: record.isError }
      : asString(record.status) === "failed" || asString(record.status) === "canceled" || asString(record.status) === "denied"
        ? { isError: true }
        : {}),
  } as ToolResult;
}

function parseAnthropicUsage(record: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!record) return undefined;
  const promptTokens = asNumber(record.input_tokens) ?? 0;
  const completionTokens = asNumber(record.output_tokens) ?? 0;
  const totalTokens = promptTokens + completionTokens;
  if (totalTokens <= 0) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    tokenAccuracy: "reported",
    usageSource: "ledger",
    usageDetails: {
      inputNoCacheTokens: promptTokens,
      inputCacheWriteTokens: asNumber(record.cache_creation_input_tokens),
      inputCacheReadTokens: asNumber(record.cache_read_input_tokens),
      outputTextTokens: completionTokens,
      raw: record,
    },
  };
}

function parseCodexUsage(record: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!record) return undefined;
  const promptTokens = asNumber(record.input_tokens) ?? 0;
  const completionTokens = asNumber(record.output_tokens) ?? 0;
  const totalTokens = asNumber(record.total_tokens) ?? (promptTokens + completionTokens);
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens > 0 ? totalTokens : promptTokens + completionTokens,
    tokenAccuracy: "reported",
    usageSource: "ledger",
    usageDetails: {
      inputNoCacheTokens: promptTokens,
      inputCacheReadTokens: asNumber(record.cached_input_tokens),
      outputTextTokens: completionTokens,
      outputReasoningTokens: asNumber(record.reasoning_output_tokens),
      raw: record,
    },
  };
}

function parseGeminiUsage(record: Record<string, unknown>): TokenUsage | undefined {
  const usage = asRecord(record.usage) ?? asRecord(record.usageMetadata) ?? record;
  const promptTokens = asNumber(usage.prompt_tokens) ?? asNumber(usage.promptTokenCount) ?? asNumber(usage.inputTokens) ?? 0;
  const completionTokens = asNumber(usage.output_tokens) ?? asNumber(usage.candidatesTokenCount) ?? asNumber(usage.outputTokens) ?? 0;
  const totalTokens = asNumber(usage.total_tokens) ?? asNumber(usage.totalTokenCount) ?? (promptTokens + completionTokens);
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens > 0 ? totalTokens : promptTokens + completionTokens,
    tokenAccuracy: "reported",
    usageSource: "ledger",
    usageDetails: {
      inputNoCacheTokens: promptTokens,
      outputTextTokens: completionTokens,
      raw: usage,
    },
  };
}

function normalizeFinishReason(value?: string): GenerateResult["finishReason"] {
  switch (value?.trim().toLowerCase()) {
    case "tool_calls":
      return "tool_calls";
    case "length":
    case "max_tokens":
      return "length";
    case "content_filter":
      return "content_filter";
    case "error":
      return "error";
    case "stop":
    case "completed":
    case undefined:
      return "stop";
    default:
      return "other";
  }
}

type NormalizedAgentState = "idle" | "thinking" | "acting" | "needs_feedback" | "errored";

const APPROVAL_EVENT_TYPES = new Set([
  "approval_request",
  "approval_requested",
  "approval_required",
  "permission_request",
  "permission_required",
  "feedback_requested",
]);

function normalizeParsedStreamChunks(
  chunks: StreamChunk[],
  parserState: JsonLineParserState,
): StreamChunk[] {
  const normalized: StreamChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.type === "state_changed") {
      const explicitState = normalizeAgentStateValue(chunk.state);
      if (!explicitState) continue;
      maybePushStateChange(normalized, parserState, explicitState);
      continue;
    }

    const derivedState = deriveStateFromChunk(chunk);
    if (derivedState) {
      maybePushStateChange(normalized, parserState, derivedState);
    }

    normalized.push(chunk);
  }
  return normalized;
}

function maybePushStateChange(
  output: StreamChunk[],
  parserState: JsonLineParserState,
  state: NormalizedAgentState,
): void {
  if (parserState.lastState === state) return;
  output.push({ type: "state_changed", state });
  parserState.lastState = state;
}

function deriveStateFromChunk(chunk: StreamChunk): NormalizedAgentState | null {
  switch (chunk.type) {
    case "tool_call_start":
      return "acting";
    case "tool_result":
    case "text_delta":
    case "reasoning_delta":
      return "thinking";
    case "finish":
      return "idle";
    default:
      return null;
  }
}

function isVisibleAssistantTextChunk(chunk: StreamChunk): boolean {
  const transcriptVisibility = chunk.transcriptVisibility ?? "visible";
  const streamKind = chunk.streamKind ?? "assistant_output";
  return transcriptVisibility === "visible" && streamKind === "assistant_output";
}

function normalizeAgentStateValue(value: unknown): NormalizedAgentState | null {
  const normalized = asString(value)?.toLowerCase();
  if (!normalized) return null;
  switch (normalized) {
    case "idle":
    case "done":
    case "completed":
    case "finished":
    case "stopped":
      return "idle";
    case "thinking":
    case "reasoning":
    case "planning":
      return "thinking";
    case "acting":
    case "executing":
    case "running_tools":
    case "running-tools":
      return "acting";
    case "needs_feedback":
    case "needs-feedback":
    case "needsfeedback":
    case "waiting_for_approval":
    case "waiting-for-approval":
    case "awaiting_approval":
      return "needs_feedback";
    case "errored":
    case "error":
    case "failed":
      return "errored";
    default:
      return null;
  }
}

function isApprovalEventType(value?: string): boolean {
  if (!value) return false;
  return APPROVAL_EVENT_TYPES.has(value.trim().toLowerCase());
}

function extractTextPayload(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((entry) => extractTextPayload(entry))
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .join("");
    return text.trim().length > 0 ? text : undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of ["text", "delta", "message", "summary", "reasoning", "thinking", "content"]) {
    const candidate = extractTextPayload(record[key]);
    if (candidate) return candidate;
  }

  if (Array.isArray(record.parts)) {
    return extractTextPayload(record.parts);
  }

  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function coerceToolArgumentsRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (record) {
    return record;
  }

  const stringValue = asString(value);
  if (stringValue) {
    const parsed = safeParseJson(stringValue);
    const parsedRecord = asRecord(parsed);
    if (parsedRecord) {
      return parsedRecord;
    }
    return { [RAW_TOOL_ARGUMENTS_KEY]: stringValue };
  }

  if (Array.isArray(value)) {
    const serialized = safeStringifyJson(value);
    if (serialized) {
      return { [RAW_TOOL_ARGUMENTS_KEY]: serialized };
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function safeStringifyJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

class AsyncStreamQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;
  private error: Error | null = null;

  push(value: T): void {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.error = error instanceof Error ? error : new Error(String(error));
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false });
        }
        if (this.error) {
          const error = this.error;
          this.error = null;
          return Promise.reject(error);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}
