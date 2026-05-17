export function isAddressInUseError(err: unknown): boolean {
  const code = typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: unknown }).code
    : undefined;
  if (code === "EADDRINUSE") return true;

  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return normalized.includes("eaddrinuse")
    || normalized.includes("address already in use")
    || normalized.includes("port is in use");
}
