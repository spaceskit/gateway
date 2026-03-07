import type { Database } from "bun:sqlite";

export type ChangeSetReviewDecision = "approved" | "rejected";

export interface SpaceChangeSetReviewRow {
  review_id: string;
  changeset_id: string;
  reviewer_principal_id: string;
  decision: ChangeSetReviewDecision;
  comment: string;
  diff_summary_json: string;
  created_at: string;
}

export interface CreateSpaceChangeSetReviewInput {
  reviewId: string;
  changeSetId: string;
  reviewerPrincipalId: string;
  decision: ChangeSetReviewDecision;
  comment?: string;
  diffSummaryJson?: string;
}

export class SpaceChangeSetReviewRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateSpaceChangeSetReviewInput): SpaceChangeSetReviewRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_changeset_reviews(
        review_id,
        changeset_id,
        reviewer_principal_id,
        decision,
        comment,
        diff_summary_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.reviewId,
      input.changeSetId,
      input.reviewerPrincipalId,
      input.decision,
      input.comment ?? "",
      input.diffSummaryJson ?? "{}",
      now,
    );
    return this.getById(input.reviewId)!;
  }

  getById(reviewId: string): SpaceChangeSetReviewRow | undefined {
    return this.db.query(`
      SELECT * FROM space_changeset_reviews
      WHERE review_id = ?
    `).get(reviewId) as SpaceChangeSetReviewRow | undefined ?? undefined;
  }

  listByChangeSet(changeSetId: string): SpaceChangeSetReviewRow[] {
    return this.db.query(`
      SELECT * FROM space_changeset_reviews
      WHERE changeset_id = ?
      ORDER BY created_at DESC
    `).all(changeSetId) as SpaceChangeSetReviewRow[];
  }
}
