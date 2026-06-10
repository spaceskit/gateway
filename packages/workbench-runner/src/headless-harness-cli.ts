import type {
  HarnessFlow,
  HarnessMode,
  HarnessOptions,
  ProvisioningStrategy,
} from "./headless-harness-types.js";
import { resolveProvisioningStrategy } from "./headless-harness-runtime.js";

export function headlessHarnessUsage(): string {
  return [
    "Usage: bun run ./dev-services/scripts/headless-space-harness.ts [options]",
    "",
    "Options:",
    "  --mode <external|in-process>",
    "  --flow <chat|mcp|combined>",
    "  --provisioning <client-api|built-in-mcp-admin>",
    "  --artifact-path <path>",
    "  --ws-url <url>",
    "  --http-url <url>",
    "  --timeout-ms <ms>",
    "  --prompt <text>",
    "  -h, --help",
  ].join("\n");
}

export function parseHeadlessHarnessArgs(argv: string[]): HarnessOptions {
  const options: HarnessOptions = {
    mode: "external",
    flow: "combined",
    provisioning: "client-api",
    timeoutMs: 15_000,
    prompt: "Headless chat prompt",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--mode":
        options.mode = expectMode(argv[++index]);
        break;
      case "--flow":
        options.flow = expectFlow(argv[++index]);
        break;
      case "--provisioning":
        options.provisioning = expectProvisioning(argv[++index]);
        break;
      case "--artifact-path":
        options.artifactPath = argv[++index];
        break;
      case "--ws-url":
        options.wsUrl = argv[++index];
        break;
      case "--http-url":
        options.httpUrl = argv[++index];
        break;
      case "--timeout-ms":
        options.timeoutMs = Number.parseInt(argv[++index] ?? "", 10);
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error(`Invalid --timeout-ms value: ${argv[index]}`);
        }
        break;
      case "--prompt":
        options.prompt = argv[++index] ?? options.prompt;
        break;
      case "-h":
      case "--help":
        console.log(headlessHarnessUsage());
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.provisioning = resolveProvisioningStrategy(options.mode, options.provisioning);
  return options;
}

function expectMode(value?: string): HarnessMode {
  if (value === "external" || value === "in-process") {
    return value;
  }
  throw new Error(`Invalid --mode value: ${value ?? "<missing>"}`);
}

function expectFlow(value?: string): HarnessFlow {
  if (value === "chat" || value === "mcp" || value === "combined") {
    return value;
  }
  throw new Error(`Invalid --flow value: ${value ?? "<missing>"}`);
}

function expectProvisioning(value?: string): ProvisioningStrategy {
  if (value === "client-api" || value === "built-in-mcp-admin") {
    return value;
  }
  throw new Error(`Invalid --provisioning value: ${value ?? "<missing>"}`);
}
