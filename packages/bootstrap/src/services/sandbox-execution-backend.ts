import type { CapabilitySandboxInvocationInput } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

export interface SandboxExecutionBackendOptions {
  logger: Logger;
  runtimeModule?: string;
  allowHostPassthrough?: boolean;
}

export interface SandboxExecutionBackend {
  readonly mode: "module" | "passthrough" | "unavailable";
  invoke(input: CapabilitySandboxInvocationInput): Promise<unknown>;
}

type SandboxModuleInvoker = (input: {
  providerId: string;
  providerSource: string;
  capability: string;
  operation: string;
  args: Record<string, unknown>;
  requiresShell: boolean;
  requiresNetwork: boolean;
  filesystemWrite: boolean;
  spaceId?: string;
  principalId?: string;
  deviceId?: string;
  agentId?: string;
  executionOrigin?: string;
}) => Promise<unknown>;

export async function createSandboxExecutionBackend(
  options: SandboxExecutionBackendOptions,
): Promise<SandboxExecutionBackend> {
  const runtimeModule = sanitizeOptional(options.runtimeModule);
  const runtimeModuleSpecifier = runtimeModule
    ? resolveRuntimeModuleSpecifier(runtimeModule)
    : undefined;
  const allowHostPassthrough = options.allowHostPassthrough === true;

  if (runtimeModuleSpecifier) {
    try {
      const imported = await import(runtimeModuleSpecifier) as Record<string, unknown>;
      const moduleInvoker = resolveModuleInvoker(imported);
      if (moduleInvoker) {
        options.logger.info("Sandbox execution backend initialized from runtime module", {
          runtimeModule,
          runtimeModuleSpecifier,
        });
        return {
          mode: "module",
          invoke: (input) => moduleInvoker(mapSandboxInput(input)),
        };
      }
      options.logger.warn("Sandbox runtime module loaded but no compatible invoker was found", {
        runtimeModule,
        runtimeModuleSpecifier,
      });
    } catch (error) {
      options.logger.warn("Sandbox runtime module failed to load", {
        runtimeModule,
        runtimeModuleSpecifier,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (allowHostPassthrough) {
    options.logger.warn("Sandbox runtime host passthrough is enabled", {
      reason: "No runtime module configured",
    });
    return {
      mode: "passthrough",
      invoke: (input) => input.hostInvoke(),
    };
  }

  return {
    mode: "unavailable",
    invoke: async (input) => {
      throw new Error(
        `Sandbox backend required but unavailable for ${input.invocation.capability}.${input.invocation.operation}`,
      );
    },
  };
}

function mapSandboxInput(
  input: CapabilitySandboxInvocationInput,
): {
  providerId: string;
  providerSource: string;
  capability: string;
  operation: string;
  args: Record<string, unknown>;
  requiresShell: boolean;
  requiresNetwork: boolean;
  filesystemWrite: boolean;
  spaceId?: string;
  principalId?: string;
  deviceId?: string;
  agentId?: string;
  executionOrigin?: string;
} {
  return {
    providerId: input.provider.id,
    providerSource: input.provider.source,
    capability: input.invocation.capability,
    operation: input.invocation.operation,
    args: input.invocation.args,
    requiresShell: input.operationMetadata.requiresShell === true,
    requiresNetwork: input.operationMetadata.requiresNetwork === true,
    filesystemWrite: input.operationMetadata.filesystemWrite === true,
    spaceId: input.context?.spaceId,
    principalId: input.context?.principalId,
    deviceId: input.context?.deviceId,
    agentId: input.context?.agentId,
    executionOrigin: input.context?.executionOrigin,
  };
}

function resolveModuleInvoker(moduleRecord: Record<string, unknown>): SandboxModuleInvoker | null {
  const direct = asFunction(moduleRecord.createSpaceskitSandboxInvoker);
  if (direct) {
    const maybeInvoker = direct();
    if (typeof maybeInvoker === "function") {
      return maybeInvoker as SandboxModuleInvoker;
    }
  }

  const invokeInSandbox = asFunction(moduleRecord.invokeInSandbox);
  if (invokeInSandbox) {
    return invokeInSandbox as SandboxModuleInvoker;
  }

  const defaultExport = asFunction(moduleRecord.default);
  if (defaultExport) {
    return defaultExport as SandboxModuleInvoker;
  }

  return null;
}

function asFunction(value: unknown): ((...args: any[]) => any) | null {
  return typeof value === "function" ? (value as (...args: any[]) => any) : null;
}

function sanitizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveRuntimeModuleSpecifier(runtimeModule: string): string {
  if (runtimeModule.startsWith("file://")) {
    return runtimeModule;
  }
  if (runtimeModule.startsWith("./") || runtimeModule.startsWith("../")) {
    return pathToFileURL(resolvePath(process.cwd(), runtimeModule)).href;
  }
  if (isAbsolute(runtimeModule)) {
    return pathToFileURL(runtimeModule).href;
  }
  return runtimeModule;
}
