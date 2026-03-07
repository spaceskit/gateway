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

interface ClaudeSessionScannerOptions {
  roots?: string[];
}

interface ClaudeRecord {
  sessionId: string;
  messageId?: string;
  requestId?: string;
  model?: string;
  timestampMs?: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

interface MutableClaudeSession {
  sessionId: string;
  model?: string;
  startedAtMs?: number;
  lastActivityAtMs?: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  seenMessageKeys: Set<string>;
}

export class ClaudeSessionScanner implements LocalUsageSessionScanner {
  readonly providerId = "claude";
  private readonly roots: string[];
  private readonly fileCache = new Map<string, CachedScannerFile>();

  constructor(options: ClaudeSessionScannerOptions = {}) {
    const home = homedir();
    const claudeConfig = process.env.CLAUDE_CONFIG_DIR?.trim();
    const baseRoots = options.roots ?? [
      claudeConfig ? join(claudeConfig, "projects") : "",
      join(home, ".claude", "projects"),
      join(home, ".config", "claude", "projects"),
    ];
    this.roots = Array.from(new Set(baseRoots.filter((value) => value.length > 0)));
  }

  async scan(windowStartMs: number): Promise<LocalUsageSessionRecord[]> {
    const files = walkFiles(this.roots, (filePath) =>
      filePath.endsWith(".json")
      || filePath.endsWith(".jsonl")
      || filePath.endsWith(".log"),
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
    const fallbackSessionId = deriveClaudeSessionIdFromPath(filePath);
    const records: ClaudeRecord[] = [];

    for (const entry of entries) {
      records.push(...extractClaudeRecords(entry, fallbackSessionId));
    }

    const bySessionId = new Map<string, MutableClaudeSession>();
    for (const record of records) {
      const state = ensureSession(bySessionId, record.sessionId);
      if (record.model && !state.model) {
        state.model = record.model;
      }
      if (record.timestampMs !== undefined) {
        state.startedAtMs = state.startedAtMs === undefined
          ? record.timestampMs
          : Math.min(state.startedAtMs, record.timestampMs);
        state.lastActivityAtMs = state.lastActivityAtMs === undefined
          ? record.timestampMs
          : Math.max(state.lastActivityAtMs, record.timestampMs);
      }

      const dedupeKey = buildClaudeDedupeKey(record);
      if (dedupeKey && state.seenMessageKeys.has(dedupeKey)) {
        continue;
      }
      if (dedupeKey) {
        state.seenMessageKeys.add(dedupeKey);
      }

      state.inputTokens += record.inputTokens;
      state.cachedInputTokens += record.cachedInputTokens;
      state.outputTokens += record.outputTokens;
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
}

function extractClaudeRecords(
  payload: Record<string, unknown>,
  fallbackSessionId: string,
): ClaudeRecord[] {
  const records: ClaudeRecord[] = [];
  const sessionIdFromPayload = asString(payload.sessionId)
    ?? asString(payload.session_id)
    ?? fallbackSessionId;
  const requestIdFromPayload = asString(payload.requestId)
    ?? asString(payload.request_id);

  const messages = payload.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (!isObjectRecord(message)) continue;
      const parsed = parseClaudeRecord(message, sessionIdFromPayload, requestIdFromPayload);
      if (parsed) records.push(parsed);
    }
    return records;
  }

  const nestedMessage = payload.message;
  if (isObjectRecord(nestedMessage)) {
    const parsed = parseClaudeRecord(nestedMessage, sessionIdFromPayload, requestIdFromPayload, payload);
    if (parsed) {
      records.push(parsed);
      return records;
    }
  }

  const direct = parseClaudeRecord(payload, sessionIdFromPayload, requestIdFromPayload);
  if (direct) {
    records.push(direct);
  }

  return records;
}

function parseClaudeRecord(
  payload: Record<string, unknown>,
  fallbackSessionId: string,
  inheritedRequestId?: string,
  envelope?: Record<string, unknown>,
): ClaudeRecord | null {
  const usagePayload = resolveUsagePayload(payload, envelope);
  const tokenCounts = parseTokenUsage(usagePayload ?? payload);
  if (
    tokenCounts.inputTokens === 0
    && tokenCounts.cachedInputTokens === 0
    && tokenCounts.outputTokens === 0
  ) {
    return null;
  }

  const sessionId = asString(payload.sessionId)
    ?? asString(payload.session_id)
    ?? asString(payload.conversationId)
    ?? asString(payload.conversation_id)
    ?? (envelope
      ? asString(envelope.sessionId) ?? asString(envelope.session_id)
      : undefined)
    ?? fallbackSessionId;
  if (!sessionId) return null;

  const requestId = asString(payload.requestId)
    ?? asString(payload.request_id)
    ?? (envelope
      ? asString(envelope.requestId) ?? asString(envelope.request_id)
      : undefined)
    ?? inheritedRequestId;
  const messageId = asString(payload.id)
    ?? asString(payload.messageId)
    ?? asString(payload.message_id);
  const model = asString(payload.model)
    ?? asString(payload.model_name)
    ?? asString(payload.modelName);
  const timestampMs = extractTimestampMs(payload)
    ?? (envelope ? extractTimestampMs(envelope) : undefined);

  return {
    sessionId,
    requestId,
    messageId,
    model,
    timestampMs,
    inputTokens: tokenCounts.inputTokens,
    cachedInputTokens: tokenCounts.cachedInputTokens,
    outputTokens: tokenCounts.outputTokens,
  };
}

function resolveUsagePayload(
  payload: Record<string, unknown>,
  envelope?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (isObjectRecord(payload.usage)) return payload.usage;
  if (isObjectRecord(payload.token_count)) return payload.token_count;
  if (isObjectRecord(payload.tokenCount)) return payload.tokenCount;
  if (isObjectRecord(payload.metrics) && isObjectRecord(payload.metrics.usage)) {
    return payload.metrics.usage;
  }

  if (envelope) {
    if (isObjectRecord(envelope.usage)) return envelope.usage;
    if (isObjectRecord(envelope.token_count)) return envelope.token_count;
    if (isObjectRecord(envelope.tokenCount)) return envelope.tokenCount;
  }

  return undefined;
}

function parseTokenUsage(payload: Record<string, unknown>): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
} {
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
    ?? asNumber(payload.cacheReadInputTokens),
  );

  const outputTokens = normalizeTokenCount(
    asNumber(payload.output_tokens)
    ?? asNumber(payload.completion_tokens)
    ?? asNumber(payload.outputTokens)
    ?? asNumber(payload.completionTokens)
    ?? asNumber(payload.output),
  );

  const totalFallback = normalizeTokenCount(
    asNumber(payload.total_tokens)
    ?? asNumber(payload.totalTokens)
    ?? asNumber(payload.tokens),
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

function ensureSession(
  bySessionId: Map<string, MutableClaudeSession>,
  sessionId: string,
): MutableClaudeSession {
  const existing = bySessionId.get(sessionId);
  if (existing) return existing;

  const created: MutableClaudeSession = {
    sessionId,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    seenMessageKeys: new Set<string>(),
  };
  bySessionId.set(sessionId, created);
  return created;
}

function buildClaudeDedupeKey(record: ClaudeRecord): string | null {
  if (!record.messageId && !record.requestId) {
    return null;
  }
  return `${record.messageId ?? ""}::${record.requestId ?? ""}`;
}

function deriveClaudeSessionIdFromPath(filePath: string): string {
  const base = basenameWithoutExtension(filePath).trim();
  return base || filePath;
}
