/**
 * Middleware system — stolen from Microsoft Agent Framework's three-layer
 * model (Agent → Function → Chat), adapted to Spaceskit's domain.
 *
 * Three interception layers:
 * - "turn"       — wraps the entire agent turn (security, audit, guardrails)
 * - "capability"  — wraps each capability/tool invocation
 * - "llm"        — wraps each LLM call (budget tracking, rate limiting)
 *
 * Standard onion model: each middleware wraps the next via `next()`.
 * Setting `ctx.terminate = true` short-circuits the chain.
 */

export type MiddlewareLayer = "turn" | "capability" | "llm";

/**
 * Context object passed through the middleware chain.
 * Middleware can read/write any field; downstream middleware and the
 * core handler see the mutations.
 */
export interface MiddlewareContext {
  /** Which layer this execution belongs to. */
  layer: MiddlewareLayer;

  /** Space ID (if applicable). */
  spaceId?: string;

  /** Agent ID (if applicable). */
  agentId?: string;

  /** Turn ID (if applicable). */
  turnId?: string;

  /** The input to the operation (turn input, tool call, LLM messages). */
  input: unknown;

  /** The output of the operation (set by the core handler or post-hooks). */
  output?: unknown;

  /** Extensible metadata — middleware can attach anything here. */
  metadata: Record<string, unknown>;

  /**
   * Set to true to short-circuit the chain.
   * When terminated, no further middleware or the core handler runs.
   * The current `output` is used as the final result.
   */
  terminate: boolean;

  /** Timestamp when the context was created. */
  startedAt: Date;
}

/**
 * A middleware function. Called with context and a `next` function
 * that invokes the next middleware (or the core handler if last).
 *
 * To intercept before: do work, then call next().
 * To intercept after: call next(), then do work.
 * To short-circuit: set ctx.terminate = true, don't call next().
 */
export type MiddlewareFn = (
  ctx: MiddlewareContext,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * A named, ordered middleware registration.
 */
export interface Middleware {
  /** Human-readable name for logging/debugging. */
  name: string;
  /** Which layer this middleware intercepts. */
  layer: MiddlewareLayer;
  /** Execution order within the layer (lower = runs first). */
  order: number;
  /** The middleware function. */
  process: MiddlewareFn;
}
