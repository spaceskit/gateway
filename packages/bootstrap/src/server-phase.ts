import { GatewayServer } from "@spaceskit/server";
import type { BootstrapState } from "./bootstrap-state.js";
import { parseOptionalNumberEnv } from "./config.js";
import { createHealthCheck } from "./healthcheck-phase.js";

export async function startGatewayServer(state: BootstrapState): Promise<void> {
  const { config, logger } = state;

  try {
    const server = new GatewayServer({
      port: config.port,
      host: config.host,
      allowPortFallback: config.port === 9320,
      portFallbackRange: 100,
      maxPayloadLength: config.maxMessageSize,
      eventBus: state.eventBus,
      a2aHandler: state.a2aHandler,
      notificationHandler: state.notificationHandler,
      syncHttpHandler: state.gatewaySyncService
        ? {
          announce: (payload) => state.gatewaySyncService!.announcePeer(payload),
          query: (payload, authSecret) => state.gatewaySyncService!.queryResources(payload, authSecret),
          pull: (payload, authSecret) => state.gatewaySyncService!.pullResources(payload, authSecret),
        }
        : undefined,
      httpHandler: async (req, url) => {
        const observabilityResponse = await state.gatewayObservabilityApiService.handleRequest(req, url);
        if (observabilityResponse) return observabilityResponse;
        if (state.gatewayMcpHandler) {
          const mcpResponse = await state.gatewayMcpHandler(req, url);
          if (mcpResponse) return mcpResponse;
        }
        if (state.spacesAdminMcpFacadeService) {
          const mcpResponse = await state.spacesAdminMcpFacadeService.handleRequest(req, url);
          if (mcpResponse) return mcpResponse;
        }
        const relayResponse = await state.shareRelayApiService.handleRequest(req, url);
        if (relayResponse) return relayResponse;
        return state.spacesRestApiService.handleRequest(req, url);
      },
      validateDeviceIdentity: state.deviceIdentityService
        ? (input) => {
          const decision = state.deviceIdentityService!.validateAuthenticatedDevice({
            principalId: input.principalId,
            deviceId: input.deviceId,
            publicKey: input.devicePublicKey,
            platform: input.platform,
          });
          return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
        }
        : undefined,
      authorizeSubscribe: state.spaceSharingService
        ? ({ client, spaceUid, spaceId }) => {
          const resolvedSpaceId = spaceId?.trim();
          if (!resolvedSpaceId) {
            return { allowed: false, reason: `Unknown space UID: ${spaceUid}` };
          }
          const decision = state.spaceSharingService!.evaluateAccess({
            spaceId: resolvedSpaceId,
            principalId: client.publicKey?.trim(),
            action: "read",
          });
          return { allowed: decision.allowed, reason: decision.reason };
        }
        : undefined,
      logger: logger.child({ module: "ws" }),
      onMessage: async (client, msg) => state.messageRouter.handle(client, msg),
      onClientClose: (client) => {
        state.messageRouter.onClientDisconnected(client);
      },
      resolveSpaceUid: async (spaceId: string) => {
        const space = await state.spaceAdminService.getSpace(spaceId);
        if (space?.spaceUid) {
          state.spaceIdByUidCache.set(space.spaceUid.trim().toLowerCase(), space.id);
        }
        return space?.spaceUid;
      },
      resolveSpaceId: state.resolveSpaceIdFromUid,
      skipAuth: config.skipAuth,
      allowedOrigins: config.allowedOrigins,
      syncRequireSecret: config.syncRequireSecret,
      httpRateLimitRpm: config.httpRateLimitRpm,
      maxConnectionsPerIp: config.maxConnectionsPerIp,
      healthCheck: createHealthCheck(state),
    });

    server.start();
    state.server = server;

    if (server.port !== config.port) {
      logger.warn("Configured port unavailable; using fallback port", {
        host: config.host,
        configuredPort: config.port,
        resolvedPort: server.port,
      });
      config.port = server.port;
    }

    const effectiveBaseUrl = `http://${config.host}:${config.port}`;
    const a2aMutable = state.a2aHandler as unknown as {
      setBaseUrl?: (baseUrl: string) => void;
      options?: { baseUrl?: string };
    };
    if (typeof a2aMutable.setBaseUrl === "function") {
      a2aMutable.setBaseUrl(effectiveBaseUrl);
    } else if (a2aMutable.options) {
      a2aMutable.options.baseUrl = effectiveBaseUrl;
    }

    logger.info("WebSocket server listening", {
      port: config.port,
      host: config.host,
      a2a: `${effectiveBaseUrl}/.well-known/agent.json`,
      subsystems: [
        "middleware",
        "memory",
        "notifications",
        state.db ? "checkpoint" : null,
        state.db ? "dead-letter" : null,
        state.db ? "experience-generator" : null,
        state.db ? "workflow-visualizer" : null,
        config.mem0ApiKey ? "mem0" : null,
        config.lettaBaseUrl ? "letta" : null,
        config.enableTracing ? "tracing" : null,
        config.enableResilience ? "resilience" : null,
        "plugin-system",
        "agent-versioning",
        state.configReloader ? "config-hot-reload" : null,
      ].filter(Boolean),
    });

    if (config.heartbeatIntervalMs > 0) {
      state.heartbeatTimer = setInterval(() => {
        logger.info("Gateway heartbeat", {
          port: config.port,
          host: config.host,
          clients: state.server?.clientCount ?? 0,
          uptimeSec: Math.floor(process.uptime()),
          rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)),
        });
      }, config.heartbeatIntervalMs);
      state.heartbeatTimer.unref?.();
      logger.info("Gateway heartbeat logging enabled", { intervalMs: config.heartbeatIntervalMs });
    }

    if (state.orchestrationJournalRepo) {
      state.journalPruneTimer = setInterval(() => {
        try {
          const cutoffIso = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString();
          const deleted = state.orchestrationJournalRepo!.pruneBefore(cutoffIso);
          if (deleted > 0) {
            logger.info("Pruned orchestration journal entries", { deleted });
          }
        } catch (error) {
          logger.warn("Failed to prune orchestration journal entries", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, 24 * 60 * 60 * 1000);
      state.journalPruneTimer.unref?.();
    }

    if (state.schedulerService) {
      const configuredInterval = parseOptionalNumberEnv(Bun.env.SPACESKIT_SCHEDULER_TICK_MS);
      const schedulerTickIntervalMs = configuredInterval !== undefined && configuredInterval > 0
        ? Math.max(1000, Math.floor(configuredInterval))
        : 15_000;

      state.schedulerTimer = setInterval(() => {
        void state.schedulerService!.runDueJobsTick(100)
          .then((executed: number) => {
            if (executed > 0) {
              logger.info("Scheduler tick executed jobs", { executed });
            }
          })
          .catch((error: unknown) => {
            logger.warn("Scheduler tick failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }, schedulerTickIntervalMs);
      state.schedulerTimer.unref?.();
      logger.info("Scheduler loop started", { tickIntervalMs: schedulerTickIntervalMs });
    }

    if (state.conciergeEscalationService) {
      const escalationTickIntervalMs = 1_000;
      const runEscalationMaintenance = async () => {
        try {
          await state.conciergeEscalationService!.runMaintenance(100);
        } catch (error) {
          logger.warn("Concierge escalation maintenance failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
      await runEscalationMaintenance();
      state.conciergeEscalationTimer = setInterval(() => {
        void runEscalationMaintenance();
      }, escalationTickIntervalMs);
      state.conciergeEscalationTimer.unref?.();
      logger.info("Concierge escalation maintenance loop started", {
        tickIntervalMs: escalationTickIntervalMs,
      });
    }

    if (state.spaceShareInviteRepo || state.spaceChangeSetService || state.spaceQuotaService) {
      const configuredInterval = parseOptionalNumberEnv(Bun.env.SPACESKIT_COLLAB_MAINTENANCE_TICK_MS);
      const maintenanceIntervalMs = configuredInterval !== undefined && configuredInterval > 0
        ? Math.max(60_000, Math.floor(configuredInterval))
        : 60 * 60 * 1000;
      const runMaintenance = async () => {
        try {
          const nowIso = new Date().toISOString();
          const expiredInvites = state.spaceShareInviteRepo?.expireBefore(nowIso) ?? 0;
          const changesetMaintenance = state.spaceChangeSetService
            ? await state.spaceChangeSetService.runMaintenance()
            : { expiredDrafts: 0, expiredByTtl: 0, purgedStaging: 0 };
          state.spaceQuotaService?.reconcileMonthlyCounters();

          if (
            expiredInvites > 0
            || changesetMaintenance.expiredDrafts > 0
            || changesetMaintenance.expiredByTtl > 0
            || changesetMaintenance.purgedStaging > 0
          ) {
            logger.info("Collaboration lifecycle maintenance complete", {
              expiredInvites,
              expiredDrafts: changesetMaintenance.expiredDrafts,
              expiredByTtl: changesetMaintenance.expiredByTtl,
              purgedStaging: changesetMaintenance.purgedStaging,
            });
          }
        } catch (error) {
          logger.warn("Collaboration lifecycle maintenance failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      await runMaintenance();
      state.lifecycleMaintenanceTimer = setInterval(() => {
        void runMaintenance();
      }, maintenanceIntervalMs);
      state.lifecycleMaintenanceTimer.unref?.();
      logger.info("Collaboration lifecycle maintenance loop started", {
        tickIntervalMs: maintenanceIntervalMs,
      });
    }
  } catch (error) {
    logger.error("WebSocket server failed to start", error);
  }
}
