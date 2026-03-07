/**
 * AuditMiddleware — records all turn executions and capability invocations.
 *
 * Turn layer (order: 90):
 * - Post: Write audit record with agent, space, turn, token usage.
 *
 * Stolen from: Microsoft AF's OpenTelemetry pattern + CrewAI's usage metrics.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import type { EventBus } from "../../events/event-bus.js";

export interface AuditMiddlewareOptions {
  eventBus: EventBus;
  /** Write an audit record to persistence. */
  writeAuditRecord?: (record: AuditRecord) => Promise<void>;
}

export interface AuditRecord {
  eventId: string;
  spaceId?: string;
  agentId?: string;
  turnId?: string;
  layer: string;
  action: string;
  durationMs: number;
  tokenUsage?: { promptTokens: number; completionTokens: number };
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export function createAuditMiddleware(
  options: AuditMiddlewareOptions,
): Middleware {
  return {
    name: "audit",
    layer: "turn",
    order: 90,
    async process(ctx: MiddlewareContext, next: () => Promise<void>) {
      await next();

      const durationMs = Date.now() - ctx.startedAt.getTime();

      const record: AuditRecord = {
        eventId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        spaceId: ctx.spaceId,
        agentId: ctx.agentId,
        turnId: ctx.turnId,
        layer: ctx.layer,
        action: "turn_executed",
        durationMs,
        tokenUsage: ctx.metadata.tokenCost
          ? {
              promptTokens: (ctx.metadata.promptTokens as number) ?? 0,
              completionTokens: (ctx.metadata.completionTokens as number) ?? 0,
            }
          : undefined,
        metadata: {
          budgetWarning: ctx.metadata.budgetWarning,
          totalSpent: ctx.metadata.totalSpent,
          terminated: ctx.terminate,
        },
        timestamp: new Date(),
      };

      // Emit event (for real-time observability)
      options.eventBus.emit({
        type: "audit.turn",
        ...record,
      });

      // Persist if handler provided
      if (options.writeAuditRecord) {
        try {
          await options.writeAuditRecord(record);
        } catch {
          // Don't fail the turn if audit write fails
        }
      }
    },
  };
}
