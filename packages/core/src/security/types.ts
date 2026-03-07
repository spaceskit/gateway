/**
 * Security model for Spaceskit.
 *
 * Security is the enforcement mechanism for the manifesto's principle:
 * "the human stays in the loop as coordinator." Agents operate within
 * explicit permission fences. The default is restrictive. Loosening
 * requires deliberate human action.
 */

export type SecurityVerdict = "allow" | "deny" | "ask_human" | "log_only";

export type TrustLevel = "untrusted" | "agent" | "reviewed" | "system";

/**
 * Per-agent security scope — defines what an agent can and cannot do.
 * Assigned when an agent joins a space. The space ceiling is the
 * most restrictive combination of all agent scopes.
 */
export interface AgentSecurityScope {
  agentId: string;
  permissionMode: "sandbox" | "full_access" | "developer";

  /** Explicit capability allowlist. Empty = all approved capabilities. */
  allowedCapabilities: string[];

  /** Filesystem scope: "" = no access, "/" = full, "/path" = scoped. */
  filesystemScope: string;
  /** Optional multi-scope expansion (e.g. space-assigned folders). */
  filesystemScopes?: string[];
  allowNetwork: boolean;
  allowShell: boolean;
  commandAllowlist: string[];

  /** Max tokens this agent can consume per turn. */
  maxTokensPerTurn: number;
  /** Max tool calls per turn (prevents runaway loops). */
  maxToolCallsPerTurn: number;

  /**
   * Whether this agent's outputs require human review before
   * being passed to capabilities or other agents.
   */
  requireOutputReview: boolean;
}

/**
 * Security policy applied at the space or system level.
 */
export interface SecurityPolicy {
  policyId: string;
  defaultPermissionMode: "sandbox" | "full_access" | "developer";
  outOfScopeVerdict: SecurityVerdict;

  /** If true, the gateway runs a policy check on agent output before it reaches any tool. */
  inspectAgentOutput: boolean;
  /** Maximum inter-agent call depth (prevents infinite delegation). */
  maxCallDepth: number;
  /** Whether cross-space artifact access requires human approval. */
  crossSpaceRequiresApproval: boolean;
  /** If true, all capability invocations are logged. */
  auditCapabilityInvocations: boolean;
  redactionMode: string;

  updatedAt: Date;
}

/**
 * Provenance of an artifact — tracks origin and review status.
 * Used to enforce trust boundaries between spaces.
 */
export interface ArtifactProvenance {
  artifactId: string;
  trustLevel: TrustLevel;
  sourceSpaceId: string;
  sourceAgentId: string;
  sourceResourceId: string;
  humanReviewed: boolean;
  reviewedBy?: string;
  reviewedAt?: Date;
}

/** Default security policy — restrictive by default. */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  policyId: "default",
  defaultPermissionMode: "sandbox",
  outOfScopeVerdict: "deny",
  inspectAgentOutput: true,
  maxCallDepth: 5,
  crossSpaceRequiresApproval: true,
  auditCapabilityInvocations: true,
  redactionMode: "STANDARD",
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Secrets detection — built-in security capability
// ---------------------------------------------------------------------------

export type SecretType =
  | "api_key"
  | "token"
  | "password"
  | "private_key"
  | "connection_string"
  | "certificate"
  | "unknown";

/** A detected secret in agent output or tool results. */
export interface DetectedSecret {
  /** Type of secret detected. */
  type: SecretType;
  /** Where it was found (e.g., "tool_result", "agent_output", "capability_args"). */
  source: string;
  /** Character offset in the source content. */
  offset: number;
  /** Length of the detected secret. */
  length: number;
  /** Confidence: 0.0 = heuristic guess, 1.0 = definite pattern match. */
  confidence: number;
  /** Whether the secret was redacted from the output. */
  redacted: boolean;
}

/** Result of a secrets scan on content. */
export interface SecretsScanResult {
  /** Whether any secrets were found. */
  hasSecrets: boolean;
  /** Detected secrets (positions are in redacted content if redaction was applied). */
  secrets: DetectedSecret[];
  /** The content with secrets redacted (if redaction was requested). */
  redactedContent?: string;
}

/** Configuration for the secrets detection engine. */
export interface SecretsDetectionConfig {
  /** Whether to scan agent output before it reaches tools/capabilities. */
  scanAgentOutput: boolean;
  /** Whether to scan tool results before they reach the agent. */
  scanToolResults: boolean;
  /** Whether to automatically redact detected secrets. */
  autoRedact: boolean;
  /** Minimum confidence threshold for detection (0.0 - 1.0). */
  confidenceThreshold: number;
  /** Custom patterns to detect (regex strings). */
  customPatterns: Array<{ name: string; pattern: string; type: SecretType }>;
}

export const DEFAULT_SECRETS_DETECTION_CONFIG: SecretsDetectionConfig = {
  scanAgentOutput: true,
  scanToolResults: true,
  autoRedact: true,
  confidenceThreshold: 0.7,
  customPatterns: [],
};

/** Default agent scope — sandbox with no shell/network. */
export const DEFAULT_AGENT_SCOPE: Omit<AgentSecurityScope, "agentId"> = {
  permissionMode: "sandbox",
  allowedCapabilities: [],
  filesystemScope: "",
  allowNetwork: false,
  allowShell: false,
  commandAllowlist: [],
  maxTokensPerTurn: 16384,
  maxToolCallsPerTurn: 20,
  requireOutputReview: false,
};
