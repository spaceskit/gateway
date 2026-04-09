const SAFE_TOKEN_KEYS = new Set([
  "prompttokens",
  "completiontokens",
  "totaltokens",
  "inputtokens",
  "outputtokens",
  "inputnocachetokens",
  "inputcachereadtokens",
  "inputcachewritetokens",
  "outputtexttokens",
  "outputreasoningtokens",
  "cachedinputtokens",
  "tokenspersecond",
]);

export function sanitizeTracePayload(value: unknown, keyPath: string[] = []): Record<string, unknown> {
  const sanitized = sanitizeValue(value, keyPath);
  if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return {
    value: sanitized,
  };
}

function sanitizeValue(value: unknown, keyPath: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, keyPath));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (shouldRedactKey(key, keyPath)) {
        const normalized = normalizeKey(key);
        next[key] = normalized === "messages" ? "[REDACTED_MESSAGES]" : "[REDACTED]";
        continue;
      }
      next[key] = sanitizeValue(nested, [...keyPath, key]);
    }
    return next;
  }
  return value;
}

function shouldRedactKey(key: string, _keyPath: string[]): boolean {
  const normalized = normalizeKey(key);
  if (SAFE_TOKEN_KEYS.has(normalized)) return false;
  return normalized === "messages"
    || normalized.includes("instruction")
    || normalized.includes("prompt")
    || normalized.includes("planner")
    || normalized.includes("guest")
    || normalized.includes("peerreview")
    || normalized.includes("synthesis")
    || normalized.includes("tooltrace")
    || normalized.includes("rawtrace")
    || normalized.includes("apikey")
    || normalized.includes("secret")
    || normalized.includes("token");
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}
