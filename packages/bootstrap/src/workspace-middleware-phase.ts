import {
  MiddlewarePipeline,
  createAuditMiddleware,
  createBudgetMiddleware,
  createContextWindowMiddleware,
  createResilienceMiddleware,
  createSecretsMiddleware,
  createSecurityMiddleware,
  createTracingMiddleware,
  createValidationMiddleware,
  type Middleware,
} from "@spaceskit/core";
import type { BootstrapState } from "./bootstrap-state.js";
import {
  isPathWithinScope,
  normalizeCandidatePath,
  SpaceWorkspaceService,
} from "./services/space-workspace-service.js";
import {
  collectFilesystemPathCandidatesByKeys,
  isRecord,
  normalizeOptionalString,
  resolveCapabilityOperationMetadata,
} from "./turn-helpers.js";

export function initializeWorkspaceAndMiddleware(state: BootstrapState): void {
  const {
    config,
    logger,
    eventBus,
    capabilities,
    db,
    spaceRepo,
    spaceResourceRepo,
    spaceWorkspaceRepo,
    usageRepo,
  } = state;

  const spaceWorkspaceService = (
    spaceRepo
    && spaceResourceRepo
    && spaceWorkspaceRepo
  )
    ? new SpaceWorkspaceService({
      spaces: spaceRepo,
      resources: spaceResourceRepo,
      workspaces: spaceWorkspaceRepo,
      spacesRoot: config.spacesRoot,
      logger: logger.child({ module: "space-workspace" }),
      debugEventPayloads: config.workspaceLogDebug,
    })
    : null;

  if (spaceWorkspaceService) {
    logger.info("Space workspace service initialized", {
      spacesRoot: spaceWorkspaceService.getSpacesRoot(),
      layoutVersion: 1,
      debugEventPayloads: config.workspaceLogDebug,
    });

    eventBus.onAny((event) => {
      const spaceId = normalizeOptionalString((event as Record<string, unknown>).spaceId);
      if (!spaceId) return;
      void spaceWorkspaceService.appendSpaceEventLog(spaceId, event as Record<string, unknown>);
    });
  }

  const middleware = new MiddlewarePipeline();

  middleware.use(createValidationMiddleware({}));

  middleware.use(createContextWindowMiddleware({
    eventBus,
    getContextWindowSize: (modelId?: string): number => {
      const normalizedModelId = modelId?.trim().toLowerCase();
      if (normalizedModelId?.startsWith("lmstudio/")) {
        return 8_192;
      }
      return 128_000;
    },
  }));

  middleware.use(createSecurityMiddleware({ eventBus }));

  if (spaceWorkspaceService) {
    middleware.use({
      name: "workspace-guard",
      layer: "capability",
      order: 35,
      process: async (ctx, next) => {
        const invocation = isRecord(ctx.input) ? ctx.input : null;
        const capability = normalizeOptionalString(invocation?.capability);
        if (capability !== "files" && capability !== "filesystem") {
          await next();
          return;
        }

        const spaceId = normalizeOptionalString(ctx.spaceId);
        const agentId = normalizeOptionalString(ctx.agentId);
        if (!spaceId || !agentId) {
          await next();
          return;
        }

        const args = isRecord(invocation?.args) ? invocation.args : {};
        const operation = normalizeOptionalString(invocation?.operation) ?? "";
        const normalizedCapability = capability === "filesystem" ? "files" : capability;
        const operationMetadata = resolveCapabilityOperationMetadata(
          capabilities as unknown as Record<string, unknown>,
          {
            capability: normalizedCapability,
            operation,
            args,
            targetProvider: normalizeOptionalString(args.targetProvider),
          },
          spaceId,
        );

        if (!operationMetadata.filesystemWrite) {
          await next();
          return;
        }

        const pathArgs = operationMetadata.pathArgs ?? [];
        if (pathArgs.length === 0) {
          ctx.terminate = true;
          ctx.output = {
            code: "FAILED_PRECONDITION",
            message: `filesystem write metadata must declare pathArgs: ${capability}.${operation}`,
            retryable: false,
            errorType: "WorkspaceGuard",
            tool: `${capability}.${operation}`,
          };
          return;
        }

        const workspace = await spaceWorkspaceService.ensureWorkspace(spaceId);
        const ownScratchpadPath = await spaceWorkspaceService.getAgentScratchpadPath(spaceId, agentId);
        const candidatePaths = collectFilesystemPathCandidatesByKeys(args, pathArgs)
          .map((rawPath) => normalizeCandidatePath(rawPath, args.cwd))
          .filter((path): path is string => Boolean(path));

        if (candidatePaths.length === 0) {
          ctx.terminate = true;
          ctx.output = {
            code: "FAILED_PRECONDITION",
            message: `filesystem write operation requires at least one declared path argument: ${capability}.${operation}`,
            retryable: false,
            errorType: "WorkspaceGuard",
            tool: `${capability}.${operation}`,
          };
          return;
        }

        for (const candidatePath of candidatePaths) {
          if (
            isPathWithinScope(candidatePath, workspace.sharedContextPath)
            && !candidatePath.toLowerCase().endsWith(".md")
          ) {
            ctx.terminate = true;
            ctx.output = {
              code: "FAILED_PRECONDITION",
              message: `shared-context writes must target .md files: ${candidatePath}`,
              retryable: false,
              errorType: "WorkspaceGuard",
              tool: `${capability}.${operation}`,
            };
            return;
          }

          if (
            isPathWithinScope(candidatePath, workspace.scratchpadsPath)
            && normalizeCandidatePath(candidatePath) !== normalizeCandidatePath(ownScratchpadPath)
          ) {
            ctx.terminate = true;
            ctx.output = {
              code: "FAILED_PRECONDITION",
              message: `scratchpad writes are restricted to ${ownScratchpadPath}`,
              retryable: false,
              errorType: "WorkspaceGuard",
              tool: `${capability}.${operation}`,
            };
            return;
          }
        }

        await next();
      },
    });
  }

  middleware.use(createSecretsMiddleware({ eventBus }));
  middleware.use(createAuditMiddleware({ eventBus }));

  if (config.enableTracing) {
    const tracingMiddleware = createTracingMiddleware({
      enabled: true,
      onSpanEnd: (span) => {
        logger.debug("Trace span", {
          operation: span.operationType,
          service: span.serviceName,
          duration: span.durationMs,
          error: span.error,
        });
      },
    });
    for (const entry of tracingMiddleware) {
      middleware.use(entry);
    }
  }

  if (config.enableResilience) {
    middleware.use(createResilienceMiddleware({
      requestsPerMinute: config.requestsPerMinute ?? 60,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 30_000,
    }));
  }

  if (db && usageRepo) {
    const estimateCost = (inputTokens: number, outputTokens: number): number =>
      (inputTokens / 1000) * 0.003 + (outputTokens / 1000) * 0.015;

    middleware.use(createBudgetMiddleware({
      eventBus,
      loadPolicy: async () => {
        const row = db.db.prepare(
          "SELECT soft_cap_usd, hard_cap_usd, warning_threshold FROM usage_budget_policy WHERE singleton_id = 1",
        ).get() as { soft_cap_usd: number; hard_cap_usd: number; warning_threshold: number } | null;

        if (row) {
          return {
            softCapUsd: row.soft_cap_usd,
            hardCapUsd: row.hard_cap_usd,
            warningThreshold: row.warning_threshold,
          };
        }

        return { softCapUsd: 20.0, hardCapUsd: 50.0, warningThreshold: 0.8 };
      },
      loadState: async () => {
        const aggregate = usageRepo.aggregateTokens();
        return {
          totalSpentUsd: estimateCost(aggregate.inputTokens, aggregate.outputTokens),
        };
      },
      updateState: async (_additionalCostUsd: number) => {},
    }));
    logger.info("Budget middleware wired with persistence");
  }

  logger.info("Middleware pipeline configured", {
    middleware: middleware.list().map((entry: Middleware) => `${entry.name}(${entry.layer}:${entry.order})`),
  });

  state.spaceWorkspaceService = spaceWorkspaceService;
  state.middleware = middleware;
}
