import type { ProviderSessionHandle } from "@spaceskit/core";

export function parseProviderSessionHandle(value: string | null | undefined): ProviderSessionHandle | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (record.type === "openai_response" && typeof record.previousResponseId === "string" && record.previousResponseId.trim()) {
      return {
        type: "openai_response",
        previousResponseId: record.previousResponseId,
      };
    }
    if (record.type === "codex_app_server_thread" && typeof record.threadId === "string" && record.threadId.trim()) {
      return {
        type: "codex_app_server_thread",
        threadId: record.threadId,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
