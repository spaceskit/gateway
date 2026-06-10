import { readFile } from "node:fs/promises";
import {
  resolveHttpPrincipalContext,
  type HttpPrincipalAuthOptions,
} from "./http-principal-auth.js";

export interface HarnessConciergeApiServiceOptions {
  pingsPath?: string;
  principalAuth?: HttpPrincipalAuthOptions;
  requireAuthenticatedPrincipal?: boolean;
}

export class HarnessConciergeApiService {
  constructor(private readonly options: HarnessConciergeApiServiceOptions) {}

  async handleRequest(req: Request, url: URL): Promise<Response | null> {
    const matched = url.pathname === "/api/concierge-pings" || url.pathname === "/v1/concierge-pings";
    if (!matched) return null;

    const auth = resolveHttpPrincipalContext(req, this.options.principalAuth);
    if (!auth.ok) {
      return jsonError(401, auth.error.code, auth.error.message);
    }
    if (this.options.requireAuthenticatedPrincipal && !auth.context.principalId) {
      return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
    }

    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }

    const path = this.options.pingsPath ?? "/Users/caruso/Documents/work/harness/state/concierge-pings.json";
    try {
      const payload = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      return jsonOk({ ...payload, sourcePath: path });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(404, "NOT_FOUND", `Concierge pings unavailable at ${path}: ${message}`);
    }
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
