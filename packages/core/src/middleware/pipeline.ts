/**
 * MiddlewarePipeline — composable middleware chain with onion execution.
 *
 * Supports three layers (turn, capability, llm). Each `execute()` call
 * filters middleware by layer, sorts by order, and chains via recursive
 * `next()` — exactly like Koa or Express middleware.
 *
 * The `coreHandler` is the actual operation (turn execution, tool call,
 * LLM generation). Middleware wraps around it.
 */

import type { Middleware, MiddlewareContext, MiddlewareLayer, MiddlewareFn } from "./types.js";

export class MiddlewarePipeline {
  private middleware: Middleware[] = [];

  /** Register a middleware. Can be called multiple times. */
  use(mw: Middleware): this {
    this.middleware.push(mw);
    return this;
  }

  /** Remove a middleware by name. */
  remove(name: string): this {
    this.middleware = this.middleware.filter((m) => m.name !== name);
    return this;
  }

  /** Get all registered middleware (for debugging/inspection). */
  list(layer?: MiddlewareLayer): Middleware[] {
    const all = [...this.middleware].sort((a, b) => a.order - b.order);
    return layer ? all.filter((m) => m.layer === layer) : all;
  }

  /**
   * Execute the middleware chain for a specific layer.
   *
   * @param layer - Which middleware layer to run
   * @param ctx - The context object (mutated in-place by middleware)
   * @param coreHandler - The actual operation to wrap (runs in the center of the onion)
   */
  async execute(
    layer: MiddlewareLayer,
    ctx: MiddlewareContext,
    coreHandler: () => Promise<void>,
  ): Promise<void> {
    // Filter and sort middleware for this layer
    const chain = this.middleware
      .filter((m) => m.layer === layer)
      .sort((a, b) => a.order - b.order);

    // Build the onion: each middleware calls next() to invoke the next one,
    // with the coreHandler at the center
    let index = 0;

    const next = async (): Promise<void> => {
      // Short-circuit if terminated
      if (ctx.terminate) return;

      if (index < chain.length) {
        const mw = chain[index++];
        await mw.process(ctx, next);
      } else {
        // All middleware executed — run the core handler
        if (!ctx.terminate) {
          await coreHandler();
        }
      }
    };

    await next();
  }

  /**
   * Convenience: create a MiddlewareContext with sensible defaults.
   */
  static createContext(
    layer: MiddlewareLayer,
    input: unknown,
    overrides?: Partial<MiddlewareContext>,
  ): MiddlewareContext {
    return {
      layer,
      input,
      metadata: {},
      terminate: false,
      startedAt: new Date(),
      ...overrides,
    };
  }
}
