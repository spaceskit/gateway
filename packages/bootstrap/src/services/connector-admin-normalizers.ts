import { createHash } from "node:crypto";
import { isCapabilityType, type CapabilityType, type ConnectorAction } from "@spaceskit/core";
import type {
  ConnectorPolicyRow,
  ConnectorPolicyScopeType,
} from "@spaceskit/persistence";
import type {
  ConnectorBindingTarget,
  ConnectorBindingType,
  ConnectorInstanceStatus,
} from "./connector-admin-service.js";

export class ConnectorAdminError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "PERMISSION_DENIED"
    | "RATE_LIMITED";

  constructor(
    code: ConnectorAdminError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

interface ConnectorSelectorSchemaDefinition {
  allowedKeys: readonly string[];
  description: string;
}

type ConnectorBindingSelectorSchemas = Partial<Record<ConnectorBindingType, ConnectorSelectorSchemaDefinition>>;

const VALID_BINDING_TYPES = new Set<ConnectorBindingType>([
  "inbound_route",
  "outbound_action",
  "capability_export",
]);

const VALID_TARGET_TYPES = new Set<ConnectorBindingTarget>([
  "main_orchestrator",
  "space_orchestrator",
]);

export const VALID_ACTIONS = new Set<ConnectorAction>([
  "notify",
  "send_message",
  "send_media",
  "send_reaction",
]);

const DEFAULT_CONNECTOR_SELECTOR_SCHEMAS: Record<string, ConnectorBindingSelectorSchemas> = {
  "apple-calendar-eventkit": {
    inbound_route: {
      allowedKeys: ["accountId", "calendarId"],
      description: "Optional account/calendar match keys for inbound route bindings.",
    },
    outbound_action: {
      allowedKeys: ["accountId", "calendarId"],
      description: "Optional account/calendar match keys for outbound action bindings.",
    },
    capability_export: {
      allowedKeys: ["accountId", "calendarId", "capabilityType"],
      description: "Optional account/calendar capability export scope keys.",
    },
  },
  "apple-reminders-eventkit": {
    inbound_route: {
      allowedKeys: ["accountId", "listId"],
      description: "Optional account/list match keys for inbound route bindings.",
    },
    outbound_action: {
      allowedKeys: ["accountId", "listId"],
      description: "Optional account/list match keys for outbound action bindings.",
    },
    capability_export: {
      allowedKeys: ["accountId", "listId", "capabilityType"],
      description: "Optional account/list capability export scope keys.",
    },
  },
  "apple-mail-mailkit": {
    inbound_route: {
      allowedKeys: ["accountId", "mailboxId", "threadId", "messageId"],
      description: "Optional account/mailbox/thread/message match keys for inbound route bindings.",
    },
    outbound_action: {
      allowedKeys: ["accountId", "mailboxId", "threadId", "messageId"],
      description: "Optional account/mailbox/thread/message match keys for outbound action bindings.",
    },
    capability_export: {
      allowedKeys: ["accountId", "mailboxId", "threadId", "messageId", "capabilityType"],
      description: "Optional account/mailbox/thread/message capability export scope keys.",
    },
  },
  "apple-contacts-contactsframework": {
    inbound_route: {
      allowedKeys: ["accountId", "containerId"],
      description: "Optional account/container match keys for inbound route bindings.",
    },
    outbound_action: {
      allowedKeys: ["accountId", "containerId"],
      description: "Optional account/container match keys for outbound action bindings.",
    },
    capability_export: {
      allowedKeys: ["accountId", "containerId", "capabilityType"],
      description: "Optional account/container capability export scope keys.",
    },
  },
  "apple-notifications-usernotifications": {
    inbound_route: {
      allowedKeys: ["accountId", "category", "threadId"],
      description: "Optional account/category/thread match keys for inbound route bindings.",
    },
    outbound_action: {
      allowedKeys: ["accountId", "category", "threadId"],
      description: "Optional account/category/thread match keys for outbound action bindings.",
    },
    capability_export: {
      allowedKeys: ["accountId", "category", "capabilityType"],
      description: "Optional account/category capability export scope keys.",
    },
  },
  "whatsapp-cloud": {
    inbound_route: {
      allowedKeys: ["accountId", "chatId", "phoneNumberId", "waBusinessAccountId"],
      description: "Optional WhatsApp account/chat/number keys for inbound route bindings.",
    },
    outbound_action: {
      allowedKeys: ["accountId", "chatId", "phoneNumberId", "waBusinessAccountId"],
      description: "Optional WhatsApp account/chat/number keys for outbound action bindings.",
    },
    capability_export: {
      allowedKeys: ["accountId", "phoneNumberId", "capabilityType"],
      description: "Optional WhatsApp account/number capability export scope keys.",
    },
  },
  "discord-bot": {
    inbound_route: {
      allowedKeys: ["guildId", "channelId", "threadId"],
      description: "Optional guild/channel/thread keys for inbound route bindings.",
    },
    outbound_action: {
      allowedKeys: ["guildId", "channelId", "threadId"],
      description: "Optional guild/channel/thread keys for outbound action bindings.",
    },
    capability_export: {
      allowedKeys: ["guildId", "channelId", "capabilityType"],
      description: "Optional guild/channel capability export scope keys.",
    },
  },
};

export function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ConnectorAdminError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

export function normalizeConnectorId(value: string): string {
  return normalizeRequired(value, "connectorId").toLowerCase();
}

export function normalizeStatus(status: string): ConnectorInstanceStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "active" || normalized === "paused" || normalized === "error") {
    return normalized;
  }
  throw new ConnectorAdminError("INVALID_ARGUMENT", `Unsupported connector status: ${status}`);
}

export function normalizeBindingType(value: string): ConnectorBindingType {
  const normalized = value.trim().toLowerCase() as ConnectorBindingType;
  if (!VALID_BINDING_TYPES.has(normalized)) {
    throw new ConnectorAdminError("INVALID_ARGUMENT", `Unsupported bindingType: ${value}`);
  }
  return normalized;
}

export function normalizeTargetType(value: string): ConnectorBindingTarget {
  const normalized = value.trim().toLowerCase() as ConnectorBindingTarget;
  if (!VALID_TARGET_TYPES.has(normalized)) {
    throw new ConnectorAdminError("INVALID_ARGUMENT", `Unsupported targetType: ${value}`);
  }
  return normalized;
}

export function normalizeAction(value: string): ConnectorAction {
  const normalized = value.trim().toLowerCase() as ConnectorAction;
  if (!VALID_ACTIONS.has(normalized)) {
    throw new ConnectorAdminError("INVALID_ARGUMENT", `Unsupported action: ${value}`);
  }
  return normalized;
}

export function normalizeActions(values: string[]): ConnectorAction[] {
  const seen = new Set<ConnectorAction>();
  const result: ConnectorAction[] = [];
  for (const value of values) {
    const normalized = normalizeAction(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function normalizeCapabilityTypes(values: string[]): CapabilityType[] {
  const seen = new Set<CapabilityType>();
  const result: CapabilityType[] = [];
  for (const raw of values) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (!isCapabilityType(normalized)) {
      throw new ConnectorAdminError("INVALID_ARGUMENT", `Unknown capability type: ${raw}`);
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function normalizePriority(priority: number): number {
  if (!Number.isInteger(priority) || priority < 0) {
    throw new ConnectorAdminError("INVALID_ARGUMENT", "priority must be a non-negative integer");
  }
  return priority;
}

export function normalizeSelector(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new ConnectorAdminError("INVALID_ARGUMENT", "selector must be an object");
}

export function validateSelectorKeysForFamily(
  familyId: string,
  bindingType: ConnectorBindingType,
  selector: Record<string, unknown>,
): void {
  const familySchemas = DEFAULT_CONNECTOR_SELECTOR_SCHEMAS[familyId];
  if (!familySchemas) return;

  const selectorSchema = familySchemas[bindingType];
  if (!selectorSchema) return;

  const unknownKeys = Object.keys(selector)
    .filter((key) => !selectorSchema.allowedKeys.includes(key));
  if (unknownKeys.length === 0) return;

  const allowed = selectorSchema.allowedKeys.length > 0
    ? selectorSchema.allowedKeys.join(", ")
    : "(none)";

  throw new ConnectorAdminError(
    "INVALID_ARGUMENT",
    `Unsupported selector key(s) for ${familyId}/${bindingType}: ${unknownKeys.join(", ")}. Allowed keys: ${allowed}`,
  );
}

export function serializeSelectorSchemasForFamily(familyId: string): Record<string, unknown> | undefined {
  const familySchemas = DEFAULT_CONNECTOR_SELECTOR_SCHEMAS[familyId];
  if (!familySchemas) {
    return undefined;
  }

  const entries = Object.entries(familySchemas).map(([bindingType, schema]) => [
    bindingType,
    {
      allowedKeys: [...schema.allowedKeys],
      description: schema.description,
    },
  ]);

  return Object.fromEntries(entries);
}

export function normalizeScopeType(value: string): ConnectorPolicyScopeType {
  const normalized = value.trim().toLowerCase() as ConnectorPolicyScopeType;
  if (normalized === "global" || normalized === "family" || normalized === "instance") {
    return normalized;
  }
  throw new ConnectorAdminError("INVALID_ARGUMENT", `Unsupported scopeType: ${value}`);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
  }
  return value;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON.
  }
  return {};
}

export function safeParseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // Ignore invalid JSON.
  }
  return [];
}

export function selectorMatchScore(
  incoming: Record<string, unknown>,
  binding: Record<string, unknown>,
): number {
  const keys = Object.keys(binding);
  if (keys.length === 0) {
    return 0;
  }

  for (const key of keys) {
    if (!(key in incoming)) {
      return -1;
    }
    if (!deepEqual(incoming[key], binding[key])) {
      return -1;
    }
  }

  return keys.length;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aEntries = Object.entries(a as Record<string, unknown>);
    const bEntries = Object.entries(b as Record<string, unknown>);
    if (aEntries.length !== bEntries.length) return false;
    for (const [key, value] of aEntries) {
      if (!deepEqual(value, (b as Record<string, unknown>)[key])) return false;
    }
    return true;
  }
  return false;
}

export function policyDisabled(row: ConnectorPolicyRow | null): boolean {
  if (!row || row.disabled !== 1) return false;
  if (!row.disabled_until) return true;
  const until = Date.parse(row.disabled_until);
  if (Number.isNaN(until)) return true;
  return until > Date.now();
}
