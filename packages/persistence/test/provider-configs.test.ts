import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { ProviderConfigRepository } from "../src/repositories/provider-configs.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepository() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-provider-configs-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);
  return new ProviderConfigRepository(db.db);
}

describe("ProviderConfigRepository", () => {
  test("upsert creates new record", () => {
    const repo = createRepository();

    const row = repo.upsert({
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      allowedModelsJson: '["anthropic/claude-sonnet-4-5"]',
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "runtime",
    });

    expect(row.provider_id).toBe("anthropic");
    expect(row.model).toBe("anthropic/claude-sonnet-4-5");
    expect(row.base_url).toBeNull();
    expect(row.allowed_models_json).toBe('["anthropic/claude-sonnet-4-5"]');
    expect(row.allow_custom_model).toBe(0);
    expect(row.native_cli_tools_enabled).toBe(0);
    expect(row.api_key_secret_ref).toBeNull();
    expect(row.auth_mode).toBe("api_key");
    expect(row.source).toBe("runtime");
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });

  test("upsert updates existing record and preserves created_at", () => {
    const repo = createRepository();

    const created = repo.upsert({
      providerId: "openai",
      model: "openai/gpt-4.1",
      allowedModelsJson: '["openai/gpt-4.1"]',
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "env",
    });

    const updated = repo.upsert({
      providerId: "openai",
      model: "openai/gpt-4.1-mini",
      baseUrl: "https://custom.api.example.com/v1",
      allowedModelsJson: '["openai/gpt-4.1","openai/gpt-4.1-mini"]',
      allowCustomModel: true,
      nativeCliToolsEnabled: false,
      authMode: "host_login",
      source: "runtime",
    });

    expect(updated.provider_id).toBe("openai");
    expect(updated.model).toBe("openai/gpt-4.1-mini");
    expect(updated.base_url).toBe("https://custom.api.example.com/v1");
    expect(updated.allow_custom_model).toBe(1);
    expect(updated.auth_mode).toBe("host_login");
    expect(updated.source).toBe("runtime");
    expect(updated.created_at).toBe(created.created_at);
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));
  });

  test("getById returns record", () => {
    const repo = createRepository();

    repo.upsert({
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      allowedModelsJson: "[]",
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "runtime",
    });

    const row = repo.getById("anthropic");
    expect(row).not.toBeNull();
    expect(row!.provider_id).toBe("anthropic");
    expect(row!.model).toBe("anthropic/claude-sonnet-4-5");
  });

  test("getById returns null for missing", () => {
    const repo = createRepository();

    const row = repo.getById("nonexistent");
    expect(row).toBeNull();
  });

  test("list returns all records", () => {
    const repo = createRepository();

    repo.upsert({
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      allowedModelsJson: "[]",
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "runtime",
    });
    repo.upsert({
      providerId: "openai",
      model: "openai/gpt-4.1",
      allowedModelsJson: "[]",
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "env",
    });

    const rows = repo.list();
    expect(rows.length).toBe(2);
    const ids = rows.map((r) => r.provider_id).sort();
    expect(ids).toEqual(["anthropic", "openai"]);
  });

  test("remove deletes record and returns true", () => {
    const repo = createRepository();

    repo.upsert({
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      allowedModelsJson: "[]",
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "runtime",
    });

    expect(repo.remove("anthropic")).toBe(true);
    expect(repo.getById("anthropic")).toBeNull();
  });

  test("remove returns false for missing", () => {
    const repo = createRepository();

    expect(repo.remove("nonexistent")).toBe(false);
  });

  test("removeAll clears table", () => {
    const repo = createRepository();

    repo.upsert({
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      allowedModelsJson: "[]",
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "runtime",
    });
    repo.upsert({
      providerId: "openai",
      model: "openai/gpt-4.1",
      allowedModelsJson: "[]",
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "env",
    });

    const count = repo.removeAll();
    expect(count).toBe(2);
    expect(repo.list()).toEqual([]);
  });

  test("JSON round-trip for allowedModels", () => {
    const repo = createRepository();
    const models = ["anthropic/claude-sonnet-4-5", "anthropic/claude-opus-4-5", "anthropic/claude-haiku-4-5"];

    repo.upsert({
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      allowedModelsJson: JSON.stringify(models),
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "runtime",
    });

    const row = repo.getById("anthropic");
    expect(row).not.toBeNull();
    const parsed = JSON.parse(row!.allowed_models_json);
    expect(parsed).toEqual(models);
  });

  test("source field persisted correctly", () => {
    const repo = createRepository();

    repo.upsert({
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      allowedModelsJson: "[]",
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "env",
    });

    const envRow = repo.getById("anthropic");
    expect(envRow!.source).toBe("env");

    repo.upsert({
      providerId: "openai",
      model: "openai/gpt-4.1",
      allowedModelsJson: "[]",
      allowCustomModel: false,
      nativeCliToolsEnabled: false,
      source: "runtime",
    });

    const runtimeRow = repo.getById("openai");
    expect(runtimeRow!.source).toBe("runtime");
  });

  test("persists native CLI tool toggle", () => {
    const repo = createRepository();

    repo.upsert({
      providerId: "claude",
      model: "claude/sonnet",
      allowedModelsJson: '["claude/sonnet"]',
      allowCustomModel: false,
      nativeCliToolsEnabled: true,
      source: "runtime",
    });

    const row = repo.getById("claude");
    expect(row?.native_cli_tools_enabled).toBe(1);
  });
});
