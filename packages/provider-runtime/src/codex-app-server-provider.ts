import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createConnection } from "node:net";
import type {
  GenerateOptions,
  GenerateResult,
  GatewayToolBridgeConfig,
  ModelInfo,
  ModelProvider,
  ProviderSessionHandle,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolResult,
} from "@spaceskit/core";
import { inferContextWindow } from "@spaceskit/core";
import {
  buildCommandApprovalRequest,
  buildFileApprovalRequest,
  mapCommandApprovalDecision,
  mapFileApprovalDecision,
  requestProviderFeedback,
} from "./codex-app-server-approvals.js";
import {
  extractDeveloperInstructions,
  mapApprovalPolicy,
  mapReasoningEffort,
  mapReasoningSummary,
  mapSandboxMode,
  toUserInputs,
} from "./codex-app-server-request-mapping.js";
import {
  isVisibleAssistantTextChunk,
} from "./codex-app-server-stream-mapping.js";
import { StdioCodexAppServerClient } from "./codex-app-server-stdio-client.js";
import {
  buildDynamicTools,
  normalizeDynamicToolCall,
  resolveGatewayToolBridgeConfig,
  toDynamicToolContentItems,
} from "./codex-app-server-tool-protocol.js";

export {
  decodeDynamicToolName,
  encodeDynamicToolName,
} from "./codex-app-server-tool-protocol.js";

const DEFAULT_CLIENT_INFO = {
  name: "spaces-gateway",
  version: "0.1.0",
} as const;

const DEFAULT_MODEL_LIST_LIMIT = 100;

type JsonRpcId = number | string;
type JsonRecord = Record<string, unknown>;
type SpawnFn = typeof spawn;

export type CodexAppServerAuthMode = "api_key" | "host_login";
export type CodexAppServerAuthStatus = "authenticated" | "needs_key" | "needs_auth" | "error" | "unsupported";

export interface CodexAppServerAuthAccount {
  email?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiProvider?: string;
}

export interface CodexAppServerDiscoveredModel {
  id: string;
  displayName: string;
  contextWindow?: number;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: string[];
  isDefault?: boolean;
}

export interface CodexAppServerProbeResult {
  authMode: CodexAppServerAuthMode;
  authStatus: CodexAppServerAuthStatus;
  authAccount?: CodexAppServerAuthAccount;
  models: CodexAppServerDiscoveredModel[];
  detectionError?: string;
}

export interface CodexAppServerProbeInput {
  providerId: string;
  model: string;
  authMode: CodexAppServerAuthMode;
  apiKey?: string;
}

export interface CodexAppServerTurnInput {
  providerId: string;
  model: string;
  authMode: CodexAppServerAuthMode;
  apiKey?: string;
  options: GenerateOptions;
}

export interface CodexAppServerClientLike {
  probeMetadata(input: CodexAppServerProbeInput): Promise<CodexAppServerProbeResult>;
  streamTurn(input: CodexAppServerTurnInput): AsyncIterable<StreamChunk>;
}

export interface CodexAppServerProviderConfig {
  id: string;
  name: string;
  model: string;
  apiKey?: string;
  authMode?: CodexAppServerAuthMode;
  isLocal?: boolean;
  env?: Record<string, string | undefined>;
  executablePath?: string;
  spawnImpl?: SpawnFn;
  clientFactory?: () => CodexAppServerClientLike;
}

export class CodexAppServerModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: CodexAppServerProviderConfig;
  private readonly client: CodexAppServerClientLike;

  constructor(config: CodexAppServerProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? false;
    this.config = config;
    this.client = config.clientFactory?.() ?? new StdioCodexAppServerClient(config);
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    const metadata = await this.probeMetadata();
    return {
      available: metadata.authStatus === "authenticated",
      latencyMs: Date.now() - startedAt,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const metadata = await this.probeMetadata();
    if (metadata.models.length > 0) {
      return metadata.models.map((model) => ({
        id: model.id,
        name: model.displayName,
        provider: this.id,
        contextWindow: model.contextWindow,
        supportsTools: true,
        isLocal: this.isLocal,
      }));
    }

    const modelId = this.resolveModelId(this.config.model);
    return [{
      id: `${this.id}/${modelId}`,
      name: modelId,
      provider: this.id,
      contextWindow: inferContextWindow(this.id, modelId),
      supportsTools: true,
      isLocal: this.isLocal,
    }];
  }

  async probeMetadata(): Promise<CodexAppServerProbeResult> {
    const authMode = this.resolveAuthMode();
    return this.client.probeMetadata({
      providerId: this.id,
      model: this.resolveModelId(this.config.model),
      authMode,
      apiKey: this.resolveApiKey(authMode),
    });
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const chunks: StreamChunk[] = [];
    for await (const chunk of this.stream(model, options)) {
      chunks.push(chunk);
    }

    const text = chunks
      .filter((chunk) => chunk.type === "text_delta" && typeof chunk.text === "string" && isVisibleAssistantTextChunk(chunk))
      .map((chunk) => chunk.text as string)
      .join("");
    const finish = [...chunks].reverse().find((chunk) => chunk.type === "finish");
    const feedback = [...chunks].reverse().find((chunk) => chunk.type === "feedback_request");

    return {
      message: {
        role: "assistant",
        content: text,
      },
      finishReason: finish?.finishReason ?? (feedback ? "other" : "stop"),
      ...(finish?.usage ? { usage: finish.usage } : {}),
      ...(finish?.providerSessionHandle ? { providerSessionHandle: finish.providerSessionHandle } : {}),
      ...(feedback?.feedbackRequest ? { feedbackRequest: feedback.feedbackRequest } : {}),
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const resolvedModel = this.resolveModelId(model || this.config.model);
    const authMode = this.resolveAuthMode();
    yield* this.client.streamTurn({
      providerId: this.id,
      model: resolvedModel,
      authMode,
      apiKey: this.resolveApiKey(authMode),
      options,
    });
  }

  private resolveAuthMode(): CodexAppServerAuthMode {
    return this.config.authMode ?? "api_key";
  }

  private resolveApiKey(authMode: CodexAppServerAuthMode): string | undefined {
    if (authMode !== "api_key") {
      return undefined;
    }
    const configured = this.config.apiKey?.trim();
    if (configured) {
      return configured;
    }
    const envApiKey = this.config.env?.OPENAI_API_KEY?.trim();
    if (envApiKey) {
      return envApiKey;
    }
    return process.env.OPENAI_API_KEY?.trim() || undefined;
  }

  private resolveModelId(modelIdRaw: string): string {
    const trimmed = modelIdRaw.trim();
    const providerPrefix = `${this.id}/`;
    if (trimmed.toLowerCase().startsWith(providerPrefix)) {
      return trimmed.slice(providerPrefix.length);
    }
    return trimmed;
  }
}
