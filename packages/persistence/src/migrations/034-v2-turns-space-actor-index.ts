/**
 * Migration v2_turns_space_actor_index
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M034_V2_TURNS_SPACE_ACTOR_INDEX_VERSION = "v2_turns_space_actor_index";

export const M034_V2_TURNS_SPACE_ACTOR_INDEX: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_turns_space_actor
        ON turns(space_id, actor_id, created_at DESC)`,
];
