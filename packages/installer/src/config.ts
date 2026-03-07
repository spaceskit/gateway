/**
 * Configuration management for Spaceskit Gateway.
 *
 * Reads/writes ~/.spaceskit/gateway.json and manages the gateway's
 * runtime configuration, including Noise Protocol settings.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewayMode = "local" | "paired";

export interface NoiseConfig {
  /** Whether Noise Protocol encryption is enabled. */
  enabled: boolean;
  /** Base64-encoded Noise static public key. */
  publicKey: string | null;
  /** Base64-encoded Noise static private key (stored securely). */
  privateKey: string | null;
}

export interface InstallerConfig {
  /** Gateway deployment mode. */
  mode: GatewayMode;
  /** WebSocket server port. */
  port: number;
  /** Server bind address. */
  host: string;
  /** Path to SQLite database. */
  dbPath: string;
  /** Noise Protocol configuration. */
  noise: NoiseConfig;
  /** Default model runtime ID (e.g., "openrouter", "openai", "codex"). */
  modelProvider: string | null;
  /** Model ID (e.g., "openrouter/openai/gpt-4.1-mini"). */
  modelId: string | null;
  /** API key for the default cloud runtime. */
  apiKey: string | null;
  /** Log level. */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Whether the setup wizard has been completed. */
  setupComplete: boolean;
  /** When the config was first created. */
  createdAt: string;
  /** When the config was last modified. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: InstallerConfig = {
  mode: "local",
  port: 9320,
  host: "127.0.0.1",
  dbPath: "", // Set dynamically to ~/.spaceskit/gateway.db
  noise: {
    enabled: false,
    publicKey: null,
    privateKey: null,
  },
  modelProvider: null,
  modelId: null,
  apiKey: null,
  logLevel: "info",
  setupComplete: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Get the Spaceskit home directory (~/.spaceskit/). */
export function getSpaceskitHome(): string {
  return join(homedir(), ".spaceskit");
}

/** Get the path to the gateway config file. */
export function getConfigPath(): string {
  return join(getSpaceskitHome(), "gateway.json");
}

/** Get the default database path. */
export function getDefaultDbPath(): string {
  return join(getSpaceskitHome(), "gateway.db");
}

/** Get the logs directory. */
export function getLogsDir(): string {
  return join(getSpaceskitHome(), "logs");
}

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

/**
 * Ensure the ~/.spaceskit/ directory exists.
 */
export function ensureSpaceskitHome(): void {
  const home = getSpaceskitHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }

  const logsDir = getLogsDir();
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

/**
 * Load the gateway config from disk.
 * Returns the default config if the file doesn't exist.
 */
export function loadConfig(): InstallerConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return {
      ...DEFAULT_CONFIG,
      dbPath: getDefaultDbPath(),
    };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<InstallerConfig>;

    // Merge with defaults to handle missing fields from older configs
    return {
      ...DEFAULT_CONFIG,
      dbPath: getDefaultDbPath(),
      ...parsed,
    };
  } catch {
    // Corrupted config — return defaults
    return {
      ...DEFAULT_CONFIG,
      dbPath: getDefaultDbPath(),
    };
  }
}

/**
 * Save the gateway config to disk.
 */
export function saveConfig(config: InstallerConfig): void {
  ensureSpaceskitHome();

  const configPath = getConfigPath();
  const toWrite = {
    ...config,
    updatedAt: new Date().toISOString(),
  };

  // Don't write the API key in plaintext if it looks sensitive
  // (In production, we'd use the system keychain)
  writeFileSync(configPath, JSON.stringify(toWrite, null, 2) + "\n", "utf-8");
}

/**
 * Check if the config file exists (i.e., setup has been run).
 */
export function configExists(): boolean {
  return existsSync(getConfigPath());
}

/**
 * Convert InstallerConfig to environment variables for the gateway bootstrap.
 */
export function configToEnv(config: InstallerConfig): Record<string, string> {
  const env: Record<string, string> = {
    SPACESKIT_PORT: String(config.port),
    SPACESKIT_HOST: config.host,
    SPACESKIT_DB_PATH: config.dbPath || getDefaultDbPath(),
    SPACESKIT_LOG_LEVEL: config.logLevel,
    SPACESKIT_LOG_FILE: join(getLogsDir(), "gateway.log"),
    // Map installer mode to gateway profile
    SPACESKIT_GATEWAY_PROFILE: config.mode === "local" ? "embedded" : "external",
  };

  // Noise transport config
  if (config.noise.enabled) {
    env.SPACESKIT_NOISE_ENABLED = "true";
    if (config.noise.publicKey) {
      env.SPACESKIT_NOISE_PUBLIC_KEY = config.noise.publicKey;
    }
    if (config.noise.privateKey) {
      env.SPACESKIT_NOISE_PRIVATE_KEY = config.noise.privateKey;
    }
  }

  if (config.modelProvider) {
    env.SPACESKIT_MODEL_PROVIDER = config.modelProvider;
  }
  if (config.modelId) {
    env.SPACESKIT_MODEL = config.modelId;
  }
  if (config.apiKey) {
    env.SPACESKIT_API_KEY = config.apiKey;
  }

  return env;
}

/**
 * Print the current config in a human-readable format.
 */
export function formatConfig(config: InstallerConfig): string {
  const lines: string[] = [
    `Mode:           ${config.mode}`,
    `Listen:         ${config.host}:${config.port}`,
    `Database:       ${config.dbPath || getDefaultDbPath()}`,
    `Log level:      ${config.logLevel}`,
    `Noise:          ${config.noise.enabled ? "enabled" : "disabled"}`,
  ];

  if (config.noise.enabled && config.noise.publicKey) {
    const shortKey = config.noise.publicKey.slice(0, 12) + "...";
    lines.push(`Noise key:      ${shortKey}`);
  }

  if (config.modelProvider) {
    lines.push(`Model:          ${config.modelProvider}/${config.modelId ?? "default"}`);
    lines.push(`API key:        ${config.apiKey ? "***" + config.apiKey.slice(-4) : "not set"}`);
  } else {
    lines.push(`Model:          not configured`);
  }

  lines.push(`Setup complete: ${config.setupComplete ? "yes" : "no"}`);

  return lines.join("\n");
}
