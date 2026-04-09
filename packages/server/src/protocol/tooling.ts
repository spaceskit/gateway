export type GatewayToolDangerLevelPayload = "standard" | "destructive";
export type GatewayToolHealthStatusPayload = "unknown" | "ok" | "degraded";
export type GatewayToolApprovalGrantModePayload = "once" | "time_window" | "durable";
export type GatewayToolCwdModePayload = "space_root" | "fixed";
export type GatewayToolOutputModePayload = "text" | "json";

export interface GatewayToolExamplePayload {
  name: string;
  description?: string;
  arguments: Record<string, unknown>;
  expectedOutput?: string;
}

export interface GatewayToolPayload {
  schemaVersion: number;
  id: string;
  providerId: string;
  displayName: string;
  description: string;
  bundleId?: string;
  bundleDisplayName?: string;
  bundleDescription?: string;
  toolGroupId?: string;
  toolGroupDisplayName?: string;
  executable: string;
  resolvedExecutable: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  instructions?: string;
  examples: GatewayToolExamplePayload[];
  timeoutMs: number;
  maxOutputBytes: number;
  cwdMode: GatewayToolCwdModePayload;
  fixedCwd?: string;
  outputMode: GatewayToolOutputModePayload;
  dangerLevel: GatewayToolDangerLevelPayload;
  enabled: boolean;
  available: boolean;
  healthStatus: GatewayToolHealthStatusPayload;
  healthMessage?: string;
  manifestPath: string;
  readmePath?: string;
  readmeContent?: string;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayToolApprovalGrantPayload {
  principalId: string;
  deviceId: string;
  spaceId: string;
  toolId: string;
  mode: GatewayToolApprovalGrantModePayload;
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  updatedAt: string;
}

export interface GatewayListToolsPayload {
  apiVersion?: string;
}

export interface GatewayGetToolPayload {
  apiVersion?: string;
  toolId: string;
}

export interface GatewayScaffoldToolPayload {
  apiVersion?: string;
  id: string;
  displayName: string;
  description: string;
  outputMode: GatewayToolOutputModePayload;
}

export interface GatewayRegisterToolPayload {
  apiVersion?: string;
  schemaVersion?: number;
  id: string;
  displayName: string;
  description: string;
  bundleId?: string;
  bundleDisplayName?: string;
  bundleDescription?: string;
  toolGroupId?: string;
  toolGroupDisplayName?: string;
  executable: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  instructions?: string;
  examples?: GatewayToolExamplePayload[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwdMode: GatewayToolCwdModePayload;
  fixedCwd?: string;
  outputMode: GatewayToolOutputModePayload;
  dangerLevel?: GatewayToolDangerLevelPayload;
  readme?: string;
  enabled?: boolean;
}

export interface GatewayRemoveToolPayload {
  apiVersion?: string;
  toolId: string;
}

export interface GatewaySetToolEnabledPayload {
  apiVersion?: string;
  toolId: string;
  enabled: boolean;
}

export interface GatewayListToolApprovalGrantsPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId?: string;
  spaceId?: string;
  toolId?: string;
  includeRevoked?: boolean;
  includeExpired?: boolean;
}

export interface GatewayRevokeToolApprovalGrantPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId?: string;
  spaceId: string;
  toolId: string;
  reason?: string;
}

export interface GatewayListToolsResponsePayload {
  tools: GatewayToolPayload[];
}

export interface GatewayGetToolResponsePayload {
  tool: GatewayToolPayload | null;
}

export interface GatewayScaffoldToolResponsePayload {
  manifest: GatewayRegisterToolPayload;
  readme: string;
}

export interface GatewayRegisterToolResponsePayload {
  tool: GatewayToolPayload;
}

export interface GatewayRemoveToolResponsePayload {
  toolId: string;
  removed: boolean;
}

export interface GatewaySetToolEnabledResponsePayload {
  tools: GatewayToolPayload[];
}

export interface GatewayListToolApprovalGrantsResponsePayload {
  grants: GatewayToolApprovalGrantPayload[];
}

export interface GatewayRevokeToolApprovalGrantResponsePayload {
  revoked: boolean;
  toolId: string;
  spaceId: string;
  grant?: GatewayToolApprovalGrantPayload;
}
