import { isAbsolute, resolve as resolvePath } from "node:path";
import { CliToolServiceError } from "./cli-tool-service-error.js";
import {
  CLI_TOOL_SCHEMA_VERSION,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  defaultExamples,
} from "./cli-tool-service-defaults.js";
import type {
  CliToolCwdMode,
  CliToolDangerLevel,
  CliToolExampleRecord,
  CliToolOutputMode,
} from "./cli-tool-service-types.js";

export function normalizeId(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new CliToolServiceError("INVALID_ARGUMENT", `${field} must contain at least one identifier character.`);
  }
  return normalized;
}

export function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new CliToolServiceError("INVALID_ARGUMENT", `${field} is required.`);
  }
  return normalized;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export function normalizeAbsolutePath(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field);
  if (!isAbsolute(normalized)) {
    throw new CliToolServiceError("INVALID_ARGUMENT", `${field} must be an absolute path.`);
  }
  return resolvePath(normalized);
}

export function normalizeArgsTemplate(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "argsTemplate must be a non-empty string array.");
  }
  return value.map((entry, index) => normalizeRequiredString(entry, `argsTemplate[${index}]`));
}

export function normalizeInputSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "inputSchema must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function normalizeExamples(
  value: unknown,
  outputMode: CliToolOutputMode,
): CliToolExampleRecord[] {
  if (value === undefined || value === null) {
    return defaultExamples(outputMode);
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "examples must be an array when provided.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CliToolServiceError("INVALID_ARGUMENT", `examples[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    return {
      name: normalizeRequiredString(record.name, `examples[${index}].name`),
      description: normalizeOptionalString(record.description),
      arguments: normalizeInputSchema(record.arguments),
      expectedOutput: normalizeOptionalString(record.expectedOutput),
    };
  });
}

export function parseCwdMode(value: unknown): CliToolCwdMode {
  if (value === "space_root" || value === "fixed") {
    return value;
  }
  throw new CliToolServiceError("INVALID_ARGUMENT", "cwdMode must be \"space_root\" or \"fixed\".");
}

export function parseOutputMode(value: unknown): CliToolOutputMode {
  if (value === "text" || value === "json") {
    return value;
  }
  throw new CliToolServiceError("INVALID_ARGUMENT", "outputMode must be \"text\" or \"json\".");
}

export function parseDangerLevel(value: unknown): CliToolDangerLevel {
  if (value === undefined || value === null || value === "standard") {
    return "standard";
  }
  if (value === "destructive") {
    return "destructive";
  }
  throw new CliToolServiceError("INVALID_ARGUMENT", "dangerLevel must be \"standard\" or \"destructive\".");
}

export function normalizeSchemaVersion(value: unknown): number {
  const schemaVersion = typeof value === "number" ? Math.trunc(value) : CLI_TOOL_SCHEMA_VERSION;
  if (schemaVersion !== CLI_TOOL_SCHEMA_VERSION) {
    throw new CliToolServiceError(
      "INVALID_ARGUMENT",
      `schemaVersion must be ${CLI_TOOL_SCHEMA_VERSION}.`,
    );
  }
  return schemaVersion;
}

export function normalizeTimeout(value: unknown): number {
  const timeout = typeof value === "number" ? value : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "timeoutMs must be a positive number.");
  }
  return Math.trunc(timeout);
}

export function normalizeMaxOutputBytes(value: unknown): number {
  const maxOutputBytes = typeof value === "number" ? value : DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "maxOutputBytes must be a positive number.");
  }
  return Math.trunc(maxOutputBytes);
}

export function normalizeIsoTimestamp(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export function summarizeReadme(
  readmeContent: string | undefined,
  fallbackDescription: string,
): string | undefined {
  const normalized = normalizeOptionalString(readmeContent);
  if (!normalized) {
    return normalizeOptionalString(fallbackDescription);
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return lines[0] ?? normalizeOptionalString(fallbackDescription);
}
