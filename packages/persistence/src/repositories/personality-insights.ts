import type { Database } from "bun:sqlite";

export type PersonalityInsightStatusRowValue = "proposed" | "accepted" | "rejected" | "superseded";

export interface PersonalityInsightRow {
  insight_id: string;
  experience_id: string;
  space_id: string;
  profile_id: string;
  base_revision: number;
  editable_patch: string;
  rationale: string;
  confidence: number;
  status: PersonalityInsightStatusRowValue;
  approved_revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePersonalityInsightInput {
  insightId: string;
  experienceId?: string;
  spaceId: string;
  profileId: string;
  baseRevision: number;
  proposedPromptDelta: string;
  rationale: string;
  confidence?: number;
  status?: PersonalityInsightStatusRowValue;
  createdBy?: string;
}

export class PersonalityInsightRepository {
  constructor(private readonly db: Database) {
    this.ensureCanonicalColumns();
  }

  create(input: CreatePersonalityInsightInput): PersonalityInsightRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO personality_insights(
        insight_id,
        experience_id,
        space_id,
        profile_id,
        base_revision,
        editable_patch,
        rationale,
        confidence,
        status,
        approved_revision,
        created_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      input.insightId,
      input.experienceId ?? "",
      input.spaceId,
      input.profileId,
      input.baseRevision,
      JSON.stringify({
        proposedPromptDelta: input.proposedPromptDelta,
      }),
      input.rationale,
      typeof input.confidence === "number" && Number.isFinite(input.confidence)
        ? input.confidence
        : 0,
      input.status ?? "proposed",
      input.createdBy ?? "experience-generator",
      now,
      now,
    );
    return this.getById(input.insightId)!;
  }

  getById(insightId: string): PersonalityInsightRow | undefined {
    return this.db
      .query("SELECT * FROM personality_insights WHERE insight_id = ?")
      .get(insightId) as PersonalityInsightRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string): PersonalityInsightRow[] {
    return this.db
      .query(`
        SELECT * FROM personality_insights
        WHERE space_id = ?
        ORDER BY created_at DESC
      `)
      .all(spaceId) as PersonalityInsightRow[];
  }

  deleteBySpace(
    spaceId: string,
    options: {
      createdAtGte?: string;
      createdAtLte?: string;
    } = {},
  ): number {
    const where = ["space_id = ?"];
    const values: Array<string | number> = [spaceId];

    if (options.createdAtGte) {
      where.push("created_at >= ?");
      values.push(options.createdAtGte);
    }
    if (options.createdAtLte) {
      where.push("created_at <= ?");
      values.push(options.createdAtLte);
    }

    const result = this.db.query(`DELETE FROM personality_insights WHERE ${where.join(" AND ")}`).run(...values);
    return result.changes;
  }

  listProposed(profileId: string): PersonalityInsightRow[] {
    return this.db
      .query(`
        SELECT * FROM personality_insights
        WHERE profile_id = ? AND status = 'proposed'
        ORDER BY created_at DESC
      `)
      .all(profileId) as PersonalityInsightRow[];
  }

  accept(insightId: string, approvedRevision = 0): void {
    const now = new Date().toISOString();
    this.db
      .query(`
        UPDATE personality_insights
        SET
          status = 'accepted',
          approved_revision = ?,
          updated_at = ?
        WHERE insight_id = ?
      `)
      .run(approvedRevision, now, insightId);
  }

  reject(insightId: string): void {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE personality_insights SET status = 'rejected', updated_at = ? WHERE insight_id = ?")
      .run(now, insightId);
  }

  supersede(insightId: string): void {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE personality_insights SET status = 'superseded', updated_at = ? WHERE insight_id = ?")
      .run(now, insightId);
  }

  private ensureCanonicalColumns(): void {
    const columns = this.db
      .query("PRAGMA table_info(personality_insights)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has("experience_id")) {
      this.db.exec(
        "ALTER TABLE personality_insights ADD COLUMN experience_id TEXT NOT NULL DEFAULT ''",
      );
    }
    if (!columnNames.has("confidence")) {
      this.db.exec(
        "ALTER TABLE personality_insights ADD COLUMN confidence REAL NOT NULL DEFAULT 0",
      );
    }
  }
}
