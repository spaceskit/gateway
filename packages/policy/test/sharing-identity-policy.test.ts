import { describe, test, expect } from "bun:test";
import {
  evaluateSharingIdentity,
  DEFAULT_SHARING_IDENTITY_POLICY,
} from "../src/sharing-identity-policy.js";
import type {
  SharingIdentityPolicy,
  SharingIdentityAssertionInput,
} from "../src/sharing-identity-policy.js";

// ---------------------------------------------------------------------------
// evaluateSharingIdentity
// ---------------------------------------------------------------------------

describe("evaluateSharingIdentity", () => {
  // -----------------------------------------------------------------------
  // device_key mode
  // -----------------------------------------------------------------------

  describe("device_key mode", () => {
    const policy: SharingIdentityPolicy = {
      mode: "device_key",
      allowDeviceKeyFallback: true,
    };

    test("hasDeviceKey=true → allowed, identityMode=device_key", () => {
      const result = evaluateSharingIdentity({
        policy,
        hasDeviceKey: true,
        hasAppleIdAssertion: false,
      });
      expect(result.allowed).toBe(true);
      expect(result.identityMode).toBe("device_key");
      expect(result.reason).toBeUndefined();
    });

    test("hasDeviceKey=false → denied, reason=identity_assertion_missing", () => {
      const result = evaluateSharingIdentity({
        policy,
        hasDeviceKey: false,
        hasAppleIdAssertion: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("identity_assertion_missing");
      expect(result.identityMode).toBe("device_key");
    });

    test("hasDeviceKey=true + hasAppleIdAssertion=true → allowed (Apple ID ignored in device_key mode)", () => {
      const result = evaluateSharingIdentity({
        policy,
        hasDeviceKey: true,
        hasAppleIdAssertion: true,
      });
      expect(result.allowed).toBe(true);
      expect(result.identityMode).toBe("device_key");
    });
  });

  // -----------------------------------------------------------------------
  // strict_apple_id mode
  // -----------------------------------------------------------------------

  describe("strict_apple_id mode", () => {
    test("hasAppleIdAssertion=true → allowed, identityMode=strict_apple_id", () => {
      const policy: SharingIdentityPolicy = {
        mode: "strict_apple_id",
        allowDeviceKeyFallback: false,
      };
      const result = evaluateSharingIdentity({
        policy,
        hasDeviceKey: true,
        hasAppleIdAssertion: true,
      });
      expect(result.allowed).toBe(true);
      expect(result.identityMode).toBe("strict_apple_id");
      expect(result.reason).toBeUndefined();
    });

    test("hasAppleIdAssertion=false + allowDeviceKeyFallback=true + hasDeviceKey=true → allowed via fallback", () => {
      const policy: SharingIdentityPolicy = {
        mode: "strict_apple_id",
        allowDeviceKeyFallback: true,
      };
      const result = evaluateSharingIdentity({
        policy,
        hasDeviceKey: true,
        hasAppleIdAssertion: false,
      });
      expect(result.allowed).toBe(true);
      expect(result.identityMode).toBe("device_key");
      expect(result.details).toContain("fallback");
    });

    test("hasAppleIdAssertion=false + allowDeviceKeyFallback=false → denied", () => {
      const policy: SharingIdentityPolicy = {
        mode: "strict_apple_id",
        allowDeviceKeyFallback: false,
      };
      const result = evaluateSharingIdentity({
        policy,
        hasDeviceKey: true,
        hasAppleIdAssertion: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("identity_assertion_missing");
      expect(result.identityMode).toBe("strict_apple_id");
    });

    test("hasAppleIdAssertion=false + allowDeviceKeyFallback=true + hasDeviceKey=false → denied", () => {
      const policy: SharingIdentityPolicy = {
        mode: "strict_apple_id",
        allowDeviceKeyFallback: true,
      };
      const result = evaluateSharingIdentity({
        policy,
        hasDeviceKey: false,
        hasAppleIdAssertion: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("identity_assertion_missing");
    });
  });

  // -----------------------------------------------------------------------
  // DEFAULT_SHARING_IDENTITY_POLICY
  // -----------------------------------------------------------------------

  describe("DEFAULT_SHARING_IDENTITY_POLICY", () => {
    test("mode is device_key", () => {
      expect(DEFAULT_SHARING_IDENTITY_POLICY.mode).toBe("device_key");
    });

    test("allowDeviceKeyFallback is true", () => {
      expect(DEFAULT_SHARING_IDENTITY_POLICY.allowDeviceKeyFallback).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // details string — all results have non-empty details
  // -----------------------------------------------------------------------

  describe("details string", () => {
    test("allowed result has non-empty details", () => {
      const result = evaluateSharingIdentity({
        policy: DEFAULT_SHARING_IDENTITY_POLICY,
        hasDeviceKey: true,
        hasAppleIdAssertion: false,
      });
      expect(result.details.length).toBeGreaterThan(0);
    });

    test("denied result has non-empty details", () => {
      const result = evaluateSharingIdentity({
        policy: DEFAULT_SHARING_IDENTITY_POLICY,
        hasDeviceKey: false,
        hasAppleIdAssertion: false,
      });
      expect(result.details.length).toBeGreaterThan(0);
    });

    test("fallback result has non-empty details", () => {
      const result = evaluateSharingIdentity({
        policy: { mode: "strict_apple_id", allowDeviceKeyFallback: true },
        hasDeviceKey: true,
        hasAppleIdAssertion: false,
      });
      expect(result.details.length).toBeGreaterThan(0);
    });

    test("strict denial result has non-empty details", () => {
      const result = evaluateSharingIdentity({
        policy: { mode: "strict_apple_id", allowDeviceKeyFallback: false },
        hasDeviceKey: true,
        hasAppleIdAssertion: false,
      });
      expect(result.details.length).toBeGreaterThan(0);
    });
  });
});
