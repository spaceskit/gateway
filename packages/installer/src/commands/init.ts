/**
 * `spaceskit-gateway init` — Run the setup wizard.
 */

import { runWizard } from "../wizard.js";

export async function initCommand(): Promise<void> {
  const config = await runWizard();

  if (!config) {
    process.exit(1);
  }

  console.log();
  console.log("  Run `spaceskit-gateway start` to launch the gateway.");
  console.log();
}
