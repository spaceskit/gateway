/**
 * Tracing middleware — instruments turn/capability/llm operations.
 *
 * Adds structured trace spans with timing, error tracking, and metadata.
 * Can be extended with OpenTelemetry export (optional dependency).
 */

import type { Middleware, MiddlewareContext } from "../types.js";

export interface TracingMiddlewareOptions {
  enabled?: boolean;
  serviceName?: string;
  /** Optional callback for exporting trace spans. */
  onSpanEnd?: (span: TraceSpan) => void;
}

export interface TraceSpan {
  spanId: string;
  traceId: string;
  serviceName: string;
  operationType: string;
  spaceId?: string;
  agentId?: string;
  turnId?: string;
  durationMs: number;
  status: "ok" | "error";
  error?: string;
  metadata: Record<string, unknown>;
  startedAt: Date;
  endedAt: Date;
}

let spanCounter = 0;

function generateId(): string {
  return `${Date.now().toString(36)}-${(spanCounter++).toString(36)}`;
}

export function createTracingMiddleware(options: TracingMiddlewareOptions = {}): Middleware[] {
  const { enabled = true, serviceName = "spaceskit-gateway", onSpanEnd } = options;

  if (!enabled) {
    return []; // Return no middleware if disabled
  }

  // Create middleware for each layer — each invocation gets a unique traceId
  return [
    {
      name: "tracing-turn",
      layer: "turn",
      order: 2,
      async process(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
        const traceId = generateId();
        const span = startSpan(traceId, serviceName, "turn", ctx);
        try {
          await next();
          endSpan(span, "ok", ctx, onSpanEnd);
        } catch (err) {
          endSpan(span, "error", ctx, onSpanEnd, err);
          throw err;
        }
      },
    },
    {
      name: "tracing-capability",
      layer: "capability",
      order: 2,
      async process(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
        const traceId = ctx.metadata.traceId as string ?? generateId();
        const span = startSpan(traceId, serviceName, "capability", ctx);
        try {
          await next();
          endSpan(span, "ok", ctx, onSpanEnd);
        } catch (err) {
          endSpan(span, "error", ctx, onSpanEnd, err);
          throw err;
        }
      },
    },
    {
      name: "tracing-llm",
      layer: "llm",
      order: 2,
      async process(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
        const traceId = ctx.metadata.traceId as string ?? generateId();
        const span = startSpan(traceId, serviceName, "llm", ctx);
        try {
          await next();
          endSpan(span, "ok", ctx, onSpanEnd);
        } catch (err) {
          endSpan(span, "error", ctx, onSpanEnd, err);
          throw err;
        }
      },
    },
  ];
}

function startSpan(
  traceId: string,
  serviceName: string,
  operationType: string,
  ctx: MiddlewareContext,
): TraceSpan {
  const spaceId = normalizeOptionalString(ctx.metadata.spaceId) ?? normalizeOptionalString(ctx.spaceId);
  const agentId = normalizeOptionalString(ctx.metadata.agentId) ?? normalizeOptionalString(ctx.agentId);
  const turnId = normalizeOptionalString(ctx.metadata.turnId) ?? normalizeOptionalString(ctx.turnId);
  const span: TraceSpan = {
    spanId: generateId(),
    traceId,
    serviceName,
    operationType,
    spaceId,
    agentId,
    turnId,
    durationMs: 0,
    status: "ok",
    metadata: {},
    startedAt: new Date(),
    endedAt: new Date(),
  };

  ctx.metadata.spanId = span.spanId;
  ctx.metadata.traceId = traceId;
  if (spaceId) ctx.metadata.spaceId = spaceId;
  if (agentId) ctx.metadata.agentId = agentId;
  if (turnId) ctx.metadata.turnId = turnId;

  return span;
}

function endSpan(
  span: TraceSpan,
  status: "ok" | "error",
  ctx: MiddlewareContext,
  onSpanEnd?: (span: TraceSpan) => void,
  error?: unknown,
): void {
  span.endedAt = new Date();
  span.durationMs = span.endedAt.getTime() - span.startedAt.getTime();
  span.status = status;
  if (error instanceof Error) span.error = error.message;
  span.metadata = { ...ctx.metadata };

  ctx.metadata.traceDurationMs = span.durationMs;

  if (onSpanEnd) {
    try {
      onSpanEnd(span);
    } catch {
      // Never let span export callback break the pipeline
    }
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
