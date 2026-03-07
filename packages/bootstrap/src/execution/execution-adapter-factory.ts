import type { ModelProvider } from "@spaceskit/core";
import {
  AppleFoundationModelProvider,
  CliExecutorModelProvider,
  OpenAICompatibleModelProvider,
  UnsupportedModelProvider,
} from "@spaceskit/provider-runtime";

export type ExecutionAdapterClass = "cloud" | "executor" | "local_runtime";

export interface ExecutionAdapterFactoryInput {
  providerId: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  isLocal?: boolean;
}

const EXECUTOR_PROVIDER_IDS = new Set(["claude", "codex", "gemini"]);
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
  createModelProvider(input: ExecutionAdapterFactoryInput): ModelProvider {
    const executionClass = classifyExecutionAdapter(input.providerId);
    const providerId = input.providerId.trim().toLowerCase();
    const isLocal = input.isLocal ?? executionClass !== "cloud";

    if (providerId === "claude" || providerId === "codex" || providerId === "gemini") {
      return new CliExecutorModelProvider({
        id: providerId,
        name: providerId,
        model: input.model,
        isLocal,
      });
    }

    if (
      providerId === "openai"
      || providerId === "openrouter"
      || providerId === "groq"
      || providerId === "together"
      || providerId === "mistral"
      || providerId === "lmstudio"
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
      return new AppleFoundationModelProvider({
        id: providerId,
        name: "Apple Foundation",
        model: input.model,
        isLocal: true,
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
