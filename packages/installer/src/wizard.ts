/**
 * Interactive setup wizard for Spaceskit Gateway.
 *
 * Guides the user through initial configuration:
 * 1. Choose deployment mode (local vs paired)
 * 2. Configure a default execution runtime (optional)
 * 3. Generate Noise Protocol keys (if paired mode)
 * 4. Save config and start
 *
 * Uses Bun's built-in readline for interactive prompts
 * (no external dependencies like inquirer).
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { generateNoiseKeyPair } from "@spaceskit/noise";
import {
  type InstallerConfig,
  type GatewayMode,
  loadConfig,
  saveConfig,
  getDefaultDbPath,
  formatConfig,
} from "./config.js";

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

async function prompt(rl: ReturnType<typeof createInterface>, message: string): Promise<string> {
  const answer = await rl.question(message);
  return answer.trim();
}

async function promptChoice(
  rl: ReturnType<typeof createInterface>,
  message: string,
  choices: { key: string; label: string; description: string }[],
): Promise<string> {
  console.log();
  console.log(message);
  console.log();
  for (const choice of choices) {
    console.log(`  ${choice.key}) ${choice.label}`);
    console.log(`     ${choice.description}`);
  }
  console.log();

  const validKeys = choices.map((c) => c.key);
  let answer = "";
  while (!validKeys.includes(answer)) {
    answer = await prompt(rl, `Choose [${validKeys.join("/")}]: `);
    if (!validKeys.includes(answer)) {
      console.log(`  Invalid choice. Please enter one of: ${validKeys.join(", ")}`);
    }
  }
  return answer;
}

async function promptSecret(
  rl: ReturnType<typeof createInterface>,
  message: string,
): Promise<string> {
  // Bun's readline doesn't support hidden input natively,
  // so we just prompt normally with a note
  const answer = await prompt(rl, message);
  return answer;
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

/**
 * Run the interactive setup wizard.
 * Returns the completed config, or null if the user cancelled.
 */
export async function runWizard(): Promise<InstallerConfig | null> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log();
    console.log("┌─────────────────────────────────────────┐");
    console.log("│       Spaceskit Gateway Setup            │");
    console.log("│                                          │");
    console.log("│  Multi-agent coordination gateway        │");
    console.log("└─────────────────────────────────────────┘");
    console.log();

    const config = loadConfig();

    // --- Step 1: Deployment mode ---

    const modeChoice = await promptChoice(
      rl,
      "How will you use this gateway?",
      [
        {
          key: "1",
          label: "Local only",
          description: "Runs on this machine only. No encryption needed.",
        },
        {
          key: "2",
          label: "Paired (accept remote connections)",
          description: "Other devices can connect. Noise Protocol encryption enabled.",
        },
      ],
    );

    const mode: GatewayMode = modeChoice === "1" ? "local" : "paired";
    config.mode = mode;

    if (mode === "local") {
      config.host = "127.0.0.1";
      config.noise.enabled = false;
      console.log();
      console.log("  ✓ Local mode — binding to 127.0.0.1");
    } else {
      config.host = "0.0.0.0";
      config.noise.enabled = true;

      console.log();
      console.log("  Generating Noise Protocol identity key pair...");

      const keyPair = await generateNoiseKeyPair();
      config.noise.publicKey = toBase64(keyPair.publicKey);
      config.noise.privateKey = toBase64(keyPair.privateKey);

      console.log(`  ✓ Noise identity: NK_${config.noise.publicKey.slice(0, 8)}...`);
      console.log("  ✓ Paired mode — binding to 0.0.0.0 with Noise encryption");
    }

    // --- Step 2: Port ---

    const portAnswer = await prompt(rl, `\nPort [${config.port}]: `);
    if (portAnswer && !isNaN(parseInt(portAnswer, 10))) {
      config.port = parseInt(portAnswer, 10);
    }

    // --- Step 3: Default execution path ---

    const providerChoice = await promptChoice(
      rl,
      "Configure a default cloud execution path? (you can do this later)",
      [
        { key: "1", label: "OpenRouter", description: "Broad BYOK cloud routing" },
        { key: "2", label: "OpenAI", description: "Direct OpenAI cloud API" },
        { key: "3", label: "Skip", description: "Configure later via config file or env vars" },
      ],
    );

    if (providerChoice === "1") {
      config.modelProvider = "openrouter";
      config.modelId = "openrouter/openai/gpt-4.1-mini";
      const apiKey = await promptSecret(rl, "  OpenRouter API key (sk-or-...): ");
      if (apiKey) {
        config.apiKey = apiKey;
        console.log("  ✓ OpenRouter configured");
      }
    } else if (providerChoice === "2") {
      config.modelProvider = "openai";
      config.modelId = "openai/gpt-4.1";
      const apiKey = await promptSecret(rl, "  OpenAI API key (sk-...): ");
      if (apiKey) {
        config.apiKey = apiKey;
        console.log("  ✓ OpenAI configured");
      }
    } else {
      console.log("  ✓ Skipped — set SPACESKIT_MODEL_PROVIDER and SPACESKIT_API_KEY later");
    }

    // --- Step 4: Database path ---

    config.dbPath = getDefaultDbPath();

    // --- Confirm & save ---

    console.log();
    console.log("─── Configuration Summary ───");
    console.log();
    console.log(formatConfig(config));
    console.log();

    const confirm = await prompt(rl, "Save this configuration? [Y/n]: ");
    if (confirm.toLowerCase() === "n") {
      console.log("  Setup cancelled.");
      return null;
    }

    config.setupComplete = true;
    config.createdAt = new Date().toISOString();
    saveConfig(config);

    console.log();
    console.log("  ✓ Configuration saved to ~/.spaceskit/gateway.json");

    return config;
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
