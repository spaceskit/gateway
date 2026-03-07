import type { CapabilityGrantInput, CapabilityLevel, CapabilityRequest } from "./types.js";

const WRITE_OPERATION_HINTS = [
  "add",
  "apply",
  "archive",
  "create",
  "delete",
  "edit",
  "insert",
  "patch",
  "post",
  "put",
  "remove",
  "revoke",
  "save",
  "send",
  "set",
  "share",
  "update",
  "upsert",
  "write",
];

const EXECUTE_OPERATION_HINTS = [
  "auth",
  "call",
  "connect",
  "control",
  "execute",
  "invoke",
  "pair",
  "run",
  "start",
  "stop",
  "stream",
  "trigger",
];

const CAPABILITY_DOMAIN_ALIASES: Record<string, string> = {
  message: "messaging",
  messages: "messaging",
};

/**
 * Convert capability + operation into a canonical request used by the
 * gateway-core default-deny evaluator.
 */
export function capabilityRequestFromInvocation(
  capability: string,
  operation: string,
): CapabilityRequest {
  const normalizedCapability = normalizeCapabilityDomain(capability);
  const level = normalizedCapability === "mcp"
    ? "execute"
    : inferCapabilityLevel(operation);
  return {
    capabilityId: `${normalizedCapability}.${level}`,
    level,
  };
}

/**
 * Parse capability grant IDs from configuration.
 *
 * Supported grant suffixes:
 * - .read
 * - .write
 * - .execute
 */
export function capabilityGrantsFromIds(
  grantIds: string[],
  grantedBy = "config",
): { grants: CapabilityGrantInput[]; invalid: string[] } {
  const grants: CapabilityGrantInput[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const rawId of grantIds) {
    const normalized = normalizeGrantId(rawId);
    if (!normalized) continue;

    const level = grantLevelFromId(normalized);
    if (!level) {
      invalid.push(rawId);
      continue;
    }

    const key = `${normalized}:${level}`;
    if (seen.has(key)) continue;
    seen.add(key);

    grants.push({
      capabilityId: normalized,
      level,
      grantedBy,
      reason: "Granted via startup configuration.",
    });
  }

  return { grants, invalid };
}

function inferCapabilityLevel(operation: string): Exclude<CapabilityLevel, "none"> {
  const normalized = operation.trim().toLowerCase();
  if (!normalized) return "read";

  if (matchesOperationHint(normalized, WRITE_OPERATION_HINTS)) {
    return "write";
  }

  if (matchesOperationHint(normalized, EXECUTE_OPERATION_HINTS)) {
    return "execute";
  }

  return "read";
}

function normalizeCapabilityDomain(capability: string): string {
  const normalized = capability.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  return CAPABILITY_DOMAIN_ALIASES[normalized] ?? normalized;
}

function normalizeGrantId(grantId: string): string {
  const trimmed = grantId.trim().toLowerCase();
  if (!trimmed) return "";

  const normalized = trimmed;

  const split = normalized.lastIndexOf(".");
  if (split <= 0 || split === normalized.length - 1) {
    return normalized;
  }

  const domain = normalizeCapabilityDomain(normalized.slice(0, split));
  const suffix = normalized.slice(split);
  return `${domain}${suffix}`;
}

function grantLevelFromId(capabilityId: string): Exclude<CapabilityLevel, "none"> | null {
  if (capabilityId.endsWith(".read")) return "read";
  if (capabilityId.endsWith(".write")) return "write";
  if (capabilityId.endsWith(".execute")) return "execute";
  return null;
}

function matchesOperationHint(operation: string, hints: string[]): boolean {
  return hints.some((hint) =>
    operation === hint || operation.startsWith(`${hint}_`) || operation.startsWith(`${hint}.`),
  );
}
