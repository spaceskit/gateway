#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  HRVST_TOOL_DEFINITIONS,
  SPACES_HRVST_WRAPPER_VERSION,
  buildHrvstCliManifest,
  buildHrvstCliToolReadme,
  getHarvestToolDefinitionByOperation,
  resolveDefaultSpacesHrvstWrapperPath,
} from "./catalog.mjs";

export { resolveDefaultSpacesHrvstWrapperPath } from "./catalog.mjs";

export async function materializeHrvstCliTools(input) {
  const targetDir = requireAbsoluteOrResolve(input?.targetDir, "targetDir");
  const wrapperPath = requireAbsoluteOrResolve(
    input?.wrapperPath ?? resolveDefaultSpacesHrvstWrapperPath(),
    "wrapperPath",
  );
  const fixedCwd = requireAbsoluteOrResolve(input?.fixedCwd ?? dirname(wrapperPath), "fixedCwd");
  const allowedToolIds = normalizeToolIdFilter(input?.toolIds);

  await assertExecutable(wrapperPath, "wrapperPath");
  await mkdir(targetDir, { recursive: true });

  const tools = [];
  for (const tool of HRVST_TOOL_DEFINITIONS) {
    if (allowedToolIds && !allowedToolIds.has(tool.id)) {
      continue;
    }
    const toolDir = join(targetDir, tool.id);
    const manifestPath = join(toolDir, "manifest.json");
    const readmePath = join(toolDir, "README.md");
    const existing = await readExistingManifest(manifestPath);
    const manifest = buildHrvstCliManifest(tool, {
      wrapperPath,
      fixedCwd,
      enabled: existing?.enabled ?? true,
      existingManifest: existing?.manifest ?? null,
    });
    const readme = buildHrvstCliToolReadme(tool);

    await mkdir(toolDir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(readmePath, `${readme}\n`, "utf8");

    tools.push({
      toolId: tool.id,
      operation: tool.operation,
      manifestPath,
      readmePath,
    });
  }

  return {
    wrapperPath,
    fixedCwd,
    targetDir,
    toolCount: tools.length,
    tools,
  };
}

async function readExistingManifest(manifestPath) {
  try {
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    return {
      enabled: typeof raw?.enabled === "boolean" ? raw.enabled : true,
      manifest: raw,
    };
  } catch {
    return null;
  }
}

function normalizeToolIdFilter(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const normalized = new Set();
  for (const value of values) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) {
      continue;
    }
    const byId = HRVST_TOOL_DEFINITIONS.find((tool) => tool.id === raw);
    if (byId) {
      normalized.add(byId.id);
      continue;
    }
    const byOperation = getHarvestToolDefinitionByOperation(raw);
    if (byOperation) {
      normalized.add(byOperation.id);
      continue;
    }
    throw new Error(`Unknown Harvest tool id or operation: ${raw}`);
  }
  return normalized;
}

function requireAbsoluteOrResolve(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return resolve(normalized);
}

async function assertExecutable(path, field) {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error(`${field} must point to an executable file: ${path}`);
  }
}

function parseCliArgs(argvInput) {
  const argv = Array.isArray(argvInput) ? [...argvInput] : [];
  const parsed = {
    help: false,
    version: false,
    targetDir: "",
    wrapperPath: undefined,
    fixedCwd: undefined,
    toolIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (token === "--version" || token === "-v") {
      parsed.version = true;
      continue;
    }
    if (token === "--target") {
      parsed.targetDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token.startsWith("--target=")) {
      parsed.targetDir = token.split("=", 2)[1] ?? "";
      continue;
    }
    if (token === "--wrapper") {
      parsed.wrapperPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token.startsWith("--wrapper=")) {
      parsed.wrapperPath = token.split("=", 2)[1] ?? "";
      continue;
    }
    if (token === "--fixed-cwd") {
      parsed.fixedCwd = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token.startsWith("--fixed-cwd=")) {
      parsed.fixedCwd = token.split("=", 2)[1] ?? "";
      continue;
    }
    if (token === "--tool") {
      parsed.toolIds.push(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token.startsWith("--tool=")) {
      parsed.toolIds.push(token.split("=", 2)[1] ?? "");
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }

  return parsed;
}

function buildHelpText() {
  return [
    "Materialize Spaces Harvest CLI tools",
    "",
    "Usage:",
    "  materialize-hrvst-cli-tools --target <gateway-cli-tools-dir> [--wrapper <path>] [--fixed-cwd <path>] [--tool <id-or-operation>]",
    "  materialize-hrvst-cli-tools --version",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    process.stdout.write(`${buildHelpText()}\n`);
    return;
  }
  if (parsed.version) {
    process.stdout.write(`materialize-hrvst-cli-tools ${SPACES_HRVST_WRAPPER_VERSION}\n`);
    return;
  }
  if (!parsed.targetDir) {
    throw new Error("The --target option is required.");
  }
  const result = await materializeHrvstCliTools(parsed);
  process.stdout.write(
    `Materialized ${result.toolCount} Harvest CLI tool bundle(s) into ${result.targetDir}\n`,
  );
}

const IS_MAIN_MODULE = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (IS_MAIN_MODULE) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
