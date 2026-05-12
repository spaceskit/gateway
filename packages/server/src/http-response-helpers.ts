const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "Content-Type, Authorization, x-spaceskit-sync-secret";

export function corsHeaders(
  req: Request,
  allowedOrigins: readonly string[] | undefined,
): Record<string, string> {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return {};
  }

  const requestOrigin = req.headers.get("Origin");
  if (!requestOrigin) {
    return {};
  }

  if (allowedOrigins.includes("*")) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS,
    };
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return {
      "Access-Control-Allow-Origin": requestOrigin,
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS,
      "Vary": "Origin",
    };
  }

  return {};
}

export function withCors(
  req: Request,
  res: Response,
  allowedOrigins: readonly string[] | undefined,
): Response {
  const headers = corsHeaders(req, allowedOrigins);
  if (Object.keys(headers).length === 0) return res;
  const merged = new Headers(res.headers);
  for (const [key, value] of Object.entries(headers)) {
    merged.set(key, value);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: merged,
  });
}
