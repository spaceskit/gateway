/**
 * Migration v2_gateway_skill_catalog
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M022_V2_GATEWAY_SKILL_CATALOG_VERSION = "v2_gateway_skill_catalog";

export const M022_V2_GATEWAY_SKILL_CATALOG: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS gateway_skill_catalog (
        skill_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content_markdown TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_skill_catalog_status
        ON gateway_skill_catalog(status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_skill_catalog_name
        ON gateway_skill_catalog(name, updated_at DESC)`,
  `INSERT OR IGNORE INTO gateway_skill_catalog(
        skill_id,
        name,
        description,
        content_markdown,
        source_ref,
        tags_json,
        status,
        created_at,
        updated_at
      ) VALUES (
        'anthropic/pdf',
        'PDF Research Assistant',
        'Extract and summarize PDF content with explicit citations and source grounding.',
        'Use this skill when working with PDF documents. Read carefully, preserve original meaning, and cite page numbers for claims. Always separate extracted facts from inferred conclusions.',
        'anthropic:skills/pdf',
        '["pdf","documents","research"]',
        'active',
        datetime('now'),
        datetime('now')
      )`,
  `INSERT OR IGNORE INTO gateway_skill_catalog(
        skill_id,
        name,
        description,
        content_markdown,
        source_ref,
        tags_json,
        status,
        created_at,
        updated_at
      ) VALUES (
        'openai/gh-address-comments',
        'GitHub Comment Resolution',
        'Address GitHub PR feedback by planning changes, applying patches, and verifying outcomes.',
        'Use this skill to process GitHub review comments. Group comments by concern, propose concrete edits, implement fixes, and report exactly which comments were resolved with file-level references.',
        'openai:skills/gh-address-comments',
        '["github","code-review","automation"]',
        'active',
        datetime('now'),
        datetime('now')
      )`,
];
