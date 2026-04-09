function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStatusCode(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function extractRetryAfterMs(record: Record<string, unknown>): number | undefined {
  const explicitMs = normalizePositiveMs(record.retryAfterMs ?? record.retry_after_ms);
  if (explicitMs !== undefined) return explicitMs;

  const explicitSeconds = normalizePositiveSeconds(record.retryAfterSeconds ?? record.retry_after_seconds);
  if (explicitSeconds !== undefined) return Math.round(explicitSeconds * 1000);

  const retryAfterValue = parseRetryAfterHeaderMs(record.retryAfter ?? record.retry_after);
  if (retryAfterValue !== undefined) return retryAfterValue;

  const headers = record.headers;
  const retryAfterHeaderMs = parseRetryAfterHeaderMs(readHeader(headers, "retry-after"));
  if (retryAfterHeaderMs !== undefined) return retryAfterHeaderMs;

  const retryAfterMsHeader = normalizePositiveMs(readHeader(headers, "retry-after-ms"));
  if (retryAfterMsHeader !== undefined) return retryAfterMsHeader;

  return undefined;
}

function readHeader(headers: unknown, targetHeader: string): unknown {
  if (!headers) return undefined;
  const normalizedTarget = targetHeader.toLowerCase();

  if (typeof headers === "object" && "get" in headers && typeof headers.get === "function") {
    const value = headers.get(targetHeader) ?? headers.get(normalizedTarget);
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  const record = asRecord(headers);
  if (!record) return undefined;

  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === normalizedTarget) {
      return value;
    }
  }
  return undefined;
}

function parseRetryAfterHeaderMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const asSeconds = Number.parseFloat(trimmed);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      return Math.round(asSeconds * 1000);
    }
    const asDateMs = Date.parse(trimmed);
    if (Number.isFinite(asDateMs)) {
      const deltaMs = asDateMs - Date.now();
      return deltaMs > 0 ? deltaMs : undefined;
    }
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value * 1000);
  }

  return undefined;
}

function normalizePositiveMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }
  return undefined;
}

function normalizePositiveSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

export function extractRateLimitErrorInfo(error: unknown): { retryAfterMs?: number } | null {
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  let fallbackRetryAfterMs: number | undefined;

  while (queue.length > 0) {
    const candidate = queue.shift();
    const record = asRecord(candidate);
    if (!record) continue;
    if (visited.has(record)) continue;
    visited.add(record);

    const retryAfterMs = extractRetryAfterMs(record);
    if (retryAfterMs !== undefined && fallbackRetryAfterMs === undefined) {
      fallbackRetryAfterMs = retryAfterMs;
    }

    const statusCode = normalizeStatusCode(record.status) ?? normalizeStatusCode(record.statusCode);
    const normalizedCode = typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
    if (
      statusCode === 429
      || normalizedCode === "429"
      || normalizedCode === "RATE_LIMITED"
      || normalizedCode === "TOO_MANY_REQUESTS"
    ) {
      return { retryAfterMs };
    }

    const nestedResponse = asRecord(record.response);
    if (nestedResponse) queue.push(nestedResponse);
    const nestedCause = asRecord(record.cause);
    if (nestedCause) queue.push(nestedCause);
    const nestedError = asRecord(record.error);
    if (nestedError) queue.push(nestedError);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("rate limit")
      || message.includes("too many requests")
      || /\b429\b/.test(message)
    ) {
      return { retryAfterMs: fallbackRetryAfterMs };
    }
  }

  return null;
}

function shouldRetryWithoutTools(
  error: unknown,
  _providerId: string,
  _modelId: string,
): boolean {
  if (isGenericToolUnsupportedError(error)) {
    return true;
  }
  const inspection = inspectLmStudioBadRequest(error);
  return inspection.sawBadRequest && inspection.sawToolUnsupported;
}

function isGenericToolUnsupportedError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const candidate = queue.shift();
    const record = asRecord(candidate);
    if (!record) continue;
    if (visited.has(record)) continue;
    visited.add(record);

    const code = typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
    if (code === "TOOLS_UNSUPPORTED" || code === "ERR_TOOLS_UNSUPPORTED") {
      return true;
    }

    const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
    if (
      message.includes("tools unsupported")
      || message.includes("tool calls unsupported")
      || message.includes("[spaceskit:tools-unsupported]")
    ) {
      return true;
    }

    const nestedCause = asRecord(record.cause);
    if (nestedCause) queue.push(nestedCause);
    const nestedError = asRecord(record.error);
    if (nestedError) queue.push(nestedError);
    const nestedResponse = asRecord(record.response);
    if (nestedResponse) queue.push(nestedResponse);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("tools unsupported")
      || message.includes("tool calls unsupported")
      || message.includes("[spaceskit:tools-unsupported]")
    );
  }

  return false;
}

export function toActionableLmStudioBadRequestError(
  error: unknown,
  providerId: string,
  modelId: string,
): Error | null {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedModelId = modelId.trim().toLowerCase();
  const isLmStudio = normalizedProviderId === "lmstudio" || normalizedModelId.startsWith("lmstudio/");
  if (!isLmStudio) {
    return null;
  }

  const inspection = inspectLmStudioBadRequest(error);
  if (!inspection.sawBadRequest || inspection.sawToolUnsupported) {
    return null;
  }

  const collapsedMessages = inspection.messages.join(" ").toLowerCase();
  const selectedModel = modelId.trim() || "the selected model";
  const modelMissing = (
    collapsedMessages.includes("model not found")
    || collapsedMessages.includes("unknown model")
    || collapsedMessages.includes("does not exist")
    || collapsedMessages.includes("not loaded")
    || (collapsedMessages.includes("model") && collapsedMessages.includes("not available"))
  );

  const guidance = modelMissing
    ? `LM Studio rejected model "${selectedModel}" with 400 Bad Request because it is not loaded. Load the model in LM Studio or choose an available model in Main Agent settings.`
    : `LM Studio returned 400 Bad Request for model "${selectedModel}". Verify that the model is loaded and compatible, then retry.`;
  const mapped = new Error(guidance);
  (mapped as Error & { cause?: unknown }).cause = error;
  return mapped;
}

interface LmStudioBadRequestInspection {
  sawBadRequest: boolean;
  sawToolUnsupported: boolean;
  messages: string[];
}

function inspectLmStudioBadRequest(error: unknown): LmStudioBadRequestInspection {
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  let sawBadRequest = false;
  let sawToolUnsupported = false;
  const messages: string[] = [];
  const seenMessages = new Set<string>();

  while (queue.length > 0) {
    const candidate = queue.shift();
    const record = asRecord(candidate);
    if (!record) continue;
    if (visited.has(record)) continue;
    visited.add(record);

    const statusCode = normalizeStatusCode(record.status) ?? normalizeStatusCode(record.statusCode);
    if (statusCode === 400) {
      sawBadRequest = true;
    }

    const code = typeof record.code === "string" ? record.code.trim().toLowerCase() : "";
    if (
      code === "bad_request"
      || code === "bad_request_error"
      || code === "invalid_argument"
    ) {
      sawBadRequest = true;
    }

    for (const messageCandidate of [
      record.message,
      record.error,
      readNestedMessage(record.details),
      readNestedMessage(record.body),
    ]) {
      if (typeof messageCandidate !== "string") continue;
      const normalized = messageCandidate.trim().toLowerCase();
      if (!normalized) continue;
      if (!seenMessages.has(normalized)) {
        seenMessages.add(normalized);
        messages.push(messageCandidate.trim());
      }
      if (normalized.includes("bad request")) {
        sawBadRequest = true;
      }
      if (isToolUnsupportedBadRequestMessage(normalized)) {
        sawToolUnsupported = true;
      }
    }

    for (const nested of [record.response, record.cause, record.error, record.details, record.body, record.data]) {
      const nestedRecord = asRecord(nested);
      if (nestedRecord) queue.push(nestedRecord);
    }
  }

  if (error instanceof Error) {
    const normalizedErrorMessage = error.message.toLowerCase();
    if (!seenMessages.has(normalizedErrorMessage) && normalizedErrorMessage.trim().length > 0) {
      messages.push(error.message.trim());
    }
    if (normalizedErrorMessage.includes("bad request")) {
      sawBadRequest = true;
    }
    if (isToolUnsupportedBadRequestMessage(normalizedErrorMessage)) {
      sawToolUnsupported = true;
    }
  }

  return { sawBadRequest, sawToolUnsupported, messages };
}

function readNestedMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  const message = record.message;
  return typeof message === "string" ? message : undefined;
}

function isToolUnsupportedBadRequestMessage(message: string): boolean {
  return (
    message.includes("tool is not supported")
    || message.includes("tools are not supported")
    || message.includes("does not support tools")
    || message.includes("function calling is not supported")
    || message.includes("function calling not supported")
    || message.includes("unsupported tool")
    || message.includes("unsupported function")
    || (message.includes("role") && message.includes("tool"))
  );
}

export function buildToolUnsupportedFallbackNotice(providerId: string, modelId: string): string {
  const providerTrimmed = providerId.trim();
  const modelTrimmed = modelId.trim();
  const provider = providerTrimmed.length > 0 ? providerTrimmed : "selected provider";
  const model = modelTrimmed.length > 0 ? modelTrimmed : "selected model";
  return `Tool calling is unavailable for ${provider} (${model}). This turn ran in text-only mode, so connectors/tools could not be executed. Switch to a tool-capable model/provider to enable tools.`;
}

export function shouldRetryLlmCallWithoutTools(
  error: unknown,
  providerId: string,
  modelId: string,
): boolean {
  return shouldRetryWithoutTools(error, providerId, modelId);
}
