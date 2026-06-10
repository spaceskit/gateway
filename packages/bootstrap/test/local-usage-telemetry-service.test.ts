import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "@spaceskit/observability";
import type { ProviderTelemetryPayload } from "@spaceskit/server";
import { CodexBarUsageAdapter } from "../src/services/codexbar-usage-adapter.js";
import { LocalUsageTelemetryService } from "../src/services/local-usage-telemetry-service.js";

const TEST_LOGGER = new Logger({
  minLevel: "error",
  module: "local-usage-telemetry-test",
});

describe("CodexBarUsageAdapter", () => {
  test("parses usage windows and credits from codexbar JSON", () => {
    const adapter = new CodexBarUsageAdapter({
      logger: TEST_LOGGER,
      enableWidgetSnapshot: false,
      runCommand: () =>
        ({
          status: 0,
          stdout: JSON.stringify([
            {
              provider: "codex",
              source: "codex-cli",
              usage: {
                primary: {
                  usedPercent: 42,
                  windowMinutes: 300,
                  resetsAt: "2026-02-28T19:00:00.000Z",
                  resetDescription: "resets in 2h",
                },
                secondary: {
                  usedPercent: 18,
                  windowMinutes: 10080,
                  resetsAt: "2026-03-03T00:00:00.000Z",
                },
                tertiary: {
                  usedPercent: 5,
                  windowMinutes: 43200,
                  resetsAt: "2026-03-28T00:00:00.000Z",
                },
              },
              credits: {
                remaining: 12.34,
              },
            },
          ]),
          stderr: "",
        }) as any,
    });

    const quota = adapter.readProviderUsage("codex", { allowCommandProbe: true });
    expect(quota.available).toBe(true);
    expect(quota.sourceLabel).toBe("codex-cli");
    expect(quota.creditsRemaining).toBe(12.34);
    expect(quota.windows.map((entry) => entry.window)).toEqual(["primary", "secondary", "tertiary"]);
    expect(quota.windows.map((entry) => entry.label)).toEqual(["session", "weekly", "tertiary"]);
  });

  test("returns install hint when codexbar binary is missing", () => {
    const adapter = new CodexBarUsageAdapter({
      logger: TEST_LOGGER,
      enableWidgetSnapshot: false,
      runCommand: () =>
        ({
          status: null,
          stdout: "",
          stderr: "",
          error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
        }) as any,
    });

    const quota = adapter.readProviderUsage("codex", { allowCommandProbe: true });
    expect(quota.available).toBe(false);
    expect(quota.installHint?.command).toBe("brew install steipete/tap/codexbar");
    expect(quota.installHint?.docsUrl).toBe("https://github.com/steipete/CodexBar");
  });

  test("retries with cli source when auto source fails", () => {
    const calls: string[] = [];
    const adapter = new CodexBarUsageAdapter({
      logger: TEST_LOGGER,
      enableWidgetSnapshot: false,
      runCommand: (_executable, args) => {
        const sourceIndex = args.indexOf("--source");
        const source = sourceIndex >= 0 ? args[sourceIndex + 1] : "unknown";
        calls.push(source);
        if (source === "auto") {
          return {
            status: 1,
            stdout: JSON.stringify([
              {
                provider: "claude",
                source: "auto",
                error: {
                  message: "Auto source unavailable.",
                },
              },
            ]),
            stderr: "",
          } as any;
        }
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              provider: "claude",
              source: "claude-cli",
              usage: {
                primary: {
                  usedPercent: 8,
                },
                secondary: {
                  usedPercent: 2,
                },
              },
            },
          ]),
          stderr: "",
        } as any;
      },
    });

    const quota = adapter.readProviderUsage("claude", { allowCommandProbe: true });
    expect(calls).toEqual(["auto", "cli"]);
    expect(quota.available).toBe(true);
    expect(quota.sourceLabel).toBe("claude-cli");
    expect(quota.windows.map((entry) => entry.window)).toEqual(["primary", "secondary"]);
  });

  test("uses structured provider error message when codexbar returns JSON errors", () => {
    const adapter = new CodexBarUsageAdapter({
      logger: TEST_LOGGER,
      enableWidgetSnapshot: false,
      runCommand: () =>
        ({
          status: 1,
          stdout: JSON.stringify([
            {
              provider: "claude",
              source: "cli",
              error: {
                code: 1,
                message: "Could not parse Claude usage: Missing Current session.",
              },
            },
          ]),
          stderr: "",
        }) as any,
    });

    const quota = adapter.readProviderUsage("claude", { allowCommandProbe: true });
    expect(quota.available).toBe(false);
    expect(quota.message).toContain("Missing Current session");
  });

  test("parses matching provider payload from multiline codexbar output", () => {
    const adapter = new CodexBarUsageAdapter({
      logger: TEST_LOGGER,
      enableWidgetSnapshot: false,
      runCommand: () =>
        ({
          status: 1,
          stdout: [
            '{"file":"CodexBarCore/CodexBarLog.swift","level":"error","message":"Could not extract OAuth credentials from Gemini CLI"}',
            '[{"provider":"gemini","source":"auto","error":{"message":"Gemini API error: Could not find Gemini CLI OAuth configuration","code":1,"kind":"provider"}}]',
            '[{"provider":"claude","source":"web","usage":{"primary":{"usedPercent":7,"windowMinutes":300},"secondary":{"usedPercent":43,"windowMinutes":10080}}}]',
          ].join("\n"),
          stderr: "",
        }) as any,
    });

    const quota = adapter.readProviderUsage("claude", { allowCommandProbe: true });
    expect(quota.available).toBe(true);
    expect(quota.sourceLabel).toBe("web");
    expect(quota.windows.map((entry) => entry.window)).toEqual(["primary", "secondary"]);
  });

  test("falls back to CodexBar widget snapshot only after a live probe has no usable quota", () => {
    const tempHome = join(tmpdir(), `codexbar-test-${crypto.randomUUID()}`);
    const snapshotDir = join(
      tempHome,
      "Library",
      "Group Containers",
      "group.com.steipete.codexbar",
    );
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(
      join(snapshotDir, "widget-snapshot.json"),
      JSON.stringify({
        generatedAt: "2026-02-28T20:27:01Z",
        entries: [
          {
            provider: "claude",
            updatedAt: "2026-02-28T20:25:33Z",
            primary: {
              usedPercent: 10,
              windowMinutes: 300,
              resetsAt: "2026-02-28T23:00:00Z",
              resetDescription: "Mar 1 at 12:00AM",
            },
            secondary: {
              usedPercent: 6,
              windowMinutes: 10080,
              resetsAt: "2026-03-06T07:00:00Z",
              resetDescription: "Mar 6 at 8:00AM",
            },
            tertiary: {
              usedPercent: 1,
              windowMinutes: 10080,
              resetsAt: "2026-03-06T07:00:00Z",
              resetDescription: "Mar 6 at 8:00AM",
            },
          },
        ],
      }),
      "utf8",
    );

    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;
    try {
      let commandCalls = 0;
      const adapter = new CodexBarUsageAdapter({
        logger: TEST_LOGGER,
        enableWidgetSnapshot: true,
        runCommand: () => {
          commandCalls += 1;
          return {
            status: 1,
            stdout: JSON.stringify([
              {
                provider: "claude",
                source: "auto",
                error: {
                  message: "Web source unavailable.",
                },
              },
            ]),
            stderr: "",
          } as any;
        },
      });

      const quota = adapter.readProviderUsage("claude", { allowCommandProbe: true });
      expect(commandCalls).toBe(2);
      expect(quota.available).toBe(true);
      expect(quota.sourceLabel).toBe("codexbar-widget");
      expect(quota.windows.map((entry) => entry.window)).toEqual(["primary", "secondary", "tertiary"]);
      expect(quota.windows[0]?.usedPercent).toBe(10);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

describe("LocalUsageTelemetryService", () => {
  test("auto mode stays passive and uses provider telemetry fallback windows", async () => {
    let commandCalls = 0;
    const adapter = new CodexBarUsageAdapter({
      logger: TEST_LOGGER,
      enableWidgetSnapshot: false,
      runCommand: () => {
        commandCalls += 1;
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              provider: "codex",
              source: "codex-cli",
              usage: {
                primary: {
                  usedPercent: 61,
                  windowMinutes: 300,
                  resetsAt: "2026-02-28T21:00:00.000Z",
                },
              },
            },
          ]),
          stderr: "",
        } as any;
      },
    });

    const service = new LocalUsageTelemetryService({
      logger: TEST_LOGGER,
      codexBarAdapter: adapter,
      codexBarMode: "auto",
      scanners: {
        codex: {
          providerId: "codex",
          scan: async () => [],
        },
      },
    });

    const telemetry = await service.getTelemetry({
      providerIds: ["codex"],
      fallbackTelemetry: [
        {
          providerId: "codex",
          status: "available",
          source: "codex_app_server",
          fetchedAt: "2026-02-28T10:00:00.000Z",
          windows: [
            {
              scopeId: "codex",
              scopeName: "Codex",
              window: "primary",
              usedPercent: 9,
              remainingPercent: 91,
              windowDurationMins: 300,
              resetsAt: "2026-02-28T18:00:00.000Z",
            },
          ],
        },
      ],
    });

    expect(telemetry.length).toBe(1);
    expect(commandCalls).toBe(0);
    expect(telemetry[0]?.quota.windows[0]?.usedPercent).toBe(9);
    expect(telemetry[0]?.quota.sourceLabel).toBe("codex-cli");
  });

  test("prefer mode may execute an explicit CodexBar probe", async () => {
    let commandCalls = 0;
    const adapter = new CodexBarUsageAdapter({
      logger: TEST_LOGGER,
      enableWidgetSnapshot: false,
      runCommand: () => {
        commandCalls += 1;
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              provider: "codex",
              source: "codex-cli",
              usage: {
                primary: {
                  usedPercent: 61,
                  windowMinutes: 300,
                  resetsAt: "2026-02-28T21:00:00.000Z",
                },
              },
            },
          ]),
          stderr: "",
        } as any;
      },
    });

    const service = new LocalUsageTelemetryService({
      logger: TEST_LOGGER,
      codexBarAdapter: adapter,
      codexBarMode: "prefer",
      scanners: {
        codex: {
          providerId: "codex",
          scan: async () => [],
        },
      },
    });

    const telemetry = await service.getTelemetry({
      providerIds: ["codex"],
    });

    expect(commandCalls).toBe(1);
    expect(telemetry[0]?.quota.windows[0]?.usedPercent).toBe(61);
    expect(telemetry[0]?.quota.sourceLabel).toBe("codex-cli");
  });

  test("uses provider telemetry fallback when CodexBar has no provider data", async () => {
    const service = new LocalUsageTelemetryService({
      logger: TEST_LOGGER,
      codexBarAdapter: new CodexBarUsageAdapter({
        logger: TEST_LOGGER,
        enableWidgetSnapshot: false,
        runCommand: () =>
          ({
            status: 0,
            stdout: JSON.stringify([
              {
                provider: "openai",
                source: "api",
              },
            ]),
            stderr: "",
          }) as any,
      }),
      codexBarMode: "auto",
      scanners: {
        openai: {
          providerId: "openai",
          scan: async () => [],
        },
      },
    });

    const telemetry = await service.getTelemetry({
      providerIds: ["openai"],
      fallbackTelemetry: [
        {
          providerId: "openai",
          status: "available",
          source: "usage_snapshot",
          fetchedAt: "2026-02-28T10:00:00.000Z",
          windows: [
            {
              scopeId: "openai",
              scopeName: "OpenAI",
              window: "primary",
              usedPercent: 9,
              remainingPercent: 91,
              windowDurationMins: 300,
              resetsAt: "2026-02-28T18:00:00.000Z",
            },
          ],
          usage: {
            providerId: "openai",
            status: "available",
            inputTokens: 120,
            outputTokens: 40,
            totalTokens: 160,
            spentUsd: 0.0123,
            tokenAccuracy: "reported",
            usageSource: "ledger",
          },
        },
      ],
    });

    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]?.status).toBe("available");
    expect(telemetry[0]?.quota.available).toBe(true);
    expect(telemetry[0]?.quota.windows[0]?.usedPercent).toBe(9);
    expect(telemetry[0]?.quota.sourceLabel).toBe("api");
    expect(telemetry[0]?.summary.totalTokens).toBe(160);
    expect(telemetry[0]?.summary.tokenAccuracy).toBe("reported");
    expect(telemetry[0]?.summary.usageSource).toBe("ledger");
  });

  function passiveAdapter(): CodexBarUsageAdapter {
    return new CodexBarUsageAdapter({
      logger: TEST_LOGGER,
      enableWidgetSnapshot: false,
      runCommand: () => ({ status: 0, stdout: "[]", stderr: "" }) as any,
    });
  }

  function codexFallback(): ProviderTelemetryPayload[] {
    return [
      {
        providerId: "codex",
        status: "available",
        source: "codex_app_server",
        fetchedAt: "2026-02-28T10:00:00.000Z",
        windows: [
          {
            scopeId: "codex",
            scopeName: "Codex",
            window: "primary",
            usedPercent: 25,
            remainingPercent: 75,
            windowDurationMins: 300,
            resetsAt: "2026-02-28T18:00:00.000Z",
          },
        ],
      },
    ];
  }

  test("cache-first: fresh cache serves without resolving the fallback thunk", async () => {
    let clock = new Date("2026-02-28T12:00:00.000Z").getTime();
    let providerCalls = 0;
    const service = new LocalUsageTelemetryService({
      logger: TEST_LOGGER,
      codexBarAdapter: passiveAdapter(),
      codexBarMode: "auto",
      refreshMinSecs: 60,
      now: () => new Date(clock),
      scanners: { codex: { providerId: "codex", scan: async () => [] } },
    });
    const fallbackTelemetryProvider = async () => {
      providerCalls += 1;
      return codexFallback();
    };

    // Cold: must resolve fallback once.
    const first = await service.getTelemetry({ providerIds: ["codex"], fallbackTelemetryProvider });
    expect(providerCalls).toBe(1);
    expect(first[0]?.quota.windows[0]?.usedPercent).toBe(25);

    // Warm within window: served from cache, thunk NOT called again.
    clock += 30_000;
    const second = await service.getTelemetry({ providerIds: ["codex"], fallbackTelemetryProvider });
    expect(providerCalls).toBe(1);
    expect(second[0]?.quota.windows[0]?.usedPercent).toBe(25);
  });

  test("stale-while-revalidate: expired cache returns stale immediately and refreshes once", async () => {
    let clock = new Date("2026-02-28T12:00:00.000Z").getTime();
    let providerCalls = 0;
    let usedPercent = 25;
    const service = new LocalUsageTelemetryService({
      logger: TEST_LOGGER,
      codexBarAdapter: passiveAdapter(),
      codexBarMode: "auto",
      refreshMinSecs: 60,
      now: () => new Date(clock),
      scanners: { codex: { providerId: "codex", scan: async () => [] } },
    });
    const fallbackTelemetryProvider = async () => {
      providerCalls += 1;
      const windows = codexFallback();
      windows[0]!.windows[0]!.usedPercent = usedPercent;
      return windows;
    };

    const first = await service.getTelemetry({ providerIds: ["codex"], fallbackTelemetryProvider });
    expect(providerCalls).toBe(1);
    expect(first[0]?.quota.windows[0]?.usedPercent).toBe(25);

    // Move past the refresh window and change upstream value.
    clock += 61_000;
    usedPercent = 80;
    const stale = await service.getTelemetry({ providerIds: ["codex"], fallbackTelemetryProvider });
    // Returned value is the STALE one (immediate), background refresh kicked off.
    expect(stale[0]?.quota.windows[0]?.usedPercent).toBe(25);

    // Let the coalesced background refresh settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(providerCalls).toBe(2);

    // Next read (still within new window) serves the refreshed value.
    clock += 1_000;
    const refreshed = await service.getTelemetry({ providerIds: ["codex"], fallbackTelemetryProvider });
    expect(refreshed[0]?.quota.windows[0]?.usedPercent).toBe(80);
    expect(providerCalls).toBe(2);
  });

  test("concurrent cold requests coalesce into a single fallback resolution", async () => {
    let providerCalls = 0;
    const service = new LocalUsageTelemetryService({
      logger: TEST_LOGGER,
      codexBarAdapter: passiveAdapter(),
      codexBarMode: "auto",
      refreshMinSecs: 60,
      scanners: { codex: { providerId: "codex", scan: async () => [] } },
    });
    const fallbackTelemetryProvider = async () => {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return codexFallback();
    };

    const [a, b] = await Promise.all([
      service.getTelemetry({ providerIds: ["codex"], fallbackTelemetryProvider }),
      service.getTelemetry({ providerIds: ["codex"], fallbackTelemetryProvider }),
    ]);
    expect(providerCalls).toBe(1);
    expect(a[0]?.quota.windows[0]?.usedPercent).toBe(25);
    expect(b[0]?.quota.windows[0]?.usedPercent).toBe(25);
  });
});
