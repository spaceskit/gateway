import type {
  OpenAICompatibleDetectedModel,
  OpenAICompatibleDetectionResult,
} from "./local-agent-discovery-service.js";
import {
  describeOpenAICompatibleDetectionError,
  resolveOpenAICompatibleModelsEndpoint,
} from "../gateway-admin-model-normalizers.js";
import { asPositiveInteger } from "../gateway-admin-value-normalizers.js";

const OPENAI_COMPATIBLE_DETECTION_CACHE_TTL_MS = 30_000;
const OPENAI_COMPATIBLE_DETECTION_TIMEOUT_MS = 1_200;

export interface OpenAICompatibleModelDiscoveryOptions {
  forceRefresh?: boolean;
}

export class OpenAICompatibleModelDiscoveryService {
  private readonly detectionCache = new Map<string, {
    expiresAt: number;
    value: OpenAICompatibleDetectionResult;
  }>();
  private readonly detectionInFlight = new Map<string, Promise<OpenAICompatibleDetectionResult>>();

  async detectModels(
    baseURLRaw?: string,
    options?: OpenAICompatibleModelDiscoveryOptions,
  ): Promise<OpenAICompatibleDetectionResult> {
    const baseURL = baseURLRaw?.trim();
    if (!baseURL) {
      return {
        serviceReachable: false,
        models: [],
      };
    }

    const endpoint = resolveOpenAICompatibleModelsEndpoint(baseURL);
    const now = Date.now();
    const forceRefresh = options?.forceRefresh === true;
    const cached = this.detectionCache.get(endpoint);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cloneDetectionResult(cached.value);
    }

    const inFlight = forceRefresh ? undefined : this.detectionInFlight.get(endpoint);
    if (inFlight) {
      return cloneDetectionResult(await inFlight);
    }

    const requestPromise = this.fetchModels(endpoint);
    this.detectionInFlight.set(endpoint, requestPromise);
    const value = await requestPromise;
    this.detectionInFlight.delete(endpoint);
    this.detectionCache.set(endpoint, {
      expiresAt: Date.now() + OPENAI_COMPATIBLE_DETECTION_CACHE_TTL_MS,
      value,
    });
    return cloneDetectionResult(value);
  }

  private async fetchModels(endpoint: string): Promise<OpenAICompatibleDetectionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_COMPATIBLE_DETECTION_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          serviceReachable: false,
          models: [],
          detectionError: `Model discovery failed at ${endpoint}: ${response.status} ${response.statusText}`,
        };
      }

      const payload = await response.json() as { data?: Array<Record<string, unknown>> };
      const modelsById = new Map<string, OpenAICompatibleDetectedModel>();
      for (const entry of payload.data ?? []) {
        const id = typeof entry?.id === "string" ? entry.id.trim() : "";
        if (!id) continue;
        const contextWindow = asPositiveInteger(entry.context_length)
          ?? asPositiveInteger(entry.context_window)
          ?? asPositiveInteger(entry.max_context_length)
          ?? asPositiveInteger(entry.contextLength)
          ?? asPositiveInteger(entry.contextWindow)
          ?? asPositiveInteger(entry.maxContextLength);

        const existing = modelsById.get(id);
        if (!existing) {
          modelsById.set(id, {
            id,
            ...(contextWindow !== undefined ? { contextWindow } : {}),
          });
          continue;
        }

        if (existing.contextWindow === undefined && contextWindow !== undefined) {
          modelsById.set(id, {
            ...existing,
            contextWindow,
          });
        }
      }
      return {
        serviceReachable: true,
        models: Array.from(modelsById.values()),
      };
    } catch (err) {
      return {
        serviceReachable: false,
        models: [],
        detectionError: describeOpenAICompatibleDetectionError(err, endpoint),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function cloneDetectionResult(
  result: OpenAICompatibleDetectionResult,
): OpenAICompatibleDetectionResult {
  return {
    ...result,
    models: result.models.map((entry) => ({ ...entry })),
  };
}
