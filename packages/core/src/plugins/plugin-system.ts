import type { EventBus } from "../events/event-bus.js";
import type { CapabilityRegistry } from "../capabilities/registry.js";

/**
 * Plugin manifest defining plugin metadata and capabilities
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  capabilities: string[];
  permissions: string[];
  entrypoint: string;
}

/**
 * Trust level for plugin security policies
 */
export type TrustLevel = "untrusted" | "community" | "verified" | "system";

/**
 * Install source enumeration
 */
export enum InstallSource {
  UNSPECIFIED = "INSTALL_SOURCE_UNSPECIFIED",
  MARKETPLACE = "INSTALL_SOURCE_MARKETPLACE",
  LOCAL = "INSTALL_SOURCE_LOCAL",
  REMOTE = "INSTALL_SOURCE_REMOTE",
  SYSTEM = "INSTALL_SOURCE_SYSTEM",
}

/**
 * Plugin execution status
 */
export type PluginStatus = "loaded" | "active" | "stopped" | "error";

/**
 * Plugin instance representing a loaded plugin in the system
 */
export interface PluginInstance {
  manifest: PluginManifest;
  status: PluginStatus;
  loadedAt: Date;
  exports: Record<string, unknown>;
  error?: Error;
  trustLevel: TrustLevel;
  signed: boolean;
  signatureIdentity?: string;
}

/**
 * Plugin sandbox for secure execution with resource limits and error boundaries
 */
export interface PluginSandbox {
  /**
   * Execute a function within the sandbox with timeout and error boundaries
   * @param fn Function to execute (sync or async)
   * @returns Promise resolving to function result
   * @throws Error if execution times out or throws
   */
  execute<T>(fn: () => T | Promise<T>): Promise<T>;
}

/**
 * Options for PluginSystem initialization
 */
export interface PluginSystemOptions {
  eventBus: EventBus;
  capabilityRegistry: CapabilityRegistry;
  maxPluginTimeoutMs?: number;
}

/**
 * Plugin registry entry from persistence layer
 */
export interface PluginRegistryEntry {
  plugin_id: string;
  name: string;
  version: string;
  source: string;
  install_source: string;
  trust_level: string;
  signed: number;
  signature_identity: string;
  scripts_executed: number;
  installed_at: string;
  updated_at: string;
}

/**
 * Default plugin sandbox implementation
 */
class DefaultPluginSandbox implements PluginSandbox {
  private timeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  async execute<T>(fn: () => T | Promise<T>): Promise<T> {
    return Promise.race([
      Promise.resolve().then(fn),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error("Plugin execution timeout")),
          this.timeoutMs
        )
      ),
    ]);
  }
}

/**
 * Runtime plugin loading system for Spaceskit
 * Manages plugin lifecycle: installation, loading, activation, and deactivation
 */
export class PluginSystem {
  private plugins: Map<string, PluginInstance> = new Map();
  private sandboxes: Map<string, PluginSandbox> = new Map();
  private eventBus: EventBus;
  private capabilityRegistry: CapabilityRegistry;
  private maxPluginTimeoutMs: number;
  private moduleCache: Map<string, Record<string, unknown>> = new Map();

  constructor(options: PluginSystemOptions) {
    this.eventBus = options.eventBus;
    this.capabilityRegistry = options.capabilityRegistry;
    this.maxPluginTimeoutMs = options.maxPluginTimeoutMs ?? 30000;
  }

  /**
   * Install a plugin manifest in the system
   * @param manifest Plugin manifest
   * @param source Source location of the plugin
   * @param trustLevel Trust level for the plugin (default: "untrusted")
   * @param signed Whether the plugin is cryptographically signed
   * @param signatureIdentity Identity of the signer
   */
  async install(
    manifest: PluginManifest,
    source: string,
    trustLevel: TrustLevel = "untrusted",
    signed: boolean = false,
    signatureIdentity?: string
  ): Promise<void> {
    const now = new Date();

    const instance: PluginInstance = {
      manifest,
      status: "loaded",
      loadedAt: now,
      exports: {},
      trustLevel,
      signed,
      signatureIdentity,
    };

    this.plugins.set(manifest.id, instance);
    const sandbox = new DefaultPluginSandbox(this.maxPluginTimeoutMs);
    this.sandboxes.set(manifest.id, sandbox);

    this.eventBus.emit({
      type: "plugin.installed",
      pluginId: manifest.id,
      manifest,
      timestamp: now,
    });
  }

  /**
   * Load a plugin's entrypoint module
   * @param pluginId ID of the plugin to load
   */
  async load(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (instance.status !== "loaded") {
      throw new Error(
        `Plugin must be in 'loaded' status to load, current: ${instance.status}`
      );
    }

    try {
      const sandbox = this.sandboxes.get(pluginId);
      if (!sandbox) {
        throw new Error(`Sandbox not found for plugin: ${pluginId}`);
      }

      // Attempt to load the module from cache or import it
      let moduleExports = this.moduleCache.get(pluginId);
      if (!moduleExports) {
        // Dynamic import within sandbox for isolation
        const loaded = await sandbox.execute<Record<string, unknown>>(async () => {
          try {
            const module = await import(instance.manifest.entrypoint);
            return module as Record<string, unknown>;
          } catch (error) {
            throw new Error(
              `Failed to load plugin module: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        });
        moduleExports = loaded ?? {};
        this.moduleCache.set(pluginId, moduleExports);
      }

      instance.exports = moduleExports;
    } catch (error) {
      instance.status = "error";
      instance.error = error instanceof Error ? error : new Error(String(error));
      this.eventBus.emit({
        type: "plugin.error",
        pluginId,
        error: instance.error,
        timestamp: new Date(),
      });
      throw instance.error;
    }
  }

  /**
   * Activate a plugin (transition to active state)
   * Calls the plugin's activate() export if present
   * @param pluginId ID of the plugin to activate
   */
  async activate(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (!["loaded", "stopped"].includes(instance.status)) {
      throw new Error(
        `Plugin must be in 'loaded' or 'stopped' status to activate, current: ${instance.status}`
      );
    }

    try {
      const sandbox = this.sandboxes.get(pluginId);
      if (!sandbox) {
        throw new Error(`Sandbox not found for plugin: ${pluginId}`);
      }

      // Call activate export if available
      const activateFn = instance.exports.activate as
        | (() => void | Promise<void>)
        | undefined;
      if (activateFn && typeof activateFn === "function") {
        await sandbox.execute(() => activateFn());
      }

      instance.status = "active";
      this.eventBus.emit({
        type: "plugin.activated",
        pluginId,
        manifest: instance.manifest,
        timestamp: new Date(),
      });
    } catch (error) {
      instance.status = "error";
      instance.error = error instanceof Error ? error : new Error(String(error));
      this.eventBus.emit({
        type: "plugin.error",
        pluginId,
        error: instance.error,
        timestamp: new Date(),
      });
      throw instance.error;
    }
  }

  /**
   * Deactivate a plugin (transition to stopped state)
   * Calls the plugin's deactivate() export if present
   * @param pluginId ID of the plugin to deactivate
   */
  async deactivate(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (instance.status !== "active") {
      throw new Error(
        `Plugin must be in 'active' status to deactivate, current: ${instance.status}`
      );
    }

    try {
      const sandbox = this.sandboxes.get(pluginId);
      if (!sandbox) {
        throw new Error(`Sandbox not found for plugin: ${pluginId}`);
      }

      // Call deactivate export if available
      const deactivateFn = instance.exports.deactivate as
        | (() => void | Promise<void>)
        | undefined;
      if (deactivateFn && typeof deactivateFn === "function") {
        await sandbox.execute(() => deactivateFn());
      }

      instance.status = "stopped";
      this.eventBus.emit({
        type: "plugin.deactivated",
        pluginId,
        manifest: instance.manifest,
        timestamp: new Date(),
      });
    } catch (error) {
      instance.status = "error";
      instance.error = error instanceof Error ? error : new Error(String(error));
      this.eventBus.emit({
        type: "plugin.error",
        pluginId,
        error: instance.error,
        timestamp: new Date(),
      });
      throw instance.error;
    }
  }

  /**
   * Uninstall a plugin from the system
   * @param pluginId ID of the plugin to uninstall
   */
  async uninstall(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    // Deactivate if active
    if (instance.status === "active") {
      await this.deactivate(pluginId);
    }

    // Cleanup resources
    this.plugins.delete(pluginId);
    this.sandboxes.delete(pluginId);
    this.moduleCache.delete(pluginId);
  }

  /**
   * Get a plugin instance by ID
   * @param pluginId ID of the plugin
   * @returns PluginInstance or null if not found
   */
  getPlugin(pluginId: string): PluginInstance | null {
    return this.plugins.get(pluginId) ?? null;
  }

  /**
   * List all installed plugins
   * @returns Array of all plugin instances
   */
  listPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * List plugins that provide a specific capability
   * @param capability Capability name to filter by
   * @returns Array of plugins providing the capability
   */
  listByCapability(capability: string): PluginInstance[] {
    return Array.from(this.plugins.values()).filter((plugin) =>
      plugin.manifest.capabilities.includes(capability)
    );
  }

  /**
   * Check if a plugin has permission to access a sensitive capability
   * Only "verified" and "system" trust levels can access sensitive capabilities
   * @param pluginId ID of the plugin
   * @param capability Capability to check
   * @returns true if plugin has access
   */
  hasCapabilityAccess(pluginId: string, capability: string): boolean {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return false;
    }

    // Check if plugin declares the capability
    if (!instance.manifest.capabilities.includes(capability)) {
      return false;
    }

    // Verify trust level for sensitive capabilities (security, secrets, admin)
    const sensitivePatterns = ["security", "secrets", "admin", "auth", "credential"];
    const isSensitive = sensitivePatterns.some((p) => capability.toLowerCase().includes(p));
    if (isSensitive && !["verified", "system"].includes(instance.trustLevel)) {
      return false;
    }

    return true;
  }
}
