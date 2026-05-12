import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService telemetry", () => {
  test("returns telemetry for configured runtimes using usage snapshot fallback", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });
      ctx.admin.setUsageSnapshotService({
        getSnapshot: () => ({
          computedAt: new Date().toISOString(),
          currency: "USD",
          windows: {
            last5h: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last7d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last30d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            lifetime: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
          },
          budget: {
            softCapUsd: 20,
            hardCapUsd: 50,
            warningThreshold: 0.8,
            spentUsd: 0,
            leftUsd: 50,
          },
          providerUsage: [
            {
              providerId: "openai",
              status: "available",
              inputTokens: 11,
              outputTokens: 7,
              totalTokens: 18,
              spentUsd: 0.12,
            },
          ],
        }),
      } as any);

      const telemetry = await ctx.admin.getProviderTelemetry();
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("openai");
      expect(telemetry[0].source).toBe("usage_snapshot");
      expect(telemetry[0].usage?.totalTokens).toBe(18);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("builds local usage fallback without calling provider telemetry recursively", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });
      ctx.admin.setUsageSnapshotService({
        getSnapshot: () => ({
          computedAt: new Date().toISOString(),
          currency: "USD",
          windows: {
            last5h: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last7d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last30d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            lifetime: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
          },
          budget: {
            softCapUsd: 20,
            hardCapUsd: 50,
            warningThreshold: 0.8,
            spentUsd: 0,
            leftUsd: 50,
          },
          providerUsage: [
            {
              providerId: "openai",
              status: "available",
              inputTokens: 11,
              outputTokens: 7,
              totalTokens: 18,
              spentUsd: 0.12,
            },
          ],
        }),
      } as any);

      (ctx.admin as any).getProviderTelemetry = async () => {
        throw new Error("getProviderTelemetry should not be called");
      };

      const telemetry = await ctx.admin.getLocalUsageTelemetry({ providerId: "openai" });
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("openai");
      expect(telemetry[0].status).toBe("available");
      expect(telemetry[0].summary.totalTokens).toBe(0);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("passes requested providerIds batch to local provider telemetry service", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });
      ctx.admin.setProviderConfig({
        providerId: "openrouter",
        model: "openrouter/anthropic/claude-sonnet-4",
        apiKey: "sk-openrouter-test",
      });
      ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "anthropic/claude-sonnet-4",
        apiKey: "sk-anthropic-test",
      });

      let received: any = null;
      ctx.admin.setLocalUsageTelemetryService({
        getTelemetry: async (input: any) => {
          received = input;
          return [];
        },
      } as any);

      const telemetry = await ctx.admin.getLocalUsageTelemetry({
        providerIds: ["openrouter", "openai", "openrouter"],
      });

      expect(telemetry).toEqual([]);
      expect(received.providerIds).toEqual(["openrouter", "openai"]);
      expect(received.fallbackTelemetry.map((entry: any) => entry.providerId)).toEqual(["openrouter", "openai"]);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("returns Claude quota windows from OAuth usage probe", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "claude",
        model: "claude/sonnet",
      });
      ctx.admin.setUsageSnapshotService({
        getSnapshot: () => ({
          computedAt: new Date().toISOString(),
          currency: "USD",
          windows: {
            last5h: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last7d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last30d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            lifetime: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
          },
          budget: {
            softCapUsd: 20,
            hardCapUsd: 50,
            warningThreshold: 0.8,
            spentUsd: 0,
            leftUsd: 50,
          },
          providerUsage: [
            {
              providerId: "claude",
              status: "available",
              inputTokens: 17,
              outputTokens: 9,
              totalTokens: 26,
              spentUsd: 0,
            },
          ],
        }),
      } as any);

      (ctx.admin as any).findExecutable = () => "/usr/local/bin/claude";
      (ctx.admin as any).readClaudeOAuthAccessToken = async () => ({
        accessToken: "oauth-token",
        source: "keychain",
      });
      (ctx.admin as any).fetchClaudeOAuthUsage = async (accessToken: string) => {
        expect(accessToken).toBe("oauth-token");
        return {
          windows: [
            {
              scopeId: "claude",
              scopeName: "Claude",
              window: "primary",
              usedPercent: 25,
              remainingPercent: 75,
              resetsAt: "2026-02-28T13:00:00.000Z",
              windowDurationMins: 300,
            },
            {
              scopeId: "claude",
              scopeName: "Claude",
              window: "secondary",
              usedPercent: 10,
              remainingPercent: 90,
              resetsAt: "2026-03-06T08:00:00.000Z",
              windowDurationMins: 10080,
            },
          ],
        };
      };

      const telemetry = await ctx.admin.getProviderTelemetry({ providerId: "claude" });
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("claude");
      expect(telemetry[0].source).toBe("claude_cli");
      expect(telemetry[0].status).toBe("available");
      expect(telemetry[0].windows.map((entry) => entry.window)).toEqual(["primary", "secondary"]);
      expect(telemetry[0].windows[0].usedPercent).toBe(25);
      expect(telemetry[0].windows[1].windowDurationMins).toBe(10080);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("does not use Anthropic API keys for Claude quota windows", async () => {
    const ctx = createContext();
    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-api-key";
      ctx.admin.setProviderConfig({
        providerId: "claude",
        model: "claude/sonnet",
      });
      (ctx.admin as any).findExecutable = () => "/usr/local/bin/claude";
      (ctx.admin as any).readClaudeOAuthAccessToken = async () => ({
        message: "No Claude OAuth token found.",
      });
      (ctx.admin as any).fetchClaudeOAuthUsage = async () => {
        throw new Error("Claude OAuth fetch should not run without an OAuth token");
      };

      const telemetry = await ctx.admin.getProviderTelemetry({ providerId: "claude" });
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("claude");
      expect(telemetry[0].source).toBe("claude_cli");
      expect(telemetry[0].windows).toEqual([]);
      expect(telemetry[0].message).toContain("OAuth");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("prefers Claude OAuth Keychain credentials before legacy credentials file", async () => {
    const ctx = createContext();
    try {
      (ctx.admin as any).readClaudeOAuthAccessTokenFromKeychain = () => ({
        accessToken: "keychain-token",
        source: "keychain",
      });
      (ctx.admin as any).readClaudeOAuthAccessTokenFromCredentialsFile = () => ({
        accessToken: "file-token",
        source: "credentials_file",
      });

      const credentials = await (ctx.admin as any).readClaudeOAuthAccessToken();
      expect(credentials).toEqual({
        accessToken: "keychain-token",
        source: "keychain",
      });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("falls back to Claude legacy credentials file when Keychain has no OAuth token", async () => {
    const ctx = createContext();
    try {
      (ctx.admin as any).readClaudeOAuthAccessTokenFromKeychain = () => ({});
      (ctx.admin as any).readClaudeOAuthAccessTokenFromCredentialsFile = () => ({
        accessToken: "file-token",
        source: "credentials_file",
      });

      const credentials = await (ctx.admin as any).readClaudeOAuthAccessToken();
      expect(credentials).toEqual({
        accessToken: "file-token",
        source: "credentials_file",
      });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("no longer shells out to claude auth status during telemetry refresh", () => {
    const source = readFileSync(
      new URL("../src/gateway-admin-service.ts", import.meta.url),
      "utf8",
    );
    expect(source.includes("auth\", \"status\", \"--json")).toBe(false);
  });

  test("returns codex telemetry windows from app-server probe", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "codex",
        model: "codex/gpt-5.1-codex",
      });

      (ctx.admin as any).findExecutable = () => "/usr/local/bin/codex";
      (ctx.admin as any).queryCodexAppServer = async () => ({
        account: {
          account: {
            email: "developer@example.com",
            planType: "pro",
          },
        },
        rateLimits: {
          rateLimitsByLimitId: {
            codex: {
              limitId: "codex",
              limitName: "Codex",
              primary: {
                usedPercent: 40,
                windowDurationMins: 300,
                resetsAt: 1_772_121_024,
              },
              secondary: {
                usedPercent: 20,
                windowDurationMins: 10_080,
                resetsAt: 1_772_482_026,
              },
            },
          },
        },
      });

      const telemetry = await ctx.admin.getProviderTelemetry({ providerId: "codex" });
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("codex");
      expect(telemetry[0].source).toBe("codex_app_server");
      expect(telemetry[0].windows.length).toBe(2);
      expect(telemetry[0].windows[0].window).toBe("primary");
      expect(telemetry[0].windows[1].window).toBe("secondary");
      expect(telemetry[0].accountLabel).toContain("pro");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("rejects telemetry requests for unknown configured runtimes", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
      });
      await expect(ctx.admin.getProviderTelemetry({ providerId: "codex" })).rejects.toThrow(
        "Unknown providerId",
      );
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
