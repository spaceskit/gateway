import type { Database } from "bun:sqlite";

export interface GatewaySkillDraftRow {
  draft_id: string;
  name: string;
  description: string;
  request_prompt: string;
  content_markdown: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertGatewaySkillDraftInput {
  draftId: string;
  name: string;
  description?: string;
  requestPrompt?: string;
  contentMarkdown: string;
}

export class GatewaySkillDraftRepository {
  constructor(private readonly db: Database) {}

  upsert(input: UpsertGatewaySkillDraftInput): GatewaySkillDraftRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_skill_drafts(
        draft_id, name, description, request_prompt, content_markdown, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        request_prompt = excluded.request_prompt,
        content_markdown = excluded.content_markdown,
        updated_at = excluded.updated_at
    `).run(
      input.draftId,
      input.name.trim(),
      input.description?.trim() ?? "",
      input.requestPrompt?.trim() ?? "",
      input.contentMarkdown,
      now,
      now,
    );

    return this.get(input.draftId)!;
  }

  get(draftId: string): GatewaySkillDraftRow | null {
    return this.db.query(`
      SELECT *
      FROM gateway_skill_drafts
      WHERE draft_id = ?
      LIMIT 1
    `).get(draftId) as GatewaySkillDraftRow | null;
  }

  list(): GatewaySkillDraftRow[] {
    return this.db.query(`
      SELECT *
      FROM gateway_skill_drafts
      ORDER BY updated_at DESC, draft_id ASC
    `).all() as GatewaySkillDraftRow[];
  }

  delete(draftId: string): boolean {
    return this.db.query(`
      DELETE FROM gateway_skill_drafts
      WHERE draft_id = ?
    `).run(draftId).changes > 0;
  }
}
