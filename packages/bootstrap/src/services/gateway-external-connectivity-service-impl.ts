import type { Logger } from "@spaceskit/observability";
import {
  GatewayExternalConnectivityRepository,
  type GatewayExternalConnectivityModeRowValue,
} from "@spaceskit/persistence";
import { isLoopbackHost } from "@spaceskit/policy";
import {
  computeFunnelStatusForProbe,
  defaultCommandRunner,
  disabledFunnelStatus,
  disableTailscaleFunnel,
  disableTailscaleServe,
  ensureTailscaleFunnel,
  ensureTailscaleServe,
  looksLikeFunnelUnavailableError,
  looksLikeLoggedOutError,
  probeTailscale,
  type GatewayExternalConnectivityCommandRunner,
} from "./gateway-external-connectivity-tailscale.js";

export type GatewayExternalConnectivityMode = "DISABLED" | "TAILSCALE";

export type GatewayExternalConnectivityState =
  | "disabled"
  | "unsupported"
  | "missing_dependency"
  | "logged_out"
  | "serve_missing"
  | "ready"
  | "error";

export type GatewayExternalConnectivityFunnelState =
  | "disabled"
  | "unavailable"
  | "not_configured"
  | "ready"
  | "error";

export const FUNNEL_EXPOSED_PATHS: readonly string[] = [
  "/.well-known/spaces/invite/",
  "/v1/share/relay/resolve",
  "/v1/share/relay/join",
  "/v1/share/relay/register_device_via_invite",
];

export interface GatewayExternalConnectivitySettings {
  mode: GatewayExternalConnectivityMode;
  funnelEnabled: boolean | null;
  updatedAt: string;
}

function normalizeMode(mode: string | undefined | null): GatewayExternalConnectivityMode {
  return mode?.trim().toUpperCase() === "TAILSCALE" ? "TAILSCALE" : "DISABLED";
}

function normalizeFunnelEnabled(value: number | boolean | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  return value !== 0;
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

export interface GatewayExternalConnectivityFunnelStatus {
  state: GatewayExternalConnectivityFunnelState;
  funnelConfigured: boolean;
  funnelUrl?: string;
  exposedPaths: string[];
  summary?: string;
  remediation?: string;
}

export interface GatewayExternalConnectivityStatus {
  state: GatewayExternalConnectivityState;
  summary: string;
  remediation?: string;
  advertisedEndpoints: GatewayExternalConnectivityAdvertisedEndpoint[];
  tailscaleStatus?: GatewayExternalConnectivityTailscaleStatus;
  funnelStatus?: GatewayExternalConnectivityFunnelStatus;
}

export interface GatewayExternalConnectivitySnapshot {
  settings: GatewayExternalConnectivitySettings;
  status: GatewayExternalConnectivityStatus;
}

export interface GatewayExternalConnectivityObservabilitySnapshot {
  mode: GatewayExternalConnectivityMode;
  state: GatewayExternalConnectivityState;
  funnelState: GatewayExternalConnectivityFunnelState;
  funnelEnabled: boolean | null;
  updatedAt: string;
  summary: string;
  endpointCount: number;
}

export interface GatewayExternalConnectivityServiceOptions {
  repo?: GatewayExternalConnectivityRepository;
  gatewayProfile: "embedded" | "external";
  gatewayHost: string;
  gatewayPort: number;
  logger?: Logger;
  runCommand?: GatewayExternalConnectivityCommandRunner;
}

export class GatewayExternalConnectivityService {
  private readonly runCommand: GatewayExternalConnectivityCommandRunner;
  private cachedSnapshot?: GatewayExternalConnectivitySnapshot;

  constructor(private readonly options: GatewayExternalConnectivityServiceOptions) {
    this.runCommand = options.runCommand ?? defaultCommandRunner;
  }

  getSettings(): GatewayExternalConnectivitySettings {
    const row = this.options.repo?.get();
    return {
      mode: normalizeMode(row?.mode),
      funnelEnabled: normalizeFunnelEnabled(row?.funnel_enabled ?? null),
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
      funnelState: snapshot.status.funnelStatus?.state ?? "disabled",
      funnelEnabled: snapshot.settings.funnelEnabled,
      updatedAt: snapshot.settings.updatedAt,
      summary: snapshot.status.summary,
      endpointCount: snapshot.status.advertisedEndpoints.length,
    };
  }

  /**
   * True when the gateway is currently exposed beyond the loopback boundary
   * (mode != DISABLED and the last-observed status reached READY).
   *
   * Uses the most recently cached snapshot — callers that need a freshly-probed
   * answer should `await getSnapshot()` first.
   */
  isExternallyExposed(): boolean {
    const snapshot = this.cachedSnapshot;
    if (!snapshot) {
      return false;
    }
    return snapshot.settings.mode !== "DISABLED" && snapshot.status.state === "ready";
  }

  /**
   * URL of the public Funnel ingress (if currently READY), used by invite
   * issuance to embed a reachable preview/resolve/join URL in the invite
   * payload. Returns undefined when funnel is disabled, unavailable, or not yet
   * probed.
   */
  currentFunnelUrl(): string | undefined {
    return this.cachedSnapshot?.status.funnelStatus?.funnelUrl;
  }

  async setMode(modeRaw: string, funnelEnabled?: boolean | null): Promise<GatewayExternalConnectivitySnapshot> {
    const mode = normalizeMode(modeRaw);
    const row = this.options.repo?.set({
      mode: mode as GatewayExternalConnectivityModeRowValue,
      funnelEnabled,
    });
    const settings: GatewayExternalConnectivitySettings = {
      mode,
      funnelEnabled: normalizeFunnelEnabled(
        row?.funnel_enabled ?? (funnelEnabled === undefined ? null : funnelEnabled),
      ),
      updatedAt: row?.updated_at ?? new Date().toISOString(),
    };

    if (mode === "TAILSCALE" && this.options.gatewayProfile === "external" && isLoopbackHost(this.options.gatewayHost)) {
      const ensured = await ensureTailscaleServe(this.runCommand, this.options.gatewayPort);
      if (!ensured.ok && !ensured.missingBinary) {
        this.options.logger?.warn("Failed to ensure Tailscale Serve mapping", {
          code: ensured.code,
          stderr: ensured.stderr,
          stdout: ensured.stdout,
        });
      }
      if (settings.funnelEnabled !== false) {
        const funnel = await ensureTailscaleFunnel(this.runCommand, this.options.gatewayPort);
        if (!funnel.ok && !funnel.missingBinary && !looksLikeFunnelUnavailableError(funnel)) {
          this.options.logger?.warn("Failed to ensure Tailscale Funnel mapping", {
            code: funnel.code,
            stderr: funnel.stderr,
            stdout: funnel.stdout,
          });
        }
      } else {
        const cleared = await disableTailscaleFunnel(this.runCommand);
        if (
          !cleared.ok
          && !cleared.missingBinary
          && !looksLikeLoggedOutError(cleared)
          && !looksLikeFunnelUnavailableError(cleared)
        ) {
          this.options.logger?.warn("Failed to clear Tailscale Funnel mapping", {
            code: cleared.code,
            stderr: cleared.stderr,
            stdout: cleared.stdout,
          });
        }
      }
    } else if (mode === "DISABLED") {
      const clearedFunnel = await disableTailscaleFunnel(this.runCommand);
      if (
        !clearedFunnel.ok
        && !clearedFunnel.missingBinary
        && !looksLikeLoggedOutError(clearedFunnel)
        && !looksLikeFunnelUnavailableError(clearedFunnel)
      ) {
        this.options.logger?.warn("Failed to clear Tailscale Funnel mapping", {
          code: clearedFunnel.code,
          stderr: clearedFunnel.stderr,
          stdout: clearedFunnel.stdout,
        });
      }
      const cleared = await disableTailscaleServe(this.runCommand, this.options.gatewayPort);
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
        funnelStatus: disabledFunnelStatus(),
      };
    }

    if (settings.mode === "DISABLED") {
      return {
        state: "disabled",
        summary: "External connectivity is disabled.",
        remediation: "Enable Tailscale to advertise a tailnet endpoint without opening the gateway to the public internet.",
        advertisedEndpoints: [],
        funnelStatus: disabledFunnelStatus(),
      };
    }

    if (!isLoopbackHost(this.options.gatewayHost)) {
      return {
        state: "error",
        summary: "Tailscale mode requires the gateway to stay bound to loopback.",
        remediation: "Restart the gateway with SPACESKIT_HOST=127.0.0.1 before enabling Tailscale external access.",
        advertisedEndpoints: [],
        funnelStatus: disabledFunnelStatus(),
      };
    }

    const probe = await probeTailscale({
      settings,
      gatewayPort: this.options.gatewayPort,
      runCommand: this.runCommand,
    });
    if (!probe.status.cliAvailable) {
      return {
        state: "missing_dependency",
        summary: "Tailscale CLI is not installed on this gateway host.",
        remediation: "Install and sign in to Tailscale on the gateway machine, then enable external connectivity again.",
        advertisedEndpoints: [],
        tailscaleStatus: probe.status,
        funnelStatus: {
          state: "unavailable",
          funnelConfigured: false,
          exposedPaths: [],
          summary: "Funnel requires the Tailscale CLI.",
          remediation: "Install Tailscale on the gateway host before enabling Funnel-based invite ingress.",
        },
      };
    }

    if (!probe.loggedIn) {
      return {
        state: "logged_out",
        summary: "Tailscale is installed but this gateway host is not connected to a tailnet.",
        remediation: "Open Tailscale on the gateway host, sign in, and confirm the node is running before retrying.",
        advertisedEndpoints: probe.advertisedEndpoints,
        tailscaleStatus: probe.status,
        funnelStatus: {
          state: "unavailable",
          funnelConfigured: false,
          exposedPaths: [],
          summary: "Funnel requires Tailscale to be signed in.",
          remediation: "Sign in to Tailscale on the gateway host, then re-enable external connectivity.",
        },
      };
    }

    if (!probe.serveConfigured) {
      return {
        state: "serve_missing",
        summary: "Tailscale is running, but the gateway is not being advertised through Tailscale Serve.",
        remediation: "Save external connectivity again or run tailscale serve for this gateway port.",
        advertisedEndpoints: probe.advertisedEndpoints,
        tailscaleStatus: probe.status,
        funnelStatus: computeFunnelStatusForProbe(settings, probe),
      };
    }

    return {
      state: "ready",
      summary: "Gateway is reachable over the tailnet through Tailscale.",
      advertisedEndpoints: probe.advertisedEndpoints,
      tailscaleStatus: probe.status,
      funnelStatus: computeFunnelStatusForProbe(settings, probe),
    };
  }

}
