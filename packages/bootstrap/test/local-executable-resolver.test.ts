import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalExecutableResolver } from "../src/execution/local-executable-resolver.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const path = tempDirs.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "spaces-resolver-"));
  tempDirs.push(path);
  return path;
}

function makeExecutable(path: string): void {
  writeFileSync(path, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(path, 0o755);
}

describe("LocalExecutableResolver", () => {
  test("prefers manual override and returns version metadata", () => {
    const root = makeTempDir();
    const manualPath = join(root, "claude");
    makeExecutable(manualPath);

    const resolver = new LocalExecutableResolver({
      spawnSyncFn(command, args) {
        if (command === manualPath && args[0] === "--version") {
          return {
            pid: 1,
            output: [],
            stdout: "2.1.71 (Claude Code)\n",
            stderr: "",
            status: 0,
            signal: null,
          } as any;
        }
        throw new Error(`Unexpected spawn: ${command} ${args.join(" ")}`);
      },
      env: {},
      homeDir: root,
    });

    const resolved = resolver.resolve({
      cacheKey: "claude",
      commands: ["claude"],
      manualPath,
      versionProbe: { args: ["--version"] },
    });

    expect(resolved.path).toBe(manualPath);
    expect(resolved.version).toBe("2.1.71 (Claude Code)");
    expect(resolved.resolutionSource).toBe("manual");
    expect(resolved.manualPathConfigured).toBe(true);
  });

  test("resolves executables from process PATH", () => {
    const root = makeTempDir();
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    const codexPath = join(binDir, "codex");
    makeExecutable(codexPath);

    const resolver = new LocalExecutableResolver({
      spawnSyncFn(command, args) {
        if (command === codexPath && args[0] === "--version") {
          return {
            pid: 1,
            output: [],
            stdout: "codex-cli 0.111.0\n",
            stderr: "",
            status: 0,
            signal: null,
          } as any;
        }
        throw new Error(`Unexpected spawn: ${command} ${args.join(" ")}`);
      },
      env: { PATH: binDir },
      homeDir: root,
    });

    const resolved = resolver.resolve({
      cacheKey: "codex",
      commands: ["codex"],
      versionProbe: { args: ["--version"] },
    });

    expect(resolved.path).toBe(codexPath);
    expect(resolved.version).toBe("codex-cli 0.111.0");
    expect(resolved.resolutionSource).toBe("process_path");
    expect(resolved.manualPathConfigured).toBe(false);
  });

  test("falls back to login-shell lookup when PATH is narrow", () => {
    const root = makeTempDir();
    const geminiPath = join(root, "gemini");
    makeExecutable(geminiPath);

    const resolver = new LocalExecutableResolver({
      spawnSyncFn(command, args) {
        if (command === "/bin/zsh") {
          return {
            pid: 2,
            output: [],
            stdout: `${geminiPath}\n`,
            stderr: "",
            status: 0,
            signal: null,
          } as any;
        }
        if (command === geminiPath && args[0] === "--version") {
          return {
            pid: 3,
            output: [],
            stdout: "0.32.1\n",
            stderr: "",
            status: 0,
            signal: null,
          } as any;
        }
        throw new Error(`Unexpected spawn: ${command} ${args.join(" ")}`);
      },
      env: { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" },
      homeDir: root,
    });

    const resolved = resolver.resolve({
      cacheKey: "gemini",
      commands: ["gemini"],
      versionProbe: { args: ["--version"] },
    });

    expect(resolved.path).toBe(geminiPath);
    expect(resolved.version).toBe("0.32.1");
    expect(resolved.resolutionSource).toBe("login_shell");
  });

  test("uses tcsh-compatible shell lookup when the login shell is tcsh", () => {
    const root = makeTempDir();
    const claudePath = join(root, "claude");
    makeExecutable(claudePath);

    const resolver = new LocalExecutableResolver({
      spawnSyncFn(command, args) {
        if (command === "/bin/tcsh") {
          expect(args).toEqual(["-l", "-c", "which 'claude'"]);
          return {
            pid: 6,
            output: [],
            stdout: `${claudePath}\n`,
            stderr: "",
            status: 0,
            signal: null,
          } as any;
        }
        if (command === claudePath && args[0] === "--version") {
          return {
            pid: 7,
            output: [],
            stdout: "2.1.71 (Claude Code)\n",
            stderr: "",
            status: 0,
            signal: null,
          } as any;
        }
        throw new Error(`Unexpected spawn: ${command} ${args.join(" ")}`);
      },
      env: { SHELL: "/bin/tcsh", PATH: "/usr/bin:/bin" },
      homeDir: root,
    });

    const resolved = resolver.resolve({
      cacheKey: "claude",
      commands: ["claude"],
      versionProbe: { args: ["--version"] },
    });

    expect(resolved.path).toBe(claudePath);
    expect(resolved.version).toBe("2.1.71 (Claude Code)");
    expect(resolved.resolutionSource).toBe("login_shell");
  });

  test("falls back to common install directories under the home folder", () => {
    const root = makeTempDir();
    const bunBinDir = join(root, ".bun", "bin");
    mkdirSync(bunBinDir, { recursive: true });
    const customCommand = "spaces-test-claude";
    const customPath = join(bunBinDir, customCommand);
    makeExecutable(customPath);

    const resolver = new LocalExecutableResolver({
      spawnSyncFn(command, args) {
        if (command === "/bin/zsh") {
          return {
            pid: 4,
            output: [],
            stdout: "",
            stderr: "",
            status: 1,
            signal: null,
          } as any;
        }
        if (command === customPath && args[0] === "--version") {
          return {
            pid: 5,
            output: [],
            stdout: "2.1.71 (Claude Code)\n",
            stderr: "",
            status: 0,
            signal: null,
          } as any;
        }
        throw new Error(`Unexpected spawn: ${command} ${args.join(" ")}`);
      },
      env: { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" },
      homeDir: root,
    });

    const resolved = resolver.resolve({
      cacheKey: customCommand,
      commands: [customCommand],
      versionProbe: { args: ["--version"] },
    });

    expect(resolved.path).toBe(customPath);
    expect(resolved.resolutionSource).toBe("common_path");
  });

  test("keeps detected executable paths even when the version probe does not complete", () => {
    const root = makeTempDir();
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    const claudePath = join(binDir, "claude");
    makeExecutable(claudePath);

    const resolver = new LocalExecutableResolver({
      spawnSyncFn(command, args) {
        if (command === claudePath && args[0] === "--version") {
          return {
            pid: 8,
            output: [],
            stdout: "",
            stderr: "",
            status: null,
            signal: "SIGTERM",
            error: new Error("spawnSync claude ETIMEDOUT"),
          } as any;
        }
        throw new Error(`Unexpected spawn: ${command} ${args.join(" ")}`);
      },
      env: { PATH: binDir },
      homeDir: root,
    });

    const resolved = resolver.resolve({
      cacheKey: "claude",
      commands: ["claude"],
      versionProbe: { args: ["--version"] },
    });

    expect(resolved.path).toBe(claudePath);
    expect(resolved.version).toBeUndefined();
    expect(resolved.resolutionSource).toBe("process_path");
    expect(resolved.error).toBeUndefined();
  });
});
