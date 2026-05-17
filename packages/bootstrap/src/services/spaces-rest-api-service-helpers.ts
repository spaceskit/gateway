export function matchPath(
  path: string,
  pattern: string[],
): Record<string, string> | null {
  const parts = path
    .split("/")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parts.length !== pattern.length) return null;
  const captures: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index]!;
    const actual = parts[index]!;
    if (expected.startsWith(":")) {
      captures[expected.slice(1)] = actual;
      continue;
    }
    if (expected !== actual) return null;
  }
  return captures;
}

export async function parseJsonBody(req: Request): Promise<
  { ok: true; value: Record<string, unknown> } | { ok: false; response: Response }
> {
  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) {
      return {
        ok: false,
        response: jsonError(400, "INVALID_ARGUMENT", "JSON body must be an object"),
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      response: jsonError(400, "INVALID_ARGUMENT", "Malformed JSON body"),
    };
  }
}

export function normalizeRequired(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("required");
  }
  return normalized;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeAccessMode(value: unknown): "default" | "full_access" | undefined {
  const normalized = normalizeOptionalString(value);
  if (normalized === "default" || normalized === "full_access") {
    return normalized;
  }
  return undefined;
}

export function parseBooleanQuery(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return undefined;
}

export function parsePositiveInt(value: string | null): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function parseNonNegativeInt(value: string | null): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function mapServiceError(error: unknown): Response {
  const code = isRecord(error) && typeof error.code === "string"
    ? error.code
    : "INTERNAL";
  const message = error instanceof Error
    ? error.message
    : "Unexpected error";
  switch (code) {
    case "UNAUTHENTICATED":
      return jsonError(401, code, message);
    case "INVALID_ARGUMENT":
      return jsonError(400, code, message);
    case "NOT_FOUND":
      return jsonError(404, code, message);
    case "PERMISSION_DENIED":
      return jsonError(403, code, message);
    case "FAILED_PRECONDITION":
      return jsonError(412, code, message);
    case "QUOTA_EXCEEDED":
      return jsonError(429, code, message);
    default:
      return jsonError(500, "INTERNAL", message);
  }
}
