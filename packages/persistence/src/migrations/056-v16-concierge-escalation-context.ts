/**
 * Migration v16_concierge_escalation_context
 *
 * Stores structured context for concierge prompts so proactive Workbench
 * notifications can reference the exact queue item, run, and intended action.
 */
export const M056_V16_CONCIERGE_ESCALATION_CONTEXT_VERSION = "v16_concierge_escalation_context";

export const M056_V16_CONCIERGE_ESCALATION_CONTEXT: readonly string[] = [
  `ALTER TABLE concierge_escalation_requests ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}'`,
];
