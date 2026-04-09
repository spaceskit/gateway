import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "@spaceskit/observability";
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

  test("prefers CodexBar widget snapshot windows when available", () => {
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
      const adapter = new CodexBarUsageAdapter({
        logger: TEST_LOGGER,
        enableWidgetSnapshot: true,
        runCommand: () => {
          throw new Error("runCommand should not be called when snapshot exists");
        },
      });

      const quota = adapter.readProviderUsage("claude");
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
  test("auto mode stays passive and falls back when no snapshot windows exist", async () => {
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
});
