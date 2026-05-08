import type {
  AppleNotificationLifecycleService,
  AppleNotificationAction,
  ApplePushEnvironment,
  ApplePushPlatform,
  ApplePushTokenKind,
  PatchAppleNotificationPreferencesInput,
} from "@spaceskit/core";
import {
  resolveHttpPrincipalContext,
  type HttpPrincipalAuthOptions,
} from "./http-principal-auth.js";

export interface AppleNotificationApiServiceOptions {
  notificationLifecycleService?: Pick<
    AppleNotificationLifecycleService,
    | "registerDevice"
    | "deleteDevice"
    | "getPreferences"
    | "patchPreferences"
    | "markDeliveryOpened"
    | "resolveFeedback"
  >;
  principalAuth?: HttpPrincipalAuthOptions;
  requireAuthenticatedPrincipal?: boolean;
}

export class AppleNotificationApiService {
  constructor(private readonly options: AppleNotificationApiServiceOptions) {}

  async handleRequest(req: Request, url: URL): Promise<Response | null> {
    const devicesMatch = matchPath(url.pathname, ["v1", "notifications", "devices"]);
    const deleteDeviceMatch = matchPath(url.pathname, ["v1", "notifications", "devices", ":registrationId"]);
    const preferencesMatch = matchPath(url.pathname, ["v1", "notifications", "preferences"]);
    const deliveryOpenedMatch = matchPath(url.pathname, [
      "v1",
      "notifications",
      "deliveries",
      ":deliveryId",
      "opened",
    ]);
    const feedbackResolveMatch = matchPath(url.pathname, [
      "v1",
      "notifications",
      "feedback",
      ":feedbackId",
      "resolve",
    ]);

    if (
      !devicesMatch
      && !deleteDeviceMatch
      && !preferencesMatch
      && !deliveryOpenedMatch
      && !feedbackResolveMatch
    ) {
      return null;
    }

    if (!this.options.notificationLifecycleService) {
      return jsonError(412, "FAILED_PRECONDITION", "Apple notification service unavailable");
    }

    const auth = resolveHttpPrincipalContext(req, this.options.principalAuth);
    if (!auth.ok) {
      return jsonError(401, auth.error.code, auth.error.message);
    }
    const principalId = auth.context.principalId ?? null;
    if (!principalId) {
      return jsonError(401, "UNAUTHENTICATED", "Principal identity is required");
    }

    try {
      if (devicesMatch) {
        return this.handleRegisterDevice(req, principalId!, auth.context.deviceId);
      }
      if (deleteDeviceMatch) {
        return this.handleDeleteDevice(req, principalId!, deleteDeviceMatch.registrationId);
      }
      if (preferencesMatch) {
        return this.handlePreferences(req, principalId!);
      }
      if (deliveryOpenedMatch) {
        return this.handleDeliveryOpened(req, principalId!, deliveryOpenedMatch.deliveryId);
      }
      if (feedbackResolveMatch) {
        return this.handleFeedbackResolve(req, principalId!, feedbackResolveMatch.feedbackId);
      }
    } catch (error) {
      return mapServiceError(error);
    }

    return null;
  }

  private async handleRegisterDevice(
    req: Request,
    principalId: string,
    authenticatedDeviceId: string | undefined,
  ): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }
    const body = await parseJsonBody(req);
    if (!body.ok) return body.response;

    const registration = await this.options.notificationLifecycleService!.registerDevice({
      principalId,
      registrationId: normalizeOptionalString(body.value.registrationId),
      deviceId: normalizeOptionalString(body.value.deviceId) ?? authenticatedDeviceId,
      platform: normalizePlatform(body.value.platform),
      tokenKind: normalizeTokenKind(body.value.tokenKind),
      pushToken: normalizeRequired(body.value.pushToken, "pushToken"),
      topic: normalizeOptionalString(body.value.topic),
      environment: normalizeEnvironment(body.value.environment),
      appBundleId: normalizeOptionalString(body.value.appBundleId),
      deviceName: normalizeOptionalString(body.value.deviceName),
      metadata: normalizeRecord(body.value.metadata),
    });
    return jsonOk({ registration });
  }

  private async handleDeleteDevice(
    req: Request,
    principalId: string,
    registrationId: string,
  ): Promise<Response> {
    if (req.method !== "DELETE") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected DELETE");
    }
    const result = await this.options.notificationLifecycleService!.deleteDevice(principalId, registrationId);
    return jsonOk(result);
  }

  private async handlePreferences(req: Request, principalId: string): Promise<Response> {
    if (req.method === "GET") {
      const preferences = await this.options.notificationLifecycleService!.getPreferences(principalId);
      return jsonOk({ preferences });
    }
    if (req.method !== "PATCH") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET or PATCH");
    }
    const body = await parseJsonBody(req);
    if (!body.ok) return body.response;
    const patch: PatchAppleNotificationPreferencesInput = {
      enabled: normalizeOptionalBoolean(body.value.enabled),
      allowCritical: normalizeOptionalBoolean(body.value.allowCritical),
      cooldownSeconds: normalizeOptionalNumber(body.value.cooldownSeconds),
      quietHours: normalizeQuietHoursPatch(body.value.quietHours),
    };
    const preferences = await this.options.notificationLifecycleService!.patchPreferences(principalId, patch);
    return jsonOk({ preferences });
  }

  private async handleDeliveryOpened(
    req: Request,
    principalId: string,
    deliveryId: string,
  ): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }
    const delivery = await this.options.notificationLifecycleService!.markDeliveryOpened(principalId, deliveryId);
    return jsonOk({ delivery });
  }

  private async handleFeedbackResolve(
    req: Request,
    principalId: string,
    feedbackId: string,
  ): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }
    const body = await parseJsonBody(req);
    if (!body.ok) return body.response;
    const result = await this.options.notificationLifecycleService!.resolveFeedback({
      principalId,
      feedbackId,
      action: normalizeAction(body.value.action),
      deliveryId: normalizeOptionalString(body.value.deliveryId),
      message: normalizeOptionalString(body.value.message),
      payload: normalizeRecord(body.value.payload),
    });
    return jsonOk({ result });
  }
}

function matchPath(
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

async function parseJsonBody(req: Request): Promise<
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

function normalizeRequired(value: unknown, name: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw serviceError("INVALID_ARGUMENT", `${name} is required`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePlatform(value: unknown): ApplePushPlatform {
  if (value === "ios" || value === "macos") return value;
  throw serviceError("INVALID_ARGUMENT", "platform must be ios or macos");
}

function normalizeTokenKind(value: unknown): ApplePushTokenKind {
  if (value === undefined || value === null) return "alert";
  if (value === "alert" || value === "voip") return value;
  throw serviceError("INVALID_ARGUMENT", "tokenKind must be alert or voip");
}

function normalizeEnvironment(value: unknown): ApplePushEnvironment {
  if (value === undefined || value === null) return "sandbox";
  if (value === "sandbox" || value === "production") return value;
  throw serviceError("INVALID_ARGUMENT", "environment must be sandbox or production");
}

function normalizeAction(value: unknown): AppleNotificationAction {
  if (
    value === "approve"
    || value === "reject"
    || value === "defer"
    || value === "revise"
    || value === "open_app"
  ) {
    return value;
  }
  throw serviceError("INVALID_ARGUMENT", "action is required");
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeQuietHoursPatch(value: unknown): PatchAppleNotificationPreferencesInput["quietHours"] {
  if (!isRecord(value)) return undefined;
  return {
    enabled: normalizeOptionalBoolean(value.enabled),
    startMinute: normalizeOptionalNumber(value.startMinute),
    endMinute: normalizeOptionalNumber(value.endMinute),
    timeZone: normalizeOptionalString(value.timeZone),
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function mapServiceError(error: unknown): Response {
  const code = isRecord(error) && typeof error.code === "string"
    ? error.code
    : "INTERNAL";
  const message = error instanceof Error ? error.message : "Unexpected error";
  switch (code) {
    case "INVALID_ARGUMENT":
      return jsonError(400, code, message);
    case "UNAUTHENTICATED":
      return jsonError(401, code, message);
    case "NOT_FOUND":
      return jsonError(404, code, message);
    case "FAILED_PRECONDITION":
      return jsonError(412, code, message);
    default:
      return jsonError(500, code, message);
  }
}

function serviceError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
