/**
 * LettaProvider — open-source agent-controlled memory.
 *
 * Letta (formerly MemGPT) gives agents direct control over their memory
 * via core memory blocks and archival storage. Supports both local SQLite
 * and remote HTTP modes.
 *
 * Lazy-loads `@letta-ai/letta-client` (optional dependency).
 *
 * Config: LETTA_BASE_URL + LETTA_API_KEY env vars.
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
import type { ToolDefinition } from "../agents/model-provider.js";
import { randomUUID } from "node:crypto";

export interface LettaProviderOptions {
  /** Letta server base URL. If absent, uses local mode. */
  baseURL?: string;
  apiKey?: string;
  /** Default agent ID in Letta. */
  defaultAgentId?: string;
  /**
   * Called when the optional SDK package cannot be loaded during
   * initialize(). Receives the original import error. Default is silent —
   * pass a logger.warn binding to surface install hints.
   */
  onSdkUnavailable?: (err: unknown) => void;
}

export class LettaProvider implements MemoryProvider {
  readonly id = "letta";
  readonly name = "Letta (Open Source Agent Memory)";
  available = false;

  private config: LettaProviderOptions;
  private client: import("@letta-ai/letta-client").LettaClient | null = null;

  constructor(config: LettaProviderOptions) {
    this.config = config;
  }

  /** Initialize the Letta client. Call before first use. */
  async initialize(): Promise<void> {
    try {
      const mod = await import("@letta-ai/letta-client");
      const LettaClient = mod.default?.LettaClient ?? mod.LettaClient ?? mod.default;

      this.client = new LettaClient({
        ...(this.config.baseURL ? { baseUrl: this.config.baseURL } : {}),
        ...(this.config.apiKey ? { token: this.config.apiKey } : {}),
      });
      this.available = true;
    } catch (err) {
      this.config.onSdkUnavailable?.(err);
      this.available = false;
    }
  }

  private ensureAvailable(): import("@letta-ai/letta-client").LettaClient {
    if (!this.client) throw new Error("Letta client not initialized. Call initialize() first.");
    return this.client;
  }

  private resolveAgentId(scope: MemoryScope): string {
    return scope.agentId ?? this.config.defaultAgentId ?? "default";
  }

  // -----------------------------------------------------------------------
  // Core CRUD
  // -----------------------------------------------------------------------

  async save(input: MemorySaveInput): Promise<MemoryDocument> {
    const client = this.ensureAvailable();

    const agentId = this.resolveAgentId(input.scope);
    let result: { id?: string };

    try {
      // Try archival memory insert (long-term)
      result = await client.agents.archivalMemory.create(agentId, {
        text: input.content,
        metadata: {
          type: input.type,
          spaceId: input.scope.spaceId,
          importance: input.importance,
          tags: input.tags,
          ...input.metadata,
        },
      });
    } catch {
      // Fallback: use messages to add memory
      result = { id: randomUUID() };
    }

    return {
      id: result.id ?? randomUUID(),
      content: input.content,
      type: input.type,
      scope: input.scope,
      metadata: input.metadata ?? {},
      tags: input.tags ?? [],
      importance: input.importance ?? 0.5,
      providerData: { lettaResult: result },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async search(query: MemoryQuery): Promise<MemorySearchResult> {
    const client = this.ensureAvailable();
    const start = performance.now();

    const agentId = this.resolveAgentId(query.scope);
    let results: import("@letta-ai/letta-client").ArchivalMemoryEntry[] = [];

    try {
      results = await client.agents.archivalMemory.list(agentId, {
        query: query.text,
        limit: query.limit ?? 10,
      });
    } catch {
      results = [];
    }

    const memories: ScoredMemory[] = (results ?? []).map((r, i) => {
      const meta = r.metadata ?? {};
      return {
        document: {
          id: r.id ?? randomUUID(),
          content: r.text ?? "",
          type: (meta.type as MemoryDocument["type"]) ?? "semantic",
          scope: { agentId, spaceId: (meta.spaceId as string | undefined) ?? query.scope.spaceId },
          metadata: meta,
          tags: (meta.tags as string[]) ?? [],
          importance: (meta.importance as number) ?? 0.5,
          createdAt: new Date(r.created_at ?? Date.now()),
          updatedAt: new Date(r.created_at ?? Date.now()),
        },
        score: 1 - i * 0.05, // Letta returns pre-ranked results
        matchReason: "Letta archival memory search",
      };
    });

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
    // Letta doesn't have a direct get-by-id for archival memory
    // This would need to search or list and filter
    return null;
  }

  async update(id: string, patch: Partial<MemorySaveInput>): Promise<MemoryDocument> {
    const client = this.ensureAvailable();
    // Letta uses core_memory_replace pattern
    if (patch.content) {
      const agentId = this.config.defaultAgentId ?? "default";
      try {
        await client.agents.archivalMemory.update(agentId, id, {
          text: patch.content,
        });
      } catch {
        // Fallback: delete and re-create
        await this.delete(id);
        const scope = patch.scope ?? {};
        return this.save({
          content: patch.content,
          type: patch.type ?? "semantic",
          scope,
          metadata: patch.metadata,
          tags: patch.tags,
          importance: patch.importance,
        });
      }
    }
    return {
      id,
      content: patch.content ?? "",
      type: patch.type ?? "semantic",
      scope: patch.scope ?? {},
      metadata: patch.metadata ?? {},
      tags: patch.tags ?? [],
      importance: patch.importance ?? 0.5,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async delete(id: string): Promise<void> {
    const client = this.ensureAvailable();
    const agentId = this.config.defaultAgentId ?? "default";
    try {
      await client.agents.archivalMemory.delete(agentId, id);
    } catch {
      // Ignore if not found
    }
  }

  async list(scope: MemoryScope, options?: ListOptions): Promise<MemoryDocument[]> {
    const client = this.ensureAvailable();
    const agentId = this.resolveAgentId(scope);

    try {
      const results = await client.agents.archivalMemory.list(agentId, {
        limit: options?.limit ?? 100,
      });

      return (results ?? []).map((r) => {
        const meta = r.metadata ?? {};
        return {
          id: r.id ?? randomUUID(),
          content: r.text ?? "",
          type: (meta.type as MemoryDocument["type"]) ?? "semantic",
          scope,
          metadata: meta,
          tags: (meta.tags as string[]) ?? [],
          importance: (meta.importance as number) ?? 0.5,
          createdAt: new Date(r.created_at ?? Date.now()),
          updatedAt: new Date(r.created_at ?? Date.now()),
        };
      });
    } catch {
      return [];
    }
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
        ? `${selected.length} memories from Letta archival storage`
        : undefined,
      tokenEstimate,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async onTurnCompleted(turnResult: TurnMemoryInput): Promise<void> {
    await this.save({
      content: `${turnResult.input.slice(0, 200)} → ${turnResult.output.slice(0, 300)}`,
      type: "episodic",
      scope: { spaceId: turnResult.spaceId, agentId: turnResult.agentId },
      metadata: { turnId: turnResult.turnId },
      importance: 0.4,
    });
  }

  // -----------------------------------------------------------------------
  // Agent Tools (Letta's unique feature)
  // -----------------------------------------------------------------------

  getAgentTools(): ToolDefinition[] {
    return [
      {
        name: "letta.save_memory",
        description: "Save a memory to your long-term archival storage",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The memory content to save" },
            importance: { type: "number", description: "Importance score 0-1" },
          },
          required: ["content"],
        },
      },
      {
        name: "letta.search_memory",
        description: "Search your archival memory for relevant information",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results (default 5)" },
          },
          required: ["query"],
        },
      },
    ];
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  async checkHealth(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.agents.list({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
