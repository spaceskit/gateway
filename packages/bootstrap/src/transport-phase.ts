import {
  A2AHandler,
  A2APushNotificationHandler,
  createDiagramHandler,
  MessageRouter,
  NotificationHandler,
  WorkflowVisualizer,
} from "@spaceskit/server";
import type { BootstrapState } from "./bootstrap-state.js";
import { GatewayObservabilityApiService } from "./services/gateway-observability-api-service.js";
import { issueHttpPrincipalToken } from "./services/http-principal-auth.js";
import { ShareRelayApiService } from "./services/share-relay-api-service.js";
import { SpacesAdminMcpFacadeService } from "./services/spaces-admin-mcp-facade-service.js";
import { createGatewayMcpHttpHandler } from "@spaceskit/mcp-runtime";
import { GatewayClient, generateAuthKeyPair } from "@spaceskit/client";
import { SpacesRestApiService } from "./services/spaces-rest-api-service.js";
import {
  mapTurnRowToSpaceTurnPayload,
  normalizeOptionalString,
  parseJsonRecord,
} from "./turn-helpers.js";

export function initializeTransportServices(state: BootstrapState): void {
  const { config, logger } = state;

  const messageRouter = new MessageRouter({
    spaceManager: state.spaceManager,
    spaceAdminService: state.spaceAdminService,
    gatewayAdminService: state.gatewayAdminService,
    gatewayResetService: state.gatewayResetService ?? undefined,
    connectorAdminService: state.connectorAdminService ?? undefined,
    gatewayIdentityService: state.gatewayIdentityService ?? undefined,
    gatewayPolicyService: state.gatewayPolicyService ?? undefined,
    gatewaySkillCatalogService: state.gatewaySkillCatalogService ?? undefined,
    gatewayKnowledgeBaseService: state.knowledgeBaseService ?? undefined,
    gatewayLibraryService: state.gatewayLibraryService ?? undefined,
    gatewayCapabilityAccessService: state.gatewayCapabilityAccessService ?? undefined,
    usageSnapshotService: state.usageSnapshotService ?? undefined,
    spaceContextService: state.spaceContextService ?? undefined,
    spaceMemoryPolicyService: state.spaceMemoryPolicyService ?? undefined,
    spaceWorkspaceService: state.spaceWorkspaceService ?? undefined,
    spaceSharingService: state.spaceSharingService ?? undefined,
    spaceChangeSetService: state.spaceChangeSetService ?? undefined,
    spaceQuotaService: state.spaceQuotaService ?? undefined,
    spaceTurnTraceService: state.spaceTurnTraceService ?? undefined,
    memoryLifecycleService: state.memoryLifecycleService ?? undefined,
    spaceArtifactService: state.spaceArtifactService ?? undefined,
    spaceToolPolicyService: state.spaceToolPolicyService ?? undefined,
    spaceMcpService: state.spaceMcpService,
    turnHistoryService: state.turnRepo
      ? {
        listSpaceTurns: async ({ spaceId, limit, offset, lastSeenTurnId }) => {
          const normalizedLastSeenTurnId = normalizeOptionalString(lastSeenTurnId);
          if (normalizedLastSeenTurnId) {
            const rows = state.turnRepo.listBySpaceAfterTurn(spaceId, normalizedLastSeenTurnId, limit);
            return {
              turns: rows.map(mapTurnRowToSpaceTurnPayload),
              total: state.turnRepo.countBySpaceAfterTurn(spaceId, normalizedLastSeenTurnId),
            };
          }
          const rows = state.turnRepo.listBySpace(spaceId, limit, offset);
          return {
            turns: rows.map(mapTurnRowToSpaceTurnPayload),
            total: state.turnRepo.countBySpace(spaceId),
          };
        },
      }
      : undefined,
    orchestrationJournalService: state.orchestrationJournalRepo
      ? {
        listEntries: async ({ spaceId, turnId, limit, offset }) => {
          const rows = state.orchestrationJournalRepo.list({ spaceId, turnId, limit, offset });
          return {
            entries: rows.map((row: any) => ({
              eventId: row.event_id,
              spaceId: row.space_id,
              turnId: row.turn_id,
              seq: row.seq,
              eventType: row.event_type,
              actorId: row.actor_id,
              lineageId: row.lineage_id,
              hopCount: row.hop_count,
              payload: parseJsonRecord(row.payload_json),
              createdAt: row.created_at,
            })),
            total: state.orchestrationJournalRepo.count(spaceId, turnId),
          };
        },
      }
      : undefined,
    deviceIdentityService: state.deviceIdentityService ?? undefined,
    spaceTemplateService: state.spaceTemplateService,
    orchestratorCommandService: state.orchestratorCommandService ?? undefined,
    schedulerService: state.schedulerService ?? undefined,
    gatewaySyncService: state.gatewaySyncService ?? undefined,
    speechSessionService: state.speechSessionService ?? undefined,
    conciergeCallRuntimeService: state.conciergeCallRuntimeService ?? undefined,
    conciergeEscalationService: state.conciergeEscalationService ?? undefined,
    toolAccessPolicyService: state.toolAccessPolicyService ?? undefined,
    gatewayWorkspaceDefaultsService: state.gatewayWorkspaceDefaultsRepo ?? undefined,
    gatewayExternalConnectivityService: state.gatewayExternalConnectivityService,
    onFeedbackResolved: state.runtimeLedgerService
      ? ({ turnId, status, resolution }) => {
        state.runtimeLedgerService?.recordApprovalResolution(turnId, status, resolution);
      }
      : undefined,
    issueHttpPrincipalToken: config.httpPrincipalAuthHs256Secret
      ? ({ principalId, deviceId, ttlSeconds }) => issueHttpPrincipalToken({
        principalId,
        deviceId,
        hs256Secret: config.httpPrincipalAuthHs256Secret!,
        ttlSeconds,
      })
      : undefined,
    sessionContinuityManager: state.sessionContinuityManager,
    capabilities: state.capabilities,
    logger: logger.child({ module: "router" }),
    agentSessionReplacementEnabled: config.agentSessionReplacementEnabled,
    sendToClient: (clientId, msg) => {
      state.server?.send(clientId, msg);
    },
    broadcastToSpace: (spaceUid, msg) => {
      state.server?.broadcastToSpace(spaceUid, msg);
    },
  });

  const a2aHandler = new A2AHandler({
    spaceManager: state.spaceManager,
    eventBus: state.eventBus,
    logger: logger.child({ module: "a2a" }),
    baseUrl: `http://${config.host}:${config.port}`,
    loadProfile: async (profileId: string) => {
      if (!state.profileRepo) return null;
      const row = state.profileRepo.getById(profileId);
      if (!row) return null;
      const revision = state.profileRepo.getActiveRevision(profileId);
      return {
        name: row.name,
        description: row.description ?? undefined,
        personalityPrompt: revision?.personality_prompt ?? undefined,
        defaultSkillIds: revision?.default_skill_set_ids_json
          ? JSON.parse(revision.default_skill_set_ids_json)
          : [],
        activeRevision: row.active_revision,
      };
    },
    listProfiles: async () => {
      if (!state.profileRepo) return [];
      return state.profileRepo.listActive().map((row: any) => ({
        profileId: row.profile_id,
        name: row.name,
        description: row.description ?? undefined,
      }));
    },
    authRequired: config.a2aRequireAuth,
    maxTasks: config.a2aTaskMax,
    taskTtlMs: config.a2aTaskTtlMs,
  });

  const a2aPush = new A2APushNotificationHandler();
  let workflowVisualizer: WorkflowVisualizer | null = null;
  let diagramHandler: ((req: Request) => Response | null) | null = null;
  if (state.db) {
    workflowVisualizer = new WorkflowVisualizer(state.db.db);
    diagramHandler = createDiagramHandler(workflowVisualizer);
  }

  const notificationHandler = new NotificationHandler({
    notificationService: state.notificationService,
  });
  const spaceIdByUidCache = new Map<string, string>();
  const resolveSpaceIdFromUid = async (spaceUidRaw: string): Promise<string | undefined> => {
    const normalizedUid = spaceUidRaw.trim().toLowerCase();
    if (!normalizedUid) return undefined;
    const cached = spaceIdByUidCache.get(normalizedUid);
    if (cached) return cached;

    const byId = await state.spaceAdminService.getSpace(spaceUidRaw.trim());
    if (byId) {
      spaceIdByUidCache.set((byId.spaceUid ?? spaceUidRaw).trim().toLowerCase(), byId.id);
      return byId.id;
    }

    const spaces = await state.spaceAdminService.listSpaces({ limit: 500 });
    const matched = spaces.find((space: any) => space.spaceUid.trim().toLowerCase() === normalizedUid);
    if (!matched) return undefined;
    spaceIdByUidCache.set(normalizedUid, matched.id);
    return matched.id;
  };

  const spacesRestApiService = new SpacesRestApiService({
    spaceChangeSetService: state.spaceChangeSetService ?? undefined,
    spaceQuotaService: state.spaceQuotaService ?? undefined,
    spaceTurnTraceService: state.spaceTurnTraceService ?? undefined,
    spaceArtifactService: state.spaceArtifactService ?? undefined,
    toolAccessPolicyService: state.toolAccessPolicyService ?? undefined,
    spaceSharingService: state.spaceSharingService ?? undefined,
    principalAuth: {
      strictVerification: config.httpPrincipalAuthStrict,
      hs256Secret: config.httpPrincipalAuthHs256Secret,
      maxClockSkewSeconds: config.httpPrincipalAuthMaxClockSkewSeconds,
    },
    requireAuthenticatedPrincipal: config.gatewayProfile === "external",
  });
  const shareRelayApiService = new ShareRelayApiService({
    spaceSharingService: state.spaceSharingService ?? undefined,
    eventBus: state.eventBus,
    principalAuth: {
      strictVerification: config.httpPrincipalAuthStrict,
      hs256Secret: config.httpPrincipalAuthHs256Secret,
      maxClockSkewSeconds: config.httpPrincipalAuthMaxClockSkewSeconds,
    },
    requireAuthenticatedPrincipal: config.gatewayProfile === "external",
  });
  const gatewayObservabilityApiService = new GatewayObservabilityApiService({
    observabilityService: state.gatewayObservabilityService,
    principalAuth: {
      strictVerification: config.httpPrincipalAuthStrict,
      hs256Secret: config.httpPrincipalAuthHs256Secret,
      maxClockSkewSeconds: config.httpPrincipalAuthMaxClockSkewSeconds,
    },
    requireAuthenticatedPrincipal: config.gatewayProfile === "external",
  });

  const spacesAdminMcpFacadeService = (
    config.mainAdminMcpEnabled
    && state.orchestratorCommandService
  )
    ? new SpacesAdminMcpFacadeService({
      orchestratorCommandService: state.orchestratorCommandService,
      defaultTargetSpaceId: config.mainSpaceId,
      principalAuth: {
        strictVerification: config.httpPrincipalAuthStrict,
        hs256Secret: config.httpPrincipalAuthHs256Secret,
        maxClockSkewSeconds: config.httpPrincipalAuthMaxClockSkewSeconds,
      },
      requireAuthenticatedPrincipal: config.gatewayProfile === "external",
    })
    : null;

  if (spacesAdminMcpFacadeService) {
    logger.info("spaces-admin MCP facade enabled", {
      endpoint: "/mcp/spaces-admin",
      mainSpaceId: config.mainSpaceId,
    });
  }

  // Full MCP server (streamable HTTP at /mcp) using loopback WebSocket client.
  // Fully lazy — keypair generation, handler creation, and connection all deferred to first request.
  let gatewayMcpHandler: ((req: Request, url: URL) => Promise<Response | null>) | null = null;
  if (config.mainAdminMcpEnabled) {
    let innerHandler: ((req: Request, url: URL) => Promise<Response | null>) | null = null;
    let initializing: Promise<void> | null = null;

    gatewayMcpHandler = async (req: Request, url: URL) => {
      if (url.pathname !== "/mcp") return null;

      if (!innerHandler) {
        if (!initializing) {
          initializing = (async () => {
            const loopbackUrl = `ws://127.0.0.1:${config.port}`;
            const loopbackKeyPair = await generateAuthKeyPair();
            const loopbackClient = new GatewayClient({ url: loopbackUrl });
            loopbackClient.setAuthKeyPair(loopbackKeyPair);
            await loopbackClient.connect();
            logger.info("MCP loopback client connected", { url: loopbackUrl });
            innerHandler = await createGatewayMcpHttpHandler(loopbackClient);
          })();
        }
        try {
          await initializing;
        } catch (err) {
          initializing = null; // allow retry
          logger.warn("MCP loopback client initialization failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return new Response(
            JSON.stringify({ error: "Gateway MCP transport not ready" }),
            { status: 503, headers: { "content-type": "application/json" } },
          );
        }
      }

      return innerHandler!(req, url);
    };
    logger.info("Gateway MCP server enabled (lazy init)", { endpoint: "/mcp" });
  }

  if (state.spaceTurnTraceService) {
    state.eventBus.on("space.turn_started", (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId || !turnId) return;
      if (state.spaceMemoryPolicyService && !state.spaceMemoryPolicyService.shouldPersistTurnTrace(spaceId)) {
        return;
      }
      state.spaceTurnTraceService?.recordTurnEvent({
        spaceId,
        turnId,
        eventType: "turn_started",
        payload: {
          type: "turn_started",
          agents: Array.isArray(event?.agents) ? event.agents : undefined,
        },
        createdAt: event?.timestamp instanceof Date ? event.timestamp.toISOString() : undefined,
      });
    });

    state.eventBus.on("space.turn_event", (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId || !turnId) return;
      if (state.spaceMemoryPolicyService && !state.spaceMemoryPolicyService.shouldPersistTurnTrace(spaceId)) {
        return;
      }
      const eventPayload = event?.event ?? {};
      const eventType = typeof eventPayload?.type === "string" ? eventPayload.type : "space.turn_event";
      const thinkingCapturePolicy = state.spaceMemoryPolicyService?.getEffectiveThinkingCapturePolicy(spaceId);
      state.spaceTurnTraceService?.recordTurnEvent({
        spaceId,
        turnId,
        agentId: typeof event?.agentId === "string" ? event.agentId : undefined,
        eventType,
        payload: eventPayload,
        createdAt: event?.timestamp instanceof Date ? event.timestamp.toISOString() : undefined,
        thinkingCapturePolicy,
      });
    });

    state.eventBus.on("space.self_check", (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId || !turnId) return;
      if (state.spaceMemoryPolicyService && !state.spaceMemoryPolicyService.shouldPersistTurnTrace(spaceId)) {
        return;
      }
      state.spaceTurnTraceService?.recordTurnEvent({
        spaceId,
        turnId,
        eventType: "space.self_check",
        payload: {
          type: "space.self_check",
          trigger: typeof event?.trigger === "string" ? event.trigger : "cadence",
          sessionId: typeof event?.sessionId === "string" ? event.sessionId : undefined,
          turnCount: typeof event?.turnCount === "number" ? event.turnCount : undefined,
        },
        createdAt: event?.timestamp instanceof Date ? event.timestamp.toISOString() : undefined,
      });
    });
  }

  if (state.runtimeLedgerService) {
    state.eventBus.on("space.turn_started", (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId || !turnId) return;
      state.runtimeLedgerService?.recordTurnStarted({
        spaceId,
        turnId,
        inputText: typeof event?.input === "string" ? event.input : "",
      });
    });

    state.eventBus.on("space.turn_event", (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId || !turnId || !event?.event || typeof event.event.type !== "string") return;
      state.runtimeLedgerService?.recordTurnEvent({
        spaceId,
        turnId,
        agentId: typeof event?.agentId === "string" ? event.agentId : undefined,
        event: event.event,
      });
    });
  }

  Object.assign(state, {
    a2aHandler,
    a2aPush,
    diagramHandler,
    gatewayMcpHandler,
    gatewayObservabilityApiService,
    messageRouter,
    notificationHandler,
    resolveSpaceIdFromUid,
    shareRelayApiService,
    spaceIdByUidCache,
    spacesAdminMcpFacadeService,
    spacesRestApiService,
    workflowVisualizer,
  });
}
