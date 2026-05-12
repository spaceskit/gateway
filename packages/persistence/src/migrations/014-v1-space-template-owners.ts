/**
 * Migration v1_space_template_owners
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M014_V1_SPACE_TEMPLATE_OWNERS_VERSION = "v1_space_template_owners";

export const M014_V1_SPACE_TEMPLATE_OWNERS: readonly string[] = [
  `ALTER TABLE space_templates
        ADD COLUMN owner_principal_id TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS idx_space_templates_owner
        ON space_templates(owner_principal_id, archived, updated_at)`,
];
