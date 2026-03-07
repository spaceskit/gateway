import { describe, expect, test } from "bun:test";
import { configToEnv, type InstallerConfig } from "../src/config.js";

function makeConfig(overrides: Partial<InstallerConfig> = {}): InstallerConfig {
  return {
    mode: "local",
    port: 9320,
    host: "127.0.0.1",
    dbPath: "/tmp/test-gateway.db",
    noise: { enabled: false, publicKey: null, privateKey: null },
    modelProvider: null,
    modelId: null,
    apiKey: null,
    logLevel: "info",
    setupComplete: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("configToEnv", () => {
  test("local mode maps to embedded profile", () => {
    const env = configToEnv(makeConfig({ mode: "local" }));
    expect(env.SPACESKIT_GATEWAY_PROFILE).toBe("embedded");
  });

  test("paired mode maps to external profile", () => {
    const env = configToEnv(makeConfig({ mode: "paired" }));
    expect(env.SPACESKIT_GATEWAY_PROFILE).toBe("external");
  });

  test("noise enabled includes noise env vars", () => {
    const env = configToEnv(
      makeConfig({
        noise: {
          enabled: true,
          publicKey: "dGVzdC1wdWJsaWMta2V5",
          privateKey: "dGVzdC1wcml2YXRlLWtleQ==",
        },
      }),
    );
    expect(env.SPACESKIT_NOISE_ENABLED).toBe("true");
    expect(env.SPACESKIT_NOISE_PUBLIC_KEY).toBe("dGVzdC1wdWJsaWMta2V5");
    expect(env.SPACESKIT_NOISE_PRIVATE_KEY).toBe("dGVzdC1wcml2YXRlLWtleQ==");
  });

  test("noise disabled omits noise env vars", () => {
    const env = configToEnv(
      makeConfig({ noise: { enabled: false, publicKey: null, privateKey: null } }),
    );
    expect(env.SPACESKIT_NOISE_ENABLED).toBeUndefined();
    expect(env.SPACESKIT_NOISE_PUBLIC_KEY).toBeUndefined();
    expect(env.SPACESKIT_NOISE_PRIVATE_KEY).toBeUndefined();
  });

  test("all base env vars are always present", () => {
    const env = configToEnv(makeConfig());
    expect(env.SPACESKIT_PORT).toBe("9320");
    expect(env.SPACESKIT_HOST).toBe("127.0.0.1");
    expect(env.SPACESKIT_DB_PATH).toBe("/tmp/test-gateway.db");
    expect(env.SPACESKIT_LOG_LEVEL).toBe("info");
    expect(env.SPACESKIT_LOG_FILE).toBeDefined();
    expect(env.SPACESKIT_GATEWAY_PROFILE).toBeDefined();
  });
});
