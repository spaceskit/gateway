import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeArtifact(
  artifactPath: string | undefined,
  repoRoot: string,
  payload: unknown,
): void {
  if (!artifactPath) {
    return;
  }
  const absolute = resolve(repoRoot, artifactPath);
  ensureDir(dirname(absolute));
  writeFileSync(absolute, JSON.stringify(payload, null, 2));
}

export function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} was not a non-empty string`);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
