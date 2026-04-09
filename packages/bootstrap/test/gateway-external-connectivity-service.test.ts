import { describe, expect, test } from "bun:test";
import { GatewayExternalConnectivityService } from "../src/services/gateway-external-connectivity-service.js";

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
  repo?: {
    get: () => { mode: "DISABLED" | "TAILSCALE"; updated_at: string };
    set: (input: { mode: "DISABLED" | "TAILSCALE" }) => { mode: "DISABLED" | "TAILSCALE"; updated_at: string };
  };
} = {}) {
  const repo = overrides.repo ?? {
    get: () => ({ mode: "TAILSCALE" as const, updated_at: "2026-03-11T00:00:00.000Z" }),
    set: (input: { mode: "DISABLED" | "TAILSCALE" }) => ({
      mode: input.mode,
      updated_at: "2026-03-11T00:00:00.000Z",
    }),
  };

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

describe("GatewayExternalConnectivityService", () => {
  test("returns unsupported for embedded gateways", async () => {
    const service = makeService({ gatewayProfile: "embedded" });
    const snapshot = await service.getSnapshot();

    expect(snapshot.status.state).toBe("unsupported");
    expect(snapshot.status.summary).toContain("loopback-only");
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
        if (args[0] === "serve") {
          return commandResult({
            stdout: "{}",
          });
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.status.state).toBe("serve_missing");
    expect(snapshot.status.advertisedEndpoints[0]?.websocketUrl).toBe("ws://gateway.tail123.ts.net:9321");
  });

  test("returns ready when tailscale serve matches the gateway port", async () => {
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
        if (args[0] === "serve") {
          return commandResult({
            stdout: JSON.stringify({
              TCP: {
                "9321": {
                  TCPForward: "tcp://127.0.0.1:9321",
                },
              },
            }),
          });
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
  });

  test("setMode configures serve when enabling tailscale", async () => {
    const commands: string[][] = [];
    const service = makeService({
      runCommand: async (args) => {
        commands.push(args);
        if (args[0] === "serve" && args.includes("--bg")) {
          return commandResult();
        }
        if (args[0] === "status") {
          return commandResult({
            stdout: JSON.stringify({
              Version: "1.89.0",
              BackendState: "Running",
              Self: {
                HostName: "macbook",
                DNSName: "gateway.tail123.ts.net",
                TailscaleIPs: ["100.101.102.103"],
              },
            }),
          });
        }
        if (args[0] === "serve" && args[1] === "status") {
          return commandResult({
            stdout: JSON.stringify({
              TCP: {
                "9321": {
                  TCPForward: "tcp://127.0.0.1:9321",
                },
              },
            }),
          });
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
    });

    const snapshot = await service.setMode("TAILSCALE");
    expect(snapshot.status.state).toBe("ready");
    expect(commands.some((args) => args.includes("--bg"))).toBe(true);
  });
});
