import type { ErrorPayload, GatewayErrorCode } from "./protocol.js";

const RETRYABLE_ERROR_CODES = new Set<GatewayErrorCode>([
  "INTERNAL",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "RATE_LIMITED",
  "CIRCUIT_OPEN",
]);

const KNOWN_CODES = new Set<GatewayErrorCode>([
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "FAILED_PRECONDITION",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "CIRCUIT_OPEN",
  "UNAUTHENTICATED",
  "INTERNAL",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
]);

function normalizeDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
    };
  }
  return details;
}

export function normalizeGatewayErrorCode(code: string): GatewayErrorCode {
  if (KNOWN_CODES.has(code as GatewayErrorCode)) {
    return code as GatewayErrorCode;
  }
  return "INTERNAL";
}

export function isRetryableGatewayError(code: GatewayErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.has(code);
}

export function buildGatewayErrorPayload(
  code: string,
  message: string,
  correlationId: string,
  details?: unknown,
  retryable?: boolean,
): ErrorPayload {
  const normalizedCode = normalizeGatewayErrorCode(code);
  const normalizedDetails = normalizeDetails(details);
  const payload: ErrorPayload = {
    code: normalizedCode,
    message,
    retryable: retryable ?? isRetryableGatewayError(normalizedCode),
    correlationId,
  };

  if (typeof normalizedDetails !== "undefined") {
    payload.details = normalizedDetails;
  }

  return payload;
}
