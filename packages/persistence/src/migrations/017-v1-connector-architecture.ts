/**
 * Migration v1_connector_architecture
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M017_V1_CONNECTOR_ARCHITECTURE_VERSION = "v1_connector_architecture";

export const M017_V1_CONNECTOR_ARCHITECTURE: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS connector_families (
        family_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        runtime TEXT NOT NULL,
        trust_class TEXT NOT NULL,
        embedded_enabled INTEGER NOT NULL DEFAULT 0,
        capability_types_json TEXT NOT NULL DEFAULT '[]',
        features_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_connector_families_runtime
        ON connector_families(runtime, trust_class, embedded_enabled)`,
  `CREATE TABLE IF NOT EXISTS connector_instances (
        connector_id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES connector_families(family_id) ON DELETE RESTRICT,
        display_name TEXT NOT NULL,
        account_fingerprint_hash TEXT NOT NULL,
        label_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (family_id, account_fingerprint_hash, label_slug)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_connector_instances_family
        ON connector_instances(family_id, status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS connector_bindings (
        binding_id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL REFERENCES connector_instances(connector_id) ON DELETE CASCADE,
        binding_type TEXT NOT NULL,
        selector_json TEXT NOT NULL DEFAULT '{}',
        selector_hash TEXT NOT NULL DEFAULT '',
        target_type TEXT NOT NULL,
        target_space_id TEXT NOT NULL DEFAULT '',
        allowed_actions_json TEXT NOT NULL DEFAULT '[]',
        capability_types_json TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connector_id, binding_type, selector_hash, priority)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_connector_bindings_connector
        ON connector_bindings(connector_id, binding_type, enabled, priority)`,
  `CREATE INDEX IF NOT EXISTS idx_connector_bindings_target
        ON connector_bindings(target_type, target_space_id, enabled, priority)`,
  `CREATE TABLE IF NOT EXISTS connector_policy (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        requests_per_minute INTEGER NOT NULL DEFAULT 60,
        burst INTEGER NOT NULL DEFAULT 60,
        disabled INTEGER NOT NULL DEFAULT 0,
        disable_reason TEXT NOT NULL DEFAULT '',
        disabled_until TEXT,
        updated_by TEXT NOT NULL DEFAULT 'system',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_connector_policy_disabled
        ON connector_policy(scope_type, disabled, disabled_until)`,
  `INSERT OR IGNORE INTO connector_policy(
        scope_type, scope_id, requests_per_minute, burst, disabled,
        disable_reason, disabled_until, updated_by, updated_at
      ) VALUES ('global', '*', 60, 60, 0, '', NULL, 'system', datetime('now'))`,
  `CREATE TABLE IF NOT EXISTS connector_secret_refs (
        connector_id TEXT NOT NULL REFERENCES connector_instances(connector_id) ON DELETE CASCADE,
        secret_key TEXT NOT NULL,
        secret_ref TEXT NOT NULL,
        backend TEXT NOT NULL DEFAULT 'native_adapter',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (connector_id, secret_key)
      )`,
];
