import type {
  ConciergeEscalationAllowedResponse,
  ConciergeEscalationFallbackPolicy,
  ConciergeEscalationRequestInput,
  ConciergeEscalationRequestResult,
  ConciergeEscalationResponseMode,
  ConciergeEscalationStatusResult,
  ConciergeEscalationUrgency,
  Notification,
} from "@spaceskit/core";
import type { ConciergeEscalationRequestRow } from "@spaceskit/persistence";

export function assertSpaceMatch(row: ConciergeEscalationRequestRow, spaceId: string): void {
  if (row.space_id !== spaceId) {
    throw new Error(`Concierge escalation request ${row.request_id} does not belong to space ${spaceId}`);
  }
}

export function toRequestResult(row: ConciergeEscalationRequestRow): ConciergeEscalationRequestResult {
  return {
    requestId: row.request_id,
    status: row.status,
    deliveryChannel: row.delivery_channel,
    expiresAt: row.expires_at ?? undefined,
    deepLink: row.deep_link || undefined,
    response: parseResponse(row),
  };
}

export function toStatusResult(row: ConciergeEscalationRequestRow): ConciergeEscalationStatusResult {
  return {
    ...toRequestResult(row),
    question: row.question,
    reason: row.reason,
    urgency: row.urgency,
    allowedResponses: parseAllowedResponses(row),
    fallbackPolicy: row.fallback_policy,
  };
}

export function parseAllowedResponses(row: ConciergeEscalationRequestRow): ConciergeEscalationAllowedResponse[] {
  try {
    const parsed = JSON.parse(row.allowed_responses_json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ConciergeEscalationAllowedResponse =>
        entry === "approve"
        || entry === "reject"
        || entry === "defer"
        || entry === "revise"
        || entry === "open_app",
    );
  } catch {
    return [];
  }
}

export function parseResponse(row: ConciergeEscalationRequestRow): Record<string, unknown> | undefined {
  if (!row.response_json?.trim()) return undefined;
  try {
    const parsed = JSON.parse(row.response_json);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function buildNotificationTargets(spaceId: string, principalId?: string): Notification["targets"] {
  const targets: Notification["targets"] = [{ type: "space", spaceId }];
  if (principalId) {
    targets.unshift({ type: "user", userId: principalId });
  }
  return targets;
}

export function buildDeepLink(requestId: string, spaceId: string): string {
  return `spaces://concierge/request?requestId=${encodeURIComponent(requestId)}&spaceId=${encodeURIComponent(spaceId)}`;
}

export function buildUserMessage(
  question: string,
  reason: string,
  urgency: ConciergeEscalationUrgency,
): string {
  const normalizedQuestion = ensureQuestion(question);
  const normalizedReason = normalizeOptional(reason);
  if (!normalizedReason) {
    return normalizedQuestion;
  }
  if (urgency === "urgent") {
    return `${normalizedQuestion} ${capitalize(normalizedReason)}.`;
  }
  return `${normalizedQuestion} ${normalizedReason}.`;
}

export function ensureQuestion(value: string): string {
  const trimmed = normalizeRequired(value, "question");
  if (/[?]$/.test(trimmed)) return trimmed;
  return `${trimmed}?`;
}

export function normalizeUrgency(value: ConciergeEscalationRequestInput["urgency"]): ConciergeEscalationUrgency {
  return value === "passive" || value === "important" || value === "urgent"
    ? value
    : "important";
}

export function normalizeResponseMode(
  value: ConciergeEscalationRequestInput["responseMode"],
  defaultResponseMode: ConciergeEscalationResponseMode,
): ConciergeEscalationResponseMode {
  if (value && value !== "structured") {
    throw new Error("Only responseMode=structured is supported");
  }
  return defaultResponseMode;
}

export function normalizeAllowedResponses(
  value: ConciergeEscalationRequestInput["allowedResponses"],
): ConciergeEscalationAllowedResponse[] {
  const normalized = Array.isArray(value) && value.length > 0
    ? value.filter(
      (entry): entry is ConciergeEscalationAllowedResponse =>
        entry === "approve"
        || entry === "reject"
        || entry === "defer"
        || entry === "revise"
        || entry === "open_app",
    )
    : ["approve", "reject", "defer", "revise"] as ConciergeEscalationAllowedResponse[];
  if (normalized.length === 0) {
    throw new Error("allowedResponses must contain at least one structured response");
  }
  return Array.from(new Set(normalized)) as ConciergeEscalationAllowedResponse[];
}

export function normalizeFallbackPolicy(
  value: ConciergeEscalationRequestInput["fallbackPolicy"],
): ConciergeEscalationFallbackPolicy {
  return value === "urgent_call_after_timeout" ? value : "none";
}

export function normalizeTimeoutSeconds(
  value: ConciergeEscalationRequestInput["timeoutSeconds"],
  fallbackPolicy: ConciergeEscalationFallbackPolicy,
  defaultTimeoutSeconds: number,
  defaultUrgentCallTimeoutSeconds: number,
): number {
  const fallback = fallbackPolicy === "urgent_call_after_timeout"
    ? defaultUrgentCallTimeoutSeconds
    : defaultTimeoutSeconds;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

export function normalizeResponseAction(
  value: unknown,
  allowedResponses: ConciergeEscalationAllowedResponse[],
): ConciergeEscalationAllowedResponse | undefined {
  if (
    value !== "approve"
    && value !== "reject"
    && value !== "defer"
    && value !== "revise"
    && value !== "open_app"
  ) {
    return undefined;
  }
  return allowedResponses.includes(value) ? value : undefined;
}

export function parseDate(value: string | null | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeRequired(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function normalizeOptional(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeUnknownString(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeOptional(value) : undefined;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
