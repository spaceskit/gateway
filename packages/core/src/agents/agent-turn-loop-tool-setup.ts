import type {
  GatewayToolBridgeConfig,
  ModelMessage,
  ToolDefinition,
} from "./model-provider.js";
import type { TurnContext } from "./agent-runtime.js";
import type { ToolExecutor } from "./tool-executor.js";
import { GatewayToolProxy } from "./gateway-tool-proxy.js";
import { resolveMcpBridgeScriptPath } from "./gateway-mcp-bridge-config.js";
import {
  buildMediatedToolPrompt,
  buildToolUsageGuidance,
  cleanupMcpDiscoveryConfig,
  resolveToolDefinitionsForTurn,
  shouldSuppressInjectedToolsForPrompt,
  writeMcpDiscoveryConfig,
} from "./agent-runtime-tools.js";

export interface ConfigureTurnToolsInput {
  toolExecutor: ToolExecutor;
  context: TurnContext;
  agentId: string;
  providerId: string;
  workingDirectory?: string;
  messages: ModelMessage[];
  isMediated: boolean;
  signal: AbortSignal;
}

export interface TurnToolSetup {
  toolDefs: ToolDefinition[];
  mediatedToolDefs: ToolDefinition[];
  mediatedFallbackEnabled: boolean;
  suppressInjectedTools: boolean;
  toolProxy: GatewayToolProxy | null;
  gatewayToolBridgeConfig?: GatewayToolBridgeConfig;
  mcpDiscoveryFilePath?: string;
}

export async function configureTurnTools(input: ConfigureTurnToolsInput): Promise<TurnToolSetup> {
  const suppressInjectedTools = shouldSuppressInjectedToolsForPrompt(input.context.messages);
  let toolDefs: ToolDefinition[] = [];
  let mediatedToolDefs: ToolDefinition[] = [];
  let mediatedFallbackEnabled = false;
  let toolProxy: GatewayToolProxy | null = null;
  let gatewayToolBridgeConfig: GatewayToolBridgeConfig | undefined;
  let mcpDiscoveryFilePath: string | undefined;

  const gatewayToolBridgeProviders = new Set(["claude", "codex", "claude-agent-sdk", "codex-app-server"]);
  const mcpDiscoveryProviders = new Set(["claude", "codex"]);

  if (input.isMediated) {
    mediatedToolDefs = await resolveToolDefinitionsForTurn(
      input.toolExecutor,
      input.context.spaceId,
      input.agentId,
      input.signal,
      input.context.messages,
      suppressInjectedTools,
    );
    if (mediatedToolDefs.length > 0) {
      const bridgeScriptPath = resolveMcpBridgeScriptPath();
      const providerSupportsGatewayToolBridge = gatewayToolBridgeProviders.has(input.providerId);
      const providerSupportsMcpDiscovery = mcpDiscoveryProviders.has(input.providerId);
      if (bridgeScriptPath && providerSupportsGatewayToolBridge) {
        const executionCtx = {
          spaceId: input.context.spaceId,
          agentId: input.agentId,
          turnId: input.context.turnId,
          lineageId: input.context.lineageId,
          principalId: input.context.principalId,
          deviceId: input.context.deviceId,
          executionOrigin: input.context.executionOrigin,
          accessMode: input.context.accessMode,
          suppressInjectedTools,
        };
        toolProxy = await GatewayToolProxy.create(input.toolExecutor, executionCtx, input.signal);
        const toolDefsJson = JSON.stringify(mediatedToolDefs);

        if (providerSupportsMcpDiscovery && input.workingDirectory) {
          try {
            mcpDiscoveryFilePath = await writeMcpDiscoveryConfig(
              input.workingDirectory,
              { bridgeScriptPath, toolDefsJson, socketPath: toolProxy.socketPath },
            );
          } catch {
            // Non-fatal: CLI flag path is primary for supporting providers.
          }
        }

        gatewayToolBridgeConfig = {
          bridgeScriptPath,
          toolDefsJson,
          socketPath: toolProxy.socketPath,
        };
      } else {
        mediatedFallbackEnabled = true;
        input.messages.splice(1, 0, {
          role: "system",
          content: buildMediatedToolPrompt(mediatedToolDefs),
        });
      }
    }
  } else {
    toolDefs = await resolveToolDefinitionsForTurn(
      input.toolExecutor,
      input.context.spaceId,
      input.agentId,
      input.signal,
      input.context.messages,
      suppressInjectedTools,
    );
    if (toolDefs.length > 0) {
      input.messages.splice(1, 0, {
        role: "system",
        content: buildToolUsageGuidance(toolDefs),
      });
    }
  }

  return {
    toolDefs,
    mediatedToolDefs,
    mediatedFallbackEnabled,
    suppressInjectedTools,
    toolProxy,
    gatewayToolBridgeConfig,
    mcpDiscoveryFilePath,
  };
}

export async function cleanupTurnTools(setup: Pick<TurnToolSetup, "toolProxy" | "mcpDiscoveryFilePath">): Promise<void> {
  setup.toolProxy?.close();
  if (setup.mcpDiscoveryFilePath) {
    await cleanupMcpDiscoveryConfig(setup.mcpDiscoveryFilePath);
  }
}
