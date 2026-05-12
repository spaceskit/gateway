/**
 * Migration v2_turns_reply_to_turn_id
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M032_V2_TURNS_REPLY_TO_TURN_ID_VERSION = "v2_turns_reply_to_turn_id";

export const M032_V2_TURNS_REPLY_TO_TURN_ID: readonly string[] = [
  `ALTER TABLE turns
        ADD COLUMN reply_to_turn_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_turns_reply_to_turn
        ON turns(reply_to_turn_id)`,
];
