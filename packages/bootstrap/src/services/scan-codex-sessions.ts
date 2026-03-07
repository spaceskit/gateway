import { homedir } from "node:os";
import { join } from "node:path";
import {
  asNumber,
  asString,
  basenameWithoutExtension,
  extractTimestampMs,
  findNestedRecord,
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

interface CodexSessionScannerOptions {
  roots?: string[];
}

interface MutableCodexSession {
  sessionId: string;
  model?: string;
  startedAtMs?: number;
  lastActivityAtMs?: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

interface TokenUsageCounts {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class CodexSessionScanner implements LocalUsageSessionScanner {
  readonly providerId = "codex";
  private readonly roots: string[];
  private readonly fileCache = new Map<string, CachedScannerFile>();

  constructor(options: CodexSessionScannerOptions = {}) {
    const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
    this.roots = options.roots ?? [
      join(codexHome, "sessions"),
      join(codexHome, "archived_sessions"),
    ];
  }

  async scan(windowStartMs: number): Promise<LocalUsageSessionRecord[]> {
    const files = walkFiles(this.roots, (filePath) =>
      filePath.endsWith(".jsonl")
      || filePath.endsWith(".json")
      || filePath.includes("/sessions/")
      || filePath.includes("/archived_sessions/"),
    );
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
    const fallbackSessionId = deriveSessionIdFromPath(filePath);
    const bySessionId = new Map<string, MutableCodexSession>();

    for (const entry of entries) {
      const sessionId = this.extractSessionId(entry) ?? fallbackSessionId;
      if (!sessionId) continue;

      const state = this.ensureSession(bySessionId, sessionId);
      const model = this.extractModel(entry);
      if (model && !state.model) {
        state.model = model;
      }

      const timestampMs = extractTimestampMs(entry);
      if (timestampMs !== undefined) {
        state.startedAtMs = state.startedAtMs === undefined
          ? timestampMs
          : Math.min(state.startedAtMs, timestampMs);
        state.lastActivityAtMs = state.lastActivityAtMs === undefined
          ? timestampMs
          : Math.max(state.lastActivityAtMs, timestampMs);
      }

      const totalUsage = findNestedRecord(entry, "total_token_usage")
        ?? findNestedRecord(entry, "totalTokenUsage");
      if (totalUsage) {
        this.applyTotalsSnapshot(state, parseTokenUsage(totalUsage));
        continue;
      }

      const lastUsage = findNestedRecord(entry, "last_token_usage")
        ?? findNestedRecord(entry, "lastTokenUsage");
      if (lastUsage) {
        this.applyDelta(state, parseTokenUsage(lastUsage));
        continue;
      }

      const tokenCount = findNestedRecord(entry, "token_count")
        ?? findNestedRecord(entry, "tokenCount");
      if (tokenCount) {
        this.applyDelta(state, parseTokenUsage(tokenCount));
      }
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

  private ensureSession(
    bySessionId: Map<string, MutableCodexSession>,
    sessionId: string,
  ): MutableCodexSession {
    const existing = bySessionId.get(sessionId);
    if (existing) return existing;

    const created: MutableCodexSession = {
      sessionId,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    };
    bySessionId.set(sessionId, created);
    return created;
  }

  private extractSessionId(entry: Record<string, unknown>): string | undefined {
    const direct = asString(entry.session_id)
      ?? asString(entry.sessionId)
      ?? asString(entry.id);
    if (direct) return direct;

    const sessionMeta = findNestedRecord(entry, "session_meta")
      ?? findNestedRecord(entry, "sessionMeta");
    if (sessionMeta) {
      const fromMeta = asString(sessionMeta.session_id)
        ?? asString(sessionMeta.sessionId)
        ?? asString(sessionMeta.id);
      if (fromMeta) return fromMeta;
    }

    return undefined;
  }

  private extractModel(entry: Record<string, unknown>): string | undefined {
    return asString(entry.model)
      ?? asString(entry.model_name)
      ?? asString(entry.modelName)
      ?? extractModelFromNested(entry);
  }

  private applyTotalsSnapshot(state: MutableCodexSession, usage: TokenUsageCounts): void {
    if (usage.inputTokens === 0 && usage.cachedInputTokens === 0 && usage.outputTokens === 0 && usage.totalTokens > 0) {
      state.inputTokens = Math.max(state.inputTokens, usage.totalTokens);
      return;
    }

    state.inputTokens = Math.max(state.inputTokens, usage.inputTokens);
    state.cachedInputTokens = Math.max(state.cachedInputTokens, usage.cachedInputTokens);
    state.outputTokens = Math.max(state.outputTokens, usage.outputTokens);
  }

  private applyDelta(state: MutableCodexSession, usage: TokenUsageCounts): void {
    if (usage.inputTokens === 0 && usage.cachedInputTokens === 0 && usage.outputTokens === 0 && usage.totalTokens > 0) {
      state.inputTokens += usage.totalTokens;
      return;
    }

    state.inputTokens += usage.inputTokens;
    state.cachedInputTokens += usage.cachedInputTokens;
    state.outputTokens += usage.outputTokens;
  }
}

function extractModelFromNested(entry: Record<string, unknown>): string | undefined {
  const sessionMeta = findNestedRecord(entry, "session_meta")
    ?? findNestedRecord(entry, "sessionMeta");
  if (sessionMeta) {
    const model = asString(sessionMeta.model)
      ?? asString(sessionMeta.model_name)
      ?? asString(sessionMeta.modelName);
    if (model) return model;
  }

  const turnContext = findNestedRecord(entry, "turn_context")
    ?? findNestedRecord(entry, "turnContext");
  if (turnContext) {
    const model = asString(turnContext.model)
      ?? asString(turnContext.model_name)
      ?? asString(turnContext.modelName);
    if (model) return model;
  }

  return undefined;
}

function parseTokenUsage(payload: Record<string, unknown>): TokenUsageCounts {
  const inputTokens = normalizeTokenCount(
    asNumber(payload.input_tokens)
    ?? asNumber(payload.prompt_tokens)
    ?? asNumber(payload.inputTokens)
    ?? asNumber(payload.promptTokens)
    ?? asNumber(payload.input),
  );

  const cachedInputTokens = normalizeTokenCount(
    asNumber(payload.cached_input_tokens)
    ?? asNumber(payload.cachedInputTokens)
    ?? asNumber(payload.cache_read_input_tokens)
    ?? asNumber(payload.cacheReadInputTokens)
    ?? asNumber(payload.cached_tokens),
  );

  const outputTokens = normalizeTokenCount(
    asNumber(payload.output_tokens)
    ?? asNumber(payload.completion_tokens)
    ?? asNumber(payload.outputTokens)
    ?? asNumber(payload.completionTokens)
    ?? asNumber(payload.output),
  );

  const totalTokens = normalizeTokenCount(
    asNumber(payload.total_tokens)
    ?? asNumber(payload.totalTokens)
    ?? asNumber(payload.total)
    ?? (inputTokens + cachedInputTokens + outputTokens),
  );

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
  };
}

function deriveSessionIdFromPath(filePath: string): string | undefined {
  const uuidLike = filePath.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  if (uuidLike) return uuidLike;

  const base = basenameWithoutExtension(filePath);
  const normalized = base.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith("session-")) {
    return normalized;
  }
  return normalized;
}
