/**
 * Migration v2_assignment_prompt_context
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M024_V2_ASSIGNMENT_PROMPT_CONTEXT_VERSION = "v2_assignment_prompt_context";

export const M024_V2_ASSIGNMENT_PROMPT_CONTEXT: readonly string[] = [
  `ALTER TABLE space_agent_assignments ADD COLUMN spawn_context TEXT`,
  `ALTER TABLE space_agent_assignments ADD COLUMN context_overrides_json TEXT`,
];
