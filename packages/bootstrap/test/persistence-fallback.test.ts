import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startGateway } from "../src/index.js";

function randomPort(): number {
  return 40_000 + Math.floor(Math.random() * 10_000);
}

function invalidDbPath(): string {
  return join(tmpdir(), `spaceskit-missing-db-dir-${crypto.randomUUID()}`, "nested", "gateway.db");
}

function tempDbPath(): string {
  return join(tmpdir(), `spaceskit-sandbox-${crypto.randomUUID()}.db`);
}

describe("bootstrap persistence fallback policy", () => {
  const INTEGRATION_TIMEOUT = 30_000;

  test("external profile fails closed when DB initialization fails", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
    Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-master-key-for-external-profile";

    try {
      await expect(startGateway({
        gatewayProfile: "external",
        host: "127.0.0.1",
        port: randomPort(),
        dbPath: invalidDbPath(),
        logLevel: "error",
        allowPersistenceFallback: true,
      })).rejects.toThrow();
    } finally {
      if (previousMasterKey === undefined) {
        delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
      } else {
        Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousMasterKey;
      }
    }
  });

  test("embedded profile fails when fallback is disabled", { timeout: INTEGRATION_TIMEOUT }, async () => {
    await expect(startGateway({
      gatewayProfile: "embedded",
      host: "127.0.0.1",
      port: randomPort(),
      dbPath: invalidDbPath(),
      logLevel: "error",
      allowPersistenceFallback: false,
    })).rejects.toThrow();
  });

  test("embedded profile can continue without DB when fallback is explicitly enabled", { timeout: INTEGRATION_TIMEOUT }, async () => {
    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;
    try {
      instance = await startGateway({
        gatewayProfile: "embedded",
        host: "127.0.0.1",
        port: randomPort(),
        dbPath: invalidDbPath(),
        logLevel: "error",
        allowPersistenceFallback: true,
      });

      expect(instance.db).toBeNull();
    } finally {
      await instance?.shutdown();
    }
  });

  test("external profile requires sandbox runtime module when sandbox routing is enforced", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
    Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-master-key-for-external-profile";

    try {
      await expect(startGateway({
        gatewayProfile: "external",
        host: "127.0.0.1",
        port: randomPort(),
        dbPath: tempDbPath(),
        logLevel: "error",
        archFreezeEnforced: true,
        sandboxRuntimeEnabled: true,
        sandboxAllowHostPassthrough: false,
      })).rejects.toThrow("sandbox runtime module");
    } finally {
      if (previousMasterKey === undefined) {
        delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
      } else {
        Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousMasterKey;
      }
    }
  });

  test("external profile rejects sandbox host passthrough", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
    Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-master-key-for-external-profile";

    try {
      await expect(startGateway({
        gatewayProfile: "external",
        host: "127.0.0.1",
        port: randomPort(),
        dbPath: tempDbPath(),
        logLevel: "error",
        archFreezeEnforced: true,
        sandboxRuntimeEnabled: true,
        sandboxAllowHostPassthrough: true,
      })).rejects.toThrow("SPACESKIT_SANDBOX_ALLOW_HOST_PASSTHROUGH");
    } finally {
      if (previousMasterKey === undefined) {
        delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
      } else {
        Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousMasterKey;
      }
    }
  });
});
