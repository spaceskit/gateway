/**
 * Configuration module for Spaceskit
 *
 * Provides hot-reload capabilities for managing configuration changes
 * at runtime with file watching and signal-based triggers.
 */

export { ConfigHotReloader } from "./hot-reload.js";
export type {
  ConfigChangeEvent,
  ConfigChangeListener,
  ConfigValidator,
  ConfigHotReloadOptions,
} from "./hot-reload.js";
