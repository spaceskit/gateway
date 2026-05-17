import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { ProfileRepository } from "../src/repositories/profiles.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepository(): ProfileRepository {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-profile-model-config-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  return new ProfileRepository(db.db);
}

describe("ProfileRepository model config canonical storage", () => {
  test("stores an empty model config when none is provided", () => {
    const repo = createRepository();

    repo.create({
      profileId: "no-model-config",
      name: "No Model Config",
    });

    const revision = repo.getActiveRevision("no-model-config");
    expect(JSON.parse(revision?.model_config_json ?? "{}")).toEqual({
      preferredModels: [],
      fallbackModels: [],
    });
  });

  test("writes selected model only to modelConfig on create", () => {
    const repo = createRepository();
    repo.create({
      profileId: "configured-create-profile",
      name: "Configured Create Profile",
      modelConfig: { preferredModels: ["openai/gpt-4.1"] },
    });

    const revision = repo.getActiveRevision("configured-create-profile");
    expect(JSON.parse(revision?.model_config_json ?? "{}")).toEqual({
      preferredModels: ["openai/gpt-4.1"],
      fallbackModels: [],
    });
  });

  test("writes selected model only to modelConfig on update", () => {
    const repo = createRepository();
    repo.create({
      profileId: "configured-profile",
      name: "Configured Profile",
      modelConfig: { preferredModels: ["openai/gpt-4.1"] },
    });

    const updated = repo.update({
      profileId: "configured-profile",
      modelConfig: { preferredModels: ["codex/gpt-5.2-codex"] },
    });

    expect(JSON.parse(updated.revision.model_config_json)).toEqual({
      preferredModels: ["codex/gpt-5.2-codex"],
      fallbackModels: [],
    });
  });
});
