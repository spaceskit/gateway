import { describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { UserProfileRepository } from "../src/repositories/user-profiles.js";

describe("UserProfileRepository", () => {
  test("upserts and fetches principal-scoped profiles", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-user-profiles-${crypto.randomUUID()}`,
    });

    try {
      const repo = new UserProfileRepository(db.db);
      repo.upsert({
        principalId: "principal-1",
        profileJson: JSON.stringify({ preferences: { tone: "concise" } }),
      });

      const row = repo.get("principal-1");
      expect(row).toBeDefined();
      expect(JSON.parse(row!.profile_json)).toEqual({
        preferences: { tone: "concise" },
      });
    } finally {
      db.close();
    }
  });

  test("falls back to local user_preferences when present", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-user-profiles-${crypto.randomUUID()}`,
    });

    try {
      const repo = new UserProfileRepository(db.db);
      db.db.query(`
        UPDATE user_preferences
        SET experience_level = 'advanced',
            runtime_mode = 'pro',
            behavior_profile = 'strict',
            full_access_warning_accepted = 1,
            developer_warning_accepted = 0,
            calendar_enabled = 1,
            reminders_enabled = 0,
            updated_at = ?
        WHERE singleton_id = 1
      `).run(new Date().toISOString());

      const fallback = repo.getLocalPreferencesFallback();
      expect(fallback).toBeDefined();
      expect(fallback?.experience_level).toBe("advanced");
      expect(fallback?.runtime_mode).toBe("pro");
      expect(fallback?.calendar_enabled).toBe(1);
    } finally {
      db.close();
    }
  });
});
