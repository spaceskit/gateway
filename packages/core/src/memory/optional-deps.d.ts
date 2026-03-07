/**
 * Type declarations for optional memory provider dependencies.
 * These packages are lazy-loaded at runtime and may not be installed.
 */

declare module "mem0ai" {
  export interface MemoryResult {
    id: string;
    memory?: string;
    text?: string;
    content?: string;
    score?: number;
    user_id?: string;
    metadata?: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
  }

  export class MemoryClient {
    constructor(config: { apiKey: string; host?: string; orgId?: string });
    add(messages: unknown[], options?: Record<string, unknown>): Promise<{ id?: string; results?: MemoryResult[] }>;
    search(query: string, options?: Record<string, unknown>): Promise<MemoryResult[]>;
    get(id: string): Promise<MemoryResult | null>;
    update(id: string, content: string): Promise<MemoryResult>;
    getAll(options?: Record<string, unknown>): Promise<MemoryResult[]>;
    delete(id: string): Promise<void>;
    deleteAll(options?: Record<string, unknown>): Promise<void>;
    history(id: string): Promise<{ results?: Array<Record<string, unknown>> }>;
  }
  export default { MemoryClient };
}

declare module "@letta-ai/letta-client" {
  export interface ArchivalMemoryEntry {
    id: string;
    text: string;
    created_at?: string;
    metadata?: Record<string, unknown>;
  }

  export class LettaClient {
    constructor(config?: { baseUrl?: string; token?: string });
    agents: {
      list(options?: Record<string, unknown>): Promise<Array<{ id: string; name: string }>>;
      archivalMemory: {
        create(agentId: string, data: { text: string; metadata?: Record<string, unknown> }): Promise<ArchivalMemoryEntry>;
        list(agentId: string, options?: Record<string, unknown>): Promise<ArchivalMemoryEntry[]>;
        update(agentId: string, id: string, data: { text: string }): Promise<ArchivalMemoryEntry>;
        delete(agentId: string, id: string): Promise<void>;
      };
      messages: {
        send(agentId: string, payload: { messages: Array<{ role: string; content: string }> }): Promise<{ messages?: Array<{ text?: string }> }>;
      };
    };
  }
  export default { LettaClient };
}
