import type {
  SyncAnnouncePayload,
  SyncAnnounceResponsePayload,
  SyncPullResourcesPayload,
  SyncPullResourcesResponsePayload,
  SyncQueryResourcesPayload,
  SyncQueryResourcesResponsePayload,
} from "./protocol.js";

export interface SyncHttpError {
  code?: string;
  message?: string;
}

export interface SyncHttpHandler {
  announce: (
    payload: SyncAnnouncePayload,
    authSecret?: string,
  ) => Promise<SyncAnnounceResponsePayload> | SyncAnnounceResponsePayload;
  query: (
    payload: SyncQueryResourcesPayload,
    authSecret?: string,
  ) => Promise<SyncQueryResourcesResponsePayload> | SyncQueryResourcesResponsePayload;
  pull: (
    payload: SyncPullResourcesPayload,
    authSecret?: string,
  ) => Promise<SyncPullResourcesResponsePayload> | SyncPullResourcesResponsePayload;
}

export interface SyncHttpRouteOptions {
  syncHttpHandler?: SyncHttpHandler;
  syncRequireSecret?: boolean;
}

export async function handleSyncHttpRequest(
  req: Request,
  pathname: string,
  options: SyncHttpRouteOptions,
): Promise<Response> {
  if (req.method !== "POST") {
    return syncErrorResponse(405, "INVALID_ARGUMENT", "Sync endpoints require POST");
  }

  if (!options.syncHttpHandler) {
    return syncErrorResponse(503, "FAILED_PRECONDITION", "Sync HTTP handler unavailable");
  }

  const payload = await parseJsonBody(req);
  if (payload instanceof Response) {
    return payload;
  }

  const authSecret = req.headers.get("x-spaceskit-sync-secret")?.trim() || undefined;
  if (options.syncRequireSecret && !authSecret) {
    return syncErrorResponse(401, "UNAUTHENTICATED", "Sync secret required");
  }

  try {
    switch (pathname) {
      case "/sync/announce": {
        const result = await options.syncHttpHandler.announce(
          payload as SyncAnnouncePayload,
          authSecret,
        );
        return syncSuccessResponse(result);
      }
      case "/sync/query": {
        const result = await options.syncHttpHandler.query(
          payload as SyncQueryResourcesPayload,
          authSecret,
        );
        return syncSuccessResponse(result);
      }
      case "/sync/pull": {
        const result = await options.syncHttpHandler.pull(
          payload as SyncPullResourcesPayload,
          authSecret,
        );
        return syncSuccessResponse(result);
      }
      default:
        return syncErrorResponse(404, "NOT_FOUND", `Unknown sync endpoint: ${pathname}`);
    }
  } catch (error) {
    const syncError = extractSyncHttpError(error);
    const status = mapSyncErrorCodeToStatus(syncError.code);
    return syncErrorResponse(status, syncError.code, syncError.message);
  }
}

async function parseJsonBody(req: Request): Promise<unknown | Response> {
  try {
    return await req.json();
  } catch {
    return syncErrorResponse(400, "INVALID_ARGUMENT", "Invalid JSON body");
  }
}

function syncSuccessResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function syncErrorResponse(
  status: number,
  code = "FAILED_PRECONDITION",
  message = "Sync request failed",
): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractSyncHttpError(error: unknown): Required<SyncHttpError> {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "FAILED_PRECONDITION";
    const message = typeof record.message === "string"
      ? record.message
      : (error instanceof Error ? error.message : "Sync request failed");
    return { code, message };
  }

  return {
    code: "FAILED_PRECONDITION",
    message: error instanceof Error ? error.message : String(error),
  };
}

function mapSyncErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case "INVALID_ARGUMENT":
      return 400;
    case "PERMISSION_DENIED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "FAILED_PRECONDITION":
      return 412;
    default:
      return 500;
  }
}
