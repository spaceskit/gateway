import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import {
  GatewayObservabilityService,
  evaluateSuccessSlo,
} from "../src/services/gateway-observability-service.js";

describe("GatewayObservabilityService", () => {
  test("tracks relay lifecycle events and computes relay SLO snapshots", () => {
    const eventBus = new EventBus();
    const service = new GatewayObservabilityService({
      eventBus,
      relaySloMinSuccessRate: 0.99,
      relaySloMinSamples: 2,
      relaySloEnforce: true,
      sandboxSloMinSuccessRate: 0.99,
      sandboxSloMinSamples: 10,
      sandboxSloEnforce: false,
      getSandboxState: () => ({
        enforceSandboxRouting: true,
        backendMode: "module",
        routed: 0,
        succeeded: 0,
        failed: 0,
      }),
    });

    eventBus.emit({
      type: "share.relay.resolve.attempt",
      timestamp: new Date(),
    });
    eventBus.emit({
      type: "share.relay.resolve.success",
      timestamp: new Date(),
      gatewayRoute: "relay_proxy",
    });
    eventBus.emit({
      type: "share.relay.resolve.attempt",
      timestamp: new Date(),
    });
    eventBus.emit({
      type: "share.relay.resolve.failed",
      timestamp: new Date(),
      code: "PERMISSION_DENIED",
    });
    eventBus.emit({
      type: "share.relay.join.attempt",
      timestamp: new Date(),
    });
    eventBus.emit({
      type: "share.relay.join.failed",
      timestamp: new Date(),
      code: "INVALID_ARGUMENT",
    });

    const snapshot = service.getRelaySnapshot();
    expect(snapshot.resolve.attempted).toBe(2);
    expect(snapshot.resolve.succeeded).toBe(1);
    expect(snapshot.resolve.failed).toBe(1);
    expect(snapshot.resolve.sloEvaluated).toBe(true);
    expect(snapshot.resolve.sloMet).toBe(false);
    expect(snapshot.resolve.belowSloSince).toBeString();
    expect(snapshot.join.attempted).toBe(1);
    expect(snapshot.join.succeeded).toBe(0);
    expect(snapshot.join.failed).toBe(1);
    expect(snapshot.routeCounts.relay_proxy).toBe(1);
    expect(snapshot.failureCodes["resolve::PERMISSION_DENIED"]).toBe(1);
    expect(snapshot.failureCodes["join::INVALID_ARGUMENT"]).toBe(1);

    service.stop();
  });

  test("formats relay and sandbox counters in Prometheus text format", () => {
    const eventBus = new EventBus();
    const service = new GatewayObservabilityService({
      eventBus,
      relaySloMinSuccessRate: 0.9,
      relaySloMinSamples: 1,
      relaySloEnforce: true,
      sandboxSloMinSuccessRate: 0.9,
      sandboxSloMinSamples: 1,
      sandboxSloEnforce: true,
      getSandboxState: () => ({
        enforceSandboxRouting: true,
        backendMode: "module",
        routed: 3,
        succeeded: 2,
        failed: 1,
      }),
    });

    eventBus.emit({ type: "share.relay.resolve.attempt", timestamp: new Date() });
    eventBus.emit({ type: "share.relay.resolve.success", timestamp: new Date(), gatewayRoute: "direct" });
    eventBus.emit({ type: "share.relay.join.attempt", timestamp: new Date() });
    eventBus.emit({ type: "share.relay.join.failed", timestamp: new Date(), code: "PERMISSION_DENIED" });

    const metrics = service.formatPrometheus();
    expect(metrics).toContain("spaceskit_relay_resolve_attempt_total 1");
    expect(metrics).toContain("spaceskit_relay_route_total{route=\"direct\"} 1");
    expect(metrics).toContain("spaceskit_relay_failure_code_total{operation=\"join\",code=\"PERMISSION_DENIED\"} 1");
    expect(metrics).toContain("spaceskit_sandbox_routed_total 3");
    expect(metrics).toContain("spaceskit_sandbox_failure_total 1");

    service.stop();
  });
});

describe("evaluateSuccessSlo", () => {
  test("treats zero samples as unevaluated and passing", () => {
    const result = evaluateSuccessSlo({
      succeeded: 0,
      failed: 0,
      minSuccessRate: 0.99,
      minSamples: 5,
    });
    expect(result.samples).toBe(0);
    expect(result.successRate).toBe(1);
    expect(result.evaluated).toBe(false);
    expect(result.meetsSlo).toBe(true);
  });
});
