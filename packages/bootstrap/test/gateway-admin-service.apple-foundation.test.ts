import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService Apple Foundation provider", () => {
  test("hides apple foundation provider when opt-in flag is disabled", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: false,
      appleFoundationAvailability: { available: true, reason: "available" },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      const catalogs = await ctx.admin.listProviderCatalogs();
      expect(catalogs.some((entry) => entry.providerId === "apple")).toBe(false);
      await expect(ctx.admin.listProviderCatalogs({ providerId: "apple" })).rejects.toThrow("Unknown providerId");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("keeps apple foundation provider out of catalogs even when opt-in is enabled on unsupported hosts", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: true, reason: "available" },
      hostPlatform: "linux",
      hostArch: "x64",
    });
    try {
      const catalogs = await ctx.admin.listProviderCatalogs();
      expect(catalogs.some((entry) => entry.providerId === "apple")).toBe(false);
      await expect(ctx.admin.listProviderCatalogs({ providerId: "apple" })).rejects.toThrow("Unknown providerId");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("shows apple foundation provider in catalogs on eligible hosts", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: true, reason: "Apple Intelligence available." },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      const catalogs = await ctx.admin.listProviderCatalogs();
      const apple = catalogs.find((entry) => entry.providerId === "apple");
      expect(apple).toBeDefined();
      expect(apple?.status).toBe("reachable");
      expect(apple?.models.map((entry) => entry.id)).toContain("apple/apple-on-device");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("allows apple provider config but blocks resolve when availability is false", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: false, reason: "Apple Intelligence unavailable." },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "apple",
        model: "apple/apple-on-device",
      })).not.toThrow();

      await expect(
        ctx.admin.resolveProviderForProfile("apple", "apple/apple-on-device"),
      ).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("blocks apple getProviderSettings and profile validation when opt-in is disabled", () => {
    const ctx = createContext({
      enableAppleFoundationProvider: false,
      appleFoundationAvailability: { available: true, reason: "Apple Intelligence available." },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      let settingsErr: unknown;
      try {
        ctx.admin.getProviderSettings("apple");
      } catch (err) {
        settingsErr = err;
      }
      expect(settingsErr).toMatchObject({ code: "FAILED_PRECONDITION" });

      let validationErr: unknown;
      try {
        ctx.admin.validateProfileModelSelection({
          providerHint: "apple",
          modelHint: "apple/apple-on-device",
        });
      } catch (err) {
        validationErr = err;
      }
      expect(validationErr).toMatchObject({ code: "FAILED_PRECONDITION" });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("blocks apple resolve on unsupported hosts even when opt-in is enabled", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: true, reason: "Apple Intelligence available." },
      hostPlatform: "linux",
      hostArch: "x64",
    });
    try {
      await expect(
        ctx.admin.resolveProviderForProfile("apple", "apple/apple-on-device"),
      ).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
