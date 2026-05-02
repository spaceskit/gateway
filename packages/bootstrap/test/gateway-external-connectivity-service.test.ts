import { describe, expect, test } from "bun:test";
import {
  FUNNEL_EXPOSED_PATHS,
  GatewayExternalConnectivityService,
} from "../src/services/gateway-external-connectivity-service.js";

interface RepoStub {
  get: () => { mode: "DISABLED" | "TAILSCALE"; funnel_enabled: number | null; updated_at: string };
  set: (input: { mode: "DISABLED" | "TAILSCALE"; funnelEnabled?: boolean | null }) => {
    mode: "DISABLED" | "TAILSCALE";
    funnel_enabled: number | null;
    updated_at: string;
  };
}

function makeRepo(initialMode: "DISABLED" | "TAILSCALE" = "TAILSCALE"): RepoStub {
  let stored: { mode: "DISABLED" | "TAILSCALE"; funnel_enabled: number | null; updated_at: string } = {
    mode: initialMode,
    funnel_enabled: null,
    updated_at: "2026-03-11T00:00:00.000Z",
  };
  return {
    get: () => stored,
    set: (input) => {
      stored = {
        mode: input.mode,
        funnel_enabled:
          input.funnelEnabled === undefined
            ? stored.funnel_enabled
            : input.funnelEnabled === null
              ? null
              : input.funnelEnabled
                ? 1
                : 0,
        updated_at: "2026-03-11T00:00:00.000Z",
      };
      return stored;
    },
  };
}

function makeService(overrides: {
  gatewayProfile?: "embedded" | "external";
  gatewayHost?: string;
  gatewayPort?: number;
  runCommand?: (args: string[]) => {
    ok: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
    missingBinary: boolean;
  } | Promise<{
    ok: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
    missingBinary: boolean;
  }>;
  repo?: RepoStub;
} = {}) {
  const repo = overrides.repo ?? makeRepo();

  return new GatewayExternalConnectivityService({
    repo: repo as any,
    gatewayProfile: overrides.gatewayProfile ?? "external",
    gatewayHost: overrides.gatewayHost ?? "127.0.0.1",
    gatewayPort: overrides.gatewayPort ?? 9321,
    runCommand: overrides.runCommand,
  });
}

function commandResult(overrides: Partial<{
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  missingBinary: boolean;
}> = {}) {
  return {
    ok: true,
    code: 0,
    stdout: "",
    stderr: "",
    missingBinary: false,
    ...overrides,
  };
}

const TAILSCALE_STATUS_READY = JSON.stringify({
  Version: "1.89.0",
  BackendState: "Running",
  Self: {
    HostName: "macbook",
    DNSName: "gateway.tail123.ts.net",
    TailscaleIPs: ["100.101.102.103"],
  },
});

const SERVE_STATUS_READY = JSON.stringify({
  TCP: {
    "9321": {
      TCPForward: "tcp://127.0.0.1:9321",
    },
  },
});

const FUNNEL_STATUS_CONFIGURED = JSON.stringify({
  AllowFunnel: { "gateway.tail123.ts.net:443": true },
  Web: {
    "gateway.tail123.ts.net:443": {
      Handlers: {
        "/.well-known/spaces/invite/": { Proxy: "http://127.0.0.1:9321/.well-known/spaces/invite/" },
        "/v1/share/relay/resolve": { Proxy: "http://127.0.0.1:9321/v1/share/relay/resolve" },
        "/v1/share/relay/join": { Proxy: "http://127.0.0.1:9321/v1/share/relay/join" },
        "/v1/share/relay/register_device_via_invite": { Proxy: "http://127.0.0.1:9321/v1/share/relay/register_device_via_invite" },
      },
    },
  },
});

describe("GatewayExternalConnectivityService", () => {
  test("returns unsupported for embedded gateways", async () => {
    const service = makeService({ gatewayProfile: "embedded" });
    const snapshot = await service.getSnapshot();

    expect(snapshot.status.state).toBe("unsupported");
    expect(snapshot.status.summary).toContain("loopback-only");
    expect(snapshot.status.funnelStatus?.state).toBe("disabled");
  });

  test("returns missing_dependency when tailscale is unavailable", async () => {
    const service = makeService({
      runCommand: async () => commandResult({
        ok: false,
        code: null,
        missingBinary: true,
      }),
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.status.state).toBe("missing_dependency");
    expect(snapshot.status.funnelStatus?.state).toBe("unavailable");
  });

  test("returns logged_out when tailscale is stopped", async () => {
    const service = makeService({
      runCommand: async (args) => {
        expect(args).toEqual(["status", "--json"]);
        return commandResult({
          stdout: JSON.stringify({
            Version: "1.89.0",
            BackendState: "Stopped",
            Health: ["Tailscale is stopped."],
            Self: {
              HostName: "macbook",
              DNSName: "",
              TailscaleIPs: [],
            },
          }),
        });
      },
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.status.state).toBe("logged_out");
    expect(snapshot.status.funnelStatus?.state).toBe("unavailable");
  });

  test("returns serve_missing when tailscale is running but serve config is absent", async () => {
    const service = makeService({
      runCommand: async (args) => {
        if (args[0] === "status") {
          return commandResult({
            stdout: JSON.stringify({
              Version: "1.89.0",
              BackendState: "Running",
              MagicDNSSuffix: "tail123.ts.net",
              Self: {
                HostName: "macbook",
                DNSName: "gateway.tail123.ts.net",
                TailscaleIPs: ["100.101.102.103"],
              },
            }),
          });
        }
        if (args[0] === "serve" && args[1] === "status") {
          return commandResult({ stdout: "{}" });
        }
        if (args[0] === "funnel" && args[1] === "status") {
          return commandResult({ stdout: "{}" });
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.status.state).toBe("serve_missing");
    expect(snapshot.status.advertisedEndpoints[0]?.websocketUrl).toBe("ws://gateway.tail123.ts.net:9321");
  });

  test("returns ready when tailscale serve matches the gateway port and funnel is configured", async () => {
    const service = makeService({
      runCommand: async (args) => {
        if (args[0] === "status") {
          return commandResult({
            stdout: JSON.stringify({
              Version: "1.89.0",
              BackendState: "Running",
              Self: {
                HostName: "macbook",
                DNSName: "gateway.tail123.ts.net",
                TailscaleIPs: ["100.101.102.103", "fd7a:115c:a1e0::123"],
              },
            }),
          });
        }
        if (args[0] === "serve" && args[1] === "status") {
          return commandResult({ stdout: SERVE_STATUS_READY });
        }
        if (args[0] === "funnel" && args[1] === "status") {
          return commandResult({ stdout: FUNNEL_STATUS_CONFIGURED });
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.status.state).toBe("ready");
    expect(snapshot.status.advertisedEndpoints.map((endpoint) => endpoint.host)).toEqual([
      "gateway.tail123.ts.net",
      "100.101.102.103",
      "fd7a:115c:a1e0::123",
    ]);
    expect(snapshot.status.funnelStatus?.state).toBe("ready");
    expect(snapshot.status.funnelStatus?.funnelUrl).toBe("https://gateway.tail123.ts.net");
    expect(snapshot.status.funnelStatus?.exposedPaths.sort()).toEqual([...FUNNEL_EXPOSED_PATHS].sort());
    expect(service.currentFunnelUrl()).toBe("https://gateway.tail123.ts.net");
  });

  test("isExternallyExposed returns false before any snapshot is computed", () => {
    const service = makeService();
    expect(service.isExternallyExposed()).toBe(false);
  });

  test("isExternallyExposed returns false when status is not ready", async () => {
    const service = makeService({
      runCommand: async () => commandResult({ ok: false, missingBinary: true }),
    });
    await service.getSnapshot();
    expect(service.isExternallyExposed()).toBe(false);
  });

  test("isExternallyExposed returns false when mode is DISABLED even if state would be ready", async () => {
    const service = makeService({ repo: makeRepo("DISABLED") });
    await service.getSnapshot();
    expect(service.isExternallyExposed()).toBe(false);
  });

  test("isExternallyExposed returns true when mode is TAILSCALE and snapshot is ready", async () => {
    const service = makeService({
      runCommand: async (args) => {
        if (args[0] === "status") {
          return commandResult({ stdout: TAILSCALE_STATUS_READY });
        }
        if (args[0] === "serve" && args[1] === "status") {
          return commandResult({ stdout: SERVE_STATUS_READY });
        }
        if (args[0] === "funnel" && args[1] === "status") {
          // Funnel feature unavailable on this tailnet — service still reaches READY for serve.
          return commandResult({ ok: false, missingBinary: true });
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.status.state).toBe("ready");
    expect(service.isExternallyExposed()).toBe(true);
  });

  test("setMode configures serve and funnel when enabling tailscale", async () => {
    const commands: string[][] = [];
    const service = makeService({
      runCommand: async (args) => {
        commands.push(args);
        if (args[0] === "serve" && args.includes("--bg")) {
          return commandResult();
        }
        if (args[0] === "funnel" && args.includes("--bg")) {
          return commandResult();
        }
        if (args[0] === "status") {
          return commandResult({ stdout: TAILSCALE_STATUS_READY });
        }
        if (args[0] === "serve" && args[1] === "status") {
          return commandResult({ stdout: SERVE_STATUS_READY });
        }
        if (args[0] === "funnel" && args[1] === "status") {
          return commandResult({ stdout: FUNNEL_STATUS_CONFIGURED });
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
    });

    const snapshot = await service.setMode("TAILSCALE");
    expect(snapshot.status.state).toBe("ready");
    expect(commands.some((args) => args[0] === "serve" && args.includes("--bg"))).toBe(true);
    for (const path of FUNNEL_EXPOSED_PATHS) {
      const matched = commands.some(
        (args) =>
          args[0] === "funnel"
          && args.includes("--bg")
          && args.some((arg) => arg === `--set-path=${path}`),
      );
      expect(matched).toBe(true);
    }
  });

  test("funnel state is unavailable when tailnet plan does not allow funnel", async () => {
    const service = makeService({
      runCommand: async (args) => {
        if (args[0] === "status") {
          return commandResult({ stdout: TAILSCALE_STATUS_READY });
        }
        if (args[0] === "serve" && args[1] === "status") {
          return commandResult({ stdout: SERVE_STATUS_READY });
        }
        if (args[0] === "funnel" && args[1] === "status") {
          return commandResult({
            ok: false,
            code: 1,
            stderr: "funnel not available for this tailnet",
            stdout: "",
            missingBinary: false,
          });
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.status.state).toBe("ready");
    expect(snapshot.status.funnelStatus?.state).toBe("unavailable");
  });

  test("setMode honours funnelEnabled=false and disables funnel", async () => {
    const commands: string[][] = [];
    const service = makeService({
      runCommand: async (args) => {
        commands.push(args);
        if (args[0] === "serve" && args.includes("--bg")) {
          return commandResult();
        }
        if (args[0] === "funnel" && args[1] === "--https=443" && args[2] === "off") {
          return commandResult();
        }
        if (args[0] === "status") {
          return commandResult({ stdout: TAILSCALE_STATUS_READY });
        }
        if (args[0] === "serve" && args[1] === "status") {
          return commandResult({ stdout: SERVE_STATUS_READY });
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
    });

    const snapshot = await service.setMode("TAILSCALE", false);
    expect(snapshot.settings.funnelEnabled).toBe(false);
    expect(snapshot.status.funnelStatus?.state).toBe("disabled");
    expect(commands.some(
      (args) => args[0] === "funnel" && args[1] === "--https=443" && args[2] === "off",
    )).toBe(true);
    expect(commands.every(
      (args) => !(args[0] === "funnel" && args.includes("--bg")),
    )).toBe(true);
  });

  test("disabling external connectivity also clears funnel mapping", async () => {
    const commands: string[][] = [];
    const service = makeService({
      runCommand: async (args) => {
        commands.push(args);
        if (args[0] === "funnel" && args[1] === "--https=443" && args[2] === "off") {
          return commandResult();
        }
        if (args[0] === "serve" && args.includes("off")) {
          return commandResult();
        }
        if (args[0] === "status") {
          return commandResult({ stdout: TAILSCALE_STATUS_READY });
        }
        return commandResult();
      },
    });

    const snapshot = await service.setMode("DISABLED");
    expect(snapshot.status.state).toBe("disabled");
    expect(snapshot.status.funnelStatus?.state).toBe("disabled");
    expect(commands.some(
      (args) => args[0] === "funnel" && args[1] === "--https=443" && args[2] === "off",
    )).toBe(true);
  });
});
