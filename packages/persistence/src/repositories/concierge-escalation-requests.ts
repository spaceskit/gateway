import type { Database } from "bun:sqlite";

export type ConciergeEscalationUrgency = "passive" | "important" | "urgent";
export type ConciergeEscalationResponseMode = "structured";
export type ConciergeEscalationAllowedResponse =
  | "approve"
  | "reject"
  | "defer"
  | "revise"
  | "open_app";
export type ConciergeEscalationFallbackPolicy = "none" | "urgent_call_after_timeout";
export type ConciergeEscalationStatus =
  | "pending"
  | "notified"
  | "actioned"
  | "expired"
  | "escalated_to_call"
  | "cancelled";
export type ConciergeEscalationDeliveryChannel = "notification" | "call";

export interface ConciergeEscalationRequestRow {
  request_id: string;
  space_id: string;
  requesting_agent_id: string;
  target_agent_id: string;
  requesting_turn_id: string;
  principal_id: string;
  device_id: string;
  reason: string;
  question: string;
  user_message: string;
  urgency: ConciergeEscalationUrgency;
  response_mode: ConciergeEscalationResponseMode;
  allowed_responses_json: string;
  fallback_policy: ConciergeEscalationFallbackPolicy;
  timeout_seconds: number;
  status: ConciergeEscalationStatus;
  delivery_channel: ConciergeEscalationDeliveryChannel;
  deep_link: string;
  response_json: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  notified_at: string | null;
  actioned_at: string | null;
  cancelled_at: string | null;
  escalated_to_call_at: string | null;
}

export interface CreateConciergeEscalationRequestInput {
  requestId: string;
  spaceId: string;
  requestingAgentId?: string;
  targetAgentId?: string;
  requestingTurnId?: string;
  principalId?: string;
  deviceId?: string;
  reason: string;
  question: string;
  userMessage: string;
  urgency: ConciergeEscalationUrgency;
  responseMode: ConciergeEscalationResponseMode;
  allowedResponses: ConciergeEscalationAllowedResponse[];
  fallbackPolicy: ConciergeEscalationFallbackPolicy;
  timeoutSeconds: number;
  status?: ConciergeEscalationStatus;
  deliveryChannel?: ConciergeEscalationDeliveryChannel;
  deepLink?: string;
  responseJson?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
  notifiedAt?: string | null;
  actionedAt?: string | null;
  cancelledAt?: string | null;
  escalatedToCallAt?: string | null;
}

export interface UpdateConciergeEscalationRequestInput {
  requestId: string;
  status?: ConciergeEscalationStatus;
  deliveryChannel?: ConciergeEscalationDeliveryChannel;
  deepLink?: string;
  responseJson?: string;
  expiresAt?: string | null;
  notifiedAt?: string | null;
  actionedAt?: string | null;
  cancelledAt?: string | null;
  escalatedToCallAt?: string | null;
}

export class ConciergeEscalationRequestRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateConciergeEscalationRequestInput): ConciergeEscalationRequestRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const updatedAt = input.updatedAt ?? createdAt;
    this.db.query(`
      INSERT INTO concierge_escalation_requests(
        request_id,
        space_id,
        requesting_agent_id,
        target_agent_id,
        requesting_turn_id,
        principal_id,
        device_id,
        reason,
        question,
        user_message,
        urgency,
        response_mode,
        allowed_responses_json,
        fallback_policy,
        timeout_seconds,
        status,
        delivery_channel,
        deep_link,
        response_json,
        created_at,
        updated_at,
        expires_at,
        notified_at,
        actioned_at,
        cancelled_at,
        escalated_to_call_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.requestId,
      input.spaceId,
      input.requestingAgentId ?? "",
      input.targetAgentId ?? "",
      input.requestingTurnId ?? "",
      input.principalId ?? "",
      input.deviceId ?? "",
      input.reason,
      input.question,
      input.userMessage,
      input.urgency,
      input.responseMode,
      JSON.stringify(normalizeAllowedResponses(input.allowedResponses)),
      input.fallbackPolicy,
      normalizeTimeoutSeconds(input.timeoutSeconds),
      input.status ?? "pending",
      input.deliveryChannel ?? "notification",
      input.deepLink ?? "",
      input.responseJson ?? "{}",
      createdAt,
      updatedAt,
      input.expiresAt ?? null,
      input.notifiedAt ?? null,
      input.actionedAt ?? null,
      input.cancelledAt ?? null,
      input.escalatedToCallAt ?? null,
    );
    return this.getById(input.requestId)!;
  }

  getById(requestId: string): ConciergeEscalationRequestRow | undefined {
    return this.db.query(`
      SELECT * FROM concierge_escalation_requests WHERE request_id = ?
    `).get(requestId) as ConciergeEscalationRequestRow | undefined ?? undefined;
  }

  listByStatuses(statuses: ConciergeEscalationStatus[], limit = 100): ConciergeEscalationRequestRow[] {
    const normalizedStatuses = Array.from(new Set(statuses));
    if (normalizedStatuses.length === 0) return [];
    const placeholders = normalizedStatuses.map(() => "?").join(", ");
    return this.db.query(`
      SELECT * FROM concierge_escalation_requests
      WHERE status IN (${placeholders})
      ORDER BY created_at ASC
      LIMIT ?
    `).all(...normalizedStatuses, normalizeLimit(limit)) as ConciergeEscalationRequestRow[];
  }

  update(input: UpdateConciergeEscalationRequestInput): ConciergeEscalationRequestRow | undefined {
    const existing = this.getById(input.requestId);
    if (!existing) return undefined;

    const sets: string[] = ["updated_at = ?"];
    const values: unknown[] = [new Date().toISOString()];

    if (input.status) {
      sets.push("status = ?");
      values.push(input.status);
    }
    if (input.deliveryChannel) {
      sets.push("delivery_channel = ?");
      values.push(input.deliveryChannel);
    }
    if (input.deepLink !== undefined) {
      sets.push("deep_link = ?");
      values.push(input.deepLink);
    }
    if (input.responseJson !== undefined) {
      sets.push("response_json = ?");
      values.push(input.responseJson);
    }
    if (input.expiresAt !== undefined) {
      sets.push("expires_at = ?");
      values.push(input.expiresAt);
    }
    if (input.notifiedAt !== undefined) {
      sets.push("notified_at = ?");
      values.push(input.notifiedAt);
    }
    if (input.actionedAt !== undefined) {
      sets.push("actioned_at = ?");
      values.push(input.actionedAt);
    }
    if (input.cancelledAt !== undefined) {
      sets.push("cancelled_at = ?");
      values.push(input.cancelledAt);
    }
    if (input.escalatedToCallAt !== undefined) {
      sets.push("escalated_to_call_at = ?");
      values.push(input.escalatedToCallAt);
    }

    values.push(input.requestId);
    this.db.query(`
      UPDATE concierge_escalation_requests
      SET ${sets.join(", ")}
      WHERE request_id = ?
    `).run(...(values as [string, ...Array<string | number | null>]));

    return this.getById(input.requestId);
  }
}

function normalizeAllowedResponses(
  value: ConciergeEscalationAllowedResponse[],
): ConciergeEscalationAllowedResponse[] {
  return Array.from(new Set(value));
}

function normalizeTimeoutSeconds(value: number): number {
  if (!Number.isFinite(value)) return 300;
  return Math.max(1, Math.floor(value));
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(1000, Math.floor(value)));
}
