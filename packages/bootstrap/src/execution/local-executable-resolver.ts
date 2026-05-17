import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import { firstNonEmptyLine, shellInvocationArgs, shellLookupCommands, shellQuote } from "./local-executable-shell.js";
export type ExecutableResolutionSource =
  | "manual"
  | "cache"
  | "process_path"
  | "login_shell"
  | "common_path"
  | "app_bundle"
  | "not_found";

interface VersionProbeSpec {
  args: string[];
  timeoutMs?: number;
}

export interface ResolveExecutableInput {
  cacheKey: string;
  commands: string[];
  versionProbe: VersionProbeSpec;
  manualPath?: string;
}

export interface ResolvedExecutable {
  path?: string;
  version?: string;
  resolutionSource: ExecutableResolutionSource;
  manualPathConfigured: boolean;
  error?: string;
}

type SpawnSyncFn = typeof spawnSync;

const COMMON_EXECUTABLE_DIRS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "~/bin",
  "~/.local/bin",
  "~/.bun/bin",
  "~/.cargo/bin",
  "~/.lmstudio/bin",
  "~/Library/pnpm",
];

export class LocalExecutableResolver {
  private readonly cache = new Map<string, string>();
  private readonly spawnSyncFn: SpawnSyncFn;
  private readonly env: NodeJS.ProcessEnv;
  private readonly homeDir: string;
  private readonly userName?: string;

  constructor(input?: {
    spawnSyncFn?: SpawnSyncFn;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    userName?: string;
  }) {
    this.spawnSyncFn = input?.spawnSyncFn ?? spawnSync;
    this.env = input?.env ?? process.env;
    this.homeDir = input?.homeDir ?? homedir();
    this.userName = input?.userName ?? process.env.USER ?? process.env.LOGNAME ?? undefined;
  }

  resolve(input: ResolveExecutableInput): ResolvedExecutable {
    const manualPathConfigured = Boolean(input.manualPath?.trim());

    const manualCandidate = this.normalizeCandidatePath(input.manualPath);
    if (manualCandidate) {
      return this.resolveCandidate({
        cacheKey: input.cacheKey,
        candidatePath: manualCandidate,
        resolutionSource: "manual",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
    }

    const cachedPath = this.cache.get(input.cacheKey);
    if (cachedPath) {
      const resolved = this.resolveCandidate({
        cacheKey: input.cacheKey,
        candidatePath: cachedPath,
        resolutionSource: "cache",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
      if (resolved.path) {
        return resolved;
      }
      this.cache.delete(input.cacheKey);
    }

    const processPathCandidate = this.resolveFromProcessPath(input.commands);
    if (processPathCandidate) {
      const resolved = this.resolveCandidate({
        cacheKey: input.cacheKey,
        candidatePath: processPathCandidate,
        resolutionSource: "process_path",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
      if (resolved.path) {
        return resolved;
      }
    }

    const loginShellCandidate = this.resolveFromLoginShell(input.commands);
    if (loginShellCandidate) {
      const resolved = this.resolveCandidate({
        cacheKey: input.cacheKey,
        candidatePath: loginShellCandidate,
        resolutionSource: "login_shell",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
      if (resolved.path) {
        return resolved;
      }
    }

    const commonPathCandidate = this.resolveFromCommonPaths(input.commands);
    if (commonPathCandidate) {
      const resolved = this.resolveCandidate({
        cacheKey: input.cacheKey,
        candidatePath: commonPathCandidate,
        resolutionSource: "common_path",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
      if (resolved.path) {
        return resolved;
      }
    }

    return {
      resolutionSource: "not_found",
      manualPathConfigured,
    };
  }

  async resolveAsync(input: ResolveExecutableInput): Promise<ResolvedExecutable> {
    const manualPathConfigured = Boolean(input.manualPath?.trim());

    const manualCandidate = this.normalizeCandidatePath(input.manualPath);
    if (manualCandidate) {
      return this.resolveCandidateAsync({
        cacheKey: input.cacheKey,
        candidatePath: manualCandidate,
        resolutionSource: "manual",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
    }

    const cachedPath = this.cache.get(input.cacheKey);
    if (cachedPath) {
      const resolved = await this.resolveCandidateAsync({
        cacheKey: input.cacheKey,
        candidatePath: cachedPath,
        resolutionSource: "cache",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
      if (resolved.path) {
        return resolved;
      }
      this.cache.delete(input.cacheKey);
    }

    const processPathCandidate = this.resolveFromProcessPath(input.commands);
    if (processPathCandidate) {
      const resolved = await this.resolveCandidateAsync({
        cacheKey: input.cacheKey,
        candidatePath: processPathCandidate,
        resolutionSource: "process_path",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
      if (resolved.path) {
        return resolved;
      }
    }

    const loginShellCandidate = this.resolveFromLoginShell(input.commands);
    if (loginShellCandidate) {
      const resolved = await this.resolveCandidateAsync({
        cacheKey: input.cacheKey,
        candidatePath: loginShellCandidate,
        resolutionSource: "login_shell",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
      if (resolved.path) {
        return resolved;
      }
    }

    const commonPathCandidate = this.resolveFromCommonPaths(input.commands);
    if (commonPathCandidate) {
      const resolved = await this.resolveCandidateAsync({
        cacheKey: input.cacheKey,
        candidatePath: commonPathCandidate,
        resolutionSource: "common_path",
        manualPathConfigured,
        versionProbe: input.versionProbe,
      });
      if (resolved.path) {
        return resolved;
      }
    }

    return {
      resolutionSource: "not_found",
      manualPathConfigured,
    };
  }

  private resolveFromProcessPath(commands: string[]): string | undefined {
    const pathValue = this.env.PATH?.trim();
    if (!pathValue) {
      return undefined;
    }
    return this.searchDirectories(commands, pathValue.split(":").filter((entry) => entry.trim().length > 0));
  }

  private resolveFromCommonPaths(commands: string[]): string | undefined {
    const directories = COMMON_EXECUTABLE_DIRS.map((entry) => this.expandHome(entry));
    return this.searchDirectories(commands, directories);
  }

  private resolveFromLoginShell(commands: string[]): string | undefined {
    const shellPath = this.detectLoginShell();
    if (!shellPath) {
      return undefined;
    }

    const lookupCommands = shellLookupCommands(shellPath);
    for (const command of commands) {
      for (const lookupCommand of lookupCommands) {
        const result = this.spawnSyncFn(
          shellPath,
          shellInvocationArgs(shellPath, `${lookupCommand} ${shellQuote(command)}`),
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 500,
            env: this.env,
          },
        );
        if (result.status !== 0) {
          continue;
        }
        const candidate = firstNonEmptyLine(result.stdout);
        if (!candidate) {
          continue;
        }
        const normalized = this.normalizeCandidatePath(candidate);
        if (normalized) {
          return normalized;
        }
      }
    }

    return undefined;
  }

  private detectLoginShell(): string | undefined {
    const envShell = this.normalizeCandidatePath(this.env.SHELL);
    if (envShell && existsSync(envShell)) {
      return envShell;
    }

    const userName = this.userName?.trim();
    if (userName) {
      if (process.platform === "darwin") {
        const result = this.spawnSyncFn("dscl", [".", "-read", `/Users/${userName}`, "UserShell"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1000,
        });
        if (result.status === 0) {
          const match = result.stdout.match(/UserShell:\s+(.+)/);
          const resolved = this.normalizeCandidatePath(match?.[1]);
          if (resolved && existsSync(resolved)) {
            return resolved;
          }
        }
      }

      const getent = this.spawnSyncFn("getent", ["passwd", userName], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      });
      if (getent.status === 0) {
        const entry = getent.stdout.trim().split(":");
        const resolved = this.normalizeCandidatePath(entry[6]);
        if (resolved && existsSync(resolved)) {
          return resolved;
        }
      }
    }

    for (const fallback of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
      if (existsSync(fallback)) {
        return fallback;
      }
    }

    return undefined;
  }

  private searchDirectories(commands: string[], directories: string[]): string | undefined {
    for (const directory of directories) {
      const normalizedDir = directory.trim();
      if (!normalizedDir) {
        continue;
      }
      for (const command of commands) {
        const candidate = join(normalizedDir, command);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  private verifyExecutable(
    executablePath: string,
    versionProbe: VersionProbeSpec,
  ): { ok: boolean; version?: string; error?: string } {
    const result = this.spawnSyncFn(executablePath, versionProbe.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: versionProbe.timeoutMs ?? 500,
    });
    if (result.error) {
      return { ok: false, error: result.error.message || String(result.error) };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        error: firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout)
          || `${basename(executablePath)} version probe failed with status ${result.status ?? "unknown"}.`,
      };
    }
    return {
      ok: true,
      version: firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr) || undefined,
    };
  }

  private resolveCandidate(input: {
    cacheKey: string;
    candidatePath: string;
    resolutionSource: Exclude<ExecutableResolutionSource, "not_found" | "app_bundle">;
    manualPathConfigured: boolean;
    versionProbe: VersionProbeSpec;
  }): ResolvedExecutable {
    if (!this.isExecutable(input.candidatePath)) {
      return {
        resolutionSource: input.resolutionSource,
        manualPathConfigured: input.manualPathConfigured,
        error: `Executable path is not usable: ${input.candidatePath}`,
      };
    }

    const verified = this.verifyExecutable(input.candidatePath, input.versionProbe);
    this.cache.set(input.cacheKey, input.candidatePath);
    return {
      path: input.candidatePath,
      version: verified.ok ? verified.version : undefined,
      resolutionSource: input.resolutionSource,
      manualPathConfigured: input.manualPathConfigured,
    };
  }

  private async resolveCandidateAsync(input: {
    cacheKey: string;
    candidatePath: string;
    resolutionSource: Exclude<ExecutableResolutionSource, "not_found" | "app_bundle">;
    manualPathConfigured: boolean;
    versionProbe: VersionProbeSpec;
  }): Promise<ResolvedExecutable> {
    if (!this.isExecutable(input.candidatePath)) {
      return {
        resolutionSource: input.resolutionSource,
        manualPathConfigured: input.manualPathConfigured,
        error: `Executable path is not usable: ${input.candidatePath}`,
      };
    }

    const verified = await this.verifyExecutableAsync(input.candidatePath, input.versionProbe);
    this.cache.set(input.cacheKey, input.candidatePath);
    return {
      path: input.candidatePath,
      version: verified.ok ? verified.version : undefined,
      resolutionSource: input.resolutionSource,
      manualPathConfigured: input.manualPathConfigured,
    };
  }

  private isExecutable(candidatePath: string): boolean {
    try {
      accessSync(candidatePath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeCandidatePath(value?: string | null): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    const expanded = this.expandHome(trimmed);
    return isAbsolute(expanded) ? expanded : resolve(expanded);
  }

  private expandHome(value: string): string {
    if (value === "~") {
      return this.homeDir;
    }
    if (value.startsWith("~/")) {
      return join(this.homeDir, value.slice(2));
    }
    return value;
  }

  private async verifyExecutableAsync(
    executablePath: string,
    versionProbe: VersionProbeSpec,
  ): Promise<{ ok: boolean; version?: string; error?: string }> {
    return await new Promise((resolve) => {
      const child = spawn(executablePath, versionProbe.args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: this.env,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGTERM");
        resolve({ ok: false, error: "version probe timed out" });
      }, versionProbe.timeoutMs ?? 500);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, error: error.message || String(error) });
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          resolve({
            ok: false,
            error: firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout)
              || `${basename(executablePath)} version probe failed with status ${code ?? "unknown"}.`,
          });
          return;
        }
        resolve({
          ok: true,
          version: firstNonEmptyLine(stdout) || firstNonEmptyLine(stderr) || undefined,
        });
      });
    });
  }
}
