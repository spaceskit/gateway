import type { HealthCheckContext, HealthStatus } from "./gateway-server.js";

export interface HealthSnapshot {
  startedAt: number;
  clientCount: number;
  draining: boolean;
}

export function parseHealthDebugQuery(url: URL): boolean {
  const value = url.searchParams.get("debug");
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}

export async function handleHealthRequest(input: {
  request: Request;
  url: URL;
  healthCheck?: (context?: HealthCheckContext) => Promise<HealthStatus>;
  snapshot: HealthSnapshot;
}): Promise<Response> {
  const { request, url, healthCheck, snapshot } = input;

  if (healthCheck) {
    try {
      const health = await healthCheck({
        debug: parseHealthDebugQuery(url),
        request,
        url,
      });
      const statusCode = health.status === "ok" || health.status === "degraded" ? 200 : 503;
      return jsonResponse({ ...health, draining: snapshot.draining }, statusCode);
    } catch (healthErr) {
      return jsonResponse({
        status: "error",
        error: healthErr instanceof Error ? healthErr.message : "Health check failed",
        uptime: Math.floor((Date.now() - snapshot.startedAt) / 1000),
        clients: snapshot.clientCount,
        draining: snapshot.draining,
      }, 503);
    }
  }

  return jsonResponse({
    status: "ok",
    uptime: Math.floor((Date.now() - snapshot.startedAt) / 1000),
    clients: snapshot.clientCount,
    draining: snapshot.draining,
  });
}

function jsonResponse(payload: unknown, status?: number): Response {
  return new Response(JSON.stringify(payload), {
    ...(status ? { status } : {}),
    headers: { "Content-Type": "application/json" },
  });
}
