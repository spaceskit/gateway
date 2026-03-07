import { describe, expect, test } from "bun:test";
import { Logger } from "@spaceskit/observability";
import { initDatabase, ProviderSecretRefRepository } from "@spaceskit/persistence";
import { ProviderSecretRefError, ProviderSecretRefService } from "../src/services/provider-secret-ref-service.js";

function createContext(masterKey = "test-master-key") {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-provider-secret-refs-${crypto.randomUUID()}`,
  });
  const repository = new ProviderSecretRefRepository(db.db);
  const service = new ProviderSecretRefService({
    repository,
    logger: new Logger({ minLevel: "error", module: "provider-secret-ref-test" }),
    masterKey,
  });
  return { db, repository, service };
}

describe("ProviderSecretRefService", () => {
  test("put/list/delete lifecycle hides secret material", () => {
    const ctx = createContext();
    try {
      const put = ctx.service.putSecretRef({
        providerId: "openai",
        label: "OpenAI Primary",
        secret: "sk-test-openai",
      });

      expect(put.created).toBe(true);
      expect(put.secretRef.providerId).toBe("openai");
      expect(put.secretRef.label).toBe("OpenAI Primary");

      const listed = ctx.service.listSecretRefs("openai");
      expect(listed.length).toBe(1);
      expect(listed[0]?.secretRef).toBe(put.secretRef.secretRef);

      const rawRow = ctx.repository.get(put.secretRef.secretRef);
      expect(rawRow?.encrypted_secret).toBeDefined();
      expect(rawRow?.encrypted_secret).not.toBe("sk-test-openai");

      const deleted = ctx.service.deleteSecretRef(put.secretRef.secretRef);
      expect(deleted).toBe(true);
      expect(ctx.service.listSecretRefs("openai").length).toBe(0);
    } finally {
      ctx.db.close();
    }
  });

  test("resolveSecret decrypts and updates lastUsedAt", () => {
    const ctx = createContext();
    try {
      const put = ctx.service.putSecretRef({
        providerId: "anthropic",
        secretRef: "secretref-anthropic-primary",
        secret: "sk-ant",
      });

      const resolved = ctx.service.resolveSecret("secretref-anthropic-primary");
      expect(resolved?.secret).toBe("sk-ant");
      expect(resolved?.summary.providerId).toBe("anthropic");

      const updated = ctx.repository.get(put.secretRef.secretRef);
      expect(updated?.last_used_at).toBeTruthy();
    } finally {
      ctx.db.close();
    }
  });

  test("decrypt fails with wrong master key", () => {
    const ctxA = createContext("master-key-a");
    try {
      ctxA.service.putSecretRef({
        providerId: "google",
        secretRef: "secretref-google-primary",
        secret: "sk-google",
      });

      const serviceWithWrongKey = new ProviderSecretRefService({
        repository: ctxA.repository,
        logger: new Logger({ minLevel: "error", module: "provider-secret-ref-test" }),
        masterKey: "master-key-b",
      });

      expect(() => serviceWithWrongKey.resolveSecret("secretref-google-primary")).toThrow(
        ProviderSecretRefError,
      );
    } finally {
      ctxA.db.close();
    }
  });
});
