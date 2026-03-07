/**
 * CompositeMemoryScorer — ranks memories using multiple signals.
 *
 * Combines:
 * - Semantic similarity (via embeddings)
 * - Recency (exponential decay over 90 days)
 * - Importance (author-assigned weight)
 * - Agent affinity (boost memories from same agent)
 *
 * Inspired by CrewAI's semantic × recency × importance model.
 */

import type { MemoryDocument, ScoredMemory } from "./types.js";
import type { EmbeddingService } from "../experiences/embedding-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryScoreWeights {
  /** Weight for semantic similarity. Default: 0.4. */
  semantic?: number;
  /** Weight for recency. Default: 0.3. */
  recency?: number;
  /** Weight for importance. Default: 0.2. */
  importance?: number;
  /** Weight for agent affinity. Default: 0.1. */
  affinity?: number;
}

export interface MemoryScoreBreakdown {
  semantic: number;
  recency: number;
  importance: number;
  affinity: number;
  total: number;
}

export interface ScorerContext {
  /** Current agent ID for affinity scoring. */
  agentId?: string;
  /** Reference time for recency scoring. Default: now. */
  currentTime?: Date;
  /** Memory decay half-life in days. Default: 45. */
  decayHalfLifeDays?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CompositeMemoryScorer {
  private embeddingService?: EmbeddingService;
  private weights: Required<MemoryScoreWeights>;

  constructor(
    weights?: MemoryScoreWeights,
    embeddingService?: EmbeddingService,
  ) {
    this.embeddingService = embeddingService;
    const raw = {
      semantic: weights?.semantic ?? 0.4,
      recency: weights?.recency ?? 0.3,
      importance: weights?.importance ?? 0.2,
      affinity: weights?.affinity ?? 0.1,
    };
    // Normalize weights to sum to 1.0
    const sum = raw.semantic + raw.recency + raw.importance + raw.affinity;
    if (sum <= 0) throw new Error("Memory score weights must sum to a positive value");
    this.weights = {
      semantic: raw.semantic / sum,
      recency: raw.recency / sum,
      importance: raw.importance / sum,
      affinity: raw.affinity / sum,
    };
  }

  /**
   * Score and rank a list of memories against a query.
   * Returns memories sorted by composite score (highest first).
   */
  async scoreMemories(
    query: string,
    memories: MemoryDocument[],
    context?: ScorerContext,
  ): Promise<ScoredMemory[]> {
    const now = context?.currentTime ?? new Date();
    const halfLife = (context?.decayHalfLifeDays ?? 45) * 24 * 60 * 60 * 1000;

    // Compute query embedding (once)
    let queryEmbedding: number[] | null = null;
    if (this.embeddingService && query) {
      try {
        queryEmbedding = await this.embeddingService.embed(query);
      } catch {
        // Embedding failed — semantic score will be 0
      }
    }

    const scored: ScoredMemory[] = [];

    for (const doc of memories) {
      const breakdown = await this.computeScore(doc, query, queryEmbedding, now, halfLife, context);

      scored.push({
        document: doc,
        score: breakdown.total,
        matchReason: this.formatReason(breakdown),
      });
    }

    // Sort by total score descending
    scored.sort((a, b) => b.score - a.score);

    return scored;
  }

  /**
   * Compute the composite score for a single memory document.
   */
  async computeScore(
    doc: MemoryDocument,
    query: string,
    queryEmbedding: number[] | null,
    now: Date,
    halfLife: number,
    context?: ScorerContext,
  ): Promise<MemoryScoreBreakdown> {
    // 1. Semantic similarity
    let semanticScore = 0;
    if (queryEmbedding && doc.embedding && this.embeddingService) {
      semanticScore = Math.max(0, this.embeddingService.similarity(queryEmbedding, doc.embedding));
    } else if (query) {
      // Fallback: keyword overlap
      semanticScore = this.keywordOverlap(query, doc.content);
    }

    // 2. Recency: exponential decay
    const ageMs = now.getTime() - doc.createdAt.getTime();
    const recencyScore = Math.exp(-0.693 * ageMs / halfLife); // 0.693 = ln(2)

    // 3. Importance: direct from document
    const importanceScore = doc.importance;

    // 4. Agent affinity: boost if memory is from the same agent
    let affinityScore = 0.5; // Neutral
    if (context?.agentId) {
      if (doc.scope.agentId === context.agentId) {
        affinityScore = 1.0; // Same agent
      } else if (doc.scope.agentId) {
        affinityScore = 0.3; // Different agent
      }
    }

    // Weighted composite
    const total =
      semanticScore * this.weights.semantic +
      recencyScore * this.weights.recency +
      importanceScore * this.weights.importance +
      affinityScore * this.weights.affinity;

    return {
      semantic: semanticScore,
      recency: recencyScore,
      importance: importanceScore,
      affinity: affinityScore,
      total: Math.min(1, Math.max(0, total)),
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private keywordOverlap(query: string, content: string): number {
    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const contentWords = new Set(content.toLowerCase().split(/\s+/).filter((w) => w.length > 2));

    if (queryWords.size === 0) return 0;

    let matches = 0;
    for (const word of queryWords) {
      if (contentWords.has(word)) matches++;
    }

    return matches / queryWords.size;
  }

  private formatReason(breakdown: MemoryScoreBreakdown): string {
    const parts: string[] = [];
    if (breakdown.semantic > 0.3) parts.push(`semantic:${breakdown.semantic.toFixed(2)}`);
    if (breakdown.recency > 0.5) parts.push(`recent:${breakdown.recency.toFixed(2)}`);
    if (breakdown.importance > 0.6) parts.push(`important:${breakdown.importance.toFixed(2)}`);
    if (breakdown.affinity > 0.7) parts.push(`same-agent`);
    return parts.join(", ") || `score:${breakdown.total.toFixed(2)}`;
  }
}
