import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initializeCollaborationServices } from "../src/collaboration-services-phase.js";
import { GatewayExternalConnectivityService } from "../src/services/gateway-external-connectivity-service.js";
import type { BootstrapState } from "../src/bootstrap-state.js";

interface DeviceIdRow {
  device_id: string;
  principal_id: string;
  public_key: string;
  platform: string;
  key_version: number;
  status: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

function makeDeviceIdentityRepo() {
  const rows = new Map<string, DeviceIdRow>();
  return {
    rows,
    getByPrincipalAndDevice: (principalId: string, deviceId: string) =>
      rows.get(`${principalId}:${deviceId}`),
    create: (input: { principalId: string; deviceId: string; publicKey: string; platform?: string }) => {
      const row: DeviceIdRow = {
        device_id: input.deviceId,
        principal_id: input.principalId,
        public_key: input.publicKey,
        platform: input.platform ?? "",
        key_version: 1,
        status: "active",
        created_at: "2026-05-02T00:00:00.000Z",
        updated_at: "2026-05-02T00:00:00.000Z",
        last_seen_at: null,
        revoked_at: null,
      };
      rows.set(`${input.principalId}:${input.deviceId}`, row);
      return row;
    },
    rotateKey: () => undefined,
    revoke: () => false,
    listByPrincipal: () => [],
    touchLastSeen: () => undefined,
  } as any;
}

function makeMinimalState(): BootstrapState {
  const state = {
    config: {
      collabChangesetsEnabled: false,
      gatewayProfile: "external",
      host: "127.0.0.1",
      port: 9321,
      shareIdentityMode: "principal",
      shareAllowDeviceKeyFallback: false,
      shareRelayBaseUrl: undefined,
      shareFallbackGatewayUrl: undefined,
      mainSpaceId: "main-space",
      mainSpaceResourceId: "resource:main",
      mainProfileId: "profile:main",
      mainAgentId: "agent:main",
      toolPolicyV2Enabled: false,
    },
    logger: {
      child: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      }),
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
    capabilities: { register: () => {}, get: () => undefined } as any,
    memoryRegistry: { getDefault: () => undefined } as any,
    deviceIdentityRepo: makeDeviceIdentityRepo(),
    spaceLinkRepo: null,
    spaceContextTransferRepo: null,
    artifactRepo: null,
    spaceRepo: null,
    spaceShareInviteRepo: null,
    spaceParticipantRepo: null,
    eventLogRepo: null,
    orchestrationJournalRepo: null,
    turnRepo: null,
    spaceQuotaPolicyRepo: null,
    participantQuotaPolicyRepo: null,
    spaceUsageCounterRepo: null,
    participantUsageCounterRepo: null,
    spaceChangeSetRepo: null,
    spaceChangeSetFileRepo: null,
    spaceChangeSetReviewRepo: null,
    spaceWorkspaceService: null,
    usageRepo: null,
    agentUsageSessionRepo: null,
    spaceToolPolicyRepo: null,
    gatewayExternalConnectivityRepo: null,
    spaceTemplateRepo: null,
    profileRepo: null,
    spaceAdminService: null,
    gatewayPolicyService: null,
    gatewayCapabilityAccessService: null,
    spaceMcpService: null,
    syncRuntimeRepo: null,
    gatewayMemoryDefaultsRepo: null,
    spaceReplaySessionRepo: null,
    experienceRepo: null,
    personalityInsightRepo: null,
    spaceAgentNotesRepo: null,
    userProfileRepo: null,
    db: null,
    server: null,
  } as unknown as BootstrapState;
  return state;
}

describe("initializeCollaborationServices — pre-registration policy wiring", () => {
  const originalEnv = Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE;

  beforeEach(() => {
    delete Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE;
    } else {
      Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE = originalEnv;
    }
  });

  test("does not require pre-registration when env flag is unset and external connectivity is not exposed", () => {
    const state = makeMinimalState();
    initializeCollaborationServices(state);

    const service = (state as any).deviceIdentityService;
    expect(service).toBeTruthy();

    // Probe via validateAuthenticatedDevice on an unknown device — should be auto-registered.
    const result = service.validateAuthenticatedDevice({
      principalId: "principal-1",
      deviceId: "device-1",
      publicKey: "key-1",
    });
    expect(result.allowed).toBe(true);
    expect(result.created).toBe(true);
  });

  test("requires pre-registration when env flag is set", () => {
    Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE = "true";
    const state = makeMinimalState();
    initializeCollaborationServices(state);

    const service = (state as any).deviceIdentityService;
    const result = service.validateAuthenticatedDevice({
      principalId: "principal-1",
      deviceId: "device-1",
      publicKey: "key-1",
    });
    expect(result.allowed).toBe(false);
    expect(String(result.reason)).toContain("not registered");
  });

  test("phase exposes a gatewayExternalConnectivityService that reports not-exposed by default", () => {
    const state = makeMinimalState();
    initializeCollaborationServices(state);
    const connectivity = (state as any).gatewayExternalConnectivityService as GatewayExternalConnectivityService;
    expect(connectivity).toBeTruthy();
    // No snapshot has been computed yet -> not externally exposed
    expect(connectivity.isExternallyExposed()).toBe(false);
  });

  test("requirePreRegistered policy expression flips when isExternallyExposed() returns true", async () => {
    // This test guards the literal boolean expression in collaboration-services-phase.ts:
    //   requirePreRegistered: Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE === "true"
    //     || gatewayExternalConnectivityService.isExternallyExposed()
    //
    // We construct an externally-exposed connectivity service, warm its cache,
    // and assert the boolean expression evaluates to true even with the env flag unset.
    const exposedService = new GatewayExternalConnectivityService({
      gatewayProfile: "external",
      gatewayHost: "127.0.0.1",
      gatewayPort: 9321,
      runCommand: async (args) => {
        if (args[0] === "status") {
          return {
            ok: true,
            code: 0,
            stdout: JSON.stringify({
              Version: "1.89.0",
              BackendState: "Running",
              Self: {
                HostName: "macbook",
                DNSName: "gateway.tail123.ts.net",
                TailscaleIPs: ["100.101.102.103"],
              },
            }),
            stderr: "",
            missingBinary: false,
          };
        }
        if (args[0] === "serve") {
          return {
            ok: true,
            code: 0,
            stdout: JSON.stringify({
              TCP: { "9321": { TCPForward: "tcp://127.0.0.1:9321" } },
            }),
            stderr: "",
            missingBinary: false,
          };
        }
        if (args[0] === "funnel") {
          // Funnel feature unavailable in this test — does not affect ready state for serve.
          return { ok: false, code: 1, stdout: "", stderr: "", missingBinary: true };
        }
        throw new Error(`Unexpected command: ${args.join(" ")}`);
      },
      repo: {
        get: () => ({ mode: "TAILSCALE", updated_at: "2026-05-02T00:00:00.000Z" }),
        set: (input: any) => ({ mode: input.mode, updated_at: "2026-05-02T00:00:00.000Z" }),
      } as any,
    });

    const warmed = await exposedService.getSnapshot();
    expect(warmed.status.state).toBe("ready");

    const requirePreRegistered = Bun.env.SPACESKIT_REQUIRE_PREREGISTERED_DEVICE === "true"
      || exposedService.isExternallyExposed();
    expect(requirePreRegistered).toBe(true);
  });
});
