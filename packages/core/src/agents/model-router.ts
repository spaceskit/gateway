/**
 * ModelRouter — per-agent model selection and fallback.
 *
 * Routes agents to different LLM providers based on profiles,
 * task requirements, and fallback policies. Supports:
 * - Per-agent model preferences (from AgentProfile.provider_hint/model_config)
 * - Task-based routing (coding → code model, chat → chat model)
 * - Automatic fallback on provider failure
 */

import type { ModelProvider } from "./model-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelRoutingPolicy {
  agentId: string;
  /** Preferred model ID (e.g., "openrouter/openai/gpt-4.1-mini"). */
  preferredModelId: string;
  /** Fallback model IDs in priority order. */
  fallbackModelIds: string[];
  /** Optional constraints. */
  constraints?: {
    maxTokens?: number;
    temperature?: number;
    /** Require tool support. */
    requiresTools?: boolean;
    /** Require vision support. */
    requiresVision?: boolean;
  };
}

export interface ModelRoutingResult {
  modelId: string;
  provider: ModelProvider;
  isFallback: boolean;
  fallbackReason?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ModelRouter {
  private policies = new Map<string, ModelRoutingPolicy>();
  private providers = new Map<string, ModelProvider>();
  private defaultModelId: string;
  private defaultProvider: ModelProvider;

  constructor(defaultProvider: ModelProvider, defaultModelId: string) {
    this.defaultProvider = defaultProvider;
    this.defaultModelId = defaultModelId;
    this.providers.set(defaultProvider.id, defaultProvider);
  }

  /**
   * Register a model provider.
   */
  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Set routing policy for a specific agent.
   */
  setPolicy(policy: ModelRoutingPolicy): void {
    this.policies.set(policy.agentId, policy);
  }

  /**
   * Remove routing policy for an agent (falls back to default).
   */
  removePolicy(agentId: string): void {
    this.policies.delete(agentId);
  }

  /**
   * Resolve the model and provider for an agent.
   * Tries preferred model first, then fallbacks, then default.
   */
  async resolve(agentId: string): Promise<ModelRoutingResult> {
    const policy = this.policies.get(agentId);

    if (!policy) {
      return {
        modelId: this.defaultModelId,
        provider: this.defaultProvider,
        isFallback: false,
      };
    }

    // Try preferred model
    const preferredProvider = this.findProviderForModel(policy.preferredModelId);
    if (preferredProvider) {
      const health = await preferredProvider.checkHealth();
      if (health.available) {
        return {
          modelId: policy.preferredModelId,
          provider: preferredProvider,
          isFallback: false,
        };
      }
    }

    // Try fallbacks
    for (const fallbackId of policy.fallbackModelIds) {
      const fallbackProvider = this.findProviderForModel(fallbackId);
      if (fallbackProvider) {
        const health = await fallbackProvider.checkHealth();
        if (health.available) {
          return {
            modelId: fallbackId,
            provider: fallbackProvider,
            isFallback: true,
            fallbackReason: `Preferred model ${policy.preferredModelId} unavailable`,
          };
        }
      }
    }

    // Default fallback
    return {
      modelId: this.defaultModelId,
      provider: this.defaultProvider,
      isFallback: true,
      fallbackReason: `All preferred models for agent ${agentId} unavailable`,
    };
  }

  /**
   * List all registered policies.
   */
  listPolicies(): ModelRoutingPolicy[] {
    return Array.from(this.policies.values());
  }

  private findProviderForModel(modelId: string): ModelProvider | null {
    // Extract provider prefix from model ID (e.g., "anthropic/claude-..." → "anthropic")
    const prefix = modelId.split("/")[0];

    // Check if any provider matches
    for (const provider of this.providers.values()) {
      if (provider.id === prefix || provider.name.toLowerCase().includes(prefix)) {
        return provider;
      }
    }

    // Fall back to default provider (it might support multiple models)
    return this.defaultProvider;
  }
}
