import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  FUNNEL_EXPOSED_PATHS,
  type GatewayExternalConnectivityAdvertisedEndpoint,
  type GatewayExternalConnectivityFunnelStatus,
  type GatewayExternalConnectivitySettings,
  type GatewayExternalConnectivityTailscaleStatus,
} from "./gateway-external-connectivity-service-impl.js";
import {
  buildAdvertisedEndpoints,
  compactLines,
  hasExpectedServeConfig,
  inspectFunnelConfig,
  looksLikeFunnelUnavailableError,
  looksLikeLoggedOutError,
  normalizeDnsName,
  parseJson,
  parseServeConfigTarget,
  toStringArray,
} from "./gateway-external-connectivity-tailscale-parsers.js";

export { looksLikeFunnelUnavailableError, looksLikeLoggedOutError };

export interface GatewayExternalConnectivityCommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  missingBinary: boolean;
}

export interface GatewayExternalConnectivityCommandRunner {
  (args: string[]): Promise<GatewayExternalConnectivityCommandResult> | GatewayExternalConnectivityCommandResult;
}

export interface TailscaleProbe {
  status: GatewayExternalConnectivityTailscaleStatus;
  advertisedEndpoints: GatewayExternalConnectivityAdvertisedEndpoint[];
  loggedIn: boolean;
  serveConfigured: boolean;
  funnelConfigured: boolean;
  funnelExposedPaths: string[];
  funnelHostName?: string;
  funnelProbeOk: boolean;
  funnelProbeMissingFeature: boolean;
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

export function disabledFunnelStatus(): GatewayExternalConnectivityFunnelStatus {
  return {
    state: "disabled",
    funnelConfigured: false,
    exposedPaths: [],
    summary: "Public invite ingress is disabled.",
  };
}

export async function probeTailscale(input: {
  settings: GatewayExternalConnectivitySettings;
  gatewayPort: number;
  runCommand: GatewayExternalConnectivityCommandRunner;
}): Promise<TailscaleProbe> {
  const statusResult = await input.runCommand(["status", "--json"]);
  if (statusResult.missingBinary) {
    return missingTailscaleProbe();
  }

  const parsedStatus = parseJson<TailscaleStatusJson>(statusResult.stdout);
  if (!statusResult.ok || !parsedStatus) {
    return unavailableTailscaleProbe(statusResult);
  }

  const backendState = parsedStatus.BackendState?.trim();
  const dnsName = normalizeDnsName(parsedStatus.Self?.DNSName);
  const health = toStringArray(parsedStatus.Health);
  const tailscaleIps = toStringArray(parsedStatus.Self?.TailscaleIPs ?? parsedStatus.TailscaleIPs);
  const advertisedEndpoints = buildAdvertisedEndpoints({
    dnsName,
    ips: tailscaleIps,
    port: input.gatewayPort,
  });
  const loggedIn = backendState === "Running"
    && (dnsName !== undefined || tailscaleIps.length > 0);

  const serveProbe = loggedIn
    ? await input.runCommand(["serve", "status", "--json"])
    : null;
  const serveConfigured = loggedIn
    && serveProbe?.ok === true
    && hasExpectedServeConfig(serveProbe.stdout, input.gatewayPort);
  const serveStatus = serveProbe?.stdout
    ? parseServeConfigTarget(serveProbe.stdout, input.gatewayPort)
    : null;

  let funnelConfigured = false;
  let funnelExposedPaths: string[] = [];
  let funnelProbeOk = false;
  let funnelProbeMissingFeature = false;

  if (loggedIn && input.settings.funnelEnabled !== false) {
    const funnelProbe = await input.runCommand(["funnel", "status", "--json"]);
    if (funnelProbe.missingBinary || looksLikeFunnelUnavailableError(funnelProbe)) {
      funnelProbeMissingFeature = true;
    } else if (funnelProbe.ok) {
      funnelProbeOk = true;
      const inspected = inspectFunnelConfig(funnelProbe.stdout);
      funnelConfigured = inspected.configured;
      funnelExposedPaths = inspected.paths;
    }
  }

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
    funnelConfigured,
    funnelExposedPaths,
    funnelHostName: dnsName,
    funnelProbeOk,
    funnelProbeMissingFeature,
  };
}

export function computeFunnelStatusForProbe(
  settings: GatewayExternalConnectivitySettings,
  probe: TailscaleProbe,
): GatewayExternalConnectivityFunnelStatus {
  if (settings.funnelEnabled === false) {
    return {
      state: "disabled",
      funnelConfigured: probe.funnelConfigured,
      exposedPaths: probe.funnelExposedPaths,
      summary: "Public invite ingress is disabled.",
      remediation: "Re-enable Funnel to allow off-tailnet invitees to open invite links.",
    };
  }

  if (probe.funnelProbeMissingFeature) {
    return {
      state: "unavailable",
      funnelConfigured: false,
      exposedPaths: [],
      summary: "Tailscale Funnel is not available for this tailnet.",
      remediation: "Enable Funnel on your Tailscale account, or keep invites tailnet-scoped.",
    };
  }

  if (!probe.funnelProbeOk) {
    return {
      state: "error",
      funnelConfigured: probe.funnelConfigured,
      exposedPaths: probe.funnelExposedPaths,
      summary: "Failed to inspect Tailscale Funnel state.",
      remediation: "Check tailscale CLI permissions on the gateway host.",
    };
  }

  if (!probe.funnelConfigured) {
    return {
      state: "not_configured",
      funnelConfigured: false,
      exposedPaths: probe.funnelExposedPaths,
      summary: "Funnel is enabled but no invite paths are currently exposed.",
      remediation: "Save external connectivity again to (re)apply the Funnel mapping for invite endpoints.",
    };
  }

  const funnelUrl = probe.funnelHostName ? `https://${probe.funnelHostName}` : undefined;
  return {
    state: "ready",
    funnelConfigured: true,
    funnelUrl,
    exposedPaths: probe.funnelExposedPaths,
    summary: "Invite endpoints are publicly reachable over Tailscale Funnel.",
  };
}

export function ensureTailscaleServe(
  runCommand: GatewayExternalConnectivityCommandRunner,
  gatewayPort: number,
): Promise<GatewayExternalConnectivityCommandResult> | GatewayExternalConnectivityCommandResult {
  return runCommand([
    "serve",
    "--yes",
    "--bg",
    `--tcp=${gatewayPort}`,
    `tcp://127.0.0.1:${gatewayPort}`,
  ]);
}

export function disableTailscaleServe(
  runCommand: GatewayExternalConnectivityCommandRunner,
  gatewayPort: number,
): Promise<GatewayExternalConnectivityCommandResult> | GatewayExternalConnectivityCommandResult {
  return runCommand([
    "serve",
    "--yes",
    `--tcp=${gatewayPort}`,
    "off",
  ]);
}

export async function ensureTailscaleFunnel(
  runCommand: GatewayExternalConnectivityCommandRunner,
  gatewayPort: number,
): Promise<GatewayExternalConnectivityCommandResult> {
  let last: GatewayExternalConnectivityCommandResult = {
    ok: true,
    code: 0,
    stdout: "",
    stderr: "",
    missingBinary: false,
  };
  for (const path of FUNNEL_EXPOSED_PATHS) {
    last = await runCommand([
      "funnel",
      "--bg",
      `--set-path=${path}`,
      `http://127.0.0.1:${gatewayPort}${path}`,
    ]);
    if (!last.ok) {
      return last;
    }
  }
  return last;
}

export function disableTailscaleFunnel(
  runCommand: GatewayExternalConnectivityCommandRunner,
): Promise<GatewayExternalConnectivityCommandResult> | GatewayExternalConnectivityCommandResult {
  return runCommand(["funnel", "--https=443", "off"]);
}

function missingTailscaleProbe(): TailscaleProbe {
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
    funnelConfigured: false,
    funnelExposedPaths: [],
    funnelProbeOk: false,
    funnelProbeMissingFeature: false,
  };
}

function unavailableTailscaleProbe(
  statusResult: GatewayExternalConnectivityCommandResult,
): TailscaleProbe {
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
    funnelConfigured: false,
    funnelExposedPaths: [],
    funnelProbeOk: false,
    funnelProbeMissingFeature: false,
  };
}

export function defaultCommandRunner(args: string[]): GatewayExternalConnectivityCommandResult {
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
