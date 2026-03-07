/**
 * `spaceskit-gateway pair` — Generate a pairing code for a remote device.
 *
 * Displays a human-readable code (WORD-WORD-WORD-NNNN) that the
 * connecting device enters to establish a Noise Protocol-encrypted
 * channel with the gateway.
 */

import { loadConfig } from "../config.js";
import { PairingManager, generatePairingCode } from "@spaceskit/noise";

export async function pairCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.noise.enabled) {
    console.log();
    console.log("  Pairing is only available in paired mode.");
    console.log("  Run `spaceskit-gateway init` and choose 'Paired' to enable it.");
    console.log();
    process.exit(1);
  }

  if (!config.noise.publicKey) {
    console.log();
    console.log("  No Noise Protocol key pair found.");
    console.log("  Run `spaceskit-gateway init` to generate one.");
    console.log();
    process.exit(1);
  }

  const pairingCode = generatePairingCode();

  console.log();
  console.log("┌─────────────────────────────────────────┐");
  console.log("│       Device Pairing                     │");
  console.log("└─────────────────────────────────────────┘");
  console.log();
  console.log(`  Pairing code:  ${pairingCode.code}`);
  console.log();
  console.log("  Enter this code on the device you want to connect.");
  console.log(`  This code expires at ${pairingCode.expiresAt.toLocaleTimeString()}.`);
  console.log();
  console.log("  Waiting for a device to connect...");
  console.log("  Press Ctrl+C to cancel.");
  console.log();

  // In a full implementation, this would:
  // 1. Start the gateway if not running
  // 2. Register the pairing code with the PairingManager
  // 3. Wait for a client to complete the pairing handshake
  // 4. Confirm success and save the device
  //
  // For now, we display the code and let the running gateway handle it.
}
