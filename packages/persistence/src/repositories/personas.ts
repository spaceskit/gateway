import type { Database } from "bun:sqlite";

export interface PersonaRow {
  persona_id: string;
  name: string;
  description: string;
  active_revision: number;
  archived: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface PersonaRevisionRow {
  id: number;
  persona_id: string;
  revision: number;
  tone: string;
  style: string;
  emotional_layer: string;
  constraints_json: string;
  instructions: string;
  source: string;
  created_at: string;
}

export interface CreatePersonaInput {
  personaId: string;
  name: string;
  description?: string;
  tone?: string;
  style?: string;
  emotionalLayer?: string;
  constraints?: string[];
  instructions?: string;
  isDefault?: boolean;
  source?: string;
}

export interface UpdatePersonaInput {
  personaId: string;
  name?: string;
  description?: string;
  tone?: string;
  style?: string;
  emotionalLayer?: string;
  constraints?: string[];
  instructions?: string;
  isDefault?: boolean;
  source?: string;
}

export class PersonaRepository {
  constructor(private readonly db: Database) {
    this.ensureCanonicalTables();
  }

  create(input: CreatePersonaInput): PersonaRow {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.query(`
        INSERT INTO personas(
          persona_id, name, description, active_revision, archived, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 0, ?, ?, ?)
      `).run(
        input.personaId,
        input.name,
        input.description ?? "",
        input.isDefault ? 1 : 0,
        now,
        now,
      );

      this.db.query(`
        INSERT INTO persona_revisions(
          persona_id, revision, tone, style, emotional_layer, constraints_json, instructions, source, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.personaId,
        input.tone ?? "",
        input.style ?? "",
        input.emotionalLayer ?? "",
        JSON.stringify(normalizeStringList(input.constraints)),
        input.instructions ?? "",
        input.source ?? "manual",
        now,
      );
    })();

    return this.getById(input.personaId)!;
  }

  getById(personaId: string): PersonaRow | undefined {
    return this.db
      .query("SELECT * FROM personas WHERE persona_id = ?")
      .get(personaId) as PersonaRow | undefined ?? undefined;
  }

  list(options: { includeArchived?: boolean } = {}): PersonaRow[] {
    if (options.includeArchived) {
      return this.db.query("SELECT * FROM personas ORDER BY name").all() as PersonaRow[];
    }
    return this.db.query("SELECT * FROM personas WHERE archived = 0 ORDER BY name").all() as PersonaRow[];
  }

  getActiveRevision(personaId: string): PersonaRevisionRow | undefined {
    return this.db.query(`
      SELECT r.*
      FROM persona_revisions r
      JOIN personas p ON p.persona_id = r.persona_id AND p.active_revision = r.revision
      WHERE r.persona_id = ?
      LIMIT 1
    `).get(personaId) as PersonaRevisionRow | undefined ?? undefined;
  }

  update(input: UpdatePersonaInput): { persona: PersonaRow; revision: PersonaRevisionRow } {
    const persona = this.getById(input.personaId);
    if (!persona) {
      throw new Error(`Persona not found: ${input.personaId}`);
    }

    const active = this.getActiveRevision(input.personaId);
    if (!active) {
      throw new Error(`Active persona revision not found: ${input.personaId}`);
    }

    const nextRevision = persona.active_revision + 1;
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db.query(`
        INSERT INTO persona_revisions(
          persona_id, revision, tone, style, emotional_layer, constraints_json, instructions, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.personaId,
        nextRevision,
        input.tone ?? active.tone ?? "",
        input.style ?? active.style ?? "",
        input.emotionalLayer ?? active.emotional_layer ?? "",
        JSON.stringify(input.constraints ? normalizeStringList(input.constraints) : parseStringArray(active.constraints_json)),
        input.instructions ?? active.instructions ?? "",
        input.source ?? "manual",
        now,
      );

      this.db.query(`
        UPDATE personas
        SET
          name = ?,
          description = ?,
          is_default = ?,
          active_revision = ?,
          updated_at = ?
        WHERE persona_id = ?
      `).run(
        input.name ?? persona.name,
        input.description ?? persona.description,
        input.isDefault === undefined ? persona.is_default : input.isDefault ? 1 : 0,
        nextRevision,
        now,
        input.personaId,
      );
    })();

    return {
      persona: this.getById(input.personaId)!,
      revision: this.getActiveRevision(input.personaId)!,
    };
  }

  archive(personaId: string): void {
    this.db
      .query("UPDATE personas SET archived = 1, updated_at = ? WHERE persona_id = ?")
      .run(new Date().toISOString(), personaId);
  }

  restore(personaId: string): void {
    this.db
      .query("UPDATE personas SET archived = 0, updated_at = ? WHERE persona_id = ?")
      .run(new Date().toISOString(), personaId);
  }

  private ensureCanonicalTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personas (
        persona_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active_revision INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_personas_archived ON personas(archived)",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persona_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        persona_id TEXT NOT NULL REFERENCES personas(persona_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        tone TEXT NOT NULL DEFAULT '',
        style TEXT NOT NULL DEFAULT '',
        emotional_layer TEXT NOT NULL DEFAULT '',
        constraints_json TEXT NOT NULL DEFAULT '[]',
        instructions TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_rev_unique ON persona_revisions(persona_id, revision)",
    );
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return normalizeStringList(parsed);
  } catch {
    return [];
  }
}
