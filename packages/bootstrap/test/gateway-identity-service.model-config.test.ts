import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase, PersonaRepository, ProfileRepository } from "@spaceskit/persistence";
import { GatewayIdentityService } from "../src/services/gateway-identity-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createService(): GatewayIdentityService {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-identity-model-config-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  return new GatewayIdentityService({
    profiles: new ProfileRepository(db.db),
    personas: new PersonaRepository(db.db),
  });
}

describe("GatewayIdentityService model config payloads", () => {
  test("omits modelConfig preferred models when none are provided", () => {
    const service = createService();

    const result = service.createAgentDefinition({
      name: "No Model Config",
    });

    expect("modelId" in result.agentDefinition).toBe(false);
    expect(result.agentDefinition.modelConfig?.preferredModels ?? []).toEqual([]);
  });

  test("uses modelConfig.preferredModels as the update model source", () => {
    const service = createService();
    const created = service.createAgentDefinition({
      name: "Configured Model",
      modelConfig: { preferredModels: ["openai/gpt-4.1"] },
    });

    const updated = service.updateAgentDefinition({
      agentDefinitionId: created.agentDefinition.agentDefinitionId,
      modelConfig: { preferredModels: ["codex/gpt-5.2-codex"] },
    });

    expect("modelId" in updated.agentDefinition).toBe(false);
    expect(updated.agentDefinition.modelConfig?.preferredModels).toEqual(["codex/gpt-5.2-codex"]);
  });
});
