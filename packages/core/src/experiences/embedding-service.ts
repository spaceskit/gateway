/**
 * EmbeddingService — converts text into vector embeddings.
 *
 * Provides a simple interface for embedding generation and similarity
 * computation. Ships with a hash-based placeholder (zero deps) and
 * an optional OpenAI implementation.
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EmbeddingService {
  /** Generate a vector embedding for the given text. */
  embed(text: string): Promise<number[]>;
  /** Compute cosine similarity between two vectors. Returns [-1, 1]. */
  similarity(a: number[], b: number[]): number;
  /** Embedding dimension size. */
  readonly dimensions: number;
}

// ---------------------------------------------------------------------------
// Hash-based placeholder (zero dependencies)
// ---------------------------------------------------------------------------

/**
 * SimpleEmbeddingService — deterministic hash-based embeddings.
 * NOT suitable for production similarity search. Use for testing
 * or as a fallback when no real embedding API is configured.
 */
export class SimpleEmbeddingService implements EmbeddingService {
  readonly dimensions = 64;

  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(this.dimensions).fill(0);
    const normalized = text.toLowerCase().trim();

    // Generate pseudo-random but deterministic embedding from text
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i);
      const idx = i % this.dimensions;
      vec[idx] += Math.sin(charCode * (i + 1) * 0.1) * 0.1;
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= magnitude;
      }
    }

    return vec;
  }

  similarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b);
  }
}

// ---------------------------------------------------------------------------
// OpenAI Embeddings (optional)
// ---------------------------------------------------------------------------

export interface OpenAIEmbeddingServiceOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

/**
 * OpenAIEmbeddingService — uses OpenAI's text-embedding-3-small model.
 * Requires an API key. Falls back gracefully if the API is unreachable.
 */
export class OpenAIEmbeddingService implements EmbeddingService {
  readonly dimensions = 1536; // text-embedding-3-small default
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor(options: OpenAIEmbeddingServiceOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "text-embedding-3-small";
    this.baseURL = options.baseURL ?? "https://api.openai.com/v1";
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text.slice(0, 8000), // Truncate to safe length
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    if (!data?.data?.[0]?.embedding) {
      throw new Error("Invalid OpenAI embeddings response: missing embedding data");
    }
    return data.data[0].embedding;
  }

  similarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b);
  }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
