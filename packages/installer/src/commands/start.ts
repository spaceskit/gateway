/**
 * `spaceskit-gateway start` — Start the gateway daemon.
 *
 * Reads ~/.spaceskit/gateway.json and starts the gateway with
 * the saved configuration. If no config exists, runs the wizard first.
 */

import {
  loadConfig,
  configExists,
  configToEnv,
  ensureSpaceskitHome,
  formatConfig,
  saveConfig,
} from "../config.js";
import { runWizard } from "../wizard.js";

export interface StartCommandOptions {
  healthDebug?: boolean;
}

export async function startCommand(options: StartCommandOptions = {}): Promise<void> {
  ensureSpaceskitHome();

  let config = loadConfig();

  // If setup hasn't been run, launch the wizard
  if (!config.setupComplete || !configExists()) {
    console.log("No configuration found. Running setup wizard...");
    const result = await runWizard();
    if (!result) {
      console.log("Setup cancelled. Cannot start without configuration.");
      process.exit(1);
    }
    config = result;
  }

  // Set environment variables from config
  if (options.healthDebug) {
    process.env.SPACESKIT_HEALTH_DEBUG = "true";
  }
  const env = configToEnv(config);
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  console.log();
  console.log("┌─────────────────────────────────────────┐");
  console.log("│       Spaceskit Gateway                  │");
  console.log("└─────────────────────────────────────────┘");
  console.log();
  console.log(formatConfig(config));
  console.log();

  if (options.healthDebug) {
    console.log("  Health debug:   enabled (/health?debug=1 returns extended diagnostics)");
    console.log();
  }

  if (config.noise.enabled) {
    console.log(`  🔒 Noise Protocol encryption active`);
    console.log(`  Run \`spaceskit-gateway pair\` to connect a device.`);
    console.log();
  }

  // Import and start the gateway bootstrap
  try {
    const { startGateway } = await import("@spaceskit/bootstrap");
    const requestedPort = config.port;
    const gateway = await startGateway({
      port: config.port,
      host: config.host,
      dbPath: config.dbPath,
      logLevel: config.logLevel,
      modelProvider: config.modelProvider ?? undefined,
      defaultModelId: config.modelId ?? undefined,
      apiKey: config.apiKey ?? undefined,
    });
    if (!gateway.server) {
      throw new Error("Gateway server failed to start");
    }

    if (gateway.config.port !== requestedPort) {
      config.port = gateway.config.port;
      saveConfig(config);
      console.log(
        `  ! Port ${requestedPort} was already in use; switched to ${config.port} and updated config.`,
      );
    }

    const protocol = config.noise.enabled ? "wss" : "ws";
    const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;
    console.log(`  ✓ Gateway running at ${protocol}://${displayHost}:${config.port}`);
    console.log(`  Press Ctrl+C to stop.`);
    console.log();
  } catch (err) {
    console.error("Failed to start gateway:", err);
    process.exit(1);
  }
}
