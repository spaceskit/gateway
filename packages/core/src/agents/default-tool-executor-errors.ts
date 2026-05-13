/**
 * Capability error normalization, retry classification, and target provider
 * coercion helpers for DefaultToolExecutor.
 *
 * Extracted from `default-tool-executor.ts`. Behavior is unchanged — these
 * helpers/types are the same definitions previously declared inline.
 */

/**
 * Standardized error returned from capability/tool invocations.
 * Provides structured error info for agent reasoning + retry logic.
 */
export interface CapabilityError {
  code: string;
  message: string;
  /** Whether the operation could succeed if retried. */
  retryable: boolean;
  /** Original error class name (if applicable). */
  errorType?: string;
  /** Capability + operation that failed. */
  tool: string;
}

/** Known retryable error patterns. */
const RETRYABLE_PATTERNS = [
  /rate.?limit/i,
  /timeout/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /503/,
  /429/,
  /too many requests/i,
  /temporarily unavailable/i,
];

function getErrorCode(err: Error): string {
  if ("code" in err && typeof (err as NodeJS.ErrnoException).code === "string") {
    return (err as NodeJS.ErrnoException).code!;
  }
  return "CAPABILITY_ERROR";
}

/**
 * Convert an unknown error into a structured CapabilityError.
 */
export function toCapabilityError(err: unknown, toolName: string): CapabilityError {
  if (err instanceof Error) {
    const message = err.message;
    const retryable = RETRYABLE_PATTERNS.some((p) => p.test(message));

    return {
      code: getErrorCode(err),
      message,
      retryable,
      errorType: err.constructor.name,
      tool: toolName,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(err),
    retryable: false,
    tool: toolName,
  };
}

export function isCapabilityErrorOutput(value: unknown): value is CapabilityError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string"
    && typeof candidate.message === "string"
    && typeof candidate.tool === "string"
    && (candidate.retryable === undefined || typeof candidate.retryable === "boolean")
  );
}

export function normalizeTargetProvider(rawValue: unknown, toolName: string): string | undefined {
  if (typeof rawValue !== "string") return undefined;
  const trimmed = rawValue.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed.toLowerCase();
  if (
    normalized === "auto"
    || normalized === "default"
    || normalized === "none"
    || normalized === "null"
    || normalized === "nil"
    || normalized === "n/a"
    || normalized === "any"
  ) {
    return undefined;
  }

  if (toolName.startsWith("lists.")) {
    if (
      normalized === "apple"
      || normalized === "apple_reminders"
      || normalized === "apple-reminders"
      || normalized === "reminders"
      || normalized === "eventkit"
    ) {
      return "apple-reminders-eventkit";
    }
  }

  if (toolName.startsWith("email.")) {
    if (
      normalized === "apple"
      || normalized === "apple_mail"
      || normalized === "apple-mail"
      || normalized === "mail"
      || normalized === "mailkit"
    ) {
      return "apple-mail-mailkit";
    }
  }

  return trimmed;
}
