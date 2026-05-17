import { spawnSync } from "node:child_process";
import type { ProviderTelemetryWindowPayload } from "@spaceskit/server";
import {
  extractClaudeOAuthAccessToken,
  mapClaudeOAuthUsageWindows,
} from "../gateway-admin-telemetry-normalizers.js";

const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
const CLAUDE_OAUTH_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_OAUTH_TIMEOUT_MS = 10_000;

export interface ClaudeOAuthAccessTokenResult {
  accessToken?: string;
  source?: "keychain";
  message?: string;
}

export interface ClaudeOAuthUsageResult {
  windows: ProviderTelemetryWindowPayload[];
  accountLabel?: string;
  message?: string;
}

export function readClaudeOAuthAccessTokenFromKeychain(): ClaudeOAuthAccessTokenResult {
  if (process.platform !== "darwin") {
    return {};
  }
  const user = process.env.USER?.trim();
  if (!user) {
    return {};
  }

  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", CLAUDE_OAUTH_KEYCHAIN_SERVICE, "-a", user, "-w"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    },
  );
  if (result.status !== 0 || !result.stdout?.trim()) {
    return {};
  }

  const accessToken = extractClaudeOAuthAccessToken(result.stdout);
  return accessToken
    ? { accessToken, source: "keychain" }
    : {};
}

export async function fetchClaudeOAuthUsage(accessToken: string): Promise<ClaudeOAuthUsageResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_OAUTH_TIMEOUT_MS);
  try {
    const response = await fetch(CLAUDE_OAUTH_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Claude OAuth usage endpoint returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const windows = mapClaudeOAuthUsageWindows(payload);
    return {
      windows,
      message: windows.length > 0
        ? "Claude OAuth quota windows loaded from provider usage endpoint."
        : "Claude OAuth usage endpoint returned no quota windows.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
