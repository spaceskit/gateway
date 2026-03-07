import type { GatewayObservabilityService } from "./gateway-observability-service.js";
import {
  resolveHttpPrincipalContext,
  type HttpPrincipalAuthOptions,
} from "./http-principal-auth.js";

export interface GatewayObservabilityApiServiceOptions {
  observabilityService?: Pick<GatewayObservabilityService, "getSummary" | "formatPrometheus">;
  principalAuth?: HttpPrincipalAuthOptions;
  /**
   * If true, all matched routes require an authenticated principal identity.
   */
  requireAuthenticatedPrincipal?: boolean;
}

export class GatewayObservabilityApiService {
  constructor(private readonly options: GatewayObservabilityApiServiceOptions) {}

  async handleRequest(req: Request, url: URL): Promise<Response | null> {
    const metricsRoute = url.pathname === "/metrics";
    const summaryRoute = url.pathname === "/v1/observability/summary";
    if (!metricsRoute && !summaryRoute) {
      return null;
    }

    const auth = resolveHttpPrincipalContext(req, this.options.principalAuth);
    if (!auth.ok) {
      return jsonError(401, auth.error.code, auth.error.message);
    }
    const principalId = auth.context.principalId;

    if (metricsRoute) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleMetrics(req);
    }

    if (summaryRoute) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleSummary(req);
    }

    return null;
  }

  private async handleMetrics(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.observabilityService) {
      return jsonError(412, "FAILED_PRECONDITION", "Observability service unavailable");
    }

    return new Response(this.options.observabilityService.formatPrometheus(), {
      status: 200,
      headers: {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  }

  private async handleSummary(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.observabilityService) {
      return jsonError(412, "FAILED_PRECONDITION", "Observability service unavailable");
    }
    return jsonOk(this.options.observabilityService.getSummary());
  }
}

function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
