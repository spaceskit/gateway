import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "@spaceskit/observability";
import type { DatabaseManager } from "@spaceskit/persistence";
import {
  evaluateTransportPolicy,
  type TransportPolicyInput,
} from "@spaceskit/policy";
import type { GatewayConfig } from "./config-types.js";
import { deterministicUuid, normalizeUuid } from "./utils/uuid.js";

export interface BootstrapWorkspacePackageStaleness {
  packageName: string;
  reason: "missing_dist" | "dist_older_than_src";
}

interface FindStaleBootstrapWorkspacePackagesInput {
  gatewayRoot?: string;
}

export function gatewayUuidSeed(config: GatewayConfig): string {
  return [
    config.mainSpaceResourceId,
    config.dbPath,
    config.host,
    String(config.port),
  ].join("|");
}

export function loadOrCreateGatewayUuid(db: DatabaseManager, seed: string): string {
  db.db.exec(
    `CREATE TABLE IF NOT EXISTS gateway_runtime_metadata (
      singleton_id INTEGER PRIMARY KEY,
      gateway_uuid TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );

  const existing = db.db
    .query("SELECT gateway_uuid FROM gateway_runtime_metadata WHERE singleton_id = 1")
    .get() as { gateway_uuid?: string } | null;

  const existingUuid = normalizeUuid(existing?.gateway_uuid);
  if (existingUuid) {
    return existingUuid;
  }

  const gatewayUuid = deterministicUuid(seed, "spaceskit.gateway.uuid");
  db.db.query(
    `INSERT INTO gateway_runtime_metadata(singleton_id, gateway_uuid, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(singleton_id)
     DO UPDATE SET gateway_uuid = excluded.gateway_uuid, updated_at = excluded.updated_at`,
  ).run(gatewayUuid, new Date().toISOString());
  return gatewayUuid;
}

const SENSITIVE_KEY_PATTERNS = ["key", "secret", "password", "token"] as const;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

function redactSensitiveValue(value: unknown): string {
  const str = String(value);
  if (str.length <= 4) return "****";
  return "*".repeat(str.length - 4) + str.slice(-4);
}

function logConfigSummary(config: GatewayConfig, logger: Logger): void {
  const entries = Object.entries(config as unknown as Record<string, unknown>);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (isSensitiveKey(key) && value !== undefined && value !== null && value !== "") {
      redacted[key] = redactSensitiveValue(value);
    } else {
      redacted[key] = value;
    }
  }
  logger.info("Resolved gateway configuration", redacted);
}

export function enforceStartupEnvValidation(config: GatewayConfig, logger: Logger): void {
  logConfigSummary(config, logger);

  if (config.gatewayProfile !== "external") return;

  const errors: string[] = [];

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push(`Invalid port: ${config.port} (must be 1–65535)`);
  }

  if (!config.host || config.host.trim() === "") {
    errors.push("SPACESKIT_HOST must be set for external profile");
  }

  if (errors.length > 0) {
    for (const err of errors) {
      logger.error(`Startup env validation failed: ${err}`);
    }
    throw new Error(`Startup env validation failed for external profile:\n${errors.join("\n")}`);
  }
}

export function enforceTransportPolicy(config: GatewayConfig, logger: Logger): void {
  const noisePublicKey = Bun.env.SPACESKIT_NOISE_PUBLIC_KEY?.trim();
  const noisePrivateKey = Bun.env.SPACESKIT_NOISE_PRIVATE_KEY?.trim();

  const rawOverride = Bun.env.SPACESKIT_ENFORCE_TRANSPORT_POLICY;
  const enforcementOverride: boolean | undefined =
    rawOverride === "true" ? true : rawOverride === "false" ? false : undefined;

  const input: TransportPolicyInput = {
    host: config.host,
    port: config.port,
    gatewayProfile: config.gatewayProfile,
    noiseEnabled: Boolean(noisePublicKey && noisePrivateKey),
    enforcementOverride,
  };

  const result = evaluateTransportPolicy(input);

  if (result.denied) {
    logger.error(result.details);
    throw new Error(result.details);
  }

  if (result.posture === "plaintext_denied") {
    logger.warn(result.details + " — enforcement disabled, proceeding with caution");
  }
}

export function acquireDbExclusiveLock(
  db: DatabaseManager,
  dbPath: string,
  logger: Logger,
): void {
  try {
    db.db.exec("BEGIN EXCLUSIVE; COMMIT;");
    logger.info("Database lock acquired", { dbPath });
  } catch (err) {
    const message = "Another gateway process is using this database — refusing to start to prevent multi-writer corruption";
    logger.error(message, { error: String(err) });
    throw new Error(message);
  }
}

export function findStaleBootstrapWorkspacePackages(
  input: FindStaleBootstrapWorkspacePackagesInput = {},
): BootstrapWorkspacePackageStaleness[] {
  const gatewayRoot = resolveGatewayWorkspaceRoot(input.gatewayRoot);
  const bootstrapManifestPath = join(gatewayRoot, "packages", "bootstrap", "package.json");
  if (!existsSync(bootstrapManifestPath)) {
    return [];
  }

  const bootstrapManifest = JSON.parse(readFileSync(bootstrapManifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const dependencyNames = Object.keys(bootstrapManifest.dependencies ?? {})
    .filter((name) => name.startsWith("@spaceskit/"))
    .sort((lhs, rhs) => lhs.localeCompare(rhs));

  const stalePackages: BootstrapWorkspacePackageStaleness[] = [];
  for (const packageName of dependencyNames) {
    const packageDir = join(gatewayRoot, "packages", packageName.replace("@spaceskit/", ""));
    const srcDir = join(packageDir, "src");
    const distEntry = join(packageDir, "dist", "index.js");
    if (!existsSync(srcDir)) {
      continue;
    }
    if (!existsSync(distEntry)) {
      stalePackages.push({ packageName, reason: "missing_dist" });
      continue;
    }

    const latestSourceMtimeMs = latestSourceMtime(srcDir);
    const distMtimeMs = statSync(distEntry).mtimeMs;
    if (latestSourceMtimeMs > distMtimeMs) {
      stalePackages.push({ packageName, reason: "dist_older_than_src" });
    }
  }

  return stalePackages;
}

export function enforceFreshBootstrapWorkspaceBuild(logger: Logger): void {
  const stalePackages = findStaleBootstrapWorkspacePackages();
  if (stalePackages.length === 0) {
    return;
  }

  const details = stalePackages.map((entry) => `${entry.packageName}:${entry.reason}`).join(", ");
  const message = `Bootstrap dependency builds are stale or missing: ${details}. Run 'bun run dev' or 'node ./scripts/workspace-build.mjs build' before starting the gateway.`;
  logger.error(message, { stalePackages });
  throw new Error(message);
}

function resolveGatewayWorkspaceRoot(override?: string): string {
  if (override?.trim()) {
    return resolve(override.trim());
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
}

function latestSourceMtime(dir: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestSourceMtime(fullPath));
      continue;
    }
    latest = Math.max(latest, statSync(fullPath).mtimeMs);
  }
  return latest;
}
