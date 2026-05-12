import { Logger } from "@spaceskit/observability";
import {
  initDatabase,
  ProfileRepository,
  ProviderSecretRefRepository,
} from "@spaceskit/persistence";
import {
  DefaultGatewayAdminService,
  type AppleFoundationAvailabilitySnapshot,
} from "../src/gateway-admin-service.js";
import { LocalExecutableResolver } from "../src/execution/local-executable-resolver.js";
import { ProviderSecretRefService } from "../src/services/provider-secret-ref-service.js";

export const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_BASE_URL",
] as const;

// No-op resolver that never finds executables — isolates tests from host CLIs.
export const NO_OP_EXECUTABLE_RESOLVER = {
  resolve: () => ({ path: undefined, resolutionSource: "not_found" as const, manualPathConfigured: false }),
} as unknown as LocalExecutableResolver;

export function createSpaceAdminStub() {
  const spaces = new Map<string, any>();

  return {
    getSpace: async (spaceId: string) => spaces.get(spaceId) ?? null,
    createSpace: async (input: any) => {
      spaces.set(input.spaceId, {
        spaceId: input.spaceId,
        spaceUid: `uid-${input.spaceId}`,
        orchestratorProfileId: input.initialAgents?.[0]?.profileId ?? null,
        agents: [...(input.initialAgents ?? [])],
      });
      return spaces.get(input.spaceId);
    },
    addAgent: async (input: any) => {
      const current = spaces.get(input.spaceId);
      if (!current) {
        throw new Error(`Missing space for addAgent: ${input.spaceId}`);
      }
      current.agents.push({
        agentId: input.agentId,
        profileId: input.profileId,
        role: input.role,
        turnOrder: input.turnOrder,
        isPrimary: input.isPrimary,
      });
      return { assignment: current.agents[current.agents.length - 1] };
    },
    updateAgentAssignment: async (input: any) => {
      const current = spaces.get(input.spaceId);
      if (!current) {
        throw new Error(`Missing space for updateAgentAssignment: ${input.spaceId}`);
      }
      const index = current.agents.findIndex((agent: any) => agent.agentId === input.agentId);
      if (index >= 0) {
        current.agents[index] = {
          agentId: input.agentId,
          profileId: input.profileId,
          role: input.role,
          turnOrder: input.turnOrder,
          isPrimary: input.isPrimary,
        };
      }
      return { assignment: current.agents[index] ?? null };
    },
    setSpaceOrchestrator: async (input: any) => {
      const current = spaces.get(input.spaceId);
      if (!current) {
        throw new Error(`Missing space for setSpaceOrchestrator: ${input.spaceId}`);
      }
      current.orchestratorProfileId = input.profileId;
      return current;
    },
  };
}

export function createContext(options?: {
  gatewayProfile?: "embedded" | "external";
  enableAppleFoundationProvider?: boolean;
  appleFoundationAvailability?: AppleFoundationAvailabilitySnapshot;
  hostPlatform?: string;
  hostArch?: string;
  executableResolver?: LocalExecutableResolver;
  interconnectorCatalogService?: {
    listBundles: () => unknown[];
    rescan: () => Promise<{ interconnectors: unknown[] }>;
  };
  claudeAgentSdkMetadataProbe?: () => Promise<any>;
  codexAppServerMetadataProbe?: () => Promise<any>;
  withProfiles?: boolean;
}) {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-gateway-admin-${crypto.randomUUID()}`,
  });
  const repository = new ProviderSecretRefRepository(db.db);
  const profileRepo = options?.withProfiles ? new ProfileRepository(db.db) : null;
  const providerSecretRefService = new ProviderSecretRefService({
    repository,
    logger: new Logger({ minLevel: "error", module: "gateway-admin-test.secret-ref" }),
    masterKey: "test-gateway-admin-master-key",
  });
  const admin = new DefaultGatewayAdminService({
    logger: new Logger({ minLevel: "error", module: "gateway-admin-test" }),
    profileRepo,
    spaceAdminService: createSpaceAdminStub() as any,
    providerSecretRefService,
    gatewayProfile: options?.gatewayProfile ?? "external",
    enableAppleFoundationProvider: options?.enableAppleFoundationProvider ?? false,
    appleFoundationAvailability: options?.appleFoundationAvailability,
    hostPlatform: options?.hostPlatform,
    hostArch: options?.hostArch,
    executableResolver: options?.executableResolver ?? NO_OP_EXECUTABLE_RESOLVER,
    interconnectorCatalogService: options?.interconnectorCatalogService as any,
    claudeAgentSdkMetadataProbe: options?.claudeAgentSdkMetadataProbe,
    codexAppServerMetadataProbe: options?.codexAppServerMetadataProbe,
  });

  return {
    db,
    profileRepo,
    providerSecretRefService,
    admin,
    restoreEnv() {
      for (const key of ENV_KEYS) {
        const value = previousEnv.get(key);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}
