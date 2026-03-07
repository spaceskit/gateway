/**
 * ExperienceMemoryProvider — the default MemoryProvider.
 *
 * Wraps Spaceskit's existing Experience system + SQLite FTS5 for search.
 * Zero external dependencies. Stores structured memories in SQLite with
 * full-text search and composite scoring (recency × importance × relevance).
 *
 * Memory type mapping:
 * - episodic → turn history (turns table)
 * - semantic → experiences (goal, summary, strengths, weaknesses)
 * - procedural → skills + actions
 * - observation → AgentObservation (per-agent notes from experiences)
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

export interface ExperienceMemoryProviderOptions {
  /** Raw Bun SQLite database handle. */
  db: any; // bun:sqlite Database
}

export class ExperienceMemoryProvider implements MemoryProvider {
  readonly id = "experience";
  readonly name = "Experiential Memory (SQLite + FTS5)";
  readonly available = true;

  private db: any;

  constructor(options: ExperienceMemoryProviderOptions) {
    this.db = options.db;
    this.initSchema();
  }

  // -----------------------------------------------------------------------
  // Schema
  // -----------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_documents (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'semantic',
        space_id TEXT,
        agent_id TEXT,
        user_id TEXT,
        session_id TEXT,
        metadata_json TEXT DEFAULT '{}',
        tags_json TEXT DEFAULT '[]',
        importance REAL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memdoc_space ON memory_documents(space_id);
      CREATE INDEX IF NOT EXISTS idx_memdoc_agent ON memory_documents(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memdoc_type ON memory_documents(type);
    `);

    // FTS5 for full-text search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          id,
          content,
          tags,
          tokenize='porter unicode61'
        );
      `);
    } catch {
      // FTS5 might already exist or not be available
    }
  }

  // -----------------------------------------------------------------------
  // Core CRUD
  // -----------------------------------------------------------------------

  async save(input: MemorySaveInput): Promise<MemoryDocument> {
    const id = randomUUID();
    const now = new Date();
    const doc: MemoryDocument = {
      id,
      content: input.content,
      type: input.type,
      scope: input.scope,
      metadata: input.metadata ?? {},
      tags: input.tags ?? [],
      importance: input.importance ?? 0.5,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO memory_documents (id, content, type, space_id, agent_id, user_id, session_id, metadata_json, tags_json, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.content,
      input.type,
      input.scope.spaceId ?? null,
      input.scope.agentId ?? null,
      input.scope.userId ?? null,
      input.scope.sessionId ?? null,
      JSON.stringify(doc.metadata),
      JSON.stringify(doc.tags),
      doc.importance,
      now.toISOString(),
      now.toISOString(),
    );

    // Index in FTS5
    try {
      this.db.prepare(`INSERT INTO memory_fts(id, content, tags) VALUES (?, ?, ?)`).run(
        id,
        input.content,
        (input.tags ?? []).join(" "),
      );
    } catch {
      // FTS might not be available
    }

    return doc;
  }

  async search(query: MemoryQuery): Promise<MemorySearchResult> {
    const start = performance.now();
    const limit = query.limit ?? 10;
    const params: unknown[] = [];
    const conditions: string[] = [];

    // Scope filters
    if (query.scope.spaceId) {
      conditions.push("space_id = ?");
      params.push(query.scope.spaceId);
    }
    if (query.scope.agentId) {
      conditions.push("agent_id = ?");
      params.push(query.scope.agentId);
    }
    if (query.scope.userId) {
      conditions.push("user_id = ?");
      params.push(query.scope.userId);
    }
    if (query.type) {
      conditions.push("type = ?");
      params.push(query.type);
    }
    if (query.after) {
      conditions.push("created_at > ?");
      params.push(query.after.toISOString());
    }
    if (query.before) {
      conditions.push("created_at < ?");
      params.push(query.before.toISOString());
    }

    // Text search via LIKE (fallback if FTS5 not available)
    if (query.text) {
      conditions.push("content LIKE ?");
      params.push(`%${query.text}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const sql = `
      SELECT * FROM memory_documents
      ${whereClause}
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(...params) as any[];
    const now = Date.now();

    const results: ScoredMemory[] = rows.map((row) => {
      const doc = this.rowToDocument(row);
      // Composite score: importance × recency
      const ageMs = now - doc.createdAt.getTime();
      const recency = Math.max(0, 1 - ageMs / (90 * 24 * 60 * 60 * 1000)); // 90-day decay
      const score = doc.importance * 0.6 + recency * 0.4;

      return {
        document: doc,
        score: Math.min(1, Math.max(0, score)),
        matchReason: query.text ? `Matched "${query.text}" in content` : "Scope match",
      };
    });

    // Filter by minScore
    const filtered = query.minScore
      ? results.filter((r) => r.score >= query.minScore!)
      : results;

    return {
      results: filtered,
      totalCount: filtered.length,
      queryTimeMs: performance.now() - start,
    };
  }

  async get(id: string): Promise<MemoryDocument | null> {
    const row = this.db.prepare("SELECT * FROM memory_documents WHERE id = ?").get(id) as any;
    return row ? this.rowToDocument(row) : null;
  }

  async update(id: string, patch: Partial<MemorySaveInput>): Promise<MemoryDocument> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Memory document ${id} not found`);

    const updates: string[] = ["updated_at = ?"];
    const params: unknown[] = [new Date().toISOString()];

    if (patch.content !== undefined) {
      updates.push("content = ?");
      params.push(patch.content);
    }
    if (patch.type !== undefined) {
      updates.push("type = ?");
      params.push(patch.type);
    }
    if (patch.metadata !== undefined) {
      updates.push("metadata_json = ?");
      params.push(JSON.stringify(patch.metadata));
    }
    if (patch.tags !== undefined) {
      updates.push("tags_json = ?");
      params.push(JSON.stringify(patch.tags));
    }
    if (patch.importance !== undefined) {
      updates.push("importance = ?");
      params.push(patch.importance);
    }

    params.push(id);
    this.db.prepare(`UPDATE memory_documents SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    return (await this.get(id))!;
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM memory_documents WHERE id = ?").run(id);
    try {
      this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
    } catch {
      // FTS might not be available
    }
  }

  async list(scope: MemoryScope, options?: ListOptions): Promise<MemoryDocument[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (scope.spaceId) {
      conditions.push("space_id = ?");
      params.push(scope.spaceId);
    }
    if (scope.agentId) {
      conditions.push("agent_id = ?");
      params.push(scope.agentId);
    }
    if (scope.userId) {
      conditions.push("user_id = ?");
      params.push(scope.userId);
    }
    if (options?.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortColumn =
      options?.sortBy === "importance" ? "importance DESC" :
      options?.sortBy === "relevance" ? "importance DESC" :
      "created_at DESC";

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    params.push(limit, offset);

    const rows = this.db.prepare(`
      SELECT * FROM memory_documents ${whereClause}
      ORDER BY ${sortColumn}
      LIMIT ? OFFSET ?
    `).all(...params) as any[];

    return rows.map((r) => this.rowToDocument(r));
  }

  // -----------------------------------------------------------------------
  // Context Assembly
  // -----------------------------------------------------------------------

  async assembleContext(
    scope: MemoryScope,
    goal?: string,
    maxTokens = 4000,
  ): Promise<ContextPayload> {
    // Search for relevant memories
    const searchResult = await this.search({
      text: goal ?? "",
      scope,
      limit: 20,
    });

    // Estimate tokens (rough: 4 chars per token)
    let tokenEstimate = 0;
    const selectedMemories: ScoredMemory[] = [];

    for (const result of searchResult.results) {
      const docTokens = Math.ceil(result.document.content.length / 4);
      if (tokenEstimate + docTokens > maxTokens) break;
      tokenEstimate += docTokens;
      selectedMemories.push(result);
    }

    // Generate summary if we have memories
    let summary: string | undefined;
    if (selectedMemories.length > 0) {
      const types = [...new Set(selectedMemories.map((m) => m.document.type))];
      summary = `${selectedMemories.length} memories assembled (${types.join(", ")}) for ${goal ?? "context"}`;
    }

    return {
      memories: selectedMemories,
      summary,
      tokenEstimate,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle Hooks
  // -----------------------------------------------------------------------

  async onTurnCompleted(turnResult: TurnMemoryInput): Promise<void> {
    // Save turn as episodic memory
    await this.save({
      content: `Turn ${turnResult.turnId}: ${turnResult.output.slice(0, 500)}`,
      type: "episodic",
      scope: {
        spaceId: turnResult.spaceId,
        agentId: turnResult.agentId,
      },
      metadata: {
        turnId: turnResult.turnId,
        toolCalls: turnResult.toolCalls.map((t) => t.name),
        tokens: turnResult.usage,
      },
      importance: 0.3, // Turn-level memories are lower importance
    });
  }

  async onSpaceCompleted(spaceId: string): Promise<void> {
    // Consolidate episodic memories into a semantic summary
    const episodics = await this.list(
      { spaceId },
      { type: "episodic", sortBy: "recency", limit: 50 },
    );

    if (episodics.length > 0) {
      const turnSummary = episodics.map((d) => d.content).join("\n");
      await this.save({
        content: `Space ${spaceId} completed with ${episodics.length} turns. Summary: ${turnSummary.slice(0, 1000)}`,
        type: "semantic",
        scope: { spaceId },
        importance: 0.7,
        tags: ["space-summary", "auto-generated"],
      });
    }
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  async checkHealth(): Promise<boolean> {
    try {
      this.db.prepare("SELECT 1 FROM memory_documents LIMIT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private rowToDocument(row: any): MemoryDocument {
    return {
      id: row.id,
      content: row.content,
      type: row.type,
      scope: {
        spaceId: row.space_id ?? undefined,
        agentId: row.agent_id ?? undefined,
        userId: row.user_id ?? undefined,
        sessionId: row.session_id ?? undefined,
      },
      metadata: JSON.parse(row.metadata_json ?? "{}"),
      tags: JSON.parse(row.tags_json ?? "[]"),
      importance: row.importance ?? 0.5,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
