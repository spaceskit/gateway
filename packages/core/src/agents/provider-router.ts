/**
 * ProviderRouter — local-first model selection with cloud fallback.
 *
 * Carries forward the v1 ProviderRoutingConnector strategy:
 * - Local connectors are PRIMARY (Ollama, LM Studio, etc.)
 * - Cloud API connectors are FALLBACK ONLY when:
 *   1. Local unavailable/unstable AND
 *   2. Policy allows AND
 *   3. API auth present
 * - Every routing decision is logged with a reason code.
 * - Cloud fallback always emits a disclosure event.
 */

import type { ModelProvider, ModelInfo } from "./model-provider.js";

export type FallbackReason =
  | "local_unavailable"
  | "local_error"
  | "budget_rule"
  | "manual_override"
  | "no_local_model_supports_tools"
  | "no_local_model_supports_vision";

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  isLocal: boolean;
  fallbackReason?: FallbackReason;
  timestamp: Date;
}

export interface ProviderRouter {
  /** Register a model provider. */
  register(provider: ModelProvider): void;

  /** Remove a model provider. */
  deregister(providerId: string): void;

  /** Get all registered providers. */
  listProviders(): ModelProvider[];

  /** Get all available models across all providers. */
  listModels(): Promise<ModelInfo[]>;

  /**
   * Select the best provider + model for a given request.
   * Prefers local, falls back to cloud with policy checks.
   */
  resolve(requirements: ModelRequirements): Promise<RoutingDecision>;

  /** Get a specific provider by ID. */
  getProvider(providerId: string): ModelProvider | undefined;
}

export interface ModelRequirements {
  /** Preferred provider ID (user override). */
  preferredProvider?: string;
  /** Preferred model ID (user override). */
  preferredModel?: string;
  /** Does the request need tool calling support? */
  needsTools?: boolean;
  /** Does the request need vision/image support? */
  needsVision?: boolean;
  /** Is cloud fallback allowed for this request? */
  allowCloudFallback?: boolean;
}
