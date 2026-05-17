import { randomUUID } from "node:crypto";
import { handleHealthRequest } from "./health-http-routes.js";
import { withCors as attachCorsHeaders } from "./http-response-helpers.js";
import { handleSyncHttpRequest } from "./sync-http-routes.js";
import type { GatewayServerOptions, WSData } from "./gateway-server.js";

interface GatewayHttpServer {
  requestIP(req: Request): { address?: string } | null;
  upgrade(req: Request, options: { data: WSData }): boolean;
}

export async function handleGatewayServerHttpRequest(input: {
  req: Request;
  server: GatewayHttpServer;
  options: GatewayServerOptions;
  startedAt: number;
  clientCount: number;
  isDraining: boolean;
  connectionsPerIp: Map<string, number>;
  consumeRateLimit: (ip: string) => boolean;
}): Promise<Response | undefined> {
  const { req, server, options } = input;
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return withCors(input, new Response(null, { status: 204 }));
  }

  const clientIp = server.requestIP(req)?.address ?? "unknown";
  if (!input.consumeRateLimit(clientIp)) {
    return withCors(input, new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    }));
  }

  if (url.pathname === "/health") {
    const healthResponse = await handleHealthRequest({
      request: req,
      url,
      healthCheck: options.healthCheck,
      snapshot: {
        startedAt: input.startedAt,
        clientCount: input.clientCount,
        draining: input.isDraining,
      },
    });
    return withCors(input, healthResponse);
  }

  if (options.a2aHandler) {
    const a2aResponse = await options.a2aHandler.handleRequest(req);
    if (a2aResponse) return withCors(input, a2aResponse);
  }

  if (url.pathname.startsWith("/sync/")) {
    const syncResponse = await handleSyncHttpRequest(req, url.pathname, options);
    return withCors(input, syncResponse);
  }

  if (options.httpHandler) {
    const handled = await options.httpHandler(req, url);
    if (handled) {
      return withCors(input, handled);
    }
  }

  if (input.isDraining) {
    return withCors(input, new Response("Server draining", { status: 503 }));
  }

  const wsClientIp = resolveWebSocketClientIp(req, server, options);
  const maxConnections = options.maxConnectionsPerIp ?? 10;
  if ((input.connectionsPerIp.get(wsClientIp) ?? 0) >= maxConnections) {
    return withCors(input, new Response("Too many connections from this IP", { status: 429 }));
  }

  const sessionId = randomUUID();
  const upgraded = server.upgrade(req, {
    data: { sessionId, clientIp: wsClientIp },
  });

  if (!upgraded) {
    return withCors(input, new Response("WebSocket upgrade failed", { status: 400 }));
  }

  return undefined;
}

function resolveWebSocketClientIp(
  req: Request,
  server: GatewayHttpServer,
  options: GatewayServerOptions,
): string {
  const detectedIp = server.requestIP(req)?.address
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return options.resolveClientIp
    ? options.resolveClientIp(req, detectedIp)
    : detectedIp;
}

function withCors(
  input: { req: Request; options: GatewayServerOptions },
  response: Response,
): Response {
  return attachCorsHeaders(input.req, response, input.options.allowedOrigins);
}
