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
import type { Database } from "bun:sqlite";
import type { ExperienceStatus } from "../experiences/types.js";
import { randomUUID } from "node:crypto";

export interface ExperienceMemoryProviderOptions {
  /** Raw Bun SQLite database handle. */
  db: any; // bun:sqlite Database
}

export interface LegacyExperienceKnowledgeBackfillResult {
  experiencesAccepted: number;
  memoryStatusesUpdated: number;
  memoryUsersUpdated: number;
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
        principal_id TEXT NOT NULL DEFAULT '',
        session_id TEXT,
        source_type TEXT NOT NULL DEFAULT '',
        source_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        metadata_json TEXT DEFAULT '{}',
        tags_json TEXT DEFAULT '[]',
        importance REAL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memdoc_space ON memory_documents(space_id);
      CREATE INDEX IF NOT EXISTS idx_memdoc_agent ON memory_documents(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memdoc_type ON memory_documents(type);
      CREATE INDEX IF NOT EXISTS idx_memdoc_source
        ON memory_documents(source_type, source_id, principal_id);
    `);
    this.ensureCanonicalColumns();

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

  private ensureCanonicalColumns(): void {
    const columns = this.db.query("PRAGMA table_info(memory_documents)").all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has("source_type")) {
      this.db.exec("ALTER TABLE memory_documents ADD COLUMN source_type TEXT NOT NULL DEFAULT ''");
    }
    if (!columnNames.has("source_id")) {
      this.db.exec("ALTER TABLE memory_documents ADD COLUMN source_id TEXT NOT NULL DEFAULT ''");
    }
    if (!columnNames.has("status")) {
      this.db.exec("ALTER TABLE memory_documents ADD COLUMN status TEXT NOT NULL DEFAULT ''");
    }
    if (!columnNames.has("principal_id")) {
      this.db.exec("ALTER TABLE memory_documents ADD COLUMN principal_id TEXT NOT NULL DEFAULT ''");
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memdoc_source
        ON memory_documents(source_type, source_id, principal_id)
    `);
  }

  // -----------------------------------------------------------------------
  // Core CRUD
  // -----------------------------------------------------------------------

  async save(input: MemorySaveInput): Promise<MemoryDocument> {
    const metadata = input.metadata ?? {};
    const sourceLink = resolveSourceLinkage(metadata, input.scope.userId);
    const existingId = sourceLink
      ? this.findDocumentIdBySource(sourceLink.sourceType, sourceLink.sourceId, sourceLink.principalId)
      : undefined;
    const id = existingId ?? randomUUID();
    const now = new Date();
    const doc: MemoryDocument = {
      id,
      content: input.content,
      type: input.type,
      scope: input.scope,
      metadata,
      tags: input.tags ?? [],
      importance: input.importance ?? 0.5,
      createdAt: now,
      updatedAt: now,
    };

    if (existingId) {
      this.db.prepare(`
        UPDATE memory_documents
        SET content = ?,
            type = ?,
            space_id = ?,
            agent_id = ?,
            user_id = ?,
            principal_id = ?,
            session_id = ?,
            source_type = ?,
            source_id = ?,
            status = ?,
            metadata_json = ?,
            tags_json = ?,
            importance = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        input.content,
        input.type,
        input.scope.spaceId ?? null,
        input.scope.agentId ?? null,
        input.scope.userId ?? null,
        sourceLink?.principalId ?? input.scope.userId ?? "",
        input.scope.sessionId ?? null,
        sourceLink?.sourceType ?? "",
        sourceLink?.sourceId ?? "",
        sourceLink?.status ?? "",
        JSON.stringify(doc.metadata),
        JSON.stringify(doc.tags),
        doc.importance,
        now.toISOString(),
        id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO memory_documents (
          id,
          content,
          type,
          space_id,
          agent_id,
          user_id,
          principal_id,
          session_id,
          source_type,
          source_id,
          status,
          metadata_json,
          tags_json,
          importance,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.content,
        input.type,
        input.scope.spaceId ?? null,
        input.scope.agentId ?? null,
        input.scope.userId ?? null,
        sourceLink?.principalId ?? input.scope.userId ?? "",
        input.scope.sessionId ?? null,
        sourceLink?.sourceType ?? "",
        sourceLink?.sourceId ?? "",
        sourceLink?.status ?? "",
        JSON.stringify(doc.metadata),
        JSON.stringify(doc.tags),
        doc.importance,
        now.toISOString(),
        now.toISOString(),
      );
    }

    // Index in FTS5
    try {
      if (existingId) {
        this.db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id);
      }
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

  private findDocumentIdBySource(
    sourceType: string,
    sourceId: string,
    principalId: string,
  ): string | undefined {
    const row = this.db.prepare(`
      SELECT id
      FROM memory_documents
      WHERE source_type = ?
        AND source_id = ?
        AND principal_id = ?
      LIMIT 1
    `).get(sourceType, sourceId, principalId) as { id?: string } | undefined;
    return row?.id;
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

    const sql = `
      SELECT * FROM memory_documents
      ${whereClause}
      ORDER BY importance DESC, created_at DESC
    `;

    const rows = this.db.prepare(sql).all(...params) as any[];
    const now = Date.now();

    const results: ScoredMemory[] = rows
      .map((row) => this.rowToDocument(row))
      .filter((doc) => !query.status || getDocumentSourceStatus(doc) === query.status)
      .map((doc) => {
        // Composite score: importance × recency × source-status confidence.
        const ageMs = now - doc.createdAt.getTime();
        const recency = Math.max(0, 1 - ageMs / (90 * 24 * 60 * 60 * 1000)); // 90-day decay
        const baseScore = doc.importance * 0.6 + recency * 0.4;
        const score = baseScore * getSourceStatusWeight(getDocumentSourceStatus(doc));

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

    const limited = filtered.slice(0, limit);

    return {
      results: limited,
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
    const metadata = JSON.parse(row.metadata_json ?? "{}") as Record<string, unknown>;
    if (typeof row.source_type === "string" && row.source_type.trim().length > 0) {
      metadata.sourceType = row.source_type;
    }
    if (typeof row.source_id === "string" && row.source_id.trim().length > 0) {
      metadata.sourceId = row.source_id;
    }
    if (typeof row.status === "string" && row.status.trim().length > 0) {
      metadata.sourceStatus = row.status;
    }
    if (typeof row.principal_id === "string" && row.principal_id.trim().length > 0) {
      metadata.principalId = row.principal_id;
    }

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
      metadata,
      tags: JSON.parse(row.tags_json ?? "[]"),
      importance: row.importance ?? 0.5,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export function backfillLegacyExperienceKnowledge(
  db: Database,
): LegacyExperienceKnowledgeBackfillResult {
  const acceptedExperienceIds = db.prepare(`
    SELECT DISTINCT e.experience_id AS experienceId
    FROM experiences e
    INNER JOIN runs r
      ON r.run_id = (
        SELECT candidate.run_id
        FROM runs candidate
        WHERE candidate.space_id = e.space_id
          AND candidate.status = 'completed'
          AND candidate.requested_by_principal_id != ''
        ORDER BY candidate.completed_at DESC, candidate.created_at DESC
        LIMIT 1
      )
    WHERE e.status = 'draft'
      AND e.summary != ''
  `).all() as Array<{ experienceId: string }>;

  for (const row of acceptedExperienceIds) {
    db.prepare(`
      UPDATE experiences
      SET status = 'accepted',
          updated_at = ?
      WHERE experience_id = ?
    `).run(new Date().toISOString(), row.experienceId);
  }

  const memoryRows = db.prepare(`
    SELECT
      m.id,
      m.user_id AS userId,
      m.metadata_json,
      r.requested_by_principal_id AS principalId
    FROM memory_documents m
    INNER JOIN experiences e
      ON e.experience_id = json_extract(m.metadata_json, '$.experienceId')
    INNER JOIN runs r
      ON r.run_id = (
        SELECT candidate.run_id
        FROM runs candidate
        WHERE candidate.space_id = e.space_id
          AND candidate.status = 'completed'
          AND candidate.requested_by_principal_id != ''
        ORDER BY candidate.completed_at DESC, candidate.created_at DESC
        LIMIT 1
      )
    WHERE e.status = 'accepted'
      AND m.type = 'semantic'
  `).all() as Array<{
    id: string;
    userId: string | null;
    metadata_json: string | null;
    principalId: string;
  }>;

  let memoryStatusesUpdated = 0;
  let memoryUsersUpdated = 0;
  const backfilledAt = new Date().toISOString();

  for (const row of memoryRows) {
    const metadata = parseMetadata(row.metadata_json);
    let metadataChanged = false;
    let userChanged = false;

    if (metadata.sourceStatus !== "accepted") {
      metadata.sourceStatus = "accepted";
      metadataChanged = true;
    }

    if (row.userId !== row.principalId) {
      userChanged = true;
    }

    if (metadataChanged || userChanged) {
      db.prepare(`
        UPDATE memory_documents
        SET metadata_json = ?,
            user_id = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(metadata),
        row.principalId,
        backfilledAt,
        row.id,
      );
    }

    if (metadataChanged) {
      memoryStatusesUpdated += 1;
    }
    if (userChanged) {
      memoryUsersUpdated += 1;
    }
  }

  return {
    experiencesAccepted: acceptedExperienceIds.length,
    memoryStatusesUpdated,
    memoryUsersUpdated,
  };
}

function getDocumentSourceStatus(doc: MemoryDocument): ExperienceStatus | undefined {
  const sourceStatus = doc.metadata.sourceStatus;
  if (
    sourceStatus === "draft" ||
    sourceStatus === "accepted" ||
    sourceStatus === "rejected" ||
    sourceStatus === "archived"
  ) {
    return sourceStatus;
  }
  return undefined;
}

function getSourceStatusWeight(status: ExperienceStatus | undefined): number {
  switch (status) {
    case "accepted":
      return 1.2;
    case "draft":
      return 0.8;
    case "rejected":
      return 0.3;
    case "archived":
      return 0.5;
    default:
      return 1;
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeSourceField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveSourceLinkage(
  metadata: Record<string, unknown>,
  scopedPrincipalId?: string,
): {
  sourceType: string;
  sourceId: string;
  status: string;
  principalId: string;
} | undefined {
  const sourceType = normalizeSourceField(metadata.sourceType ?? metadata.source_type);
  const sourceId = normalizeSourceField(metadata.sourceId ?? metadata.source_id);
  if (!sourceType || !sourceId) {
    return undefined;
  }
  const status = normalizeSourceField(
    metadata.sourceStatus ?? metadata.source_status ?? metadata.status,
  ) ?? "";
  const principalId = normalizeSourceField(
    metadata.principalId ?? metadata.principal_id,
  ) ?? normalizeSourceField(scopedPrincipalId) ?? "";
  return {
    sourceType,
    sourceId,
    status,
    principalId,
  };
}
