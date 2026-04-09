import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findStaleBootstrapWorkspacePackages } from "../src/startup-guards.js";

describe("bootstrap startup guards", () => {
  test("gateway dev script rebuilds workspace packages before boot", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "..", "..", "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(manifest.scripts?.dev).toContain("workspace-build.mjs build");
    expect(manifest.scripts?.["dev:embedded"]).toContain("workspace-build.mjs build");
    expect(manifest.scripts?.["dev:external"]).toContain("workspace-build.mjs build");
  });

  test("detects stale or missing workspace dist for bootstrap dependencies", () => {
    const root = mkdtempSync(join(tmpdir(), "spaceskit-startup-guards-"));

    try {
      mkdirSync(join(root, "packages", "bootstrap"), { recursive: true });
      writeFileSync(
        join(root, "packages", "bootstrap", "package.json"),
        JSON.stringify({
          name: "@spaceskit/bootstrap",
          dependencies: {
            "@spaceskit/core": "*",
            "@spaceskit/server": "*",
          },
        }),
      );

      mkdirSync(join(root, "packages", "core", "src"), { recursive: true });
      mkdirSync(join(root, "packages", "core", "dist"), { recursive: true });
      writeFileSync(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@spaceskit/core" }));
      writeFileSync(join(root, "packages", "core", "src", "index.ts"), "export const core = true;\n");
      writeFileSync(join(root, "packages", "core", "dist", "index.js"), "export const core = true;\n");

      mkdirSync(join(root, "packages", "server", "src"), { recursive: true });
      writeFileSync(join(root, "packages", "server", "package.json"), JSON.stringify({ name: "@spaceskit/server" }));
      writeFileSync(join(root, "packages", "server", "src", "index.ts"), "export const server = true;\n");

      const now = Date.now() / 1000;
      utimesSync(join(root, "packages", "core", "dist", "index.js"), now - 120, now - 120);
      utimesSync(join(root, "packages", "core", "src", "index.ts"), now, now);

      const stalePackages = findStaleBootstrapWorkspacePackages({ gatewayRoot: root });

      expect(stalePackages).toEqual([
        {
          packageName: "@spaceskit/core",
          reason: "dist_older_than_src",
        },
        {
          packageName: "@spaceskit/server",
          reason: "missing_dist",
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
