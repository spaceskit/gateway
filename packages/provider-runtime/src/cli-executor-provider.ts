import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnSyncReturns } from "node:child_process";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  TokenUsage,
} from "@spaceskit/core";
import { ToolsUnsupportedError, UnsupportedProviderError } from "./provider-errors.js";

type SupportedProviderId = "claude" | "codex" | "gemini";

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

export interface CliExecutorProviderConfig {
  id: string;
  name: string;
  model: string;
  isLocal?: boolean;
  runCommand?: CommandRunner;
  runCommandSync?: CommandRunnerSync;
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

export class CliExecutorModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: CliExecutorProviderConfig;
  private readonly runCommand: CommandRunner;
  private readonly runCommandSync: CommandRunnerSync;

  constructor(config: CliExecutorProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? true;
    this.config = config;
    this.runCommand = config.runCommand ?? defaultRunCommand;
    this.runCommandSync = config.runCommandSync ?? defaultRunCommandSync;
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
        supportsTools: false,
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
    const spec = buildCommand(reference, prompt, options);
    const result = await this.runCommand(spec, options.signal);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `${reference.providerId} exited with status ${result.exitCode}`);
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
    const result = await this.generate(model, options);
    if (result.message.content) {
      yield {
        type: "text_delta",
        text: result.message.content,
      };
    }
    yield {
      type: "finish",
      usage: result.usage,
      finishReason: result.finishReason,
    };
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

function buildCommand(reference: ModelReference, prompt: string, options: GenerateOptions): CommandSpec {
  const nativeCliToolsEnabled = options.nativeCliToolsEnabled === true;
  const cwd = normalizeWorkingDirectory(options.workingDirectory);

  switch (reference.providerId) {
    case "claude":
      return {
        executable: "claude",
        args: [
          "--print",
          "--input-format",
          "text",
          "--output-format",
          "text",
          "--permission-mode",
          nativeCliToolsEnabled ? "bypassPermissions" : "plan",
          "--tools",
          nativeCliToolsEnabled ? "default" : "",
          ...(nativeCliToolsEnabled && cwd ? ["--add-dir", cwd] : []),
          "--model",
          reference.providerModelId,
        ],
        stdin: prompt,
        ...(cwd ? { cwd } : {}),
      };
    case "codex":
      return {
        executable: "codex",
        args: [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          nativeCliToolsEnabled ? "workspace-write" : "read-only",
          ...(nativeCliToolsEnabled ? ["--full-auto"] : []),
          "--color",
          "never",
          ...(cwd ? ["-C", cwd] : []),
          "--model",
          reference.providerModelId,
          "-",
        ],
        stdin: prompt,
        ...(cwd ? { cwd } : {}),
      };
    case "gemini":
      return {
        executable: "gemini",
        args: [
          "--prompt",
          "",
          "--output-format",
          "text",
          "--approval-mode",
          nativeCliToolsEnabled ? "auto_edit" : "plan",
          ...(nativeCliToolsEnabled && cwd ? ["--include-directories", cwd] : []),
          "--model",
          reference.providerModelId,
        ],
        stdin: prompt,
        ...(cwd ? { cwd } : {}),
      };
  }
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
