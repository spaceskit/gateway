#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  HRVST_TOOL_DEFINITIONS,
  SPACES_HRVST_WRAPPER_VERSION,
  getHarvestToolDefinitionByOperation,
} from "./catalog.mjs";

const COMMON_HRVST_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "~/.local/bin",
  "~/bin",
];

export function buildHrvstCommandArgs(operation, payloadInput = {}) {
  const tool = normalizeOperation(operation);
  const payload = normalizePayloadRecord(payloadInput);
  const args = [...tool.command];
  const argumentsArray = normalizeArgumentsArray(payload.arguments);
  if (argumentsArray.length < tool.minArguments) {
    throw new Error(
      `Harvest operation ${tool.operation} requires at least ${tool.minArguments} argument(s): ${tool.argumentNames.join(", ")}`,
    );
  }
  if (typeof tool.maxArguments === "number" && argumentsArray.length > tool.maxArguments) {
    throw new Error(
      `Harvest operation ${tool.operation} accepts at most ${tool.maxArguments} argument(s).`,
    );
  }
  args.push(...argumentsArray);
  appendFlags(args, payload.flags, {
    style: "harvest",
  });
  appendPresentFlags(args, payload.presentFlags, {
    style: "harvest",
  });
  if (tool.supportsJsonOutput && !hasFlag(payload.flags, "output")) {
    args.push("--output", "json");
  }
  return args;
}

export async function runHrvstOperation(input, dependencies = {}) {
  const tool = normalizeOperation(input?.operation);
  const payload = normalizePayloadRecord(input?.payload);
  const env = normalizeEnv(input?.env ?? process.env);
  const runCommand = dependencies.runCommand ?? spawnCommand;
  const hrvstExecutable = resolveHrvstExecutable(env);
  const args = buildHrvstCommandArgs(tool.operation, payload);
  const result = await executeHrvst({
    executable: hrvstExecutable,
    args,
    env,
    stdin: typeof payload.stdin === "string" ? payload.stdin : undefined,
    runCommand,
  });

  return envelope(tool.operation, summarizeSuccess(tool), {
    data: normalizeOutput(tool, result.stdout),
    refs: buildRefs(payload),
  });
}

export function parseWrapperCliArgs(argvInput = []) {
  const argv = Array.isArray(argvInput) ? [...argvInput] : [];
  const parsed = {
    help: false,
    version: false,
    operation: "",
    payload: {},
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
    if (token === "--op" || token === "--operation") {
      parsed.operation = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token.startsWith("--op=") || token.startsWith("--operation=")) {
      parsed.operation = token.split("=", 2)[1] ?? "";
      continue;
    }
    if (token === "--payload") {
      parsed.payload = parsePayloadArgument(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--payload=")) {
      parsed.payload = parsePayloadArgument(token.split("=", 2)[1]);
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }

  return parsed;
}

export function resolveHrvstExecutable(envInput = process.env) {
  const env = normalizeEnv(envInput);
  const explicit = nonEmptyString(env.SPACES_HRVST_EXECUTABLE);
  if (explicit) {
    assertExecutable(resolve(explicit), "SPACES_HRVST_EXECUTABLE");
    return resolve(explicit);
  }

  const searchDirs = [
    ...splitPathEntries(env.PATH),
    ...COMMON_HRVST_DIRS.map((entry) => expandHome(entry, env.HOME)),
  ];
  const visited = new Set();
  for (const dir of searchDirs) {
    const normalizedDir = nonEmptyString(dir);
    if (!normalizedDir || visited.has(normalizedDir)) {
      continue;
    }
    visited.add(normalizedDir);
    const candidate = join(normalizedDir, "hrvst");
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate `hrvst` in PATH or common install directories. Install hrvst-cli or set SPACES_HRVST_EXECUTABLE.",
  );
}

function normalizeOperation(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("A Harvest wrapper operation is required.");
  }
  const definition = getHarvestToolDefinitionByOperation(normalized);
  if (!definition) {
    throw new Error(`Unsupported Harvest wrapper operation: ${normalized}`);
  }
  return definition;
}

function normalizeOutput(tool, stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (tool.supportsJsonOutput) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  const parsed = tryParseJson(trimmed);
  if (parsed !== undefined) {
    return parsed;
  }
  return textData(stdout);
}

function summarizeSuccess(tool) {
  if (tool.operation.endsWith(".list")) {
    return `Completed Harvest list operation ${tool.operation}.`;
  }
  if (tool.operation.endsWith(".get") || tool.operation === "users.me") {
    return `Completed Harvest read operation ${tool.operation}.`;
  }
  return `Completed Harvest operation ${tool.operation}.`;
}

function buildRefs(payload) {
  const refs = {};
  const argumentsArray = normalizeArgumentsArray(payload.arguments);
  if (argumentsArray.length > 0) {
    refs.arguments = argumentsArray;
  }
  const flagKeys = payload.flags && typeof payload.flags === "object"
    ? Object.keys(payload.flags)
    : [];
  if (flagKeys.length > 0) {
    refs.flagKeys = flagKeys.sort();
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
}

async function executeHrvst(input) {
  const result = await input.runCommand({
    executable: input.executable,
    args: input.args,
    env: input.env,
    stdin: input.stdin,
  });
  if (result.exitCode !== 0) {
    throw new Error(normalizeProcessError(result.stderr, result.stdout));
  }
  return result;
}

function appendFlags(target, flagsInput, options) {
  const flags = normalizeFlagRecord(flagsInput);
  for (const [key, rawValue] of Object.entries(flags)) {
    const flagName = renderFlagName(key, options.style);
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        target.push(flagName, renderHarvestScalar(item));
      }
      continue;
    }
    target.push(flagName, renderHarvestScalar(rawValue));
  }
}

function appendPresentFlags(target, flagsInput, options) {
  const presentFlags = Array.isArray(flagsInput) ? flagsInput : [];
  for (const raw of presentFlags) {
    const normalized = typeof raw === "string" ? raw.trim() : "";
    if (!normalized) {
      continue;
    }
    target.push(renderFlagName(normalized, options.style));
  }
}

function renderHarvestScalar(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      throw new Error("Harvest flag values must not be empty.");
    }
    return normalized;
  }
  throw new Error("Harvest flag values must be strings, numbers, booleans, or arrays.");
}

function renderFlagName(value, style) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("Flag names must be non-empty strings.");
  }
  if (normalized.startsWith("--")) {
    return normalized;
  }
  if (style === "harvest") {
    if (/[[_-]/.test(normalized)) {
      return `--${normalized}`;
    }
    return `--${normalized.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`;
  }
  return `--${normalized}`;
}

function hasFlag(flagsInput, flagName) {
  const flags = normalizeFlagRecord(flagsInput);
  return Object.keys(flags).some((key) => key.trim() === flagName || key.trim() === `--${flagName}`);
}

function normalizeArgumentsArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const normalized = typeof item === "string"
      ? item.trim()
      : typeof item === "number"
        ? String(item)
        : "";
    if (!normalized) {
      throw new Error("Wrapper arguments must be non-empty strings or numbers.");
    }
    return normalized;
  });
}

function normalizeFlagRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizePayloadRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeEnv(envInput) {
  return { ...envInput };
}

function normalizeProcessError(stderr, stdout) {
  const message = nonEmptyString(stderr) ?? nonEmptyString(stdout);
  return message ?? "Harvest CLI returned a non-zero exit code.";
}

function textData(stdout) {
  return {
    text: stdout.trim(),
  };
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function envelope(operation, summary, extra = {}) {
  return {
    ok: true,
    operation,
    summary,
    ...extra,
  };
}

function parsePayloadArgument(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return {};
  }
  try {
    const parsed = JSON.parse(normalized);
    return normalizePayloadRecord(parsed);
  } catch (error) {
    throw new Error(`Invalid --payload JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function spawnCommand(input) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(input.executable, input.args, {
      env: input.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
    if (typeof input.stdin === "string") {
      child.stdin?.write(input.stdin);
    }
    child.stdin?.end();
  });
}

function splitPathEntries(value) {
  const normalized = nonEmptyString(value);
  if (!normalized) {
    return [];
  }
  return normalized.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function expandHome(value, homeDirectory) {
  if (!value.startsWith("~")) {
    return value;
  }
  const home = nonEmptyString(homeDirectory);
  return home ? resolve(home, value.slice(2)) : value;
}

function nonEmptyString(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : undefined;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function assertExecutable(path, field) {
  if (!isExecutable(path)) {
    throw new Error(`${field} must point to an executable file: ${path}`);
  }
}

function buildHelpText() {
  return [
    "Spaces Harvest CLI wrapper",
    "",
    "Usage:",
    "  spaces-hrvst --op <operation> --payload <json>",
    "  spaces-hrvst --version",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseWrapperCliArgs(argv);
  if (parsed.help) {
    process.stdout.write(`${buildHelpText()}\n`);
    return;
  }
  if (parsed.version) {
    process.stdout.write(`spaces-hrvst ${SPACES_HRVST_WRAPPER_VERSION}\n`);
    return;
  }

  const result = await runHrvstOperation({
    operation: parsed.operation,
    payload: parsed.payload,
    env: process.env,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const IS_MAIN_MODULE = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (IS_MAIN_MODULE) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
