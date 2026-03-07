#!/usr/bin/env bun
/**
 * spaceskit-gateway — CLI for installing and running the Spaceskit Gateway.
 *
 * Usage:
 *   spaceskit-gateway              Start the gateway (runs init on first launch)
 *   spaceskit-gateway init         Run the setup wizard
 *   spaceskit-gateway start        Start the gateway daemon (supports --health-debug)
 *   spaceskit-gateway pair         Generate a pairing code for a remote device
 *   spaceskit-gateway peers        List paired devices
 *   spaceskit-gateway unpair <id>  Remove a paired device
 *   spaceskit-gateway status       Show gateway status
 *   spaceskit-gateway config       Print current configuration
 *   spaceskit-gateway service      Manage the background service
 *   spaceskit-gateway help         Show this help message
 */

import { initCommand } from "../src/commands/init.js";
import { startCommand, type StartCommandOptions } from "../src/commands/start.js";
import { pairCommand } from "../src/commands/pair.js";
import { peersCommand, unpairCommand } from "../src/commands/peers.js";
import { statusCommand, type StatusCommandOptions } from "../src/commands/status.js";
import { loadConfig, formatConfig, configExists } from "../src/config.js";
import {
  installService,
  uninstallService,
  startService,
  stopService,
  getServiceStatus,
} from "../src/service.js";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const VERSION = "0.1.0";
const START_HEALTH_DEBUG_FLAGS = new Set(["--health-debug", "--debug-health"]);

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function showHelp(): void {
  console.log(`
  spaceskit-gateway v${VERSION}

  Multi-agent coordination gateway with Noise Protocol encryption.

  Usage:
    spaceskit-gateway                 Start (runs setup on first launch)
    spaceskit-gateway init            Run the setup wizard
    spaceskit-gateway start [options] Start the gateway
    spaceskit-gateway pair            Generate a pairing code
    spaceskit-gateway peers           List paired devices
    spaceskit-gateway unpair <id>     Remove a paired device
    spaceskit-gateway status          Show gateway status
    spaceskit-gateway config          Print configuration
    spaceskit-gateway service <cmd>   Manage background service
    spaceskit-gateway help            Show this help
    spaceskit-gateway version         Show version

  Service commands:
    service install    Install as a background service (launchd/systemd)
    service uninstall  Remove the background service
    service start      Start the background service
    service stop       Stop the background service
    service status     Show service status

  Start options:
    --health-debug     Enable extended diagnostics in /health output
    --debug-health     Alias for --health-debug

  Environment variables:
    SPACESKIT_PORT             WebSocket port (default: 9320)
    SPACESKIT_HOST             Bind address (default: 127.0.0.1)
    SPACESKIT_MODEL_PROVIDER   Provider/executor (openrouter, openai, groq, together, mistral, claude, codex, gemini, lmstudio, ollama)
    SPACESKIT_MODEL            Model ID
    SPACESKIT_API_KEY          Provider API key
    SPACESKIT_HEALTH_DEBUG     Include debug diagnostics in /health

  Config file: ~/.spaceskit/gateway.json
  Database:    ~/.spaceskit/gateway.db
  Logs:        ~/.spaceskit/logs/
`);
}

function parseStartOptions(args: string[]): StartCommandOptions {
  const options: StartCommandOptions = {
    healthDebug: false,
  };

  for (const arg of args) {
    if (START_HEALTH_DEBUG_FLAGS.has(arg)) {
      options.healthDebug = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown start option: ${arg}`);
    }
    throw new Error(`Unexpected start argument: ${arg}`);
  }

  return options;
}

function parseStatusOptions(args: string[]): StatusCommandOptions {
  const options: StatusCommandOptions = {
    healthDebug: false,
  };

  for (const arg of args) {
    if (START_HEALTH_DEBUG_FLAGS.has(arg)) {
      options.healthDebug = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown status option: ${arg}`);
    }
    throw new Error(`Unexpected status argument: ${arg}`);
  }

  return options;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "";

  try {
    switch (command) {
      case "":
        // Default: start (with init if needed)
        await startCommand(parseStartOptions(args));
        break;

      case "init":
        await initCommand();
        break;

      case "start":
        await startCommand(parseStartOptions(args.slice(1)));
        break;

      case "--health-debug":
      case "--debug-health":
        await startCommand(parseStartOptions(args));
        break;

      case "pair":
        await pairCommand();
        break;

      case "peers":
        await peersCommand();
        break;

      case "unpair":
        await unpairCommand(args[1] ?? "");
        break;

      case "status":
        await statusCommand(parseStatusOptions(args.slice(1)));
        break;

      case "config":
        if (!configExists()) {
          console.log("\n  No configuration found. Run `spaceskit-gateway init` first.\n");
          process.exit(1);
        }
        console.log();
        console.log(formatConfig(loadConfig()));
        console.log();
        break;

      case "service": {
        const subCmd = args[1] ?? "status";
        switch (subCmd) {
          case "install":
            installService();
            break;
          case "uninstall":
            uninstallService();
            break;
          case "start":
            startService();
            break;
          case "stop":
            stopService();
            break;
          case "status": {
            const status = getServiceStatus();
            console.log(`\n  Service: ${status}\n`);
            break;
          }
          default:
            console.log(`\n  Unknown service command: ${subCmd}`);
            console.log("  Use: install, uninstall, start, stop, status\n");
        }
        break;
      }

      case "version":
      case "--version":
      case "-v":
        console.log(`spaceskit-gateway v${VERSION}`);
        break;

      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;

      default:
        console.log(`\n  Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
