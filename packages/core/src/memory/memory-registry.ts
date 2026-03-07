/**
 * MemoryProviderRegistry — manages multiple memory providers.
 *
 * Routes queries to the appropriate provider, supports fallback,
 * and merges results when searching across providers.
 */

import type {
  MemoryProvider,
  MemoryProviderRegistry as IMemoryProviderRegistry,
  MemoryQuery,
  MemorySearchResult,
  ScoredMemory,
} from "./types.js";

export class MemoryProviderRegistry implements IMemoryProviderRegistry {
  private providers = new Map<string, MemoryProvider>();
  private defaultProviderId: string | null = null;

  register(provider: MemoryProvider): void {
    this.providers.set(provider.id, provider);

    // Auto-set first provider as default
    if (!this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
    if (this.defaultProviderId === providerId) {
      this.defaultProviderId = this.providers.size > 0
        ? this.providers.keys().next().value ?? null
        : null;
    }
  }

  get(providerId: string): MemoryProvider | undefined {
    return this.providers.get(providerId);
  }

  getDefault(): MemoryProvider | undefined {
    if (!this.defaultProviderId) return undefined;
    return this.providers.get(this.defaultProviderId);
  }

  setDefault(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Memory provider "${providerId}" not registered`);
    }
    this.defaultProviderId = providerId;
  }

  list(): MemoryProvider[] {
    return Array.from(this.providers.values());
  }

  async search(query: MemoryQuery, providerId?: string): Promise<MemorySearchResult> {
    // Search a specific provider
    if (providerId) {
      const provider = this.providers.get(providerId);
      if (!provider) {
        throw new Error(`Memory provider "${providerId}" not found`);
      }
      return provider.search(query);
    }

    // Search the default provider
    const defaultProvider = this.getDefault();
    if (!defaultProvider) {
      return { results: [], totalCount: 0, queryTimeMs: 0 };
    }

    return defaultProvider.search(query);
  }

  /**
   * Search across ALL registered providers and merge results.
   * Results are deduped by content hash and sorted by score.
   */
  async searchAll(query: MemoryQuery): Promise<MemorySearchResult> {
    const start = performance.now();
    const allResults: ScoredMemory[] = [];

    const promises = Array.from(this.providers.values())
      .filter((p) => p.available)
      .map((p) => p.search(query).catch(() => null));

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        allResults.push(...result.value.results);
      }
    }

    // Deduplicate by document ID (unique per provider)
    const seen = new Set<string>();
    const deduped = allResults.filter((r) => {
      const key = r.document.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by score descending
    deduped.sort((a, b) => b.score - a.score);

    // Apply limit
    const limited = deduped.slice(0, query.limit ?? 10);

    return {
      results: limited,
      totalCount: deduped.length,
      queryTimeMs: performance.now() - start,
    };
  }
}
