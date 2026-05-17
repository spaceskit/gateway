import type { BootstrapState } from "./bootstrap-state.js";
import { createSandboxExecutionBackend } from "./services/sandbox-execution-backend.js";
import {
  evaluateSandboxSlo,
  resolveCapabilityExecutionRoute,
} from "./turn-helpers.js";

export interface PolicySandboxRuntimeState {
  enforceSandboxRouting: boolean;
  backendMode: "disabled" | "module" | "passthrough" | "unavailable";
  routed: number;
  succeeded: number;
  failed: number;
  belowSloSince?: string;
  lastFailureAt?: string;
  lastFailureMessage?: string;
}

export async function configurePolicySandboxRuntime(
  state: BootstrapState,
): Promise<PolicySandboxRuntimeState> {
  const { config, logger } = state;
  const enforceSandboxRouting = config.archFreezeEnforced || config.sandboxRuntimeEnabled;
  const sandboxBackend = enforceSandboxRouting
    ? await createSandboxExecutionBackend({
      logger: logger.child({ module: "sandbox-runtime" }),
      runtimeModule: config.sandboxRuntimeModule,
      allowHostPassthrough: config.sandboxAllowHostPassthrough,
    })
    : null;
  const sandboxRuntimeState: PolicySandboxRuntimeState = {
    enforceSandboxRouting,
    backendMode: sandboxBackend?.mode ?? "disabled",
    routed: 0,
    succeeded: 0,
    failed: 0,
    belowSloSince: undefined,
    lastFailureAt: undefined,
    lastFailureMessage: undefined,
  };

  if (config.gatewayProfile === "external" && enforceSandboxRouting) {
    if (config.sandboxAllowHostPassthrough) {
      throw new Error(
        "External profile requires strict sandbox isolation; SPACESKIT_SANDBOX_ALLOW_HOST_PASSTHROUGH=true is not permitted",
      );
    }
    if (!sandboxBackend || sandboxBackend.mode !== "module") {
      throw new Error(
        "External profile requires a configured sandbox runtime module when sandbox routing is enforced",
      );
    }
  }

  const updateSandboxSloState = (): void => {
    const evaluation = evaluateSandboxSlo({
      succeeded: sandboxRuntimeState.succeeded,
      failed: sandboxRuntimeState.failed,
      minSuccessRate: config.sandboxSloMinSuccessRate,
      minSamples: config.sandboxSloMinSamples,
    });
    if (!evaluation.evaluated || evaluation.meetsSlo) {
      sandboxRuntimeState.belowSloSince = undefined;
      return;
    }
    if (!sandboxRuntimeState.belowSloSince) {
      sandboxRuntimeState.belowSloSince = new Date().toISOString();
      logger.warn("Sandbox success-rate SLO breached", {
        gatewayProfile: config.gatewayProfile,
        sandboxMode: sandboxRuntimeState.backendMode,
        successRate: evaluation.successRate,
        minSuccessRate: config.sandboxSloMinSuccessRate,
        samples: evaluation.samples,
        minSamples: config.sandboxSloMinSamples,
        sandboxSloEnforce: config.sandboxSloEnforce,
      });
    }
  };

  if (sandboxBackend) {
    state.capabilities.setSandboxInvoker(async (input) => {
      sandboxRuntimeState.routed += 1;
      try {
        const result = await sandboxBackend.invoke(input);
        sandboxRuntimeState.succeeded += 1;
        updateSandboxSloState();
        return result;
      } catch (error) {
        sandboxRuntimeState.failed += 1;
        sandboxRuntimeState.lastFailureAt = new Date().toISOString();
        sandboxRuntimeState.lastFailureMessage = error instanceof Error ? error.message : String(error);
        updateSandboxSloState();
        throw error;
      }
    });
    logger.info("Sandbox execution backend configured", {
      mode: sandboxBackend.mode,
      enforceSandboxRouting,
      sandboxRuntimeEnabled: config.sandboxRuntimeEnabled,
      archFreezeEnforced: config.archFreezeEnforced,
      sloMinSuccessRate: config.sandboxSloMinSuccessRate,
      sloMinSamples: config.sandboxSloMinSamples,
      sloEnforce: config.sandboxSloEnforce,
    });
    if (sandboxBackend.mode === "unavailable") {
      logger.warn("Sandbox backend unavailable — sandbox-routed operations will be denied", {
        sandboxRuntimeModule: config.sandboxRuntimeModule ?? null,
      });
    }
  } else {
    state.capabilities.setSandboxInvoker(null);
  }

  state.capabilities.setExecutionRoutingResolver((routingInput) => (
    resolveCapabilityExecutionRoute(routingInput, { enforceSandboxRouting })
  ));

  return sandboxRuntimeState;
}
