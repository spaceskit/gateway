export interface OrchestrationJournalEntry {
  spaceId: string;
  turnId: string;
  eventType: string;
  actorId: string;
  lineageId?: string;
  hopCount?: number;
  payload: Record<string, unknown>;
}

export type AppendOrchestrationJournalEntry = (entry: OrchestrationJournalEntry) => Promise<void> | void;

export type RecordOrchestrationMetric = (
  name: string,
  value: number,
  tags?: Record<string, string>,
) => void;

export async function appendRedactedOrchestrationJournalEntry(input: {
  entry: OrchestrationJournalEntry;
  append?: AppendOrchestrationJournalEntry;
  recordMetric: RecordOrchestrationMetric;
}): Promise<void> {
  const { append, entry, recordMetric } = input;
  if (!append) return;
  try {
    await append({
      ...entry,
      payload: redactOrchestrationPayload(entry.payload),
    });
    recordMetric("orchestration_journal_write_total", 1, {
      status: "ok",
      spaceId: entry.spaceId,
    });
  } catch {
    recordMetric("orchestration_journal_write_total", 1, {
      status: "failed",
      spaceId: entry.spaceId,
    });
  }
}

export function redactOrchestrationPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactOrchestrationValue(payload) as Record<string, unknown>;
}

function redactOrchestrationValue(value: unknown, keyPath: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactOrchestrationValue(entry, keyPath));
  }
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = [...keyPath, key];
      if (isSensitiveOrchestrationKey(key)) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactOrchestrationValue(nested, nextPath);
      }
    }
    return redacted;
  }
  if (typeof value === "string" && value.length > 2_000) {
    return `${value.slice(0, 2_000)}...`;
  }
  return value;
}

function isSensitiveOrchestrationKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/[_-]/g, "");
  return normalized === "messages"
    || normalized.includes("prompt")
    || normalized.includes("instruction")
    || normalized.includes("tooltrace");
}
