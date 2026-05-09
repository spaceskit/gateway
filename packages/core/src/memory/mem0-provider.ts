/**
 * Mem0Provider — market-leader memory adapter.
 *
 * Mem0 provides hybrid vector + graph memory with 90% token reduction.
 * Lazy-loads the `mem0ai` npm package (optional dependency).
 *
 * Features via Mem0:
 * - Automatic memory extraction from conversations
 * - Vector + graph search (24+ vector DB backends)
 * - User/agent/session scoping
 * - Memory decay and consolidation
 *
 * Config: MEM0_API_KEY env var or apiKey in constructor.
 */

import type {
  MemoryProvider,
  MemoryDocument,
  MemoryQuery,
  MemorySearchResult,
  MemorySaveInput,
  MemoryScope,
  ContextPayload,
  ListOptions,
  ScoredMemory,
  TurnMemoryInput,
} from "./types.js";
import { randomUUID } from "node:crypto";

export interface Mem0ProviderOptions {
  apiKey: string;
  baseURL?: string;
  /** Default user ID for scoping. */
  defaultUserId?: string;
  /** Organization ID for multi-tenant. */
  orgId?: string;
  /**
   * Called when the optional SDK package cannot be loaded during
   * initialize(). Receives the original import error. Default is silent —
   * pass a logger.warn binding to surface install hints.
   */
  onSdkUnavailable?: (err: unknown) => void;
}

export class Mem0Provider implements MemoryProvider {
  readonly id = "mem0";
  readonly name = "Mem0 (Hybrid Vector + Graph)";
  available = false;

  private config: Mem0ProviderOptions;
  private client: import("mem0ai").MemoryClient | null = null;

  constructor(config: Mem0ProviderOptions) {
    this.config = config;
  }

  /** Initialize the Mem0 client. Call before first use. */
  async initialize(): Promise<void> {
    try {
      const mod = await import("mem0ai");
      const MemoryClient = mod.default?.MemoryClient ?? mod.MemoryClient ?? mod.default;
      this.client = new MemoryClient({
        apiKey: this.config.apiKey,
        ...(this.config.baseURL ? { host: this.config.baseURL } : {}),
        ...(this.config.orgId ? { orgId: this.config.orgId } : {}),
      });
      this.available = true;
    } catch (err) {
      this.config.onSdkUnavailable?.(err);
      this.available = false;
    }
  }

  private ensureAvailable(): import("mem0ai").MemoryClient {
    if (!this.client) throw new Error("Mem0 client not initialized. Call initialize() first.");
    return this.client;
  }

  private scopeToUserId(scope: MemoryScope): string {
    return scope.userId ?? scope.agentId ?? scope.spaceId ?? this.config.defaultUserId ?? "default";
  }

  // -----------------------------------------------------------------------
  // Core CRUD
  // -----------------------------------------------------------------------

  async save(input: MemorySaveInput): Promise<MemoryDocument> {
    const client = this.ensureAvailable();

    const userId = this.scopeToUserId(input.scope);
    const result = await client.add(
      [{ role: "user", content: input.content }],
      {
        user_id: userId,
        ...(input.scope.agentId ? { agent_id: input.scope.agentId } : {}),
        ...(input.scope.sessionId ? { run_id: input.scope.sessionId } : {}),
        metadata: {
          type: input.type,
          spaceId: input.scope.spaceId,
          importance: input.importance,
          tags: input.tags,
          ...input.metadata,
        },
      },
    );

    const memId = result?.results?.[0]?.id ?? result?.id ?? randomUUID();

    return {
      id: memId,
      content: input.content,
      type: input.type,
      scope: input.scope,
      metadata: input.metadata ?? {},
      tags: input.tags ?? [],
      importance: input.importance ?? 0.5,
      providerData: { mem0Result: result },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async search(query: MemoryQuery): Promise<MemorySearchResult> {
    const client = this.ensureAvailable();
    const start = performance.now();

    const userId = this.scopeToUserId(query.scope);
    const results = await client.search(query.text, {
      user_id: userId,
      limit: query.limit ?? 10,
      ...(query.scope.agentId ? { agent_id: query.scope.agentId } : {}),
    });

    const memories: ScoredMemory[] = (results ?? []).map((r) => {
      const meta = r.metadata ?? {};
      return {
        document: {
          id: r.id ?? randomUUID(),
          content: r.memory ?? r.text ?? r.content ?? "",
          type: (meta.type as MemoryDocument["type"]) ?? "semantic",
          scope: {
            userId,
            agentId: (meta.agentId as string | undefined) ?? query.scope.agentId,
            spaceId: (meta.spaceId as string | undefined) ?? query.scope.spaceId,
          },
          metadata: meta,
          tags: (meta.tags as string[]) ?? [],
          importance: (meta.importance as number) ?? 0.5,
          providerData: { score: r.score },
          createdAt: new Date(r.created_at ?? Date.now()),
          updatedAt: new Date(r.updated_at ?? Date.now()),
        },
        score: r.score ?? 0.8,
        matchReason: "Mem0 semantic + graph search",
      };
    });

    // Apply minScore filter
    const filtered = query.minScore
      ? memories.filter((m) => m.score >= query.minScore!)
      : memories;

    return {
      results: filtered,
      totalCount: filtered.length,
      queryTimeMs: performance.now() - start,
    };
  }

  async get(id: string): Promise<MemoryDocument | null> {
    const client = this.ensureAvailable();
    try {
      const result = await client.get(id);
      if (!result) return null;
      const meta = result.metadata ?? {};
      return {
        id: result.id,
        content: result.memory ?? result.text ?? "",
        type: (meta.type as MemoryDocument["type"]) ?? "semantic",
        scope: {
          userId: result.user_id,
          agentId: meta.agentId as string | undefined,
          spaceId: meta.spaceId as string | undefined,
        },
        metadata: meta,
        tags: (meta.tags as string[]) ?? [],
        importance: (meta.importance as number) ?? 0.5,
        createdAt: new Date(result.created_at ?? Date.now()),
        updatedAt: new Date(result.updated_at ?? Date.now()),
      };
    } catch {
      return null;
    }
  }

  async update(id: string, patch: Partial<MemorySaveInput>): Promise<MemoryDocument> {
    const client = this.ensureAvailable();
    if (patch.content) {
      await client.update(id, patch.content);
    }
    const doc = await this.get(id);
    if (!doc) throw new Error(`Mem0 memory ${id} not found after update`);
    return doc;
  }

  async delete(id: string): Promise<void> {
    const client = this.ensureAvailable();
    await client.delete(id);
  }

  async list(scope: MemoryScope, options?: ListOptions): Promise<MemoryDocument[]> {
    const client = this.ensureAvailable();
    const userId = this.scopeToUserId(scope);
    const results = await client.getAll({
      user_id: userId,
      ...(scope.agentId ? { agent_id: scope.agentId } : {}),
      limit: options?.limit ?? 100,
    });

    return (results ?? []).map((r) => {
      const meta = r.metadata ?? {};
      return {
        id: r.id ?? randomUUID(),
        content: r.memory ?? r.text ?? "",
        type: (meta.type as MemoryDocument["type"]) ?? "semantic",
        scope,
        metadata: meta,
        tags: (meta.tags as string[]) ?? [],
        importance: (meta.importance as number) ?? 0.5,
        createdAt: new Date(r.created_at ?? Date.now()),
        updatedAt: new Date(r.updated_at ?? Date.now()),
      };
    });
  }

  // -----------------------------------------------------------------------
  // Context Assembly
  // -----------------------------------------------------------------------

  async assembleContext(scope: MemoryScope, goal?: string, maxTokens = 4000): Promise<ContextPayload> {
    const searchResult = await this.search({
      text: goal ?? "",
      scope,
      limit: 20,
    });

    let tokenEstimate = 0;
    const selected: ScoredMemory[] = [];

    for (const result of searchResult.results) {
      const docTokens = Math.ceil(result.document.content.length / 4);
      if (tokenEstimate + docTokens > maxTokens) break;
      tokenEstimate += docTokens;
      selected.push(result);
    }

    return {
      memories: selected,
      summary: selected.length > 0
        ? `${selected.length} memories from Mem0 (avg score: ${(selected.reduce((s, m) => s + m.score, 0) / selected.length).toFixed(2)})`
        : undefined,
      tokenEstimate,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async onTurnCompleted(turnResult: TurnMemoryInput): Promise<void> {
    // Mem0 auto-extracts memories from conversations
    await this.save({
      content: `Q: ${turnResult.input.slice(0, 200)}\nA: ${turnResult.output.slice(0, 300)}`,
      type: "episodic",
      scope: { spaceId: turnResult.spaceId, agentId: turnResult.agentId },
      metadata: { turnId: turnResult.turnId },
      importance: 0.4,
    });
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  async checkHealth(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.getAll({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
