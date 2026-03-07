import type { EventBus } from "../events/event-bus.js";

/**
 * Represents a configuration change event
 */
export interface ConfigChangeEvent<T> {
  /** The previous configuration value */
  oldValue: T;
  /** The new configuration value */
  newValue: T;
  /** ISO timestamp when the change occurred */
  timestamp: string;
  /** The mode that triggered the reload */
  mode: "manual" | "file" | "signal";
}

/**
 * Configuration change listener callback
 */
export type ConfigChangeListener<T> = (event: ConfigChangeEvent<T>) => void | Promise<void>;

/**
 * Validation function for configuration
 */
export type ConfigValidator<T> = (config: unknown) => T | never;

/**
 * Options for configuring the ConfigHotReloader
 */
export interface ConfigHotReloadOptions<T> {
  /** Initial configuration value */
  initialConfig: T;

  /** Optional validator function to validate new configs */
  validate?: ConfigValidator<T>;

  /** Optional EventBus instance for emitting change events */
  eventBus?: EventBus;

  /**
   * File-based reload configuration
   */
  file?: {
    /** Path to the config file (JSON or YAML) */
    path: string;

    /**
     * Polling interval in milliseconds
     * @default 5000
     */
    pollInterval?: number;
  };

  /**
   * Signal-based reload configuration
   * When enabled, SIGHUP signal triggers a reload from file
   */
  signal?: {
    /** Whether to watch SIGHUP signal */
    enabled: boolean;

    /** Path to config file for signal-based reload */
    filePath: string;
  };

  /**
   * Debounce time for rapid changes in milliseconds
   * @default 300
   */
  debounceMs?: number;
}

/**
 * Hot-reloadable configuration system for Spaceskit
 *
 * Supports two reload modes:
 * 1. File-based: Polls a JSON/YAML config file at regular intervals
 * 2. Signal-based: Reloads config on SIGHUP signal
 *
 * @template T The configuration type
 *
 * @example
 * ```typescript
 * const reloader = new ConfigHotReloader<AppConfig>({
 *   initialConfig: defaultConfig,
 *   validate: (config) => AppConfig.parse(config),
 *   file: {
 *     path: "./config.json",
 *     pollInterval: 5000
 *   },
 *   eventBus: myEventBus
 * });
 *
 * reloader.onConfigChange((event) => {
 *   console.log("Config changed:", event.newValue);
 * });
 *
 * await reloader.start();
 * ```
 */
export class ConfigHotReloader<T> {
  private currentConfig: T;
  private listeners: ConfigChangeListener<T>[] = [];
  private isRunning = false;
  private fileWatchInterval: NodeJS.Timer | null = null;
  private signalHandler: (() => void) | null = null;
  private lastConfigChecksum: string | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly options: ConfigHotReloadOptions<T>;

  /**
   * Creates a new ConfigHotReloader instance
   */
  constructor(options: ConfigHotReloadOptions<T>) {
    this.options = options;
    this.currentConfig = options.initialConfig;
  }

  /**
   * Gets the current configuration
   */
  getCurrentConfig(): T {
    return this.currentConfig;
  }

  /**
   * Subscribes a listener to configuration changes
   */
  onConfigChange(listener: ConfigChangeListener<T>): () => void {
    this.listeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Manually triggers a configuration reload
   */
  async reload(): Promise<void> {
    if (this.options.file) {
      await this.loadConfigFromFile("manual");
    }
  }

  /**
   * Starts the hot-reload system
   * Begins file polling and/or signal listening based on configuration
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Start file-based watching
    if (this.options.file) {
      const pollInterval = this.options.file.pollInterval ?? 5000;
      this.fileWatchInterval = setInterval(async () => {
        await this.loadConfigFromFile("file");
      }, pollInterval);
    }

    // Start signal-based watching
    if (this.options.signal?.enabled) {
      this.signalHandler = async () => {
        await this.loadConfigFromFile("signal");
      };
      process.on("SIGHUP", this.signalHandler);
    }
  }

  /**
   * Stops the hot-reload system
   * Clears file polling and signal listeners
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop file polling
    if (this.fileWatchInterval) {
      clearInterval(this.fileWatchInterval);
      this.fileWatchInterval = null;
    }

    // Remove signal handler
    if (this.signalHandler) {
      process.off("SIGHUP", this.signalHandler);
      this.signalHandler = null;
    }

    // Clear any pending debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Loads configuration from file with debouncing
   */
  private async loadConfigFromFile(mode: "file" | "signal" | "manual"): Promise<void> {
    // Clear any pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const debounceMs = this.options.debounceMs ?? 300;

    // Debounce the actual load
    this.debounceTimer = setTimeout(async () => {
      try {
        const filePath = this.options.file?.path ?? this.options.signal?.filePath;
        if (!filePath) {
          return;
        }

        const fileContent = await Bun.file(filePath).text();
        const checksum = this.calculateChecksum(fileContent);

        // Skip if content hasn't changed
        if (this.lastConfigChecksum === checksum) {
          return;
        }

        this.lastConfigChecksum = checksum;

        // Parse configuration based on file extension
        let parsedConfig: unknown;
        if (filePath.endsWith(".json")) {
          parsedConfig = JSON.parse(fileContent);
        } else if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
          // For YAML, we'd need a YAML parser. Using JSON fallback for now.
          // In a real implementation, you'd use a library like 'yaml'
          parsedConfig = JSON.parse(fileContent);
        } else {
          // Assume JSON for unknown extensions
          parsedConfig = JSON.parse(fileContent);
        }

        // Validate the new configuration
        let newConfig: T;
        if (this.options.validate) {
          newConfig = this.options.validate(parsedConfig);
        } else {
          newConfig = parsedConfig as T;
        }

        // Notify listeners of the change
        await this.notifyListeners(newConfig, mode);
        this.currentConfig = newConfig;
      } catch (error) {
        console.error(
          `[ConfigHotReloader] Failed to load configuration from file: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      this.debounceTimer = null;
    }, debounceMs);
  }

  /**
   * Notifies all listeners of a configuration change
   */
  private async notifyListeners(newConfig: T, mode: "file" | "signal" | "manual"): Promise<void> {
    const event: ConfigChangeEvent<T> = {
      oldValue: this.currentConfig,
      newValue: newConfig,
      timestamp: new Date().toISOString(),
      mode,
    };

    // Emit to EventBus if provided
    if (this.options.eventBus) {
      this.options.eventBus.emit({
        type: "config.changed",
        oldValue: event.oldValue,
        newValue: event.newValue,
        mode: event.mode,
        timestamp: new Date(),
      });
    }

    // Call all registered listeners
    const results = this.listeners.map((listener) => {
      try {
        return listener(event);
      } catch (error) {
        console.error(
          `[ConfigHotReloader] Listener error: ${error instanceof Error ? error.message : String(error)}`,
        );
        return Promise.resolve();
      }
    });

    await Promise.all(results);
  }

  /**
   * Calculates a simple checksum of content for change detection
   */
  private calculateChecksum(content: string): string {
    // Using a simple hash function - in production, consider crypto.subtle.digest
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${hash}`;
  }
}
