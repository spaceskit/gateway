import type { CapabilityType } from "../capabilities/types.js";

export type ToolAccessPolicyScopeType = "gateway" | "space" | "agent_override";
export type ToolAccessRuleSelectorKind =
  | "capability"
  | "cli_bundle"
  | "connector_family"
  | "connector_instance"
  | "mcp_server"
  | "tool_operation";
export type ToolAccessRuleState = "enabled" | "disabled" | "inherit";

export interface ToolAccessRule {
  selectorKind: ToolAccessRuleSelectorKind;
  selectorId: string;
  state: ToolAccessRuleState;
}

export type DangerousCapabilityId =
  | "managed_shell"
  | "arbitrary_shell"
  | "approval_bypass"
  | "filesystem_escape";

export type GuestAccessPreset = "read_only" | "collaborator";

export interface DangerousCapabilityRule {
  capabilityId: DangerousCapabilityId;
  state: ToolAccessRuleState;
}

export interface ToolAccessPolicy {
  scopeType: ToolAccessPolicyScopeType;
  scopeId: string;
  rules: ToolAccessRule[];
  dangerousCapabilities: DangerousCapabilityRule[];
  guestAccessPreset?: GuestAccessPreset;
  policyVersion: string;
  updatedBy?: string;
  updatedAt?: string;
}

export type SafetyProfileId = "safe" | "workspace" | "operator" | "yolo";

export interface SafetyProfileDefinition {
  profileId: SafetyProfileId;
  displayName: string;
  description: string;
  rules: ToolAccessRule[];
  dangerousCapabilities: DangerousCapabilityRule[];
  updatedAt: string;
}

export interface EffectiveToolAccessOperation {
  operationId: string;
  capability: CapabilityType;
  operation: string;
  providerIds: string[];
  selectors: string[];
  allowed: boolean;
  denialReasonCode?: string;
  denialReason?: string;
  requiredDangerousCapability?: DangerousCapabilityId;
  escalationAllowed?: boolean;
}

export interface EffectiveDangerousCapability {
  capabilityId: DangerousCapabilityId;
  enabled: boolean;
  source: "profile" | "gateway_policy" | "space_policy" | "agent_override" | "grant" | "turn_access_mode" | "default";
}

export interface EffectiveToolAccess {
  spaceId: string;
  agentId?: string;
  policyVersion: string;
  safetyProfileId?: SafetyProfileId;
  operations: EffectiveToolAccessOperation[];
  dangerousCapabilities: EffectiveDangerousCapability[];
  generatedAt: string;
}

export type AccessGrantTargetKind = "dangerous_capability" | "tool_selector";
export type AccessGrantMode = "time_window" | "durable";

export interface AccessGrantTarget {
  kind: AccessGrantTargetKind;
  id: string;
}

export interface ToolAccessEvaluation {
  allowed: boolean;
  reasonCode?: string;
  reason?: string;
  requiresApproval?: boolean;
  approvalContext?: Record<string, unknown>;
}

export const DEFAULT_SAFETY_PROFILES: SafetyProfileDefinition[] = [
  {
    profileId: "safe",
    displayName: "Safe",
    description: "No managed shell, no raw shell, no approval bypass, no filesystem escape.",
    rules: [],
    dangerousCapabilities: [
      { capabilityId: "managed_shell", state: "disabled" },
      { capabilityId: "arbitrary_shell", state: "disabled" },
      { capabilityId: "approval_bypass", state: "disabled" },
      { capabilityId: "filesystem_escape", state: "disabled" },
    ],
    updatedAt: new Date("2026-03-12T00:00:00.000Z").toISOString(),
  },
  {
    profileId: "workspace",
    displayName: "Workspace",
    description: "Workspace-safe tools plus managed CLI bundles.",
    rules: [],
    dangerousCapabilities: [
      { capabilityId: "managed_shell", state: "enabled" },
      { capabilityId: "arbitrary_shell", state: "disabled" },
      { capabilityId: "approval_bypass", state: "disabled" },
      { capabilityId: "filesystem_escape", state: "disabled" },
    ],
    updatedAt: new Date("2026-03-12T00:00:00.000Z").toISOString(),
  },
  {
    profileId: "operator",
    displayName: "Operator",
    description: "Managed shell plus raw shell with approvals.",
    rules: [],
    dangerousCapabilities: [
      { capabilityId: "managed_shell", state: "enabled" },
      { capabilityId: "arbitrary_shell", state: "enabled" },
      { capabilityId: "approval_bypass", state: "disabled" },
      { capabilityId: "filesystem_escape", state: "enabled" },
    ],
    updatedAt: new Date("2026-03-12T00:00:00.000Z").toISOString(),
  },
  {
    profileId: "yolo",
    displayName: "YOLO",
    description: "All dangerous capabilities enabled, including approval bypass.",
    rules: [],
    dangerousCapabilities: [
      { capabilityId: "managed_shell", state: "enabled" },
      { capabilityId: "arbitrary_shell", state: "enabled" },
      { capabilityId: "approval_bypass", state: "enabled" },
      { capabilityId: "filesystem_escape", state: "enabled" },
    ],
    updatedAt: new Date("2026-03-12T00:00:00.000Z").toISOString(),
  },
];
