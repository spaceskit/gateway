#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const gatewayRoot = resolve(scriptDir, "..");
const isDryRun = process.argv.includes("--dry-run");
const isForced = process.argv.includes("--force");

const skippedDirNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
]);

const dbFilePattern = /\.(?:db|sqlite)(?:-(?:wal|shm|journal))?$/i;

function runningGatewayPids() {
  const result = spawnSync("pgrep", ["-f", "^bun run packages/bootstrap/src/index.ts$"], {
    encoding: "utf8",
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && /^\d+$/.test(value));
}

async function collectDbFiles(rootDir, files = []) {
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const absPath = resolve(rootDir, entry.name);

    if (entry.isDirectory()) {
      if (skippedDirNames.has(entry.name)) {
        continue;
      }
      await collectDbFiles(absPath, files);
      continue;
    }

    if (entry.isFile() && dbFilePattern.test(entry.name)) {
      files.push(absPath);
    }
  }

  return files;
}

function formatCount(n) {
  return `${n} file${n === 1 ? "" : "s"}`;
}

async function main() {
  if (!isDryRun && !isForced) {
    const pids = runningGatewayPids();
    if (pids.length > 0) {
      console.error("Refusing to reset DB files while gateway process(es) are running.");
      console.error(`Running PID(s): ${pids.join(", ")}`);
      console.error("Stop gateway processes first, or rerun with --force.");
      process.exitCode = 1;
      return;
    }
  }

  const files = await collectDbFiles(gatewayRoot);

  if (files.length === 0) {
    console.log("No gateway DB files found.");
    return;
  }

  const verb = isDryRun ? "Would remove" : "Removing";
  console.log(`${verb} ${formatCount(files.length)}:`);

  for (const file of files.sort()) {
    const relativePath = relative(gatewayRoot, file);
    if (!isDryRun) {
      await rm(file, { force: true });
    }
    console.log(`- ${relativePath}`);
  }

  if (isDryRun) {
    console.log("Dry run complete. No files were removed.");
  } else {
    console.log("Gateway DB cleanup complete.");
  }
}

main().catch((error) => {
  console.error("Failed to reset gateway DB files.");
  console.error(error);
  process.exitCode = 1;
});
