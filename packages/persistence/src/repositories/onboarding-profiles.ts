/**
 * Onboarding profile repository — stores onboarding profiles and completion state.
 */

import type { Database } from "bun:sqlite";

export interface OnboardingProfileRow {
  id: string;
  display_name: string;
  goal: string;
  capture_mode: string;
  goal_description: string | null;
  completed: number; // SQLite boolean (0/1)
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class OnboardingProfileRepository {
  constructor(private db: Database) {}

  upsert(row: Omit<OnboardingProfileRow, "created_at" | "updated_at">): OnboardingProfileRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO onboarding_profiles(
        id,
        display_name,
        goal,
        capture_mode,
        goal_description,
        completed,
        completed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        goal = excluded.goal,
        capture_mode = excluded.capture_mode,
        goal_description = excluded.goal_description,
        completed = excluded.completed,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `).run(
      row.id,
      row.display_name,
      row.goal,
      row.capture_mode,
      row.goal_description,
      row.completed,
      row.completed_at,
      now,
      now,
    );

    return this.getById(row.id)!;
  }

  getById(id: string): OnboardingProfileRow | undefined {
    return this.db.query(`
      SELECT * FROM onboarding_profiles WHERE id = ?
    `).get(id) as OnboardingProfileRow | undefined ?? undefined;
  }

  getCompleted(): OnboardingProfileRow | undefined {
    return this.db.query(`
      SELECT * FROM onboarding_profiles
      WHERE completed = 1
      ORDER BY completed_at ASC
      LIMIT 1
    `).get() as OnboardingProfileRow | undefined ?? undefined;
  }

  markComplete(id: string): boolean {
    const now = new Date().toISOString();
    return this.db.query(`
      UPDATE onboarding_profiles
      SET completed = 1,
          completed_at = ?,
          updated_at = ?
      WHERE id = ?
        AND completed = 0
    `).run(now, now, id).changes > 0;
  }
}
