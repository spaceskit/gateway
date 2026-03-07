/**
 * Service management for Spaceskit Gateway.
 *
 * Creates and manages:
 * - macOS: launchd plist (~/Library/LaunchAgents/dev.spaceskit.gateway.plist)
 * - Linux: systemd user unit (~/.config/systemd/user/spaceskit-gateway.service)
 *
 * This lets the gateway start on login and restart on crashes.
 */

import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { getSpaceskitHome, getLogsDir } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceStatus = "running" | "stopped" | "not-installed";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const LAUNCHD_LABEL = "dev.spaceskit.gateway";
const SYSTEMD_UNIT = "spaceskit-gateway";

function getLaunchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function getSystemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", `${SYSTEMD_UNIT}.service`);
}

/**
 * Find the path to the Bun executable.
 */
function findBunPath(): string {
  try {
    return execSync("which bun", { encoding: "utf-8" }).trim();
  } catch {
    return "/usr/local/bin/bun"; // fallback
  }
}

/**
 * Find the path to the gateway bootstrap entry point.
 */
function findGatewayEntryPoint(): string {
  // When installed via npm, the entry point is in node_modules
  // When running from source, it's relative to the monorepo
  const candidates = [
    join(getSpaceskitHome(), "node_modules", "@spaceskit", "bootstrap", "src", "index.ts"),
    join(process.cwd(), "packages", "bootstrap", "src", "index.ts"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: assume npm global install
  return "spaceskit-gateway start";
}

// ---------------------------------------------------------------------------
// macOS launchd
// ---------------------------------------------------------------------------

function generateLaunchdPlist(): string {
  const bunPath = findBunPath();
  const entryPoint = findGatewayEntryPoint();
  const logsDir = getLogsDir();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>run</string>
    <string>${entryPoint}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${getSpaceskitHome()}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>${join(logsDir, "gateway.log")}</string>

  <key>StandardErrorPath</key>
  <string>${join(logsDir, "gateway.err.log")}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:${join(homedir(), ".bun", "bin")}</string>
  </dict>
</dict>
</plist>`;
}

// ---------------------------------------------------------------------------
// Linux systemd
// ---------------------------------------------------------------------------

function generateSystemdUnit(): string {
  const bunPath = findBunPath();
  const entryPoint = findGatewayEntryPoint();

  return `[Unit]
Description=Spaceskit Gateway
After=network.target

[Service]
Type=simple
ExecStart=${bunPath} run ${entryPoint}
WorkingDirectory=${getSpaceskitHome()}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install the gateway as a system service (launchd on macOS, systemd on Linux).
 */
export function installService(): void {
  const os = platform();

  if (os === "darwin") {
    const plistPath = getLaunchdPlistPath();
    const plist = generateLaunchdPlist();
    writeFileSync(plistPath, plist, "utf-8");
    console.log(`  ✓ launchd plist written to ${plistPath}`);
  } else if (os === "linux") {
    const unitPath = getSystemdUnitPath();
    const unit = generateSystemdUnit();

    // Ensure directory exists
    const dir = join(homedir(), ".config", "systemd", "user");
    if (!existsSync(dir)) {
      execSync(`mkdir -p "${dir}"`);
    }

    writeFileSync(unitPath, unit, "utf-8");
    execSync("systemctl --user daemon-reload");
    console.log(`  ✓ systemd unit written to ${unitPath}`);
  } else {
    console.log(`  ✗ Service management not supported on ${os}`);
  }
}

/**
 * Uninstall the system service.
 */
export function uninstallService(): void {
  const os = platform();

  if (os === "darwin") {
    const plistPath = getLaunchdPlistPath();
    if (existsSync(plistPath)) {
      try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`); } catch { /* already unloaded */ }
      unlinkSync(plistPath);
      console.log("  ✓ launchd service removed");
    } else {
      console.log("  Service not installed.");
    }
  } else if (os === "linux") {
    const unitPath = getSystemdUnitPath();
    if (existsSync(unitPath)) {
      try { execSync(`systemctl --user stop ${SYSTEMD_UNIT} 2>/dev/null`); } catch { /* already stopped */ }
      try { execSync(`systemctl --user disable ${SYSTEMD_UNIT} 2>/dev/null`); } catch { /* ok */ }
      unlinkSync(unitPath);
      execSync("systemctl --user daemon-reload");
      console.log("  ✓ systemd service removed");
    } else {
      console.log("  Service not installed.");
    }
  }
}

/**
 * Start the system service.
 */
export function startService(): void {
  const os = platform();

  if (os === "darwin") {
    const plistPath = getLaunchdPlistPath();
    if (!existsSync(plistPath)) {
      console.log("  Service not installed. Run `spaceskit-gateway service install` first.");
      return;
    }
    execSync(`launchctl load "${plistPath}"`);
    console.log("  ✓ Gateway service started (launchd)");
  } else if (os === "linux") {
    execSync(`systemctl --user start ${SYSTEMD_UNIT}`);
    console.log("  ✓ Gateway service started (systemd)");
  }
}

/**
 * Stop the system service.
 */
export function stopService(): void {
  const os = platform();

  if (os === "darwin") {
    const plistPath = getLaunchdPlistPath();
    if (existsSync(plistPath)) {
      execSync(`launchctl unload "${plistPath}"`);
      console.log("  ✓ Gateway service stopped");
    }
  } else if (os === "linux") {
    execSync(`systemctl --user stop ${SYSTEMD_UNIT}`);
    console.log("  ✓ Gateway service stopped");
  }
}

/**
 * Get the current service status.
 */
export function getServiceStatus(): ServiceStatus {
  const os = platform();

  if (os === "darwin") {
    const plistPath = getLaunchdPlistPath();
    if (!existsSync(plistPath)) return "not-installed";

    try {
      const output = execSync(`launchctl list ${LAUNCHD_LABEL} 2>/dev/null`, {
        encoding: "utf-8",
      });
      return output.includes("PID") ? "running" : "stopped";
    } catch {
      return "stopped";
    }
  }

  if (os === "linux") {
    const unitPath = getSystemdUnitPath();
    if (!existsSync(unitPath)) return "not-installed";

    try {
      execSync(`systemctl --user is-active ${SYSTEMD_UNIT}`, { encoding: "utf-8" });
      return "running";
    } catch {
      return "stopped";
    }
  }

  return "not-installed";
}
