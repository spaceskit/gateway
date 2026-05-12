import { rmSync } from "node:fs";

export const INTEGRATION_TIMEOUT = 30_000;

export function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

export function removeDbArtifacts(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

export function gatewayErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" ? candidate : undefined;
}

export function gatewayErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { message?: unknown }).message;
  return typeof candidate === "string" ? candidate : undefined;
}
