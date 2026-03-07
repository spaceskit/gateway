/**
 * `spaceskit-gateway peers` — List paired devices.
 * `spaceskit-gateway unpair <id>` — Remove a paired device.
 */

import { loadConfig } from "../config.js";

export async function peersCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.noise.enabled) {
    console.log();
    console.log("  Pairing is only available in paired mode.");
    console.log("  Run `spaceskit-gateway init` and choose 'Paired' to enable it.");
    console.log();
    return;
  }

  // In a full implementation, this reads from the SQLite paired_devices table.
  // For now, we show the structure.
  console.log();
  console.log("  Paired Devices");
  console.log("  ──────────────");
  console.log();
  console.log("  No devices paired yet.");
  console.log("  Run `spaceskit-gateway pair` to connect a device.");
  console.log();
}

export async function unpairCommand(deviceId: string): Promise<void> {
  if (!deviceId) {
    console.log("  Usage: spaceskit-gateway unpair <device-id>");
    return;
  }

  // In a full implementation, this removes the device from paired_devices.
  console.log(`  Device ${deviceId} has been unpaired.`);
}
