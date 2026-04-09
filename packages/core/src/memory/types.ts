/**
 * MemoryProvider — pluggable agent memory abstraction.
 *
 * Adapts external memory systems (Mem0, Letta, etc.) into a uniform interface
 * while preserving Spaceskit's curated experience model as the default.
 *
 * Design principles:
 * 1. Scope-first: every operation is scoped (agent, space, user, global)
 * 2. Type-aware: episodic, semantic, procedural memories are first-class
 * 3. Lazy-loading: external SDKs are imported dynamically (optional deps)
 * 4. Agent-controllable: optionally expose memory ops as agent tools
 */

import type { ToolDefinition } from "../agents/model-provider.js";
import type { ExperienceStatus } from "../experiences/types.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type MemoryType = "episodic" | "semantic" | "procedural" | "observation";

export interface MemoryScope {
  agentId?: string;
  spaceId?: string;
  userId?: string;
  sessionId?: string;
  /** Global scope if all fields are omitted. */
}

export interface MemorySaveInput {
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  metadata?: Record<string, unknown>;
  tags?: string[];
  /** Importance score: 0.0 = low, 1.0 = critical. */
  importance?: number;
}

export interface MemoryDocument {
  id: string;
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  metadata: Record<string, unknown>;
  tags: string[];
  importance: number;
  /** Optional vector embedding for similarity search. */
  embedding?: number[];
  /** Provider-specific data (e.g., Zep temporal fields, Mem0 graph edges). */
  providerData?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryQuery {
  /** Natural-language search text. */
  text: string;
  scope: MemoryScope;
  type?: MemoryType;
  status?: ExperienceStatus;
  tags?: string[];
  /** Max results. Default: 10. */
  limit?: number;
  /** Minimum relevance score [0, 1]. Default: 0.0. */
  minScore?: number;
  /** Temporal filters (for providers that support it). */
  after?: Date;
  before?: Date;
}

export interface ScoredMemory {
  document: MemoryDocument;
  score: number;
  matchReason?: string;
}

export interface MemorySearchResult {
  results: ScoredMemory[];
  totalCount: number;
  queryTimeMs: number;
}

export interface ContextPayload {
  /** Assembled memories for an agent turn. */
  memories: ScoredMemory[];
  /** Optional summary of assembled context. */
  summary?: string;
  /** Estimated token count of the assembled context. */
  tokenEstimate: number;
}

export interface MemoryVersion {
  id: string;
  version: number;
  content: string;
  validFrom: Date;
  validUntil?: Date;
  changeReason?: string;
}

export interface TurnMemoryInput {
  spaceId: string;
  turnId: string;
  agentId: string;
  input: string;
  output: string;
  toolCalls: { name: string; result: unknown }[];
  usage: { promptTokens: number; completionTokens: number };
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  type?: MemoryType;
  sortBy?: "recency" | "importance" | "relevance";
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface MemoryProvider {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;

  // --- Core CRUD ---
  save(input: MemorySaveInput): Promise<MemoryDocument>;
  search(query: MemoryQuery): Promise<MemorySearchResult>;
  get(id: string): Promise<MemoryDocument | null>;
  update(id: string, patch: Partial<MemorySaveInput>): Promise<MemoryDocument>;
  delete(id: string): Promise<void>;
  list(scope: MemoryScope, options?: ListOptions): Promise<MemoryDocument[]>;

  // --- Context Assembly ---
  /** Assemble relevant memories for an agent turn. Called by runtime before LLM call. */
  assembleContext(scope: MemoryScope, goal?: string, maxTokens?: number): Promise<ContextPayload>;

  // --- Lifecycle Hooks ---
  /** Called when a space turn completes. Provider decides what to remember. */
  onTurnCompleted?(turnResult: TurnMemoryInput): Promise<void>;
  /** Called when a space completes. Provider can consolidate/summarize. */
  onSpaceCompleted?(spaceId: string): Promise<void>;

  // --- Optional: Temporal ---
  getHistory?(id: string): Promise<MemoryVersion[]>;

  // --- Optional: Agent Tools ---
  /** If supported, returns tool definitions the agent can call to manage its own memory. */
  getAgentTools?(): ToolDefinition[];

  // --- Optional: Sharing ---
  /** Share memories across agents in a space. */
  shareWithAgents?(memoryIds: string[], agentIds: string[]): Promise<void>;

  // --- Health ---
  checkHealth(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface MemoryProviderRegistry {
  /** Register a memory provider. */
  register(provider: MemoryProvider): void;
  /** Unregister a memory provider. */
  unregister(providerId: string): void;
  /** Get a specific provider by ID. */
  get(providerId: string): MemoryProvider | undefined;
  /** Get the default provider. */
  getDefault(): MemoryProvider | undefined;
  /** Set the default provider. */
  setDefault(providerId: string): void;
  /** List all registered providers. */
  list(): MemoryProvider[];
  /** Search across all providers (or a specific one). */
  search(query: MemoryQuery, providerId?: string): Promise<MemorySearchResult>;
}
