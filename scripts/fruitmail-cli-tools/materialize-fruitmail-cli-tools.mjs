#!/usr/bin/env node

import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRUITMAIL_TOOL_DEFINITIONS,
  buildFruitMailCliManifest,
  buildFruitMailCliToolReadme,
  resolveDefaultSpacesFruitMailWrapperPath,
} from "./catalog.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export async function materializeFruitMailCliTools(input) {
  const targetDir = input?.targetDir ? resolve(input.targetDir) : resolve(SCRIPT_DIR, "../../.spaceskit-cli-tools");
  const wrapperPath = resolve(input?.wrapperPath ?? resolveDefaultSpacesFruitMailWrapperPath());
  const fixedCwd = resolve(input?.fixedCwd ?? dirname(wrapperPath));

  await assertExecutable(wrapperPath, "wrapperPath");

  await mkdir(targetDir, { recursive: true });

  const tools = [];
  for (const tool of FRUITMAIL_TOOL_DEFINITIONS) {
    const toolDir = join(targetDir, tool.id);
    const manifestPath = join(toolDir, "manifest.json");
    const readmePath = join(toolDir, "README.md");
    await mkdir(toolDir, { recursive: true });

    const existingEnabled = await readExistingEnabled(manifestPath);
    const manifest = buildFruitMailCliManifest(tool, { wrapperPath, fixedCwd, enabled: existingEnabled });
    const readme = buildFruitMailCliToolReadme(tool);

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(readmePath, `${readme}\n`);

    tools.push({ id: tool.id, dir: toolDir });
  }

  return { tools, targetDir };
}

async function assertExecutable(path, field) {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error(`${field} must point to an executable file: ${path}`);
  }
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
