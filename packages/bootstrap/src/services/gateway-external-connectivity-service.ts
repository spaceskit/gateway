import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { Logger } from "@spaceskit/observability";
import {
  GatewayExternalConnectivityRepository,
  type GatewayExternalConnectivityModeRowValue,
} from "@spaceskit/persistence";
import { isLoopbackHost } from "@spaceskit/policy";

export type GatewayExternalConnectivityMode = "DISABLED" | "TAILSCALE";

export type GatewayExternalConnectivityState =
  | "disabled"
  | "unsupported"
  | "missing_dependency"
  | "logged_out"
  | "serve_missing"
  | "ready"
  | "error";

export interface GatewayExternalConnectivitySettings {
  mode: GatewayExternalConnectivityMode;
  updatedAt: string;
}

export interface GatewayExternalConnectivityAdvertisedEndpoint {
  provider: "tailscale";
  label: string;
  host: string;
  port: number;
  websocketUrl: string;
  healthUrl: string;
}

export interface GatewayExternalConnectivityTailscaleStatus {
  cliAvailable: boolean;
  version?: string;
  backendState?: string;
  health: string[];
  hostName?: string;
  dnsName?: string;
  magicDnsSuffix?: string;
  tailscaleIps: string[];
  serveConfigured: boolean;
  serveTarget?: string;
  servePort?: number;
}

export interface GatewayExternalConnectivityStatus {
  state: GatewayExternalConnectivityState;
  summary: string;
  remediation?: string;
  advertisedEndpoints: GatewayExternalConnectivityAdvertisedEndpoint[];
  tailscaleStatus?: GatewayExternalConnectivityTailscaleStatus;
}

export interface GatewayExternalConnectivitySnapshot {
  settings: GatewayExternalConnectivitySettings;
  status: GatewayExternalConnectivityStatus;
}

export interface GatewayExternalConnectivityObservabilitySnapshot {
  mode: GatewayExternalConnectivityMode;
  state: GatewayExternalConnectivityState;
  updatedAt: string;
  summary: string;
  endpointCount: number;
}

interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  missingBinary: boolean;
}

interface CommandRunner {
  (args: string[]): Promise<CommandResult> | CommandResult;
}

export interface GatewayExternalConnectivityServiceOptions {
  repo?: GatewayExternalConnectivityRepository;
  gatewayProfile: "embedded" | "external";
  gatewayHost: string;
  gatewayPort: number;
  logger?: Logger;
  runCommand?: CommandRunner;
}

interface TailscaleProbe {
  status: GatewayExternalConnectivityTailscaleStatus;
  advertisedEndpoints: GatewayExternalConnectivityAdvertisedEndpoint[];
  loggedIn: boolean;
  serveConfigured: boolean;
}

interface TailscaleStatusJson {
  Version?: string;
  BackendState?: string;
  MagicDNSSuffix?: string;
  Health?: unknown;
  Self?: {
    HostName?: string;
    DNSName?: string;
    TailscaleIPs?: unknown;
  };
  TailscaleIPs?: unknown;
}

export class GatewayExternalConnectivityService {
  private readonly runCommand: CommandRunner;
  private cachedSnapshot?: GatewayExternalConnectivitySnapshot;

  constructor(private readonly options: GatewayExternalConnectivityServiceOptions) {
    this.runCommand = options.runCommand ?? defaultCommandRunner;
  }

  getSettings(): GatewayExternalConnectivitySettings {
    const row = this.options.repo?.get();
    return {
      mode: normalizeMode(row?.mode),
      updatedAt: row?.updated_at ?? new Date().toISOString(),
    };
  }

  async getSnapshot(): Promise<GatewayExternalConnectivitySnapshot> {
    const settings = this.getSettings();
    const status = await this.computeStatus(settings);
    const snapshot = { settings, status } satisfies GatewayExternalConnectivitySnapshot;
    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  getCachedObservabilitySnapshot(): GatewayExternalConnectivityObservabilitySnapshot | undefined {
    const snapshot = this.cachedSnapshot;
    if (!snapshot) {
      return undefined;
    }
    return {
      mode: snapshot.settings.mode,
      state: snapshot.status.state,
      updatedAt: snapshot.settings.updatedAt,
      summary: snapshot.status.summary,
      endpointCount: snapshot.status.advertisedEndpoints.length,
    };
  }

  async setMode(modeRaw: string): Promise<GatewayExternalConnectivitySnapshot> {
    const mode = normalizeMode(modeRaw);
    const row = this.options.repo?.set({ mode: mode as GatewayExternalConnectivityModeRowValue });
    const settings: GatewayExternalConnectivitySettings = {
      mode,
      updatedAt: row?.updated_at ?? new Date().toISOString(),
    };

    if (mode === "TAILSCALE" && this.options.gatewayProfile === "external" && isLoopbackHost(this.options.gatewayHost)) {
      const ensured = await this.ensureTailscaleServe();
      if (!ensured.ok && !ensured.missingBinary) {
        this.options.logger?.warn("Failed to ensure Tailscale Serve mapping", {
          code: ensured.code,
          stderr: ensured.stderr,
          stdout: ensured.stdout,
        });
      }
    } else if (mode === "DISABLED") {
      const cleared = await this.disableTailscaleServe();
      if (!cleared.ok && !cleared.missingBinary && !looksLikeLoggedOutError(cleared)) {
        this.options.logger?.warn("Failed to disable Tailscale Serve mapping", {
          code: cleared.code,
          stderr: cleared.stderr,
          stdout: cleared.stdout,
        });
      }
    }

    const status = await this.computeStatus(settings);
    const snapshot = { settings, status } satisfies GatewayExternalConnectivitySnapshot;
    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  private async computeStatus(
    settings: GatewayExternalConnectivitySettings,
  ): Promise<GatewayExternalConnectivityStatus> {
    if (this.options.gatewayProfile !== "external") {
      return {
        state: "unsupported",
        summary: "Embedded gateways remain loopback-only in v1.",
        remediation: "Run the gateway in external mode on a Mac or host machine to enable WAN access.",
        advertisedEndpoints: [],
      };
    }

    if (settings.mode === "DISABLED") {
      return {
        state: "disabled",
        summary: "External connectivity is disabled.",
        remediation: "Enable Tailscale to advertise a tailnet endpoint without opening the gateway to the public internet.",
        advertisedEndpoints: [],
      };
    }

    if (!isLoopbackHost(this.options.gatewayHost)) {
      return {
        state: "error",
        summary: "Tailscale mode requires the gateway to stay bound to loopback.",
        remediation: "Restart the gateway with SPACESKIT_HOST=127.0.0.1 before enabling Tailscale external access.",
        advertisedEndpoints: [],
      };
    }

    const probe = await this.probeTailscale();
    if (!probe.status.cliAvailable) {
      return {
        state: "missing_dependency",
        summary: "Tailscale CLI is not installed on this gateway host.",
        remediation: "Install and sign in to Tailscale on the gateway machine, then enable external connectivity again.",
        advertisedEndpoints: [],
        tailscaleStatus: probe.status,
      };
    }

    if (!probe.loggedIn) {
      return {
        state: "logged_out",
        summary: "Tailscale is installed but this gateway host is not connected to a tailnet.",
        remediation: "Open Tailscale on the gateway host, sign in, and confirm the node is running before retrying.",
        advertisedEndpoints: probe.advertisedEndpoints,
        tailscaleStatus: probe.status,
      };
    }

    if (!probe.serveConfigured) {
      return {
        state: "serve_missing",
        summary: "Tailscale is running, but the gateway is not being advertised through Tailscale Serve.",
        remediation: "Save external connectivity again or run tailscale serve for this gateway port.",
        advertisedEndpoints: probe.advertisedEndpoints,
        tailscaleStatus: probe.status,
      };
    }

    return {
      state: "ready",
      summary: "Gateway is reachable over the tailnet through Tailscale.",
      advertisedEndpoints: probe.advertisedEndpoints,
      tailscaleStatus: probe.status,
    };
  }

  private async probeTailscale(): Promise<TailscaleProbe> {
    const statusResult = await this.runCommand(["status", "--json"]);
    if (statusResult.missingBinary) {
      return {
        status: {
          cliAvailable: false,
          health: [],
          tailscaleIps: [],
          serveConfigured: false,
        },
        advertisedEndpoints: [],
        loggedIn: false,
        serveConfigured: false,
      };
    }

    const parsedStatus = parseJson<TailscaleStatusJson>(statusResult.stdout);
    if (!statusResult.ok || !parsedStatus) {
      return {
        status: {
          cliAvailable: true,
          health: compactLines([statusResult.stderr || statusResult.stdout]),
          tailscaleIps: [],
          serveConfigured: false,
        },
        advertisedEndpoints: [],
        loggedIn: false,
        serveConfigured: false,
      };
    }

    const backendState = parsedStatus.BackendState?.trim();
    const dnsName = normalizeDnsName(parsedStatus.Self?.DNSName);
    const health = toStringArray(parsedStatus.Health);
    const tailscaleIps = toStringArray(parsedStatus.Self?.TailscaleIPs ?? parsedStatus.TailscaleIPs);
    const advertisedEndpoints = buildAdvertisedEndpoints({
      dnsName,
      ips: tailscaleIps,
      port: this.options.gatewayPort,
    });
    const loggedIn = backendState === "Running"
      && (dnsName !== undefined || tailscaleIps.length > 0);

    const serveProbe = loggedIn
      ? await this.runCommand(["serve", "status", "--json"])
      : null;
    const serveConfigured = loggedIn
      && serveProbe?.ok === true
      && hasExpectedServeConfig(serveProbe.stdout, this.options.gatewayPort);
    const serveStatus = serveProbe?.stdout ? parseServeConfigTarget(serveProbe.stdout, this.options.gatewayPort) : null;

    return {
      status: {
        cliAvailable: true,
        version: parsedStatus.Version?.trim() || undefined,
        backendState,
        health,
        hostName: parsedStatus.Self?.HostName?.trim() || undefined,
        dnsName,
        magicDnsSuffix: parsedStatus.MagicDNSSuffix?.trim() || undefined,
        tailscaleIps,
        serveConfigured,
        serveTarget: serveStatus?.target,
        servePort: serveStatus?.port,
      },
      advertisedEndpoints,
      loggedIn,
      serveConfigured,
    };
  }

  private async ensureTailscaleServe(): Promise<CommandResult> {
    return this.runCommand([
      "serve",
      "--yes",
      "--bg",
      `--tcp=${this.options.gatewayPort}`,
      `tcp://127.0.0.1:${this.options.gatewayPort}`,
    ]);
  }

  private async disableTailscaleServe(): Promise<CommandResult> {
    return this.runCommand([
      "serve",
      "--yes",
      `--tcp=${this.options.gatewayPort}`,
      "off",
    ]);
  }
}

function buildAdvertisedEndpoints(input: {
  dnsName?: string;
  ips: string[];
  port: number;
}): GatewayExternalConnectivityAdvertisedEndpoint[] {
  const endpoints: GatewayExternalConnectivityAdvertisedEndpoint[] = [];
  if (input.dnsName) {
    endpoints.push(makeAdvertisedEndpoint("MagicDNS", input.dnsName, input.port));
  }
  for (const ip of input.ips) {
    endpoints.push(makeAdvertisedEndpoint("Tailnet IP", ip, input.port));
  }
  return endpoints;
}

function makeAdvertisedEndpoint(
  label: string,
  host: string,
  port: number,
): GatewayExternalConnectivityAdvertisedEndpoint {
  return {
    provider: "tailscale",
    label,
    host,
    port,
    websocketUrl: `ws://${formatHost(host)}:${port}`,
    healthUrl: `http://${formatHost(host)}:${port}/health`,
  };
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function normalizeMode(mode: string | undefined | null): GatewayExternalConnectivityMode {
  return mode?.trim().toUpperCase() === "TAILSCALE" ? "TAILSCALE" : "DISABLED";
}

function normalizeDnsName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\.$/, "");
  return normalized ? normalized : undefined;
}

function compactLines(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/\r?\n/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function hasExpectedServeConfig(rawJson: string, gatewayPort: number): boolean {
  const parsed = parseJson<unknown>(rawJson);
  if (!parsed) {
    return false;
  }
  return searchServeConfigForPort(parsed, String(gatewayPort), gatewayPort);
}

function searchServeConfigForPort(node: unknown, portKey: string, gatewayPort: number): boolean {
  if (Array.isArray(node)) {
    return node.some((entry) => searchServeConfigForPort(entry, portKey, gatewayPort));
  }

  if (!node || typeof node !== "object") {
    return false;
  }

  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === portKey && containsServeTarget(value, gatewayPort)) {
      return true;
    }
    if (searchServeConfigForPort(value, portKey, gatewayPort)) {
      return true;
    }
  }

  return false;
}

function containsServeTarget(node: unknown, gatewayPort: number): boolean {
  if (typeof node === "string") {
    return normalizeServeTarget(node) !== undefined;
  }
  if (Array.isArray(node)) {
    return node.some((entry) => containsServeTarget(entry, gatewayPort));
  }
  if (!node || typeof node !== "object") {
    return false;
  }

  const record = node as Record<string, unknown>;
  for (const value of Object.values(record)) {
    if (typeof value === "string") {
      const normalized = normalizeServeTarget(value);
      if (normalized && normalized.endsWith(`:${gatewayPort}`)) {
        return true;
      }
      continue;
    }
    if (containsServeTarget(value, gatewayPort)) {
      return true;
    }
  }

  return false;
}

function parseServeConfigTarget(
  rawJson: string,
  gatewayPort: number,
): { port: number; target: string } | null {
  const parsed = parseJson<unknown>(rawJson);
  if (!parsed) {
    return null;
  }
  return findServeTarget(parsed, String(gatewayPort));
}

function findServeTarget(node: unknown, portKey: string): { port: number; target: string } | null {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findServeTarget(entry, portKey);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (!node || typeof node !== "object") {
    return null;
  }

  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === portKey) {
      const target = firstServeTarget(value);
      if (target) {
        return {
          port: Number(portKey),
          target,
        };
      }
    }

    const nested = findServeTarget(value, portKey);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function firstServeTarget(node: unknown): string | null {
  if (typeof node === "string") {
    return normalizeServeTarget(node) ?? null;
  }
  if (Array.isArray(node)) {
    for (const entry of node) {
      const nested = firstServeTarget(entry);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  if (!node || typeof node !== "object") {
    return null;
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    const nested = firstServeTarget(value);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function normalizeServeTarget(value: string): string | undefined {
  const normalized = value.trim();
  if (
    normalized === `tcp://127.0.0.1:${extractPort(normalized)}`
    || normalized === `tcp://localhost:${extractPort(normalized)}`
  ) {
    return normalized.replace("localhost", "127.0.0.1");
  }
  if (
    normalized.startsWith("tcp://127.0.0.1:")
    || normalized.startsWith("tcp://localhost:")
  ) {
    return normalized.replace("localhost", "127.0.0.1");
  }
  return undefined;
}

function extractPort(value: string): string {
  const match = value.match(/:(\d+)$/);
  return match?.[1] ?? "";
}

function looksLikeLoggedOutError(result: CommandResult): boolean {
  const haystack = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return haystack.includes("tailscale is stopped")
    || haystack.includes("not logged in")
    || haystack.includes("needs login");
}

function defaultCommandRunner(args: string[]): CommandResult {
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync("tailscale", args, {
      encoding: "utf8",
    });
  } catch (error) {
    return {
      ok: false,
      code: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      missingBinary: true,
    };
  }

  if (result.error?.message?.includes("ENOENT")) {
    return {
      ok: false,
      code: result.status ?? null,
      stdout: result.stdout ?? "",
      stderr: result.error.message,
      missingBinary: true,
    };
  }

  return {
    ok: result.status === 0,
    code: result.status ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    missingBinary: false,
  };
}
