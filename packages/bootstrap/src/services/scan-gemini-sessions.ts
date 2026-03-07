import { homedir } from "node:os";
import { join } from "node:path";
import {
  asNumber,
  asString,
  basenameWithoutExtension,
  extractTimestampMs,
  isObjectRecord,
  mergeSessions,
  normalizeTokenCount,
  parseJsonEntries,
  purgeMissingFiles,
  readCachedSessions,
  type CachedScannerFile,
  type LocalUsageSessionRecord,
  type LocalUsageSessionScanner,
  walkFiles,
} from "./local-usage-scanner.js";

interface GeminiSessionScannerOptions {
  roots?: string[];
}

interface MutableGeminiSession {
  sessionId: string;
  model?: string;
  startedAtMs?: number;
  lastActivityAtMs?: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export class GeminiSessionScanner implements LocalUsageSessionScanner {
  readonly providerId = "gemini";
  private readonly roots: string[];
  private readonly fileCache = new Map<string, CachedScannerFile>();

  constructor(options: GeminiSessionScannerOptions = {}) {
    this.roots = options.roots ?? [join(homedir(), ".gemini", "tmp")];
  }

  async scan(windowStartMs: number): Promise<LocalUsageSessionRecord[]> {
    const files = walkFiles(this.roots, (filePath) => {
      const normalized = filePath.toLowerCase();
      return normalized.includes("/chats/")
        && normalized.endsWith(".json")
        && normalized.includes("/session-");
    });
    const retainedPaths = new Set(files);
    const sessions: LocalUsageSessionRecord[] = [];

    for (const filePath of files) {
      sessions.push(
        ...readCachedSessions(
          filePath,
          this.fileCache,
          (path, content, mtimeMs) => this.parseFile(path, content, mtimeMs),
        ),
      );
    }

    purgeMissingFiles(this.fileCache, retainedPaths);
    return mergeSessions(sessions, windowStartMs);
  }

  private parseFile(
    filePath: string,
    content: string,
    fileMtimeMs: number,
  ): LocalUsageSessionRecord[] {
    const entries = parseJsonEntries(content);
    if (entries.length === 0) {
      return [];
    }

    const fallbackSessionId = deriveGeminiSessionIdFromPath(filePath);
    const bySessionId = new Map<string, MutableGeminiSession>();

    for (const entry of entries) {
      this.consumeEntry(entry, fallbackSessionId, bySessionId);
    }

    const sessions: LocalUsageSessionRecord[] = [];
    for (const state of bySessionId.values()) {
      sessions.push({
        sessionId: state.sessionId,
        model: state.model,
        startedAtMs: state.startedAtMs,
        lastActivityAtMs: state.lastActivityAtMs ?? fileMtimeMs,
        inputTokens: Math.max(0, state.inputTokens),
        cachedInputTokens: Math.max(0, state.cachedInputTokens),
        outputTokens: Math.max(0, state.outputTokens),
      });
    }

    return sessions;
  }

  private consumeEntry(
    entry: Record<string, unknown>,
    fallbackSessionId: string,
    bySessionId: Map<string, MutableGeminiSession>,
  ): void {
    const sessionId = asString(entry.sessionId)
      ?? asString(entry.session_id)
      ?? fallbackSessionId;
    if (!sessionId) return;

    const state = ensureGeminiSession(bySessionId, sessionId);
    const rootModel = asString(entry.model)
      ?? asString(entry.model_name)
      ?? asString(entry.modelName);
    if (rootModel && !state.model) {
      state.model = rootModel;
    }

    const messageCandidates = collectMessageCandidates(entry);
    if (messageCandidates.length === 0) {
      this.applyMessageRecord(state, entry);
      return;
    }

    for (const message of messageCandidates) {
      this.applyMessageRecord(state, message);
    }
  }

  private applyMessageRecord(
    state: MutableGeminiSession,
    payload: Record<string, unknown>,
  ): void {
    const model = asString(payload.model)
      ?? asString(payload.model_name)
      ?? asString(payload.modelName);
    if (model && !state.model) {
      state.model = model;
    }

    const timestampMs = extractTimestampMs(payload);
    if (timestampMs !== undefined) {
      state.startedAtMs = state.startedAtMs === undefined
        ? timestampMs
        : Math.min(state.startedAtMs, timestampMs);
      state.lastActivityAtMs = state.lastActivityAtMs === undefined
        ? timestampMs
        : Math.max(state.lastActivityAtMs, timestampMs);
    }

    const usagePayload = resolveGeminiUsagePayload(payload);
    const usage = parseGeminiTokenUsage(usagePayload);
    state.inputTokens += usage.inputTokens;
    state.cachedInputTokens += usage.cachedInputTokens;
    state.outputTokens += usage.outputTokens;
  }
}

function collectMessageCandidates(entry: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  for (const key of ["messages", "history", "events", "turns", "contents"]) {
    const value = entry[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isObjectRecord(item)) {
        candidates.push(item);
      }
    }
  }

  const chat = entry.chat;
  if (isObjectRecord(chat)) {
    const chatMessages = chat.messages;
    if (Array.isArray(chatMessages)) {
      for (const item of chatMessages) {
        if (isObjectRecord(item)) {
          candidates.push(item);
        }
      }
    }
  }

  return candidates;
}

function resolveGeminiUsagePayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (isObjectRecord(payload.usage)) return payload.usage;
  if (isObjectRecord(payload.token_count)) return payload.token_count;
  if (isObjectRecord(payload.tokenCount)) return payload.tokenCount;
  return payload;
}

function parseGeminiTokenUsage(payload: Record<string, unknown>): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
} {
  const inputTokens = normalizeTokenCount(
    asNumber(payload.inputTokens)
    ?? asNumber(payload.input_tokens)
    ?? asNumber(payload.promptTokens)
    ?? asNumber(payload.prompt_tokens),
  );
  const cachedInputTokens = normalizeTokenCount(
    asNumber(payload.cachedInputTokens)
    ?? asNumber(payload.cached_input_tokens)
    ?? asNumber(payload.cacheReadInputTokens)
    ?? asNumber(payload.cache_read_input_tokens),
  );
  const outputTokens = normalizeTokenCount(
    asNumber(payload.outputTokens)
    ?? asNumber(payload.output_tokens)
    ?? asNumber(payload.completionTokens)
    ?? asNumber(payload.completion_tokens),
  );

  const totalFallback = normalizeTokenCount(
    asNumber(payload.tokens)
    ?? asNumber(payload.totalTokens)
    ?? asNumber(payload.total_tokens),
  );

  if (inputTokens === 0 && cachedInputTokens === 0 && outputTokens === 0 && totalFallback > 0) {
    return {
      inputTokens: totalFallback,
      cachedInputTokens: 0,
      outputTokens: 0,
    };
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
  };
}

function ensureGeminiSession(
  bySessionId: Map<string, MutableGeminiSession>,
  sessionId: string,
): MutableGeminiSession {
  const existing = bySessionId.get(sessionId);
  if (existing) return existing;

  const created: MutableGeminiSession = {
    sessionId,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  bySessionId.set(sessionId, created);
  return created;
}

function deriveGeminiSessionIdFromPath(filePath: string): string {
  const base = basenameWithoutExtension(filePath).trim();
  return base || filePath;
}
