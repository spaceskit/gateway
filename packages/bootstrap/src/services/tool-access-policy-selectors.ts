import type {
  CapabilityProvider,
  CapabilityRegistry,
  CapabilityType,
  DangerousCapabilityId,
  ToolAccessRule,
} from "@spaceskit/core";
import type { CliToolService } from "./cli-tool-service.js";

export type CliToolLookup = Pick<CliToolService, "getTool"> | null | undefined;

export interface ToolAccessCandidateOperation {
  operationId: string;
  capability: CapabilityType;
  operation: string;
  providerIds: string[];
  providers: CapabilityProvider[];
}

type CapabilityRegistryLookup = Pick<
  CapabilityRegistry,
  "getAvailableCapabilities" | "getProviders" | "getProvidersForSpace"
>;

export function resolveCandidateOperations(
  capabilities: CapabilityRegistryLookup,
  spaceId: string,
): ToolAccessCandidateOperation[] {
  const output = new Map<string, {
    capability: CapabilityType;
    operation: string;
    providerIds: Set<string>;
    providers: Map<string, CapabilityProvider>;
  }>();
  for (const capability of capabilities.getAvailableCapabilities()) {
    const providers = resolveProviders(capabilities, capability, spaceId);
    for (const provider of providers) {
      for (const operation of provider.operations) {
        const operationId = `${capability}.${operation}`;
        const entry = output.get(operationId) ?? {
          capability,
          operation,
          providerIds: new Set<string>(),
          providers: new Map<string, CapabilityProvider>(),
        };
        entry.providerIds.add(provider.id);
        entry.providers.set(provider.id, provider);
        output.set(operationId, entry);
      }
    }
  }
  return Array.from(output.entries()).map(([operationId, value]) => ({
    operationId,
    capability: value.capability,
    operation: value.operation,
    providerIds: Array.from(value.providerIds).sort(),
    providers: Array.from(value.providers.values()),
  }));
}

export function resolveProviders(
  capabilities: Pick<CapabilityRegistry, "getProviders" | "getProvidersForSpace">,
  capability: CapabilityType,
  spaceId: string,
): CapabilityProvider[] {
  if (capability === "mcp") {
    return capabilities.getProvidersForSpace(capability, spaceId);
  }
  return capabilities.getProviders(capability);
}

export function buildSelectorIds(input: {
  capability: CapabilityType;
  operation: string;
  provider: CapabilityProvider;
  cliToolService?: CliToolLookup;
}): string[] {
  const selectors = [
    `capability:${input.capability}`,
    `tool_operation:${input.capability}.${input.operation}`,
  ];
  if (input.capability === "calendar" && input.provider.id === "apple-calendar-eventkit") {
    selectors.push("connector_family:apple-calendar-eventkit");
  }
  if (input.capability === "lists" && input.provider.id === "apple-reminders-eventkit") {
    selectors.push("connector_family:apple-reminders-eventkit");
  }
  if (input.capability === "email" && input.provider.id === "apple-mail-mailkit") {
    selectors.push("connector_family:apple-mail-mailkit");
  }
  if (input.capability === "shell") {
    const tool = input.cliToolService?.getTool(input.operation);
    if (tool?.bundleId?.trim()) {
      selectors.push(`cli_bundle:${tool.bundleId.trim()}`);
    }
  }
  if (input.provider.source === "connector") {
    selectors.push(`connector_instance:${input.provider.id}`);
    const familyId = input.provider.id.split(":")[0]?.trim();
    if (familyId) {
      selectors.push(`connector_family:${familyId}`);
    }
  }
  if (input.capability === "mcp" && input.provider.id.trim()) {
    selectors.push(`mcp_server:${input.provider.id.trim()}`);
  }
  return Array.from(new Set(selectors));
}

export function findMatchingRule(
  rules: ToolAccessRule[],
  selectors: string[],
): ToolAccessRule | undefined {
  for (const selector of selectors) {
    const [selectorKind, ...rest] = selector.split(":");
    const selectorId = rest.join(":");
    const match = rules.find((rule) => rule.selectorKind === selectorKind && rule.selectorId === selectorId);
    if (match) {
      return match;
    }
  }
  return undefined;
}

export function requiredDangerousCapability(
  cliToolService: CliToolLookup,
  capability: CapabilityType,
  operation: string,
): DangerousCapabilityId | undefined {
  if (capability !== "shell") {
    return undefined;
  }
  const tool = cliToolService?.getTool(operation);
  return tool?.bundleId?.trim() ? "managed_shell" : "arbitrary_shell";
}

export function isManagedCliTool(
  cliToolService: CliToolLookup,
  capability: CapabilityType,
  operation: string,
): boolean {
  if (capability !== "shell") return false;
  if (!cliToolService) return false;
  return cliToolService.getTool(operation) != null;
}
