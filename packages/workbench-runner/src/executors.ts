import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ensureDir } from "./reports.js";
import type {
  CommandAdapterConfig,
  ProcessResult,
  RunContext,
  ScenarioManifest,
  XcodebuildAdapterConfig,
} from "./types.js";

const PM2_LOG_LINES = "200";
const DEFAULT_BLOCKED_EXIT_CODES = [125];

function normalizePath(basePath: string, value: string): string {
  if (value.startsWith("/")) {
    return value;
  }
  return resolve(basePath, value);
}

function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(path));
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

function collectDeclaredArtifacts(scenario: ScenarioManifest, context: RunContext): string[] {
  const refs = new Set<string>();
  for (const artifact of scenario.artifacts) {
    const absolutePath = normalizePath(context.repo_root, artifact);
    if (!existsSync(absolutePath)) {
      continue;
    }
    refs.add(absolutePath);
    if (statSync(absolutePath).isDirectory()) {
      for (const file of listFilesRecursive(absolutePath)) {
        refs.add(file);
      }
    }
  }
  return [...refs].sort();
}

function resolveEnvValue(value: string, env: Record<string, string>): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => env[name] ?? "");
}

function mergeEnv(
  baseEnv: Record<string, string>,
  scenarioEnv: Record<string, string> | undefined,
): Record<string, string> {
  if (!scenarioEnv) {
    return { ...baseEnv };
  }
  const merged = { ...baseEnv };
  for (const [key, value] of Object.entries(scenarioEnv)) {
    merged[key] = resolveEnvValue(value, merged);
  }
  return merged;
}

function execCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  stdoutPath: string,
  stderrPath: string,
): Promise<{ exitCode: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    ensureDir(dirname(stdoutPath));
    ensureDir(dirname(stderrPath));
    const stdoutStream = createWriteStream(stdoutPath);
    const stderrStream = createWriteStream(stderrPath);
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      stdoutStream.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrStream.write(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      stdoutStream.end();
      stderrStream.end();
      rejectPromise(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      stdoutStream.end();
      stderrStream.end();
      if (timedOut && code === null) {
        resolvePromise({ exitCode: 124 });
        return;
      }
      resolvePromise({ exitCode: code });
    });
  });
}

function capturePM2Log(logPath: string): string[] {
  ensureDir(dirname(logPath));
  const shellScript = `
    if command -v pm2 >/dev/null 2>&1; then
      pm2 logs --lines ${PM2_LOG_LINES} --nostream
    elif command -v npx >/dev/null 2>&1; then
      npx --yes pm2 logs --lines ${PM2_LOG_LINES} --nostream
    fi
  `;
  const result = spawnSync("bash", ["-lc", shellScript], {
    encoding: "utf8",
  });
  if ((result.stdout?.trim().length ?? 0) === 0 && (result.stderr?.trim().length ?? 0) === 0) {
    return [];
  }
  writeFileSync(logPath, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  return [logPath];
}

function cleanupMacOSTestProcesses(): void {
  spawnSync("osascript", ["-e", 'tell application id "com.caruso.spaces.macos" to quit'], {
    stdio: "ignore",
  });

  const processes = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  });
  if (processes.status !== 0 || !processes.stdout) {
    return;
  }

  const entries = processes.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number.parseInt(match[1]!, 10),
        ppid: Number.parseInt(match[2]!, 10),
        command: match[3]!,
      };
    })
    .filter((entry): entry is { pid: number; ppid: number; command: string } => entry != null);

  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const targetPids = new Set<number>();

  for (const entry of entries) {
    if (entry.pid === process.pid) {
      continue;
    }

    if (/\/Spaces\.app\/Contents\/MacOS\/Spaces(?:\s|$)/.test(entry.command)) {
      targetPids.add(entry.pid);
      const parent = byPid.get(entry.ppid);
      if (parent && /debugserver/.test(parent.command)) {
        targetPids.add(parent.pid);
      }
      continue;
    }

    if (/debugserver.*\/Spaces\.app\/Contents\/MacOS\/Spaces/.test(entry.command)) {
      targetPids.add(entry.pid);
    }
  }

  for (const pid of [...targetPids].sort((lhs, rhs) => rhs - lhs)) {
    spawnSync("kill", ["-9", String(pid)], {
      stdio: "ignore",
    });
  }
}

function parseSimulatorDestination(destination: string): string | null {
  if (!destination.includes("platform=iOS Simulator")) {
    return null;
  }
  const match = destination.match(/name=([^,]+)/);
  return match?.[1]?.trim() ?? null;
}

function checkIOSDestinationAvailable(destination: string): string | null {
  const simulatorName = parseSimulatorDestination(destination);
  if (!simulatorName) {
    return null;
  }
  const result = spawnSync("xcrun", ["simctl", "list", "devices", "available", "-j"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "xcrun simctl is unavailable";
  }
  try {
    const payload = JSON.parse(result.stdout) as {
      devices?: Record<string, Array<{ name?: string; isAvailable?: boolean }>>;
    };
    const devices = Object.values(payload.devices ?? {}).flat();
    const matched = devices.some((device) => device.name === simulatorName && device.isAvailable !== false);
    return matched ? null : `iOS simulator destination not available: ${simulatorName}`;
  } catch {
    return "failed to parse available iOS simulator destinations";
  }
}

async function runCommandScenario(
  scenario: ScenarioManifest,
  context: RunContext,
  reportDir: string,
): Promise<ProcessResult> {
  const config = scenario.config as CommandAdapterConfig;
  const stdoutPath = join(reportDir, "logs", `${scenario.scenario_id}.stdout.log`);
  const stderrPath = join(reportDir, "logs", `${scenario.scenario_id}.stderr.log`);
  const env = mergeEnv(context.env, config.env);
  const timeoutMs = config.timeout_ms ?? 10 * 60 * 1000;
  const blockedExitCodes = config.blocked_exit_codes ?? DEFAULT_BLOCKED_EXIT_CODES;

  const result = await execCommand(
    "bash",
    ["-lc", config.command],
    normalizePath(context.repo_root, config.cwd),
    env,
    timeoutMs,
    stdoutPath,
    stderrPath,
  );

  const pm2LogPath = join(reportDir, "logs", `${scenario.scenario_id}.pm2.log`);
  const pm2Logs = capturePM2Log(pm2LogPath);
  const logRefs = [stdoutPath, stderrPath, ...pm2Logs];
  const declaredArtifacts = collectDeclaredArtifacts(scenario, context);
  if (blockedExitCodes.includes(result.exitCode ?? -1)) {
    return {
      status: "blocked",
      exitCode: result.exitCode,
      failureAssertion: readFileSync(stderrPath, "utf8").trim() || readFileSync(stdoutPath, "utf8").trim() || `Command blocked with exit code ${result.exitCode}`,
      artifactRefs: [...declaredArtifacts, ...logRefs],
      logRefs,
    };
  }

  if ((result.exitCode ?? 0) !== 0) {
    return {
      status: "failed",
      exitCode: result.exitCode,
      failureAssertion: readFileSync(stderrPath, "utf8").trim() || readFileSync(stdoutPath, "utf8").trim() || `Command failed with exit code ${result.exitCode}`,
      artifactRefs: [...declaredArtifacts, ...logRefs],
      logRefs,
    };
  }

  return {
    status: "passed",
    exitCode: result.exitCode,
    failureAssertion: null,
    artifactRefs: [...declaredArtifacts, ...logRefs],
    logRefs,
  };
}

async function runXcodebuildScenario(
  scenario: ScenarioManifest,
  context: RunContext,
  reportDir: string,
): Promise<ProcessResult> {
  const config = scenario.config as XcodebuildAdapterConfig;
  const env = mergeEnv(context.env, config.env);
  const destination = config.destination_env && env[config.destination_env]
    ? env[config.destination_env]
    : config.destination;
  const iosDestinationIssue = checkIOSDestinationAvailable(destination);
  if (iosDestinationIssue) {
    return {
      status: "blocked",
      exitCode: null,
      failureAssertion: iosDestinationIssue,
      artifactRefs: [],
      logRefs: [],
    };
  }

  if (destination.includes("platform=macOS")) {
    cleanupMacOSTestProcesses();
  }

  const projectPath = normalizePath(context.repo_root, config.project ?? "spaces-mac-ios/Spaces.xcodeproj");
  const xcresultPath = join(reportDir, "results", `${scenario.scenario_id}.xcresult`);
  const attachmentPath = join(reportDir, "attachments", scenario.scenario_id);
  const xcodeLogPath = join(reportDir, "logs", `${scenario.scenario_id}.xcodebuild.log`);
  const stderrPath = join(reportDir, "logs", `${scenario.scenario_id}.xcodebuild.stderr.log`);

  rmSync(xcresultPath, { recursive: true, force: true });
  rmSync(attachmentPath, { recursive: true, force: true });
  ensureDir(attachmentPath);

  const args = [
    "test",
    "-project",
    projectPath,
    "-scheme",
    config.scheme,
    "-destination",
    destination,
    "-resultBundlePath",
    xcresultPath,
  ];
  if (config.only_testing) {
    args.push(`-only-testing:${config.only_testing}`);
  }

  const result = await execCommand(
    "xcodebuild",
    args,
    dirname(projectPath),
    env,
    config.timeout_ms ?? 30 * 60 * 1000,
    xcodeLogPath,
    stderrPath,
  );

  if (existsSync(xcresultPath)) {
    spawnSync("xcrun", [
      "xcresulttool",
      "export",
      "attachments",
      "--path",
      xcresultPath,
      "--output-path",
      attachmentPath,
    ]);
  }

  const pm2LogPath = join(reportDir, "logs", `${scenario.scenario_id}.pm2.log`);
  const pm2Logs = capturePM2Log(pm2LogPath);
  const attachmentFiles = listFilesRecursive(attachmentPath);
  const declaredArtifacts = collectDeclaredArtifacts(scenario, context);
  const artifactRefs = [...declaredArtifacts, xcresultPath, ...attachmentFiles];
  const logRefs = [xcodeLogPath, stderrPath, ...pm2Logs];
  if ((result.exitCode ?? 0) !== 0) {
    return {
      status: "failed",
      exitCode: result.exitCode,
      failureAssertion: readFileSync(xcodeLogPath, "utf8").trim().split("\n").slice(-20).join("\n") || `xcodebuild exited with ${result.exitCode}`,
      artifactRefs,
      logRefs,
    };
  }

  return {
    status: "passed",
    exitCode: result.exitCode,
    failureAssertion: null,
    artifactRefs,
    logRefs,
  };
}

export async function executeScenario(
  scenario: ScenarioManifest,
  context: RunContext,
  reportDir: string,
): Promise<ProcessResult> {
  switch (scenario.adapter) {
    case "noop":
      return {
        status: "passed",
        exitCode: 0,
        failureAssertion: null,
        artifactRefs: [],
        logRefs: [],
      };
    case "shell":
    case "bun":
    case "swift":
      return runCommandScenario(scenario, context, reportDir);
    case "xcodebuild":
      return runXcodebuildScenario(scenario, context, reportDir);
    default:
      return {
        status: "failed",
        exitCode: null,
        failureAssertion: `Unsupported adapter: ${(scenario as { adapter: string }).adapter}`,
        artifactRefs: [],
        logRefs: [],
      };
  }
}
