import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";

export const BUILTIN_MCP_ADMIN_ENDPOINT_PATH = "/mcp/spaces-admin";

export const BUILTIN_MCP_ADMIN_TOOL_NAMES = [
  "spaces.admin.list_spaces",
  "spaces.admin.create_space",
  "spaces.admin.list_skills",
  "spaces.admin.create_skill",
  "spaces.admin.handoff_space",
] as const;

export type BuiltinMcpAdminToolName = typeof BUILTIN_MCP_ADMIN_TOOL_NAMES[number];
export type BuiltinMcpAdminAuthMode = "strict" | "compat" | "unavailable";

export interface BuiltinMcpAdminPolicy {
  enabled: boolean;
  allowTargetSpaceOverride: boolean;
  allowedTools: BuiltinMcpAdminToolName[];
}

export interface ResolveBuiltinMcpAdminPolicyInput {
  globalFlags?: Record<string, unknown> | null | undefined;
  bootstrapDefaultEnabled: boolean;
}

export interface BuiltinMcpAdminRuntimeMetadata {
  endpointPath: string;
  effectiveEnabled: boolean;
  bootstrapDefaultEnabled: boolean;
  authMode: BuiltinMcpAdminAuthMode;
  tokenIssuerAvailable: boolean;
  defaultTargetSpaceId: string;
}

export function resolveBuiltinMcpAdminPolicy(
  input: ResolveBuiltinMcpAdminPolicyInput,
): BuiltinMcpAdminPolicy {
  const stored = readStoredBuiltinMcpAdminPolicy(input.globalFlags);
  const defaultToolSet = [...BUILTIN_MCP_ADMIN_TOOL_NAMES];

  if (!stored) {
    return {
      enabled: input.bootstrapDefaultEnabled,
      allowTargetSpaceOverride: input.bootstrapDefaultEnabled,
      allowedTools: defaultToolSet,
    };
  }

  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : false,
    allowTargetSpaceOverride: typeof stored.allowTargetSpaceOverride === "boolean"
      ? stored.allowTargetSpaceOverride
      : false,
    allowedTools: parseBuiltinMcpAdminToolNames(stored.allowedTools),
  };
}

export function buildBuiltinMcpAdminRuntimeMetadata(input: {
  globalFlags?: Record<string, unknown> | null | undefined;
  bootstrapDefaultEnabled: boolean;
  gatewayProfile: GatewayCoreProfileId;
  strictHttpPrincipalAuth: boolean;
  tokenIssuerAvailable: boolean;
  defaultTargetSpaceId: string;
}): BuiltinMcpAdminRuntimeMetadata {
  const policy = resolveBuiltinMcpAdminPolicy({
    globalFlags: input.globalFlags,
    bootstrapDefaultEnabled: input.bootstrapDefaultEnabled,
  });
  return {
    endpointPath: BUILTIN_MCP_ADMIN_ENDPOINT_PATH,
    effectiveEnabled: policy.enabled,
    bootstrapDefaultEnabled: input.bootstrapDefaultEnabled,
    authMode: resolveBuiltinMcpAdminAuthMode({
      gatewayProfile: input.gatewayProfile,
      strictHttpPrincipalAuth: input.strictHttpPrincipalAuth,
      tokenIssuerAvailable: input.tokenIssuerAvailable,
    }),
    tokenIssuerAvailable: input.tokenIssuerAvailable,
    defaultTargetSpaceId: input.defaultTargetSpaceId,
  };
}

export function isBuiltinMcpAdminToolName(value: unknown): value is BuiltinMcpAdminToolName {
  return typeof value === "string" && BUILTIN_MCP_ADMIN_TOOL_NAMES.includes(
    value as BuiltinMcpAdminToolName,
  );
}

function readStoredBuiltinMcpAdminPolicy(
  globalFlags: Record<string, unknown> | null | undefined,
): Partial<BuiltinMcpAdminPolicy> | null {
  const raw = globalFlags?.mcpAdmin;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as Partial<BuiltinMcpAdminPolicy>;
}

function parseBuiltinMcpAdminToolNames(value: unknown): BuiltinMcpAdminToolName[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<BuiltinMcpAdminToolName>();
  for (const entry of value) {
    if (isBuiltinMcpAdminToolName(entry)) {
      allowed.add(entry);
    }
  }
  return [...allowed];
}

function resolveBuiltinMcpAdminAuthMode(input: {
  gatewayProfile: GatewayCoreProfileId;
  strictHttpPrincipalAuth: boolean;
  tokenIssuerAvailable: boolean;
}): BuiltinMcpAdminAuthMode {
  if (input.strictHttpPrincipalAuth) {
    return "strict";
  }
  if (input.gatewayProfile === "external" || input.tokenIssuerAvailable) {
    return "compat";
  }
  return "unavailable";
}
