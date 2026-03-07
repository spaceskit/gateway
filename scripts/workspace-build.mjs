import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "build" && mode !== "typecheck") {
  console.error("Usage: node scripts/workspace-build.mjs <build|typecheck>");
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const gatewayRoot = resolve(scriptDir, "..");
const packagesRoot = join(gatewayRoot, "packages");

const packageEntries = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const dir = join(packagesRoot, entry.name);
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) {
      return null;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return {
      dir,
      manifestPath,
      name: manifest.name,
      scripts: manifest.scripts ?? {},
      dependencies: collectInternalDependencies(manifest),
    };
  })
  .filter(Boolean);

const packagesByName = new Map(packageEntries.map((entry) => [entry.name, entry]));
const orderedPackages = topologicalOrder(packageEntries, packagesByName);

if (mode === "build") {
  for (const entry of orderedPackages) {
    runBuild(entry);
  }
  process.exit(0);
}

for (const entry of orderedPackages) {
  runBuild(entry);
}

for (const entry of orderedPackages) {
  runTypecheck(entry);
}

function collectInternalDependencies(manifest) {
  const combined = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };
  return Object.keys(combined)
    .filter((name) => name.startsWith("@spaceskit/"));
}

function topologicalOrder(entries, byName) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = (entry) => {
    if (visited.has(entry.name)) {
      return;
    }
    if (visiting.has(entry.name)) {
      throw new Error(`Workspace dependency cycle detected at ${entry.name}`);
    }
    visiting.add(entry.name);
    for (const dependencyName of entry.dependencies) {
      const dependency = byName.get(dependencyName);
      if (dependency) {
        visit(dependency);
      }
    }
    visiting.delete(entry.name);
    visited.add(entry.name);
    ordered.push(entry);
  };

  for (const entry of entries) {
    visit(entry);
  }

  return ordered;
}

function runBuild(entry) {
  if (!entry.scripts.build) {
    return;
  }
  runCommand(entry, ["run", "build"], "build");
}

function runTypecheck(entry) {
  if (entry.scripts.typecheck) {
    runCommand(entry, ["run", "typecheck"], "typecheck");
    return;
  }

  const tsconfigPath = join(entry.dir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    return;
  }
  runCommand(entry, ["x", "tsc", "-p", "tsconfig.json", "--noEmit"], "typecheck");
}

function runCommand(entry, args, label) {
  console.log(`[workspace-${mode}] ${label} ${entry.name}`);
  const result = spawnSync("bun", args, {
    cwd: entry.dir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
