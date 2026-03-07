import type { EventBus } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";

type RelayRoute = "direct" | "relay_proxy";
type RelayOperation = "resolve" | "join";
type SandboxBackendMode = "disabled" | "module" | "passthrough" | "unavailable";

export interface GatewayObservabilityServiceOptions {
  eventBus?: Pick<EventBus, "on">;
  logger?: Logger;
  relaySloMinSuccessRate: number;
  relaySloMinSamples: number;
  relaySloEnforce: boolean;
  sandboxSloMinSuccessRate: number;
  sandboxSloMinSamples: number;
  sandboxSloEnforce: boolean;
  getSandboxState: () => {
    enforceSandboxRouting: boolean;
    backendMode: SandboxBackendMode;
    routed: number;
    succeeded: number;
    failed: number;
    lastFailureAt?: string;
    lastFailureMessage?: string;
    belowSloSince?: string;
  };
}

interface RelayOperationState {
  attempted: number;
  succeeded: number;
  failed: number;
  belowSloSince?: string;
}

interface RelayState {
  resolve: RelayOperationState;
  join: RelayOperationState;
  routeCounts: Record<RelayRoute, number>;
  failureCodes: Record<string, number>;
}

export interface SloEvaluation {
  successRate: number;
  samples: number;
  evaluated: boolean;
  meetsSlo: boolean;
}

export interface RelayOperationSnapshot {
  attempted: number;
  succeeded: number;
  failed: number;
  successRate: number;
  samples: number;
  sloEvaluated: boolean;
  sloMet: boolean;
  belowSloSince?: string;
}

export interface RelayObservabilitySnapshot {
  resolve: RelayOperationSnapshot;
  join: RelayOperationSnapshot;
  overall: RelayOperationSnapshot;
  routeCounts: Record<RelayRoute, number>;
  failureCodes: Record<string, number>;
  minSuccessRate: number;
  minSamples: number;
  sloEnforced: boolean;
}

export interface SandboxObservabilitySnapshot {
  enforceSandboxRouting: boolean;
  backendMode: SandboxBackendMode;
  routed: number;
  succeeded: number;
  failed: number;
  successRate: number;
  samples: number;
  minSuccessRate: number;
  minSamples: number;
  sloEvaluated: boolean;
  sloMet: boolean;
  sloEnforced: boolean;
  belowSloSince?: string;
  lastFailureAt?: string;
  lastFailureMessage?: string;
}

export interface GatewayObservabilitySummary {
  generatedAt: string;
  relay: RelayObservabilitySnapshot;
  sandbox: SandboxObservabilitySnapshot;
}

export class GatewayObservabilityService {
  private readonly relayState: RelayState = {
    resolve: { attempted: 0, succeeded: 0, failed: 0 },
    join: { attempted: 0, succeeded: 0, failed: 0 },
    routeCounts: {
      direct: 0,
      relay_proxy: 0,
    },
    failureCodes: {},
  };

  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly options: GatewayObservabilityServiceOptions) {
    if (options.eventBus) {
      this.unsubscribers.push(
        options.eventBus.on("share.relay.resolve.attempt", () => {
          this.recordAttempt("resolve");
        }),
      );
      this.unsubscribers.push(
        options.eventBus.on("share.relay.join.attempt", () => {
          this.recordAttempt("join");
        }),
      );
      this.unsubscribers.push(
        options.eventBus.on("share.relay.resolve.success", (event) => {
          const route = normalizeRelayRoute(event.gatewayRoute);
          this.recordSuccess("resolve", route);
        }),
      );
      this.unsubscribers.push(
        options.eventBus.on("share.relay.join.success", () => {
          this.recordSuccess("join");
        }),
      );
      this.unsubscribers.push(
        options.eventBus.on("share.relay.resolve.failed", (event) => {
          this.recordFailure("resolve", normalizeErrorCode(event.code));
        }),
      );
      this.unsubscribers.push(
        options.eventBus.on("share.relay.join.failed", (event) => {
          this.recordFailure("join", normalizeErrorCode(event.code));
        }),
      );
    }
  }

  stop(): void {
    while (this.unsubscribers.length > 0) {
      const unsubscribe = this.unsubscribers.pop();
      unsubscribe?.();
    }
  }

  getRelaySnapshot(): RelayObservabilitySnapshot {
    const resolveEval = evaluateSuccessSlo({
      succeeded: this.relayState.resolve.succeeded,
      failed: this.relayState.resolve.failed,
      minSuccessRate: this.options.relaySloMinSuccessRate,
      minSamples: this.options.relaySloMinSamples,
    });
    const joinEval = evaluateSuccessSlo({
      succeeded: this.relayState.join.succeeded,
      failed: this.relayState.join.failed,
      minSuccessRate: this.options.relaySloMinSuccessRate,
      minSamples: this.options.relaySloMinSamples,
    });
    const overallEval = evaluateSuccessSlo({
      succeeded: this.relayState.resolve.succeeded + this.relayState.join.succeeded,
      failed: this.relayState.resolve.failed + this.relayState.join.failed,
      minSuccessRate: this.options.relaySloMinSuccessRate,
      minSamples: this.options.relaySloMinSamples,
    });

    return {
      resolve: {
        attempted: this.relayState.resolve.attempted,
        succeeded: this.relayState.resolve.succeeded,
        failed: this.relayState.resolve.failed,
        successRate: resolveEval.successRate,
        samples: resolveEval.samples,
        sloEvaluated: resolveEval.evaluated,
        sloMet: resolveEval.meetsSlo,
        belowSloSince: this.relayState.resolve.belowSloSince,
      },
      join: {
        attempted: this.relayState.join.attempted,
        succeeded: this.relayState.join.succeeded,
        failed: this.relayState.join.failed,
        successRate: joinEval.successRate,
        samples: joinEval.samples,
        sloEvaluated: joinEval.evaluated,
        sloMet: joinEval.meetsSlo,
        belowSloSince: this.relayState.join.belowSloSince,
      },
      overall: {
        attempted: this.relayState.resolve.attempted + this.relayState.join.attempted,
        succeeded: this.relayState.resolve.succeeded + this.relayState.join.succeeded,
        failed: this.relayState.resolve.failed + this.relayState.join.failed,
        successRate: overallEval.successRate,
        samples: overallEval.samples,
        sloEvaluated: overallEval.evaluated,
        sloMet: overallEval.meetsSlo,
        belowSloSince: earliestIso(
          this.relayState.resolve.belowSloSince,
          this.relayState.join.belowSloSince,
        ),
      },
      routeCounts: {
        direct: this.relayState.routeCounts.direct,
        relay_proxy: this.relayState.routeCounts.relay_proxy,
      },
      failureCodes: { ...this.relayState.failureCodes },
      minSuccessRate: this.options.relaySloMinSuccessRate,
      minSamples: this.options.relaySloMinSamples,
      sloEnforced: this.options.relaySloEnforce,
    };
  }

  getSandboxSnapshot(): SandboxObservabilitySnapshot {
    const sandboxState = this.options.getSandboxState();
    const evalResult = evaluateSuccessSlo({
      succeeded: sandboxState.succeeded,
      failed: sandboxState.failed,
      minSuccessRate: this.options.sandboxSloMinSuccessRate,
      minSamples: this.options.sandboxSloMinSamples,
    });
    return {
      enforceSandboxRouting: sandboxState.enforceSandboxRouting,
      backendMode: sandboxState.backendMode,
      routed: sandboxState.routed,
      succeeded: sandboxState.succeeded,
      failed: sandboxState.failed,
      successRate: evalResult.successRate,
      samples: evalResult.samples,
      minSuccessRate: this.options.sandboxSloMinSuccessRate,
      minSamples: this.options.sandboxSloMinSamples,
      sloEvaluated: evalResult.evaluated,
      sloMet: evalResult.meetsSlo,
      sloEnforced: this.options.sandboxSloEnforce,
      belowSloSince: sandboxState.belowSloSince,
      lastFailureAt: sandboxState.lastFailureAt,
      lastFailureMessage: sandboxState.lastFailureMessage,
    };
  }

  getSummary(): GatewayObservabilitySummary {
    return {
      generatedAt: new Date().toISOString(),
      relay: this.getRelaySnapshot(),
      sandbox: this.getSandboxSnapshot(),
    };
  }

  formatPrometheus(): string {
    const summary = this.getSummary();
    const lines: string[] = [];

    lines.push("# HELP spaceskit_relay_resolve_attempt_total Relay resolve attempts.");
    lines.push("# TYPE spaceskit_relay_resolve_attempt_total counter");
    lines.push(`spaceskit_relay_resolve_attempt_total ${summary.relay.resolve.attempted}`);

    lines.push("# HELP spaceskit_relay_resolve_success_total Relay resolve successes.");
    lines.push("# TYPE spaceskit_relay_resolve_success_total counter");
    lines.push(`spaceskit_relay_resolve_success_total ${summary.relay.resolve.succeeded}`);

    lines.push("# HELP spaceskit_relay_resolve_failure_total Relay resolve failures.");
    lines.push("# TYPE spaceskit_relay_resolve_failure_total counter");
    lines.push(`spaceskit_relay_resolve_failure_total ${summary.relay.resolve.failed}`);

    lines.push("# HELP spaceskit_relay_join_attempt_total Relay join attempts.");
    lines.push("# TYPE spaceskit_relay_join_attempt_total counter");
    lines.push(`spaceskit_relay_join_attempt_total ${summary.relay.join.attempted}`);

    lines.push("# HELP spaceskit_relay_join_success_total Relay join successes.");
    lines.push("# TYPE spaceskit_relay_join_success_total counter");
    lines.push(`spaceskit_relay_join_success_total ${summary.relay.join.succeeded}`);

    lines.push("# HELP spaceskit_relay_join_failure_total Relay join failures.");
    lines.push("# TYPE spaceskit_relay_join_failure_total counter");
    lines.push(`spaceskit_relay_join_failure_total ${summary.relay.join.failed}`);

    lines.push("# HELP spaceskit_relay_route_total Relay route distribution.");
    lines.push("# TYPE spaceskit_relay_route_total counter");
    lines.push(`spaceskit_relay_route_total{route="direct"} ${summary.relay.routeCounts.direct}`);
    lines.push(`spaceskit_relay_route_total{route="relay_proxy"} ${summary.relay.routeCounts.relay_proxy}`);

    lines.push("# HELP spaceskit_relay_failure_code_total Relay failures by operation and error code.");
    lines.push("# TYPE spaceskit_relay_failure_code_total counter");
    for (const [key, count] of Object.entries(summary.relay.failureCodes)) {
      const [operation, code] = key.split("::");
      lines.push(
        `spaceskit_relay_failure_code_total{operation="${escapeLabelValue(operation)}",code="${escapeLabelValue(code)}"} ${count}`,
      );
    }

    lines.push("# HELP spaceskit_relay_success_rate Relay success rate gauges.");
    lines.push("# TYPE spaceskit_relay_success_rate gauge");
    lines.push(`spaceskit_relay_success_rate{operation="resolve"} ${summary.relay.resolve.successRate}`);
    lines.push(`spaceskit_relay_success_rate{operation="join"} ${summary.relay.join.successRate}`);
    lines.push(`spaceskit_relay_success_rate{operation="overall"} ${summary.relay.overall.successRate}`);

    lines.push("# HELP spaceskit_relay_slo_met Relay SLO status (1=met,0=breached).");
    lines.push("# TYPE spaceskit_relay_slo_met gauge");
    lines.push(`spaceskit_relay_slo_met{operation="resolve"} ${summary.relay.resolve.sloMet ? 1 : 0}`);
    lines.push(`spaceskit_relay_slo_met{operation="join"} ${summary.relay.join.sloMet ? 1 : 0}`);
    lines.push(`spaceskit_relay_slo_met{operation="overall"} ${summary.relay.overall.sloMet ? 1 : 0}`);

    lines.push("# HELP spaceskit_sandbox_routed_total Sandbox-routed invocations.");
    lines.push("# TYPE spaceskit_sandbox_routed_total counter");
    lines.push(`spaceskit_sandbox_routed_total ${summary.sandbox.routed}`);

    lines.push("# HELP spaceskit_sandbox_success_total Successful sandbox invocations.");
    lines.push("# TYPE spaceskit_sandbox_success_total counter");
    lines.push(`spaceskit_sandbox_success_total ${summary.sandbox.succeeded}`);

    lines.push("# HELP spaceskit_sandbox_failure_total Failed sandbox invocations.");
    lines.push("# TYPE spaceskit_sandbox_failure_total counter");
    lines.push(`spaceskit_sandbox_failure_total ${summary.sandbox.failed}`);

    lines.push("# HELP spaceskit_sandbox_success_rate Sandbox success rate.");
    lines.push("# TYPE spaceskit_sandbox_success_rate gauge");
    lines.push(`spaceskit_sandbox_success_rate ${summary.sandbox.successRate}`);

    lines.push("# HELP spaceskit_sandbox_slo_met Sandbox SLO status (1=met,0=breached).");
    lines.push("# TYPE spaceskit_sandbox_slo_met gauge");
    lines.push(`spaceskit_sandbox_slo_met ${summary.sandbox.sloMet ? 1 : 0}`);

    return `${lines.join("\n")}\n`;
  }

  private recordAttempt(operation: RelayOperation): void {
    this.relayState[operation].attempted += 1;
  }

  private recordSuccess(operation: RelayOperation, route?: RelayRoute): void {
    this.relayState[operation].succeeded += 1;
    if (route) {
      this.relayState.routeCounts[route] += 1;
    }
    this.updateRelaySloState(operation);
  }

  private recordFailure(operation: RelayOperation, code: string): void {
    this.relayState[operation].failed += 1;
    this.relayState.failureCodes[`${operation}::${code}`] = (
      this.relayState.failureCodes[`${operation}::${code}`] ?? 0
    ) + 1;
    this.updateRelaySloState(operation);
  }

  private updateRelaySloState(operation: RelayOperation): void {
    const state = this.relayState[operation];
    const evaluation = evaluateSuccessSlo({
      succeeded: state.succeeded,
      failed: state.failed,
      minSuccessRate: this.options.relaySloMinSuccessRate,
      minSamples: this.options.relaySloMinSamples,
    });
    if (!evaluation.evaluated || evaluation.meetsSlo) {
      state.belowSloSince = undefined;
      return;
    }
    if (!state.belowSloSince) {
      state.belowSloSince = new Date().toISOString();
      this.options.logger?.warn("Relay success-rate SLO breached", {
        operation,
        successRate: evaluation.successRate,
        samples: evaluation.samples,
        minSuccessRate: this.options.relaySloMinSuccessRate,
        minSamples: this.options.relaySloMinSamples,
        relaySloEnforce: this.options.relaySloEnforce,
      });
    }
  }
}

export function evaluateSuccessSlo(input: {
  succeeded: number;
  failed: number;
  minSuccessRate: number;
  minSamples: number;
}): SloEvaluation {
  const samples = Math.max(0, input.succeeded) + Math.max(0, input.failed);
  const successRate = samples <= 0 ? 1 : Math.max(0, Math.min(1, input.succeeded / samples));
  const evaluated = samples >= Math.max(1, Math.floor(input.minSamples));
  const meetsSlo = !evaluated || successRate >= input.minSuccessRate;
  return {
    successRate,
    samples,
    evaluated,
    meetsSlo,
  };
}

function normalizeRelayRoute(value: unknown): RelayRoute | undefined {
  if (value === "direct" || value === "relay_proxy") {
    return value;
  }
  return undefined;
}

function normalizeErrorCode(value: unknown): string {
  if (typeof value !== "string") return "INTERNAL";
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : "INTERNAL";
}

function earliestIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function escapeLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n");
}
