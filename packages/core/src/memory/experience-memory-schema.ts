export interface ExperienceMemoryDatabase {
  exec: (sql: string) => unknown;
  query: (sql: string) => { all: () => unknown[] };
}

export function initExperienceMemorySchema(db: ExperienceMemoryDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'semantic',
      space_id TEXT,
      agent_id TEXT,
      user_id TEXT,
      principal_id TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      source_type TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      metadata_json TEXT DEFAULT '{}',
      tags_json TEXT DEFAULT '[]',
      importance REAL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memdoc_space ON memory_documents(space_id);
    CREATE INDEX IF NOT EXISTS idx_memdoc_agent ON memory_documents(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memdoc_type ON memory_documents(type);
    CREATE INDEX IF NOT EXISTS idx_memdoc_source
      ON memory_documents(source_type, source_id, principal_id);
  `);
  ensureCanonicalColumns(db);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id,
        content,
        tags,
        tokenize='porter unicode61'
      );
    `);
  } catch {
    // FTS5 might already exist or not be available.
  }
}

function ensureCanonicalColumns(db: ExperienceMemoryDatabase): void {
  const columns = db.query("PRAGMA table_info(memory_documents)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("source_type")) {
    db.exec("ALTER TABLE memory_documents ADD COLUMN source_type TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has("source_id")) {
    db.exec("ALTER TABLE memory_documents ADD COLUMN source_id TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has("status")) {
    db.exec("ALTER TABLE memory_documents ADD COLUMN status TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has("principal_id")) {
    db.exec("ALTER TABLE memory_documents ADD COLUMN principal_id TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memdoc_source
      ON memory_documents(source_type, source_id, principal_id)
  `);
}
