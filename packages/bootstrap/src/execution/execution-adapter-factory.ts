import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelProvider } from "@spaceskit/core";
import {
  AnthropicSdkModelProvider,
  type AppleFoundationProviderConfig,
  AppleFoundationModelProvider,
  ClaudeAgentSdkModelProvider,
  CliExecutorModelProvider,
  CodexAppServerModelProvider,
  LmStudioModelProvider,
  OpenAICompatibleModelProvider,
  OpenAIResponsesModelProvider,
  UnsupportedModelProvider,
} from "@spaceskit/provider-runtime";

export type ExecutionAdapterClass = "cloud" | "executor" | "local_runtime";

export interface ExecutionAdapterFactoryInput {
  providerId: string;
  model: string;
  apiKey?: string;
  authMode?: "api_key" | "host_login";
  baseURL?: string;
  isLocal?: boolean;
}

interface ExecutionAdapterFactoryOptions {
  appleHelperExecutablePath?: string;
  appleHelperRunCommand?: AppleFoundationProviderConfig["runCommand"];
}

const EXECUTOR_PROVIDER_IDS = new Set(["claude", "claude-agent-sdk", "codex", "codex-app-server", "gemini"]);
const LOCAL_RUNTIME_PROVIDER_IDS = new Set(["apple", "lmstudio", "ollama"]);

export function classifyExecutionAdapter(providerIdRaw?: string): ExecutionAdapterClass {
  const providerId = providerIdRaw?.trim().toLowerCase() ?? "";
  if (EXECUTOR_PROVIDER_IDS.has(providerId)) {
    return "executor";
  }
  if (LOCAL_RUNTIME_PROVIDER_IDS.has(providerId)) {
    return "local_runtime";
  }
  return "cloud";
}

export function mapExecutionClassToCatalogGroup(
  executionClass: ExecutionAdapterClass,
): "cloud" | "executor" | "local_runtime" {
  switch (executionClass) {
    case "cloud":
      return "cloud";
    case "executor":
      return "executor";
    case "local_runtime":
      return "local_runtime";
  }
}

export class ExecutionAdapterFactory {
  constructor(private readonly options: ExecutionAdapterFactoryOptions = {}) {}

  createModelProvider(input: ExecutionAdapterFactoryInput): ModelProvider {
    const executionClass = classifyExecutionAdapter(input.providerId);
    const providerId = input.providerId.trim().toLowerCase();
    const isLocal = input.isLocal ?? executionClass !== "cloud";

    if (providerId === "anthropic") {
      return new AnthropicSdkModelProvider({
        id: providerId,
        name: "Anthropic",
        model: input.model,
        apiKey: input.apiKey,
        isLocal: false,
      });
    }

    if (providerId === "claude-agent-sdk") {
      return new ClaudeAgentSdkModelProvider({
        id: providerId,
        name: "Claude Agent SDK",
        model: input.model,
        apiKey: input.apiKey,
        authMode: input.authMode,
        isLocal: false,
      });
    }

    if (providerId === "codex-app-server") {
      return new CodexAppServerModelProvider({
        id: providerId,
        name: "Codex App Server",
        model: input.model,
        apiKey: input.apiKey,
        authMode: input.authMode as "api_key" | "host_login" | undefined,
        isLocal: false,
      });
    }

    if (providerId === "claude" || providerId === "codex" || providerId === "gemini") {
      return new CliExecutorModelProvider({
        id: providerId,
        name: providerId,
        model: input.model,
        isLocal,
      } as any);
    }

    // OpenAI Responses API — explicit opt-in for server-side session support
    if (providerId === "openai-responses") {
      return new OpenAIResponsesModelProvider({
        id: "openai",
        name: "OpenAI (Responses API)",
        model: input.model,
        apiKey: input.apiKey,
        isLocal: false,
      });
    }

    if (providerId === "lmstudio") {
      return new LmStudioModelProvider({
        id: providerId,
        name: "LM Studio",
        model: input.model,
        baseURL: input.baseURL,
        isLocal: true,
      });
    }

    if (
      providerId === "openai"
      || providerId === "openrouter"
      || providerId === "groq"
      || providerId === "together"
      || providerId === "mistral"
      || providerId === "ollama"
    ) {
      return new OpenAICompatibleModelProvider({
        id: providerId,
        name: providerId,
        model: input.model,
        apiKey: input.apiKey,
        baseURL: input.baseURL,
        isLocal,
      });
    }

    if (providerId === "apple") {
      const helperExecutablePath = this.options.appleHelperExecutablePath
        ?? resolveAppleFoundationHelperExecutablePath();
      return new AppleFoundationModelProvider({
        id: providerId,
        name: "Apple Foundation",
        model: input.model,
        isLocal: true,
        ...(helperExecutablePath
          ? {
            helperExecutablePath,
            runCommand: this.options.appleHelperRunCommand ?? runAppleFoundationHelperCommand,
          }
          : {}),
      });
    }

    return new UnsupportedModelProvider({
      id: providerId,
      name: providerId,
      isLocal,
      detail: "This provider is not part of the native MVP runtime.",
    });
  }

  classify(providerId: string): ExecutionAdapterClass {
    return classifyExecutionAdapter(providerId);
  }
}

function resolveAppleFoundationHelperExecutablePath(): string | undefined {
  const envOverride = process.env.SPACESKIT_APPLE_FOUNDATION_HELPER_PATH?.trim();
  if (envOverride) {
    return existsSync(envOverride) ? envOverride : undefined;
  }

  const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
  const helperRoot = resolve(gatewayRoot, "native/apple-foundation-helper/.build");
  const platformDir = process.arch === "arm64" ? "arm64-apple-macosx" : "x86_64-apple-macosx";
  const candidates = [
    resolve(helperRoot, platformDir, "release/SpacesAppleFoundationHelper"),
    resolve(helperRoot, platformDir, "debug/SpacesAppleFoundationHelper"),
    resolve(helperRoot, "release/SpacesAppleFoundationHelper"),
    resolve(helperRoot, "debug/SpacesAppleFoundationHelper"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function runAppleFoundationHelperCommand(
  input: {
    executable: string;
    args: string[];
    stdin?: string;
  },
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(input.executable, input.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({
        exitCode: code ?? 0,
        stdout,
        stderr,
      });
    });

    if (input.stdin) {
      child.stdin.write(input.stdin);
    }
    child.stdin.end();
  });
}
