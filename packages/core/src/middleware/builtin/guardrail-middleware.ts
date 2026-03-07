/**
 * GuardrailMiddleware — validates agent output before it propagates.
 *
 * Turn layer (order: 80):
 * - Post: Run output through code-based and/or LLM-based validators.
 *   If invalid, inject feedback and optionally retry.
 *
 * Stolen from: CrewAI's function-based + LLM-based guardrails system.
 *
 * Guardrails are configured per-space in SpaceConfig.guardrails[].
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import type { EventBus } from "../../events/event-bus.js";

// ---------------------------------------------------------------------------
// Guardrail definitions
// ---------------------------------------------------------------------------

/** A code-based guardrail: a function that validates output. */
export interface CodeGuardrail {
  type: "code";
  name: string;
  /** Validate the output. Return valid=true to pass, valid=false with feedback to fail. */
  validate: (output: string) => { valid: boolean; feedback: string };
}

/** An LLM-based guardrail: a prompt sent to a validator LLM. */
export interface LLMGuardrail {
  type: "llm";
  name: string;
  /** The validation prompt. The agent's output will be appended. */
  validationPrompt: string;
  /**
   * Function to call the validator LLM.
   * Injected so the guardrail doesn't depend on a specific provider.
   */
  callValidator?: (prompt: string) => Promise<{ valid: boolean; feedback: string }>;
}

export type Guardrail = CodeGuardrail | LLMGuardrail;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export interface GuardrailMiddlewareOptions {
  eventBus: EventBus;
  /** Maximum retries when a guardrail fails. Default: 3. */
  maxRetries?: number;
  /** Temperature escalation per retry (added to base). Default: 0.1. */
  temperatureEscalation?: number;
  /**
   * Resolve guardrails for a space.
   * Returns the guardrails configured for that space.
   */
  resolveGuardrails: (spaceId: string) => Promise<Guardrail[]>;
  /**
   * Optional retry callback — called to re-generate output when guardrails fail.
   * If not provided, the middleware sets metadata for the runtime to handle retry.
   */
  onRetry?: (ctx: MiddlewareContext, feedback: string, attempt: number) => Promise<string | null>;
}

export function createGuardrailMiddleware(
  options: GuardrailMiddlewareOptions,
): Middleware {
  const maxRetries = options.maxRetries ?? 3;

  return {
    name: "guardrail",
    layer: "turn",
    order: 80,
    async process(ctx: MiddlewareContext, next: () => Promise<void>) {
      await next();

      // Only validate if there's output
      if (!ctx.output || !ctx.spaceId) return;

      const guardrails = await options.resolveGuardrails(ctx.spaceId);
      if (guardrails.length === 0) return;

      // Retry loop — re-validate after each retry
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const output =
          typeof ctx.output === "string"
            ? ctx.output
            : JSON.stringify(ctx.output);

        let allPassed = true;

        // Run guardrails sequentially
        for (const guardrail of guardrails) {
          const result = await runGuardrail(guardrail, output);

          if (!result.valid) {
            options.eventBus.emit({
              type: "guardrail.failed",
              spaceId: ctx.spaceId,
              agentId: ctx.agentId,
              guardrailName: guardrail.name,
              feedback: result.feedback,
              attempt,
              maxRetries,
              timestamp: new Date(),
            });

            allPassed = false;

            // If we have retries left and a retry callback, attempt re-generation
            if (attempt < maxRetries && options.onRetry) {
              const retryOutput = await options.onRetry(ctx, result.feedback, attempt + 1);
              if (retryOutput !== null) {
                ctx.output = retryOutput;
                // Escalate temperature metadata for next attempt
                ctx.metadata.guardrailRetryAttempt = attempt + 1;
                ctx.metadata.guardrailTemperatureBoost =
                  (options.temperatureEscalation ?? 0.1) * (attempt + 1);
                break; // Break inner loop, continue retry loop
              }
            }

            // No retry callback or retry returned null — fall through to metadata
            ctx.metadata.guardrailFailed = true;
            ctx.metadata.guardrailFeedback = result.feedback;
            ctx.metadata.guardrailName = guardrail.name;
            ctx.metadata.guardrailMaxRetries = maxRetries;
            ctx.metadata.guardrailAttempt = attempt;
            return;
          }

          options.eventBus.emit({
            type: "guardrail.passed",
            spaceId: ctx.spaceId,
            agentId: ctx.agentId,
            guardrailName: guardrail.name,
            timestamp: new Date(),
          });
        }

        if (allPassed) return; // All guardrails passed
      }

      // Exhausted all retries
      ctx.metadata.guardrailFailed = true;
      ctx.metadata.guardrailFeedback = "Exhausted all guardrail retry attempts";
      ctx.metadata.guardrailMaxRetries = maxRetries;
      ctx.metadata.guardrailAttempt = maxRetries;
    },
  };
}

async function runGuardrail(
  guardrail: Guardrail,
  output: string,
): Promise<{ valid: boolean; feedback: string }> {
  if (guardrail.type === "code") {
    try {
      return guardrail.validate(output);
    } catch (err) {
      return {
        valid: false,
        feedback: `Guardrail "${guardrail.name}" threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (guardrail.type === "llm" && guardrail.callValidator) {
    const prompt = `${guardrail.validationPrompt}\n\n--- Agent Output ---\n${output}\n--- End Output ---\n\nIs this output valid? Respond with JSON: { "valid": true/false, "feedback": "..." }`;

    try {
      return await guardrail.callValidator(prompt);
    } catch (err) {
      return {
        valid: true, // Don't block on validator failure
        feedback: `LLM validator error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // No validator available — pass
  return { valid: true, feedback: "" };
}
