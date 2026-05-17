import type { ConnectorPolicyRepository } from "@spaceskit/persistence";
import { policyDisabled } from "./connector-admin-normalizers.js";
import type { ConnectorPolicyRecord } from "./connector-admin-service-types.js";

export interface ConnectorTokenBucket {
  tokens: number;
  lastRefillMs: number;
}

export function resolveEffectiveConnectorPolicy(
  policyRepo: ConnectorPolicyRepository,
  familyId: string,
  connectorId: string,
): ConnectorPolicyRecord {
  const global = policyRepo.get("global", "*");
  const family = policyRepo.get("family", familyId);
  const instance = policyRepo.get("instance", connectorId);

  const merged = {
    scopeType: "instance" as const,
    scopeId: connectorId,
    requestsPerMinute: global?.requests_per_minute ?? 60,
    burst: global?.burst ?? 60,
    disabled: policyDisabled(global),
    disableReason: global?.disable_reason || undefined,
    disabledUntil: global?.disabled_until || undefined,
    updatedBy: global?.updated_by ?? "system",
    updatedAt: global?.updated_at ?? new Date().toISOString(),
  };

  if (family) {
    merged.requestsPerMinute = family.requests_per_minute;
    merged.burst = family.burst;
    if (policyDisabled(family)) {
      merged.disabled = true;
      merged.disableReason = family.disable_reason || merged.disableReason;
      merged.disabledUntil = family.disabled_until || merged.disabledUntil;
    }
    merged.updatedBy = family.updated_by;
    merged.updatedAt = family.updated_at;
  }

  if (instance) {
    merged.requestsPerMinute = instance.requests_per_minute;
    merged.burst = instance.burst;
    if (policyDisabled(instance)) {
      merged.disabled = true;
      merged.disableReason = instance.disable_reason || merged.disableReason;
      merged.disabledUntil = instance.disabled_until || merged.disabledUntil;
    }
    merged.updatedBy = instance.updated_by;
    merged.updatedAt = instance.updated_at;
  }

  return merged;
}

export function consumeConnectorRateToken(
  buckets: Map<string, ConnectorTokenBucket>,
  key: string,
  requestsPerMinute: number,
  burst: number,
): boolean {
  if (requestsPerMinute <= 0 || burst <= 0) {
    return true;
  }

  const now = Date.now();
  const limit = Math.max(1, burst);
  const refillRatePerMs = requestsPerMinute / 60000;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: limit, lastRefillMs: now };
    buckets.set(key, bucket);
  }

  const elapsed = Math.max(0, now - bucket.lastRefillMs);
  bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillRatePerMs);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    return false;
  }

  bucket.tokens -= 1;
  return true;
}
