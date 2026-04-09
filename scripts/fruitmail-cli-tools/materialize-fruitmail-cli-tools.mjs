#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRUITMAIL_TOOL_DEFINITIONS,
  SPACES_FRUITMAIL_WRAPPER_VERSION,
} from "./catalog.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export async function materializeFruitMailCliTools(input) {
  const targetDir = input?.targetDir ? resolve(input.targetDir) : resolve(SCRIPT_DIR, "../../.spaceskit-cli-tools");
  const wrapperPath = resolve(SCRIPT_DIR, "spaces-fruitmail.mjs");
  const fixedCwd = dirname(wrapperPath);

  await mkdir(targetDir, { recursive: true });

  const tools = [];
  for (const tool of FRUITMAIL_TOOL_DEFINITIONS) {
    const toolDir = join(targetDir, tool.id);
    await mkdir(toolDir, { recursive: true });

    const existingEnabled = await readExistingEnabled(join(toolDir, "manifest.json"));

    const manifest = {
      id: tool.id,
      toolName: tool.toolName,
      displayName: tool.displayName,
      description: tool.description,
      bundleId: tool.bundleId,
      bundleDisplayName: tool.bundleDisplayName,
      bundleDescription: tool.bundleDescription,
      toolGroupId: tool.toolGroupId,
      toolGroupDisplayName: tool.toolGroupDisplayName,
      inputSchema: tool.inputSchema,
      outputHint: tool.outputHint,
      schemaVersion: tool.schemaVersion,
      wrapperVersion: tool.wrapperVersion,
      enabled: existingEnabled ?? true,
      runtime: {
        type: "shell",
        command: "node",
        args: [wrapperPath, extractOperation(tool.id), "{{payload}}"],
        cwd: fixedCwd,
        timeoutMs: 30000,
      },
    };

    await writeFile(join(toolDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

    const readme = `# ${tool.displayName}\n\n${tool.description}\n\nBundle: ${tool.bundleDisplayName}\nWrapper: ${SPACES_FRUITMAIL_WRAPPER_VERSION}\n`;
    await writeFile(join(toolDir, "README.md"), readme);

    tools.push({ id: tool.id, dir: toolDir });
  }

  return { tools, targetDir };
}

function extractOperation(toolId) {
  return toolId.replace("shell.fruitmail.", "");
}

async function readExistingEnabled(manifestPath) {
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const existing = JSON.parse(raw);
    return typeof existing.enabled === "boolean" ? existing.enabled : undefined;
  } catch {
    return undefined;
  }
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith("materialize-fruitmail-cli-tools.mjs")) {
  const targetDir = process.argv[2];
  materializeFruitMailCliTools({ targetDir })
    .then((result) => {
      console.log(`Materialized ${result.tools.length} fruitmail CLI tools to ${result.targetDir}`);
    })
    .catch((err) => {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    });
}
