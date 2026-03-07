# ---- Build stage ----
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
COPY packages/ packages/
RUN bun install --frozen-lockfile
RUN bun run build || true

# ---- Runtime stage ----
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Non-root user for reduced attack surface
RUN adduser --system --no-create-home --uid 1001 spaceskit

# Copy built artifacts from builder
COPY --from=builder /app/ /app/

# Set ownership to non-root user
RUN chown -R spaceskit:nogroup /app

USER spaceskit

# Default environment for production deployments
ENV NODE_ENV=production
ENV SPACESKIT_GATEWAY_PROFILE=external
ENV SPACESKIT_PORT=9320
ENV SPACESKIT_HOST=0.0.0.0

EXPOSE 9320

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:9320/health || exit 1

# TODO: Add K8s manifests with securityContext (runAsNonRoot, readOnlyRootFilesystem),
#       liveness/readiness probes, and PodDisruptionBudget for production deployments.

ENTRYPOINT ["bun", "run", "packages/bootstrap/src/index.ts"]
