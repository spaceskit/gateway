/**
 * `spaceskit-gateway status` — Show gateway runtime status.
 */

import { loadConfig, configExists, formatConfig } from "../config.js";

export interface StatusCommandOptions {
  healthDebug?: boolean;
}

export async function statusCommand(options: StatusCommandOptions = {}): Promise<void> {
  if (!configExists()) {
    console.log();
    console.log("  Gateway is not configured.");
    console.log("  Run `spaceskit-gateway init` to set up.");
    console.log();
    return;
  }

  const config = loadConfig();

  console.log();
  console.log("┌─────────────────────────────────────────┐");
  console.log("│       Gateway Status                     │");
  console.log("└─────────────────────────────────────────┘");
  console.log();
  console.log(formatConfig(config));
  console.log();

  // Try to reach the health endpoint
  const protocol = "http";
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  const healthUrl = `${protocol}://${host}:${config.port}/health${options.healthDebug ? "?debug=1" : ""}`;

  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const health = await response.json() as {
        status: string;
        uptime: number;
        clients: number;
        subsystems?: Record<string, { status: string; detail?: string }>;
        degradation?: {
          reasons?: Array<{
            subsystem: string;
            status: string;
            detail?: string;
          }>;
        };
      };
      console.log(`  Runtime:        ✓ running`);
      console.log(`  Status:         ${health.status}`);
      console.log(`  Uptime:         ${formatUptime(health.uptime)}`);
      console.log(`  Clients:        ${health.clients}`);

      if (health.subsystems) {
        const subsystemSummary = Object.entries(health.subsystems)
          .map(([name, s]) => `${name}: ${s.status}`)
          .join(", ");
        console.log(`  Subsystems:     ${subsystemSummary}`);
      }

      if (health.degradation?.reasons?.length) {
        const reasons = health.degradation.reasons
          .map((entry) => `${entry.subsystem}=${entry.status}${entry.detail ? ` (${entry.detail})` : ""}`)
          .join("; ");
        console.log(`  Degradation:    ${reasons}`);
      }
    } else {
      console.log(`  Runtime:        ✗ unhealthy (HTTP ${response.status})`);
    }
  } catch {
    console.log(`  Runtime:        ✗ not running`);
    console.log(`  Hint:           Run \`spaceskit-gateway start\` to launch.`);
  }

  console.log();
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
