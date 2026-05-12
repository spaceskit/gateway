import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LocalExecutableResolver } from "../execution/local-executable-resolver.js";
import {
  LOCAL_PROVIDER_MODEL_MANIFEST,
} from "./provider-catalog-support.js";
import {
  uniqueModelIds,
  withProviderPrefix,
} from "../gateway-admin-model-normalizers.js";

export interface DiscoveredLocalAgent {
  id: string;
  name: string;
  detected: boolean;
  executablePath?: string;
  appPath?: string;
  serviceReachable?: boolean;
  recommendedProviderId: string;
  recommendedModel: string;
  requiresApiKey: boolean;
  availableModels?: string[];
  detectionError?: string;
  notes?: string;
}

export interface OpenAICompatibleDetectedModel {
  id: string;
  contextWindow?: number;
}

export interface OpenAICompatibleDetectionResult {
  serviceReachable: boolean;
  models: OpenAICompatibleDetectedModel[];
  detectionError?: string;
}

export interface LocalClientTemplate {
  id: string;
  name: string;
  commands: string[];
  appPath?: string;
  recommendedProviderId: string;
  recommendedModel: string;
  requiresApiKey: boolean;
  defaultProfileName: string;
  defaultPersonalityPrompt: string;
  notes?: string;
}

const LOCAL_AGENT_SNAPSHOT_CACHE_TTL_MS = 10_000;

export const LOCAL_CLIENT_TEMPLATES: LocalClientTemplate[] = [
  {
    id: "claude",
    name: "Claude",
    commands: ["claude"],
    recommendedProviderId: "claude",
    recommendedModel: "claude/sonnet",
    requiresApiKey: false,
    defaultProfileName: "Claude Agent",
    defaultPersonalityPrompt: "You are a Claude-backed agent focused on clear reasoning and safe execution.",
  },
  {
    id: "gemini",
    name: "Gemini",
    commands: ["gemini"],
    recommendedProviderId: "gemini",
    recommendedModel: "gemini/gemini-2.5-flash",
    requiresApiKey: false,
    defaultProfileName: "Gemini Agent",
    defaultPersonalityPrompt: "You are a Gemini-backed agent focused on concise and grounded responses.",
  },
  {
    id: "codex",
    name: "Codex",
    commands: ["codex"],
    recommendedProviderId: "codex",
    recommendedModel: "codex/gpt-5.1-codex",
    requiresApiKey: false,
    defaultProfileName: "Codex Agent",
    defaultPersonalityPrompt: "You are a coding-focused assistant optimized for implementation tasks.",
  },
  {
    id: "codex-app-server",
    name: "Codex App Server",
    commands: ["codex"],
    recommendedProviderId: "codex-app-server",
    recommendedModel: "codex-app-server/gpt-5.4",
    requiresApiKey: false,
    defaultProfileName: "Codex App Server Agent",
    defaultPersonalityPrompt: "You are a coding-focused assistant running through Codex App Server with mediated gateway tools.",
    notes: "Uses the local codex app-server transport and can authenticate with ChatGPT or OPENAI_API_KEY.",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    commands: ["lms", "lmstudio"],
    appPath: "/Applications/LM Studio.app",
    recommendedProviderId: "lmstudio",
    recommendedModel: "lmstudio/qwen2.5-coder",
    requiresApiKey: false,
    defaultProfileName: "LM Studio Agent",
    defaultPersonalityPrompt: "You are a local model agent running through LM Studio.",
    notes: "Uses OpenAI-compatible endpoint http://127.0.0.1:1234/v1 by default.",
  },
];

export interface LocalAgentDiscoveryServiceOptions {
  executableResolver?: LocalExecutableResolver;
  providerConfigs: ReadonlyMap<string, { baseURL?: string }>;
  resolveProviderBaseURL: (providerId: string, configuredBaseURL?: string) => string | undefined;
  providerPolicyRestrictionReason: (providerId: string) => string | undefined;
  detectOpenAICompatibleModels: (baseURL?: string) => Promise<OpenAICompatibleDetectionResult>;
}

export class LocalAgentDiscoveryService {
  private readonly executableResolver: LocalExecutableResolver;
  private snapshotCache?: {
    expiresAt: number;
    value: DiscoveredLocalAgent[];
  };
  private snapshotInFlight?: Promise<DiscoveredLocalAgent[]>;

  constructor(private readonly options: LocalAgentDiscoveryServiceOptions) {
    this.executableResolver = options.executableResolver ?? new LocalExecutableResolver();
  }

  getLocalClientTemplate(localClientId: string): LocalClientTemplate | undefined {
    return LOCAL_CLIENT_TEMPLATES.find((entry) => entry.id === localClientId);
  }

  async discoverLocalAgents(forceRefresh = false): Promise<DiscoveredLocalAgent[]> {
    return this.loadLocalAgentSnapshot(forceRefresh);
  }

  async loadLocalAgentSnapshot(forceRefresh: boolean): Promise<DiscoveredLocalAgent[]> {
    const now = Date.now();
    if (!forceRefresh) {
      const cached = this.snapshotCache;
      if (cached) {
        if (cached.expiresAt > now) {
          return cached.value.map(cloneDiscoveredLocalAgent);
        }
        if (!this.snapshotInFlight) {
          this.snapshotInFlight = this.computeLocalAgentSnapshot();
        }
        return cached.value.map(cloneDiscoveredLocalAgent);
      }
      if (this.snapshotInFlight) {
        return (await this.snapshotInFlight).map(cloneDiscoveredLocalAgent);
      }
    }

    if (!this.snapshotInFlight) {
      this.snapshotInFlight = this.computeLocalAgentSnapshot();
    }
    return (await this.snapshotInFlight).map(cloneDiscoveredLocalAgent);
  }

  invalidate(): void {
    this.snapshotCache = undefined;
    this.snapshotInFlight = undefined;
  }

  findExecutable(commands: string[]): string | null {
    const resolved = this.executableResolver.resolve({
      cacheKey: commands.join("|"),
      commands,
      versionProbe: { args: ["--version"], timeoutMs: 750 },
    });
    return resolved.path ?? null;
  }

  detectCodexCliModels(): string[] {
    const home = process.env.HOME?.trim();
    if (!home) {
      return [];
    }

    const results: string[] = [];
    const seen = new Set<string>();
    const addModel = (value: unknown) => {
      if (typeof value !== "string") return;
      const normalized = value.trim();
      if (!normalized) return;
      const withPrefix = withProviderPrefix("codex", normalized);
      const key = withPrefix.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      results.push(withPrefix);
    };

    const configPath = join(home, ".codex", "config.toml");
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf8");
        const match = content.match(/^\s*model\s*=\s*"([^"]+)"/m);
        if (match?.[1]) {
          addModel(match[1]);
        }
      } catch {
        // Ignore local config parse issues.
      }
    }

    const cachePath = join(home, ".codex", "models_cache.json");
    if (existsSync(cachePath)) {
      try {
        const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as {
          models?: Array<{ slug?: unknown; visibility?: unknown }>;
        };
        for (const entry of parsed.models ?? []) {
          const visibility = typeof entry.visibility === "string"
            ? entry.visibility.toLowerCase()
            : "";
          if (visibility === "hidden") {
            continue;
          }
          addModel(entry.slug);
        }
      } catch {
        // Ignore cache parse issues.
      }
    }

    return results;
  }

  private async computeLocalAgentSnapshot(): Promise<DiscoveredLocalAgent[]> {
    const lmStudioPolicyReason = this.options.providerPolicyRestrictionReason("lmstudio");
    try {
      const lmStudioDetection = lmStudioPolicyReason
        ? {
          serviceReachable: false,
          models: [],
          detectionError: lmStudioPolicyReason,
        }
        : await this.options.detectOpenAICompatibleModels(
          this.options.resolveProviderBaseURL(
            "lmstudio",
            this.options.providerConfigs.get("lmstudio")?.baseURL,
          ),
        );
      const codexDetectedModels = this.detectCodexCliModels();
      const codexAppServerDetectedModels = codexDetectedModels.map((modelId) =>
        modelId.replace(/^codex\//, "codex-app-server/"),
      );

      const value = LOCAL_CLIENT_TEMPLATES.map((template) => {
        const executablePath = this.findExecutable(template.commands);
        const appPath = template.appPath && existsSync(template.appPath) ? template.appPath : undefined;
        const providerId = template.recommendedProviderId;
        const policyReason = this.options.providerPolicyRestrictionReason(providerId);
        const policyAllowed = !policyReason;
        const detected = policyAllowed && Boolean(executablePath || appPath);
        const localManifestModels = LOCAL_PROVIDER_MODEL_MANIFEST[providerId] ?? [];
        const availableModels = !policyAllowed
          ? []
          : template.id === "lmstudio"
            ? lmStudioDetection.models.map((model) => withProviderPrefix("lmstudio", model.id))
            : uniqueModelIds([
              ...(template.id === "codex" ? codexDetectedModels : []),
              ...(template.id === "codex-app-server" ? codexAppServerDetectedModels : []),
              ...localManifestModels,
            ]);
        const recommendedModel = availableModels?.[0] ?? template.recommendedModel;
        const detectionError = policyReason
          || (template.id === "lmstudio" ? lmStudioDetection.detectionError : undefined);

        return {
          id: template.id,
          name: template.name,
          detected,
          executablePath: executablePath ?? undefined,
          appPath,
          serviceReachable: template.id === "lmstudio"
            ? (policyAllowed ? lmStudioDetection.serviceReachable : false)
            : undefined,
          recommendedProviderId: template.recommendedProviderId,
          recommendedModel,
          requiresApiKey: template.requiresApiKey,
          ...(availableModels && availableModels.length > 0 ? { availableModels } : {}),
          ...(detectionError ? { detectionError } : {}),
          notes: template.notes,
        };
      });

      this.snapshotCache = {
        expiresAt: Date.now() + LOCAL_AGENT_SNAPSHOT_CACHE_TTL_MS,
        value,
      };
      return value;
    } finally {
      this.snapshotInFlight = undefined;
    }
  }
}

export function cloneDiscoveredLocalAgent(agent: DiscoveredLocalAgent): DiscoveredLocalAgent {
  return {
    ...agent,
    availableModels: agent.availableModels ? [...agent.availableModels] : undefined,
  };
}
