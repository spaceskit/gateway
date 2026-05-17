import type { SpawnSyncReturns } from "node:child_process";
import type {
  CliExecutionObserver,
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
} from "@spaceskit/core";
import { buildCommand } from "./cli-executor-command-builder.js";
import type {
  CommandSpec,
  ModelReference,
} from "./cli-executor-command-types.js";
import {
  commandPreview,
  estimateUsage,
  extractCliOutput,
  renderPrompt,
} from "./cli-executor-output.js";
import {
  executableForProvider,
  MODEL_MANIFEST,
  normalizeProviderId,
} from "./cli-executor-provider-metadata.js";
import {
  defaultRunCommand,
  defaultRunCommandStream,
  defaultRunCommandSync,
} from "./cli-executor-runner.js";
import { createCliStreamParser } from "./cli-executor-stream-parser.js";
import { ToolsUnsupportedError, UnsupportedProviderError } from "./provider-errors.js";

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
  runCommand?: CommandRunner;
  runCommandSync?: CommandRunnerSync;
  runCommandStream?: CommandStreamRunner;
}

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

async function notifyCliExecutionObserver(
  observer: CliExecutionObserver | undefined,
  event: Parameters<CliExecutionObserver>[0],
): Promise<void> {
  if (!observer) return;
  await observer(event);
}
