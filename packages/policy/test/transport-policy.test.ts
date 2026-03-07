import { describe, test, expect } from "bun:test";
import { isLoopbackHost, evaluateTransportPolicy } from "../src/transport-policy.js";

// ---------------------------------------------------------------------------
// isLoopbackHost
// ---------------------------------------------------------------------------

describe("isLoopbackHost", () => {
  test("127.0.0.1 is loopback", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
  });

  test("::1 is loopback", () => {
    expect(isLoopbackHost("::1")).toBe(true);
  });

  test("localhost is loopback", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
  });

  test("LOCALHOST is loopback (case insensitive)", () => {
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
  });

  test(" localhost  is loopback (whitespace trimmed)", () => {
    expect(isLoopbackHost(" localhost ")).toBe(true);
  });

  test("0.0.0.0 is NOT loopback (binds all interfaces)", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  test("192.168.1.100 is NOT loopback", () => {
    expect(isLoopbackHost("192.168.1.100")).toBe(false);
  });

  test("10.0.0.1 is NOT loopback", () => {
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
  });

  test("my-server.local is NOT loopback", () => {
    expect(isLoopbackHost("my-server.local")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateTransportPolicy
// ---------------------------------------------------------------------------

describe("evaluateTransportPolicy", () => {
  // -----------------------------------------------------------------------
  // Loopback hosts — always plaintext_loopback, never denied
  // -----------------------------------------------------------------------

  describe("loopback hosts", () => {
    test("127.0.0.1 + embedded + no noise → plaintext_loopback, not denied", () => {
      const result = evaluateTransportPolicy({
        host: "127.0.0.1",
        port: 9320,
        gatewayProfile: "embedded",
        noiseEnabled: false,
      });
      expect(result.posture).toBe("plaintext_loopback");
      expect(result.denied).toBe(false);
    });

    test("127.0.0.1 + external + no noise → plaintext_loopback, not denied", () => {
      const result = evaluateTransportPolicy({
        host: "127.0.0.1",
        port: 9420,
        gatewayProfile: "external",
        noiseEnabled: false,
      });
      expect(result.posture).toBe("plaintext_loopback");
      expect(result.denied).toBe(false);
    });

    test("::1 + embedded + noise enabled → plaintext_loopback, not denied", () => {
      const result = evaluateTransportPolicy({
        host: "::1",
        port: 9320,
        gatewayProfile: "embedded",
        noiseEnabled: true,
      });
      expect(result.posture).toBe("plaintext_loopback");
      expect(result.denied).toBe(false);
    });

    test("localhost + external + noise enabled → plaintext_loopback, not denied", () => {
      const result = evaluateTransportPolicy({
        host: "localhost",
        port: 9420,
        gatewayProfile: "external",
        noiseEnabled: true,
      });
      expect(result.posture).toBe("plaintext_loopback");
      expect(result.denied).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Non-loopback with noise — always encrypted, never denied
  // -----------------------------------------------------------------------

  describe("non-loopback with noise", () => {
    test("192.168.1.1 + external + noise → encrypted, not denied", () => {
      const result = evaluateTransportPolicy({
        host: "192.168.1.1",
        port: 9420,
        gatewayProfile: "external",
        noiseEnabled: true,
      });
      expect(result.posture).toBe("encrypted");
      expect(result.denied).toBe(false);
    });

    test("0.0.0.0 + embedded + noise → encrypted, not denied", () => {
      const result = evaluateTransportPolicy({
        host: "0.0.0.0",
        port: 9320,
        gatewayProfile: "embedded",
        noiseEnabled: true,
      });
      expect(result.posture).toBe("encrypted");
      expect(result.denied).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Non-loopback without noise — external profile (denied by default)
  // -----------------------------------------------------------------------

  describe("non-loopback without noise — external profile", () => {
    test("denied by default (no override)", () => {
      const result = evaluateTransportPolicy({
        host: "192.168.1.1",
        port: 9420,
        gatewayProfile: "external",
        noiseEnabled: false,
      });
      expect(result.posture).toBe("plaintext_denied");
      expect(result.denied).toBe(true);
      expect(result.reason).toBe("non_loopback_insecure");
    });

    test("override=false disables enforcement", () => {
      const result = evaluateTransportPolicy({
        host: "192.168.1.1",
        port: 9420,
        gatewayProfile: "external",
        noiseEnabled: false,
        enforcementOverride: false,
      });
      expect(result.posture).toBe("plaintext_denied");
      expect(result.denied).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Non-loopback without noise — embedded profile (NOT denied by default)
  // -----------------------------------------------------------------------

  describe("non-loopback without noise — embedded profile", () => {
    test("not denied by default (no override)", () => {
      const result = evaluateTransportPolicy({
        host: "192.168.1.1",
        port: 9320,
        gatewayProfile: "embedded",
        noiseEnabled: false,
      });
      expect(result.posture).toBe("plaintext_denied");
      expect(result.denied).toBe(false);
    });

    test("override=true enables enforcement", () => {
      const result = evaluateTransportPolicy({
        host: "192.168.1.1",
        port: 9320,
        gatewayProfile: "embedded",
        noiseEnabled: false,
        enforcementOverride: true,
      });
      expect(result.posture).toBe("plaintext_denied");
      expect(result.denied).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Details string — all results have a non-empty details
  // -----------------------------------------------------------------------

  describe("details string", () => {
    test("loopback result has non-empty details", () => {
      const result = evaluateTransportPolicy({
        host: "127.0.0.1",
        port: 9320,
        gatewayProfile: "embedded",
        noiseEnabled: false,
      });
      expect(result.details.length).toBeGreaterThan(0);
    });

    test("encrypted result has non-empty details", () => {
      const result = evaluateTransportPolicy({
        host: "192.168.1.1",
        port: 9420,
        gatewayProfile: "external",
        noiseEnabled: true,
      });
      expect(result.details.length).toBeGreaterThan(0);
    });

    test("denied result has non-empty details", () => {
      const result = evaluateTransportPolicy({
        host: "192.168.1.1",
        port: 9420,
        gatewayProfile: "external",
        noiseEnabled: false,
      });
      expect(result.details.length).toBeGreaterThan(0);
    });
  });
});
