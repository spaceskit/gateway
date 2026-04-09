import { estimateTokens as estimateBudgetTokens } from "../orchestrator/context-budget.js";
import type { ModelMessage } from "./model-provider.js";
import { inferContextWindow, resolveModelCapabilities } from "./model-capability-registry.js";

export type CliLaunchSnapshotSource = "preflight" | "registry" | "reported";

export interface CliLaunchSnapshot {
  agentId: string;
  providerId: string;
  modelId: string;
  contextWindowTokens: number;
  estimatedPromptTokens: number;
  estimatedRemainingTokens: number;
  source: CliLaunchSnapshotSource;
}

interface OpenAIModelContextWindowCatalog {
  fetchedAtMs: number;
  byModelId: Map<string, number>;
}

const OPENAI_MODEL_CATALOG_TTL_MS = 30 * 60 * 1_000;
const openAiCatalogCache = new Map<string, OpenAIModelContextWindowCatalog>();
const openAiCatalogInFlight = new Map<string, Promise<OpenAIModelContextWindowCatalog | null>>();

export interface ResolveCliLaunchSnapshotInput {
  agentId: string;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  messages: ModelMessage[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export async function resolveCliLaunchSnapshot(
  input: ResolveCliLaunchSnapshotInput,
): Promise<CliLaunchSnapshot | undefined> {
  const providerId = input.providerId.trim().toLowerCase();
  if (!providerId) {
    return undefined;
  }

  const capabilities = resolveModelCapabilities(providerId, input.modelId);
  if (!capabilities.isCliExecutor) {
    return undefined;
  }

  const promptTokens = estimatePromptTokens(input.systemPrompt, input.messages);
  const modelId = normalizeModelId(input.modelId, providerId);
  const liveWindow = providerId === "codex"
    ? await resolveOpenAiCodexWindow(modelId, input.apiKey, input.fetchImpl)
    : undefined;
  const contextWindowTokens = liveWindow
    ?? inferContextWindow(providerId, modelId)
    ?? capabilities.contextWindow;

  return {
    agentId: input.agentId,
    providerId,
    modelId,
    contextWindowTokens,
    estimatedPromptTokens: promptTokens,
    estimatedRemainingTokens: Math.max(contextWindowTokens - promptTokens, 0),
    source: liveWindow !== undefined ? "preflight" : "registry",
  };
}

async function resolveOpenAiCodexWindow(
  modelId: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | undefined> {
  const key = apiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  if (!key) {
    return undefined;
  }

  const cached = openAiCatalogCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAtMs <= OPENAI_MODEL_CATALOG_TTL_MS) {
    return cached.byModelId.get(modelId.toLowerCase());
  }

  let inFlight = openAiCatalogInFlight.get(key);
  if (!inFlight) {
    inFlight = fetchOpenAiModelContextWindows(key, fetchImpl);
    openAiCatalogInFlight.set(key, inFlight);
  }

  const catalog = await inFlight.finally(() => {
    if (openAiCatalogInFlight.get(key) === inFlight) {
      openAiCatalogInFlight.delete(key);
    }
  });
  if (!catalog) {
    return undefined;
  }

  openAiCatalogCache.set(key, catalog);
  return catalog.byModelId.get(modelId.toLowerCase());
}

async function fetchOpenAiModelContextWindows(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<OpenAIModelContextWindowCatalog | null> {
  try {
    const response = await fetchImpl("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as { data?: Array<Record<string, unknown>> };
    const byModelId = new Map<string, number>();

    for (const entry of payload.data ?? []) {
      const id = typeof entry.id === "string" ? entry.id.trim().toLowerCase() : "";
      if (!id) continue;
      if (!id.includes("gpt-5") && !id.includes("codex")) continue;

      const contextWindow =
        asPositiveInt(entry.context_length)
        ?? asPositiveInt(entry.context_window)
        ?? asPositiveInt(entry.max_context_length);
      if (contextWindow) {
        byModelId.set(id, contextWindow);
      }
    }

    return {
      fetchedAtMs: Date.now(),
      byModelId,
    };
  } catch {
    return null;
  }
}

function estimatePromptTokens(systemPrompt: string, messages: ModelMessage[]): number {
  let chars = systemPrompt.length;
  for (const message of messages) {
    chars += message.content.length + 20;
  }
  return estimateBudgetTokens(chars);
}

function normalizeModelId(modelId: string, providerId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const prefix = `${providerId.toLowerCase()}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return undefined;
}
