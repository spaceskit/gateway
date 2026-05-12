/**
 * Migration v2_usage_record_token_accuracy
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M038_V2_USAGE_RECORD_TOKEN_ACCURACY_VERSION = "v2_usage_record_token_accuracy";

export const M038_V2_USAGE_RECORD_TOKEN_ACCURACY: readonly string[] = [
  `ALTER TABLE usage_records
        ADD COLUMN token_accuracy TEXT NOT NULL DEFAULT 'reported'`,
];
