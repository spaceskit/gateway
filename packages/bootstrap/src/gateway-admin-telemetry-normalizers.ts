import type {
  GatewayModelCatalogEntryPayload,
  GatewayModelProviderCatalogPayload,
  GatewayProviderAuthAccountPayload,
  GatewayProviderAuthStatusPayload,
  ProviderTelemetrySourcePayload,
  ProviderTelemetryWindowPayload,
} from "@spaceskit/server";
import type {
  ClaudeAgentSdkAuthAccount,
  ClaudeAgentSdkProbeResult,
  CodexAppServerAuthAccount,
  CodexAppServerProbeResult,
} from "@spaceskit/provider-runtime";
import {
  asNumber,
  asString,
  isObjectRecord,
  parseIsoString,
} from "./gateway-admin-value-normalizers.js";

export interface ClaudeAgentSdkCatalogProbe {
  authStatus: GatewayProviderAuthStatusPayload;
  authAccount?: GatewayProviderAuthAccountPayload;
  models: Array<{
    id: string;
    displayName: string;
    contextWindow?: number;
  }>;
  detectionError?: string;
}

export interface CodexAppServerCatalogProbe {
  authStatus: GatewayProviderAuthStatusPayload;
  authAccount?: GatewayProviderAuthAccountPayload;
  models: Array<{
    id: string;
    displayName: string;
    contextWindow?: number;
  }>;
  detectionError?: string;
}

export function extractClaudeOAuthAccessToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const token = extractClaudeOAuthAccessTokenFromRecord(parsed);
    if (token) {
      return token;
    }
  } catch {
    // Keychain output is expected to be JSON, but keep the file parser tolerant.
  }

  return undefined;
}

export function mapClaudeOAuthUsageWindows(payload: unknown): ProviderTelemetryWindowPayload[] {
  if (!isObjectRecord(payload)) {
    return [];
  }

  return [
    mapClaudeOAuthUsageWindow(payload.five_hour, "primary", 300),
    mapClaudeOAuthUsageWindow(payload.seven_day, "secondary", 10080),
  ].filter((window): window is ProviderTelemetryWindowPayload => Boolean(window));
}

export function cloneClaudeAgentSdkCatalogProbe(
  probe: ClaudeAgentSdkCatalogProbe,
): ClaudeAgentSdkCatalogProbe {
  return {
    authStatus: probe.authStatus,
    authAccount: probe.authAccount ? { ...probe.authAccount } : undefined,
    models: (probe.models ?? []).map((model) => ({ ...model })),
    detectionError: probe.detectionError,
  };
}

export function mapClaudeAgentSdkProbeResult(
  probe: ClaudeAgentSdkProbeResult,
): ClaudeAgentSdkCatalogProbe {
  return {
    authStatus: probe.authStatus,
    authAccount: mapClaudeAgentSdkAuthAccount(probe.authAccount),
    models: probe.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      contextWindow: model.contextWindow,
    })),
    detectionError: probe.detectionError,
  };
}

export function cloneCodexAppServerCatalogProbe(
  probe: CodexAppServerCatalogProbe,
): CodexAppServerCatalogProbe {
  return {
    authStatus: probe.authStatus,
    authAccount: probe.authAccount ? { ...probe.authAccount } : undefined,
    models: (probe.models ?? []).map((model) => ({ ...model })),
    detectionError: probe.detectionError,
  };
}

export function cloneGatewayModelProviderCatalog(
  catalog: GatewayModelProviderCatalogPayload,
): GatewayModelProviderCatalogPayload {
  return {
    ...catalog,
    supportedAuthModes: [...(catalog.supportedAuthModes ?? [])],
    authAccount: catalog.authAccount ? { ...catalog.authAccount } : undefined,
    models: (catalog.models ?? []).map(cloneGatewayModelCatalogEntry),
  };
}

export function mapCodexAppServerProbeResult(
  probe: CodexAppServerProbeResult,
): CodexAppServerCatalogProbe {
  return {
    authStatus: probe.authStatus,
    authAccount: mapCodexAppServerAuthAccount(probe.authAccount),
    models: probe.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      contextWindow: model.contextWindow,
    })),
    detectionError: probe.detectionError,
  };
}

export function mapFallbackTelemetrySource(source: ProviderTelemetrySourcePayload): string {
  switch (source) {
    case "codex_app_server":
      return "codex-cli";
    case "claude_cli":
      return "claude-cli";
    case "gemini_cli":
      return "gemini-cli";
    case "lmstudio_runtime":
      return "runtime";
    case "usage_snapshot":
      return "api";
    default:
      return source;
  }
}

function extractClaudeOAuthAccessTokenFromRecord(value: unknown): string | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const oauth = value.claudeAiOauth;
  if (isObjectRecord(oauth)) {
    const expiresAt = asNumber(oauth.expiresAt);
    if (expiresAt !== undefined && expiresAt < Date.now()) {
      return undefined;
    }
    const token = asString(oauth.accessToken)
      ?? asString(oauth.access_token);
    if (token) {
      return token;
    }
  }

  return asString(value.accessToken)
    ?? asString(value.access_token);
}

function mapClaudeOAuthUsageWindow(
  payload: unknown,
  window: "primary" | "secondary",
  windowDurationMins: number,
): ProviderTelemetryWindowPayload | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const usedPercentRaw = asNumber(payload.utilization);
  if (usedPercentRaw === undefined) {
    return null;
  }
  const usedPercent = Math.max(0, Math.min(100, usedPercentRaw));
  const resetsAt = parseIsoString(payload.resets_at);
  return {
    scopeId: "claude",
    scopeName: "Claude",
    window,
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    resetsAt,
    windowDurationMins,
  };
}

function cloneGatewayModelCatalogEntry(
  entry: GatewayModelCatalogEntryPayload,
): GatewayModelCatalogEntryPayload {
  return {
    ...entry,
  };
}

function mapClaudeAgentSdkAuthAccount(
  account?: ClaudeAgentSdkAuthAccount,
): GatewayProviderAuthAccountPayload | undefined {
  if (!account) {
    return undefined;
  }
  const normalized: GatewayProviderAuthAccountPayload = {
    email: account.email?.trim() || undefined,
    organization: account.organization?.trim() || undefined,
    subscriptionType: account.subscriptionType?.trim() || undefined,
    apiProvider: account.apiProvider?.trim() || undefined,
    tokenSource: account.tokenSource?.trim() || undefined,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function mapCodexAppServerAuthAccount(
  account?: CodexAppServerAuthAccount,
): GatewayProviderAuthAccountPayload | undefined {
  if (!account) {
    return undefined;
  }
  const normalized: GatewayProviderAuthAccountPayload = {
    email: account.email?.trim() || undefined,
    subscriptionType: account.subscriptionType?.trim() || undefined,
    apiProvider: account.apiProvider?.trim() || undefined,
    tokenSource: account.tokenSource?.trim() || undefined,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}
