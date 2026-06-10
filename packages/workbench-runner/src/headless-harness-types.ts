export type HarnessMode = "external" | "in-process";
export type HarnessFlow = "chat" | "mcp" | "combined";
export type ProvisioningStrategy = "client-api" | "built-in-mcp-admin";
export type TurnStatus = "completed" | "failed" | "pending";

export interface HarnessOptions {
  mode: HarnessMode;
  flow: HarnessFlow;
  provisioning: ProvisioningStrategy;
  artifactPath?: string;
  wsUrl?: string;
  httpUrl?: string;
  timeoutMs: number;
  prompt: string;
  startGateway?: HeadlessGatewayStarter;
}

export interface TurnObservation {
  turnId: string | null;
  status: TurnStatus;
  streamText: string;
  finalMessage?: string;
  failure?: string;
  events: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
}

export interface HarnessRunReport {
  mode: HarnessMode;
  flow: HarnessFlow;
  provisioning: ProvisioningStrategy;
  startedAt: string;
  finishedAt: string;
  gateway: {
    wsUrl: string;
    httpUrl: string;
  };
  chat?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
}

export interface HarnessRuntime {
  wsUrl: string;
  httpUrl: string;
  cleanup: () => Promise<void>;
}

export interface HeadlessGatewayOptions {
  port: number;
  host: string;
  dbPath: string;
  spacesRoot: string;
  logLevel: string;
  gatewayProfile: string;
  archFreezeEnforced: boolean;
  skipAuth: boolean;
  httpPrincipalAuthHs256Secret: string;
  mainAdminMcpEnabled: boolean;
  gatewayCapabilityGrants: string[];
  runtimeGeneration: string;
  mainSpaceId: string;
  mainProfileId: string;
  mainAgentId: string;
}

export interface HeadlessGatewayInstance {
  shutdown: () => Promise<void>;
}

export type HeadlessGatewayStarter = (
  options: HeadlessGatewayOptions,
) => Promise<HeadlessGatewayInstance>;
