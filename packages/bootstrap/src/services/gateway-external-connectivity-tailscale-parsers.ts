import {
  FUNNEL_EXPOSED_PATHS,
  type GatewayExternalConnectivityAdvertisedEndpoint,
} from "./gateway-external-connectivity-service-impl.js";
import type { GatewayExternalConnectivityCommandResult } from "./gateway-external-connectivity-tailscale.js";

export function buildAdvertisedEndpoints(input: {
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

export function normalizeDnsName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\.$/, "");
  return normalized ? normalized : undefined;
}

export function compactLines(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/\r?\n/))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function hasExpectedServeConfig(rawJson: string, gatewayPort: number): boolean {
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

  for (const value of Object.values(node as Record<string, unknown>)) {
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

export function parseServeConfigTarget(
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

export function looksLikeLoggedOutError(result: GatewayExternalConnectivityCommandResult): boolean {
  const haystack = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return haystack.includes("tailscale is stopped")
    || haystack.includes("not logged in")
    || haystack.includes("needs login");
}

export function looksLikeFunnelUnavailableError(
  result: GatewayExternalConnectivityCommandResult,
): boolean {
  const haystack = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return haystack.includes("funnel not available")
    || haystack.includes("funnel is not enabled")
    || haystack.includes("funnel attribute is not allowed")
    || haystack.includes("not allowed to use funnel")
    || haystack.includes("funnel: not available")
    || haystack.includes("requires funnel");
}

export function inspectFunnelConfig(rawJson: string): { configured: boolean; paths: string[] } {
  const parsed = parseJson<unknown>(rawJson);
  if (!parsed || typeof parsed !== "object") {
    return { configured: false, paths: [] };
  }
  const paths = collectFunnelPaths(parsed);
  return {
    configured: paths.length > 0,
    paths,
  };
}

function collectFunnelPaths(node: unknown): string[] {
  const found = new Set<string>();
  walkFunnelTree(node, found);
  return [...found];
}

function walkFunnelTree(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      walkFunnelTree(entry, found);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as Record<string, unknown>;
  const web = record.Web;
  if (web && typeof web === "object") {
    for (const hostValue of Object.values(web as Record<string, unknown>)) {
      if (!hostValue || typeof hostValue !== "object") {
        continue;
      }
      const handlers = (hostValue as { Handlers?: unknown }).Handlers;
      if (handlers && typeof handlers === "object") {
        for (const path of Object.keys(handlers as Record<string, unknown>)) {
          if (FUNNEL_EXPOSED_PATHS.some((expected) => path === expected || path.startsWith(expected))) {
            found.add(path);
          }
        }
      }
    }
  }
  for (const value of Object.values(record)) {
    walkFunnelTree(value, found);
  }
}

