/**
 * Capability system types.
 *
 * A capability is an abstract description of what the system can do
 * (lists, calendar, speech, files, etc.). A provider implements one or
 * more capabilities. Multiple providers can serve the same capability.
 *
 * Example: "lists" capability has providers "Apple Reminders" (via native
 * adapter) and "Google Tasks" (via TypeScript connector). Both registered
 * simultaneously. The routing layer decides which handles each call.
 */

import { z } from "zod";

/** All supported capability types. */
export type CapabilityType =
  | "lists"
  | "calendar"
  | "notes"
  | "contacts"
  | "messaging"
  | "speech"
  | "notifications"
  | "files"
  | "clipboard"
  | "shell"
  | "shortcuts"
  | "browser"
  | "media"
  | "health"
  | "mcp"       // MCP server bridge (isolated @ai-sdk/mcp client)
  | "secrets";  // Secrets detection and management

export const CAPABILITY_TYPES = [
  "lists",
  "calendar",
  "notes",
  "contacts",
  "messaging",
  "speech",
  "notifications",
  "files",
  "clipboard",
  "shell",
  "shortcuts",
  "browser",
  "media",
  "health",
  "mcp",
  "secrets",
] as const satisfies readonly CapabilityType[];

const CAPABILITY_TYPE_SET = new Set<string>(CAPABILITY_TYPES);

export function isCapabilityType(value: string): value is CapabilityType {
  return CAPABILITY_TYPE_SET.has(value);
}

/** Where a provider runs. */
export type ProviderSource =
  | "adapter"     // Native OS adapter (Swift, C#, etc.)
  | "connector"   // TypeScript plugin in the gateway process
  | "builtin";    // Gateway-internal (e.g., local file-based lists)

// ---------------------------------------------------------------------------
// 3-tier connector control-plane model
// ---------------------------------------------------------------------------

export type ConnectorFamilyId = string;
export type ConnectorInstanceId = string;

export type ConnectorKind = "channel" | "capability" | "hybrid";
export type ConnectorRuntime = ProviderSource;
export type ConnectorTrustClass = "embedded_safe" | "external_only";
export type ConnectorInstanceStatus = "active" | "paused" | "error";

export type ConnectorBindingType =
  | "inbound_route"
  | "outbound_action"
  | "capability_export";

export type ConnectorBindingTarget = "main_orchestrator" | "space_orchestrator";

export type ConnectorAction =
  | "notify"
  | "send_message"
  | "send_media"
  | "send_reaction";

export interface ConnectorFamily {
  id: ConnectorFamilyId;
  name: string;
  kind: ConnectorKind;
  runtime: ConnectorRuntime;
  trustClass: ConnectorTrustClass;
  embeddedEnabled: boolean;
  capabilityTypes: CapabilityType[];
  features: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorInstance {
  id: ConnectorInstanceId;
  familyId: ConnectorFamilyId;
  displayName: string;
  accountFingerprintHash: string;
  labelSlug: string;
  status: ConnectorInstanceStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorBinding {
  id: string;
  connectorId: ConnectorInstanceId;
  bindingType: ConnectorBindingType;
  selector: Record<string, unknown>;
  target: ConnectorBindingTarget;
  targetSpaceId?: string;
  allowedActions: ConnectorAction[];
  capabilityTypes: CapabilityType[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorPolicy {
  scopeType: "global" | "family" | "instance";
  scopeId: string;
  requestsPerMinute: number;
  burst: number;
  disabled: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface CapabilityOperationMetadata {
  /** Operation requires shell execution privileges. */
  requiresShell?: boolean;
  /** Operation performs outbound network I/O. */
  requiresNetwork?: boolean;
  /** Operation mutates filesystem state. */
  filesystemWrite?: boolean;
  /** Declared filesystem path arguments used by this operation. */
  pathArgs?: string[];
  /** Declared command argument keys used by shell operations. */
  commandArgs?: string[];
}

/** A registered capability provider. */
export interface CapabilityProvider {
  /** Unique provider ID (e.g., "apple-reminders", "google-tasks"). */
  id: string;
  /** Human-readable name (e.g., "Apple Reminders"). */
  name: string;
  /** Where this provider runs. */
  source: ProviderSource;
  /** Which capability type this provider serves. */
  capabilityType: CapabilityType;
  /** Which operations this provider supports (subset of the capability's operations). */
  operations: string[];
  /** Optional per-operation enforcement metadata. */
  operationMetadata?: Record<string, CapabilityOperationMetadata>;
  /** Is this provider currently available? */
  available: boolean;
  /** When this provider was last seen healthy. */
  lastHealthCheck?: Date;
}

/** A request to invoke a capability operation. */
export interface CapabilityInvocation {
  /** The capability type (e.g., "lists"). */
  capability: CapabilityType;
  /** The operation to perform (e.g., "getItems"). */
  operation: string;
  /** Typed arguments for the operation. */
  args: Record<string, unknown>;
  /** Target a specific provider (e.g., "apple-reminders"). If omitted, uses routing. */
  targetProvider?: string;
  /** Should this fan out to all providers and merge results? */
  aggregate?: boolean;
}

/** Result from a capability invocation. */
export interface CapabilityResult {
  /** Which provider handled this invocation. */
  providerId: string;
  /** The operation result data. */
  data: unknown;
  /** How long the invocation took. */
  durationMs: number;
}

/** Result from an aggregated invocation across multiple providers. */
export interface AggregatedCapabilityResult {
  results: CapabilityResult[];
  errors: Array<{ providerId: string; error: string }>;
}

/**
 * Routing preferences for capability resolution.
 * Can be set at system-wide, space-level, or per-invocation level.
 */
export interface CapabilityRoutingPreferences {
  /** Default provider per capability type. */
  defaults: Partial<Record<CapabilityType, string>>;
  /** Space-level overrides (space ID -> capability type -> provider ID). */
  spaceOverrides: Record<string, Partial<Record<CapabilityType, string>>>;
}
