import { describe, expect, test } from "bun:test";
import {
  deriveRiskLevel,
  riskSummary,
} from "../../src/gateway/gateway-read-model.js";
import type {
  GatewayTransportPosture,
  GatewayConnectionStatus,
  GatewayRiskLevel,
} from "../../src/gateway/gateway-read-model.js";

describe("deriveRiskLevel", () => {
  test("encrypted + connected -> none", () => {
    expect(deriveRiskLevel("encrypted", "connected")).toBe("none");
  });

  test("plaintext_loopback + connected -> low", () => {
    expect(deriveRiskLevel("plaintext_loopback", "connected")).toBe("low");
  });

  test("plaintext_denied + connected -> high", () => {
    expect(deriveRiskLevel("plaintext_denied", "connected")).toBe("high");
  });

  test("encrypted + disconnected -> elevated", () => {
    expect(deriveRiskLevel("encrypted", "disconnected")).toBe("elevated");
  });

  test("plaintext_loopback + error -> elevated", () => {
    expect(deriveRiskLevel("plaintext_loopback", "error")).toBe("elevated");
  });

  test("encrypted + connecting -> low", () => {
    expect(deriveRiskLevel("encrypted", "connecting")).toBe("low");
  });

  test("plaintext_denied + disconnected -> elevated", () => {
    expect(deriveRiskLevel("plaintext_denied", "disconnected")).toBe("elevated");
  });

  test("plaintext_denied + error -> elevated", () => {
    expect(deriveRiskLevel("plaintext_denied", "error")).toBe("elevated");
  });

  test("plaintext_loopback + connecting -> low", () => {
    expect(deriveRiskLevel("plaintext_loopback", "connecting")).toBe("low");
  });
});

describe("riskSummary", () => {
  test("encrypted / none -> contains 'Encrypted'", () => {
    const summary = riskSummary("encrypted", "none");
    expect(summary.toLowerCase()).toContain("encrypted");
  });

  test("plaintext_loopback / low -> non-empty, mentions loopback", () => {
    const summary = riskSummary("plaintext_loopback", "low");
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.toLowerCase()).toContain("loopback");
  });

  test("plaintext_denied / high -> mentions exposed or insecure", () => {
    const summary = riskSummary("plaintext_denied", "high");
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.toLowerCase()).toContain("exposed");
  });

  test("any posture / elevated -> non-empty", () => {
    const summary = riskSummary("encrypted", "elevated");
    expect(summary.length).toBeGreaterThan(0);
  });

  test("low risk without plaintext_loopback -> connection in progress", () => {
    const summary = riskSummary("encrypted", "low");
    expect(summary.toLowerCase()).toContain("connection");
  });

  test("all posture/risk combos return non-empty strings", () => {
    const postures: GatewayTransportPosture[] = [
      "encrypted",
      "plaintext_loopback",
      "plaintext_denied",
    ];
    const levels: GatewayRiskLevel[] = ["none", "low", "elevated", "high"];

    for (const posture of postures) {
      for (const level of levels) {
        const summary = riskSummary(posture, level);
        expect(summary.length).toBeGreaterThan(0);
      }
    }
  });
});
