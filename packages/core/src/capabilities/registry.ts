/**
 * CapabilityRegistry — the central routing table for all capabilities.
 *
 * Responsibilities:
 * - Register/deregister providers (from native adapter or TS connectors)
 * - Resolve which provider handles a given invocation
 * - Fan out read operations to multiple providers and merge results
 * - Route write operations to a single target provider
 * - Emit events when capability availability changes
 */

import type {
  CapabilityType,
  CapabilityProvider,
  CapabilityOperationMetadata,
  CapabilityInvocation,
  CapabilityResult,
  AggregatedCapabilityResult,
  CapabilityRoutingPreferences,
} from "./types.js";
import type { EventBus } from "../events/event-bus.js";
import type { TurnAccessMode } from "../agents/model-provider.js";

export interface CapabilityHandler {
  invoke(
    operation: string,
    args: Record<string, unknown>,
    context?: CapabilityPolicyContext,
  ): Promise<unknown>;
}

export interface GatewayPolicyEvaluationResult {
  allowed: boolean;
  reason?: string;
}

export type CapabilityExecutionOrigin =
  | "owner"
  | "guest"
  | "connector"
  | "system"
  | "unknown";

export interface CapabilityPolicyContext {
  spaceId?: string;
  principalId?: string;
  deviceId?: string;
  agentId?: string;
  executionOrigin?: CapabilityExecutionOrigin;
  accessMode?: TurnAccessMode;
}

export type GatewayPolicyEvaluator = (
  capability: CapabilityType,
  operation: string,
  args: Record<string, unknown>,
  context?: CapabilityPolicyContext,
) => GatewayPolicyEvaluationResult;

export type CapabilityExecutionBackend = "host" | "sandbox";

export interface CapabilityExecutionRoute {
  backend: CapabilityExecutionBackend;
  reason?: string;
}

export interface CapabilityExecutionRoutingInput {
  invocation: CapabilityInvocation;
  provider: CapabilityProvider;
  operationMetadata: CapabilityOperationMetadata;
  context?: CapabilityPolicyContext;
}

export type CapabilityExecutionRoutingResolver = (
  input: CapabilityExecutionRoutingInput,
) => CapabilityExecutionRoute;

export interface CapabilitySandboxInvocationInput extends CapabilityExecutionRoutingInput {
  hostInvoke: () => Promise<unknown>;
}

export type CapabilitySandboxInvoker = (
  input: CapabilitySandboxInvocationInput,
) => Promise<unknown>;

export class CapabilityRegistry {
  private providers = new Map<string, CapabilityProvider>();
  private handlers = new Map<string, CapabilityHandler>();
  private preferences: CapabilityRoutingPreferences = {
    defaults: {},
    spaceOverrides: {},
  };
  private gatewayPolicyEvaluator: GatewayPolicyEvaluator | null = null;
  private executionRoutingResolver: CapabilityExecutionRoutingResolver | null = null;
  private sandboxInvoker: CapabilitySandboxInvoker | null = null;

  constructor(private eventBus: EventBus) {}

  /**
   * Register a capability provider with its handler.
   * Called by the native adapter on connect, or by TS connectors on startup.
   */
  register(provider: CapabilityProvider, handler: CapabilityHandler): void {
    this.providers.set(provider.id, { ...provider, available: true });
    this.handlers.set(provider.id, handler);
    this.eventBus.emit({
      type: "capability.registered",
      providerId: provider.id,
      capabilityType: provider.capabilityType,
      operations: provider.operations,
      timestamp: new Date(),
    });
  }

  /** Remove a provider. Called when the native adapter disconnects. */
  deregister(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (provider) {
      this.providers.delete(providerId);
      this.handlers.delete(providerId);
      this.eventBus.emit({
        type: "capability.deregistered",
        providerId,
        capabilityType: provider.capabilityType,
        timestamp: new Date(),
      });
    }
  }

  /** Mark a provider as unavailable without removing it. */
  markUnavailable(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.available = false;
      this.eventBus.emit({
        type: "capability.unavailable",
        providerId,
        capabilityType: provider.capabilityType,
        timestamp: new Date(),
      });
    }
  }

  /** Get all providers for a capability type. */
  getProviders(capabilityType: CapabilityType): CapabilityProvider[] {
    return Array.from(this.providers.values()).filter(
      (p) => p.capabilityType === capabilityType && p.available
    );
  }

  /**
   * Get providers visible to a specific space.
   *
   * Most capabilities expose all available providers. MCP is space-scoped:
   * only the effective provider (space override or system default) is visible.
   */
  getProvidersForSpace(
    capabilityType: CapabilityType,
    spaceId?: string,
  ): CapabilityProvider[] {
    if (capabilityType !== "mcp") {
      return this.getProviders(capabilityType);
    }

    const preferred = this.resolvePreferredProvider(capabilityType, spaceId);
    return preferred ? [preferred] : [];
  }

  /**
   * Resolve operation metadata used by security and workspace enforcement.
   * Provider-declared metadata takes precedence, with capability defaults as fallback.
   */
  getOperationMetadata(
    invocation: CapabilityInvocation,
    spaceId?: string,
    providerId?: string,
  ): CapabilityOperationMetadata {
    const provider = providerId
      ? this.providers.get(providerId)
      : this.resolveProvider(invocation, spaceId);
    const providerMetadata = provider?.operationMetadata?.[invocation.operation];
    const fallback = defaultOperationMetadata(invocation.capability, invocation.operation);
    return {
      ...fallback,
      ...(providerMetadata ?? {}),
      pathArgs: providerMetadata?.pathArgs ?? fallback.pathArgs,
      commandArgs: providerMetadata?.commandArgs ?? fallback.commandArgs,
    };
  }

  /** Get all registered capability types that have at least one available provider. */
  getAvailableCapabilities(): CapabilityType[] {
    const types = new Set<CapabilityType>();
    for (const p of this.providers.values()) {
      if (p.available) types.add(p.capabilityType);
    }
    return Array.from(types);
  }

  /** Update routing preferences. */
  setPreferences(prefs: Partial<CapabilityRoutingPreferences>): void {
    if (prefs.defaults) {
      this.preferences.defaults = { ...this.preferences.defaults, ...prefs.defaults };
    }
    if (prefs.spaceOverrides) {
      this.preferences.spaceOverrides = {
        ...this.preferences.spaceOverrides,
        ...prefs.spaceOverrides,
      };
    }
  }

  /** Set or clear gateway-level allow/deny policy evaluator. */
  setGatewayPolicyEvaluator(evaluator: GatewayPolicyEvaluator | null): void {
    this.gatewayPolicyEvaluator = evaluator;
  }

  /** Set or clear execution route resolver used for host vs sandbox backend routing. */
  setExecutionRoutingResolver(resolver: CapabilityExecutionRoutingResolver | null): void {
    this.executionRoutingResolver = resolver;
  }

  /** Set or clear sandbox execution invoker. Required when route resolver returns backend=sandbox. */
  setSandboxInvoker(invoker: CapabilitySandboxInvoker | null): void {
    this.sandboxInvoker = invoker;
  }

  /**
   * Invoke a capability operation.
   *
   * Resolution order:
   * 1. Explicit targetProvider in the invocation
   * 2. Space-level default (if spaceId provided in context)
   * 3. System-wide default for the capability type
   * 4. First available provider
   *
   * If aggregate=true, fans out to all providers and merges results.
   */
  async invoke(
    invocation: CapabilityInvocation,
    context?: CapabilityPolicyContext,
  ): Promise<CapabilityResult | AggregatedCapabilityResult> {
    if (this.gatewayPolicyEvaluator) {
      const decision = this.gatewayPolicyEvaluator(
        invocation.capability,
        invocation.operation,
        invocation.args,
        context,
      );
      if (!decision.allowed) {
        throw new CapabilityDeniedError(
          invocation.capability,
          invocation.operation,
          decision.reason,
        );
      }
    }

    if (invocation.aggregate) {
      return this.invokeAggregated(invocation, context);
    }

    const provider = this.resolveProvider(invocation, context?.spaceId);
    if (!provider) {
      throw new CapabilityNotAvailableError(
        invocation.capability,
        invocation.operation
      );
    }

    const handler = this.handlers.get(provider.id);
    if (!handler) {
      throw new CapabilityNotAvailableError(
        invocation.capability,
        invocation.operation
      );
    }

    const operationMetadata = this.getOperationMetadata(invocation, context?.spaceId, provider.id);
    const route = this.resolveExecutionRoute({
      invocation,
      provider,
      operationMetadata,
      context,
    });

    const start = Date.now();
    const data = await this.invokeWithRoute({
      invocation,
      provider,
      operationMetadata,
      context,
      route,
      handler,
    });
    const durationMs = Date.now() - start;

    this.eventBus.emit({
      type: "capability.invoked",
      providerId: provider.id,
      capabilityType: invocation.capability,
      operation: invocation.operation,
      executionBackend: route.backend,
      executionRouteReason: route.reason,
      durationMs,
      timestamp: new Date(),
    });

    return { providerId: provider.id, data, durationMs };
  }

  private resolveProvider(
    invocation: CapabilityInvocation,
    spaceId?: string
  ): CapabilityProvider | undefined {
    // 1. Explicit target
    if (invocation.targetProvider) {
      const p = this.providers.get(invocation.targetProvider);
      if (p?.available && p.operations.includes(invocation.operation)) return p;
    }

    // 2. Space/system preferred routing
    const preferred = this.resolvePreferredProvider(invocation.capability, spaceId);
    if (preferred?.operations.includes(invocation.operation)) {
      return preferred;
    }

    // 3. MCP is strictly space/system scoped: no implicit provider fallback.
    if (invocation.capability === "mcp") {
      return undefined;
    }

    // 4. First available for non-MCP capabilities.
    return this.getProviders(invocation.capability).find((p) =>
      p.operations.includes(invocation.operation)
    );
  }

  private resolvePreferredProvider(
    capabilityType: CapabilityType,
    spaceId?: string,
  ): CapabilityProvider | undefined {
    if (spaceId) {
      const spaceDefault = this.preferences.spaceOverrides[spaceId]?.[capabilityType];
      if (spaceDefault) {
        const provider = this.providers.get(spaceDefault);
        if (provider?.available && provider.capabilityType === capabilityType) {
          return provider;
        }
      }
    }

    const systemDefault = this.preferences.defaults[capabilityType];
    if (systemDefault) {
      const provider = this.providers.get(systemDefault);
      if (provider?.available && provider.capabilityType === capabilityType) {
        return provider;
      }
    }

    if (capabilityType === "mcp") {
      return undefined;
    }

    return this.getProviders(capabilityType)[0];
  }

  private async invokeAggregated(
    invocation: CapabilityInvocation,
    context?: CapabilityPolicyContext,
  ): Promise<AggregatedCapabilityResult> {
    const providers = this.getProviders(invocation.capability).filter((p) =>
      p.operations.includes(invocation.operation)
    );

    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const handler = this.handlers.get(provider.id)!;
        const start = Date.now();
        const operationMetadata = this.getOperationMetadata(invocation, context?.spaceId, provider.id);
        const route = this.resolveExecutionRoute({
          invocation,
          provider,
          operationMetadata,
          context,
        });
        const data = await this.invokeWithRoute({
          invocation,
          provider,
          operationMetadata,
          context,
          route,
          handler,
        });
        return { providerId: provider.id, data, durationMs: Date.now() - start };
      })
    );

    const results: CapabilityResult[] = [];
    const errors: Array<{ providerId: string; error: string }> = [];

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === "fulfilled") {
        results.push(s.value);
      } else {
        errors.push({
          providerId: providers[i].id,
          error: s.reason?.message ?? "Unknown error",
        });
      }
    }

    return { results, errors };
  }

  private resolveExecutionRoute(
    input: CapabilityExecutionRoutingInput,
  ): CapabilityExecutionRoute {
    if (!this.executionRoutingResolver) {
      return { backend: "host" };
    }
    const resolved = this.executionRoutingResolver(input);
    if (resolved.backend === "sandbox" || resolved.backend === "host") {
      return resolved;
    }
    return { backend: "host" };
  }

  private async invokeWithRoute(input: {
    invocation: CapabilityInvocation;
    provider: CapabilityProvider;
    operationMetadata: CapabilityOperationMetadata;
    context?: CapabilityPolicyContext;
    route: CapabilityExecutionRoute;
    handler: CapabilityHandler;
  }): Promise<unknown> {
    const hostInvoke = () => input.handler.invoke(
      input.invocation.operation,
      input.invocation.args,
      input.context,
    );
    if (input.route.backend !== "sandbox") {
      return hostInvoke();
    }
    if (!this.sandboxInvoker) {
      throw new CapabilityDeniedError(
        input.invocation.capability,
        input.invocation.operation,
        input.route.reason ?? "Sandbox backend required but unavailable",
      );
    }
    this.eventBus.emit({
      type: "capability.execution_routed",
      providerId: input.provider.id,
      capabilityType: input.invocation.capability,
      operation: input.invocation.operation,
      backend: "sandbox",
      reason: input.route.reason ?? "policy_required",
      timestamp: new Date(),
    });
    return this.sandboxInvoker({
      invocation: input.invocation,
      provider: input.provider,
      operationMetadata: input.operationMetadata,
      context: input.context,
      hostInvoke,
    });
  }
}

const DEFAULT_PATH_ARGS = [
  "path",
  "filePath",
  "targetPath",
  "sourcePath",
  "destinationPath",
  "directory",
  "cwd",
];

const DEFAULT_COMMAND_ARGS = ["command", "cmd", "script", "program"];

function defaultOperationMetadata(
  capability: CapabilityType,
  operation: string,
): CapabilityOperationMetadata {
  const normalizedOperation = operation.trim().toLowerCase();
  const filesystemWrite = capability === "files" && isLikelyFilesystemWriteOperation(normalizedOperation);
  const requiresShell = capability === "shell";
  const requiresNetwork = capability === "browser" || capability === "messaging" || capability === "mcp";

  return {
    requiresShell,
    requiresNetwork,
    filesystemWrite,
    pathArgs: capability === "files" ? DEFAULT_PATH_ARGS : undefined,
    commandArgs: requiresShell ? DEFAULT_COMMAND_ARGS : undefined,
  };
}

function isLikelyFilesystemWriteOperation(operation: string): boolean {
  if (!operation) return false;
  return (
    operation.includes("write")
    || operation.includes("append")
    || operation.includes("create")
    || operation.includes("update")
    || operation.includes("save")
    || operation.includes("delete")
    || operation.includes("remove")
    || operation.includes("rename")
    || operation.includes("move")
    || operation.includes("mkdir")
    || operation.includes("touch")
    || operation.includes("copy")
  );
}

export class CapabilityNotAvailableError extends Error {
  constructor(capability: string, operation: string) {
    super(`No available provider for ${capability}.${operation}`);
    this.name = "CapabilityNotAvailableError";
  }
}

export class CapabilityDeniedError extends Error {
  readonly code = "PERMISSION_DENIED" as const;

  constructor(capability: string, operation: string, reason?: string) {
    super(reason ?? `Capability denied by gateway policy: ${capability}.${operation}`);
    this.name = "CapabilityDeniedError";
  }
}
