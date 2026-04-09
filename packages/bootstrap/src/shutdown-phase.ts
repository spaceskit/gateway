import type { BootstrapState } from "./bootstrap-state.js";

export function createShutdown(state: BootstrapState): () => Promise<void> {
  return async () => {
    state.logger.info("Shutting down gateway...");
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.journalPruneTimer) {
      clearInterval(state.journalPruneTimer);
      state.journalPruneTimer = null;
    }
    if (state.schedulerTimer) {
      clearInterval(state.schedulerTimer);
      state.schedulerTimer = null;
    }
    if (state.conciergeEscalationTimer) {
      clearInterval(state.conciergeEscalationTimer);
      state.conciergeEscalationTimer = null;
    }
    if (state.lifecycleMaintenanceTimer) {
      clearInterval(state.lifecycleMaintenanceTimer);
      state.lifecycleMaintenanceTimer = null;
    }
    state.gatewayObservabilityService.stop();
    state.configReloader?.stop();

    for (const plugin of state.pluginSystem.listPlugins()) {
      if (plugin.status === "active") {
        try {
          await state.pluginSystem.deactivate(plugin.manifest.id);
        } catch {
          // Best effort on shutdown.
        }
      }
    }

    try {
      await state.server?.drain(state.config.drainTimeoutMs);
      await state.server?.stop();
    } catch (error) {
      state.logger.error("Error stopping server", error);
    }

    state.db?.close();
    state.logger.info("Gateway stopped");
  };
}

export function registerProcessSignals(shutdown: () => Promise<void>): void {
  process.on("SIGINT", () => {
    shutdown().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    shutdown().then(() => process.exit(0));
  });
}
