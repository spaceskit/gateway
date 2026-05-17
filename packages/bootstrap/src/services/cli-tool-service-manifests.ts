import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { LocalExecutableResolver } from "../execution/local-executable-resolver.js";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  defaultInstructions,
} from "./cli-tool-service-defaults.js";
import { CliToolServiceError } from "./cli-tool-service-error.js";
import {
  normalizeAbsolutePath,
  normalizeArgsTemplate,
  normalizeExamples,
  normalizeId,
  normalizeInputSchema,
  normalizeIsoTimestamp,
  normalizeMaxOutputBytes,
  normalizeOptionalString,
  normalizeRequiredString,
  normalizeSchemaVersion,
  normalizeTimeout,
  parseCwdMode,
  parseDangerLevel,
  parseOutputMode,
} from "./cli-tool-service-normalizers.js";
import type {
  CliToolManifestRecord,
  RegisteredCliTool,
  RegisterCliToolInput,
} from "./cli-tool-service-types.js";

export function providerIdForTool(toolId: string): string {
  return `cli-tool-${toolId}`;
}

export async function materializeCliToolManifest(
  input: RegisterCliToolInput,
  deps: {
    loaded: ReadonlyMap<string, RegisteredCliTool>;
    executableResolver: LocalExecutableResolver;
  },
): Promise<CliToolManifestRecord> {
  const schemaVersion = normalizeSchemaVersion(input.schemaVersion);
  const id = normalizeId(input.id, "id");
  const displayName = normalizeRequiredString(input.displayName, "displayName");
  const description = normalizeRequiredString(input.description, "description");
  const bundleId = normalizeOptionalString(input.bundleId);
  const bundleDisplayName = bundleId ? normalizeOptionalString(input.bundleDisplayName) : undefined;
  const bundleDescription = bundleId ? normalizeOptionalString(input.bundleDescription) : undefined;
  const toolGroupId = bundleId ? normalizeOptionalString(input.toolGroupId) : undefined;
  const toolGroupDisplayName = bundleId && toolGroupId
    ? normalizeOptionalString(input.toolGroupDisplayName)
    : undefined;
  const executable = normalizeRequiredString(input.executable, "executable");
  const argsTemplate = normalizeArgsTemplate(input.argsTemplate);
  const cwdMode = parseCwdMode(input.cwdMode);
  const fixedCwd = cwdMode === "fixed"
    ? normalizeAbsolutePath(input.fixedCwd, "fixedCwd")
    : undefined;
  const outputMode = parseOutputMode(input.outputMode);
  const timeoutMs = normalizeTimeout(input.timeoutMs);
  const maxOutputBytes = normalizeMaxOutputBytes(input.maxOutputBytes);
  const inputSchema = normalizeInputSchema(input.inputSchema);
  const instructions = normalizeOptionalString(input.instructions) ?? defaultInstructions(displayName, outputMode);
  const examples = normalizeExamples(input.examples, outputMode);
  const dangerLevel = parseDangerLevel(input.dangerLevel);
  const enabled = input.enabled ?? deps.loaded.get(id)?.enabled ?? true;

  const resolved = await deps.executableResolver.resolveAsync({
    cacheKey: `cli-tool:${id}`,
    commands: [executable],
    versionProbe: { args: ["--version"], timeoutMs: 750 },
    manualPath: isAbsolute(executable) ? executable : undefined,
  });
  if (!resolved.path) {
    throw new CliToolServiceError(
      "FAILED_PRECONDITION",
      resolved.error
        ? `Failed resolving CLI tool executable: ${resolved.error}`
        : `Failed resolving CLI tool executable: ${executable}`,
    );
  }

  const now = new Date().toISOString();
  const existing = deps.loaded.get(id);
  return {
    schemaVersion,
    id,
    displayName,
    description,
    bundleId,
    bundleDisplayName,
    bundleDescription,
    toolGroupId,
    toolGroupDisplayName,
    executable,
    resolvedExecutable: resolved.path,
    argsTemplate,
    inputSchema,
    instructions,
    examples,
    timeoutMs,
    maxOutputBytes,
    cwdMode,
    fixedCwd,
    outputMode,
    dangerLevel,
    enabled,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function manifestRecordFromTool(tool: RegisteredCliTool): CliToolManifestRecord {
  return {
    schemaVersion: tool.schemaVersion,
    id: tool.id,
    displayName: tool.displayName,
    description: tool.description,
    bundleId: tool.bundleId,
    bundleDisplayName: tool.bundleDisplayName,
    bundleDescription: tool.bundleDescription,
    toolGroupId: tool.toolGroupId,
    toolGroupDisplayName: tool.toolGroupDisplayName,
    executable: tool.executable,
    resolvedExecutable: tool.resolvedExecutable,
    argsTemplate: [...tool.argsTemplate],
    inputSchema: { ...tool.inputSchema },
    instructions: tool.instructions,
    examples: tool.examples.map((example) => ({ ...example, arguments: { ...example.arguments } })),
    timeoutMs: tool.timeoutMs,
    maxOutputBytes: tool.maxOutputBytes,
    cwdMode: tool.cwdMode,
    fixedCwd: tool.fixedCwd,
    outputMode: tool.outputMode,
    dangerLevel: tool.dangerLevel,
    enabled: tool.enabled,
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt,
  };
}

export async function readCliToolManifest(path: string): Promise<CliToolManifestRecord> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<CliToolManifestRecord>;
  const outputMode = parseOutputMode(raw.outputMode);
  return {
    schemaVersion: normalizeSchemaVersion(raw.schemaVersion),
    id: normalizeId(raw.id, "id"),
    displayName: normalizeRequiredString(raw.displayName, "displayName"),
    description: normalizeRequiredString(raw.description, "description"),
    bundleId: normalizeOptionalString(raw.bundleId),
    bundleDisplayName: normalizeOptionalString(raw.bundleDisplayName),
    bundleDescription: normalizeOptionalString(raw.bundleDescription),
    toolGroupId: normalizeOptionalString(raw.toolGroupId),
    toolGroupDisplayName: normalizeOptionalString(raw.toolGroupDisplayName),
    executable: normalizeRequiredString(raw.executable, "executable"),
    resolvedExecutable: normalizeAbsolutePath(raw.resolvedExecutable, "resolvedExecutable"),
    argsTemplate: normalizeArgsTemplate(raw.argsTemplate),
    inputSchema: normalizeInputSchema(raw.inputSchema),
    instructions: normalizeOptionalString(raw.instructions),
    examples: normalizeExamples(raw.examples, outputMode),
    timeoutMs: normalizeTimeout(raw.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    maxOutputBytes: normalizeMaxOutputBytes(raw.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES),
    cwdMode: parseCwdMode(raw.cwdMode),
    fixedCwd: raw.cwdMode === "fixed"
      ? normalizeAbsolutePath(raw.fixedCwd, "fixedCwd")
      : undefined,
    outputMode,
    dangerLevel: parseDangerLevel(raw.dangerLevel),
    enabled: raw.enabled ?? true,
    createdAt: normalizeIsoTimestamp(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: normalizeIsoTimestamp(raw.updatedAt) ?? new Date().toISOString(),
  };
}
