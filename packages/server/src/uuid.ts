import { createHash } from "node:crypto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_NAMESPACE = "spaceskit.uuid";

export function normalizeUuid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return UUID_REGEX.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

export function deterministicUuid(seed: string, namespace = DEFAULT_NAMESPACE): string {
  const normalizedSeed = seed.trim() || "empty";
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(normalizedSeed)
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
