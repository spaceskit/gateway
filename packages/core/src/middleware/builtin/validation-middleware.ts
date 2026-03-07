/**
 * Validation middleware — pre-execution checks.
 *
 * Runs first (order: 1) on the turn layer to catch invalid inputs
 * before any resources are consumed.
 */

import type { Middleware, MiddlewareContext } from "../types.js";

export interface ValidationMiddlewareOptions {
  /** Max input text length. Default: 100000. */
  maxInputLength?: number;
  /** Required metadata fields. */
  requiredFields?: string[];
}

export function createValidationMiddleware(options: ValidationMiddlewareOptions = {}): Middleware {
  const { maxInputLength = 100000, requiredFields = [] } = options;

  return {
    name: "validation",
    layer: "turn",
    order: 1, // Run first, before everything else
    async process(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
      // Check required metadata
      for (const field of requiredFields) {
        if (!ctx.metadata[field]) {
          ctx.terminate = true;
          throw new Error(`Validation failed: missing required field "${field}" in context metadata`);
        }
      }

      // Validate spaceId from the canonical turn context field.
      const spaceId = normalizeOptionalString(ctx.spaceId);
      if (!spaceId) {
        ctx.terminate = true;
        throw new Error("Validation failed: spaceId is required");
      }
      ctx.spaceId = spaceId;
      ctx.metadata.spaceId = spaceId;

      // Validate input
      const input = ctx.input;
      if (typeof input === "string") {
        if (input.trim().length === 0) {
          ctx.terminate = true;
          throw new Error("Validation failed: input text cannot be empty");
        }
        if (input.length > maxInputLength) {
          ctx.terminate = true;
          throw new Error(
            `Validation failed: input exceeds maximum length (${input.length} > ${maxInputLength})`,
          );
        }
      }

      // All checks passed
      ctx.metadata.validated = true;
      ctx.metadata.validatedAt = new Date().toISOString();

      await next();
    },
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
