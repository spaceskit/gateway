/**
 * Gateway WebSocket protocol — message types exchanged between
 * the gateway server and connected clients (native app, adapter, CLI).
 *
 * `proto/` is the canonical cross-process contract source of truth.
 * This file is the JSON WebSocket transport barrel for the remaining
 * gateway-specific envelope and payload types.
 *
 * All messages are JSON-encoded. Binary payloads (audio, etc.) use
 * a separate binary channel identified by message ID.
 */
export * from "./protocol/envelope.js";
export * from "./protocol/spaces.js";
export * from "./protocol/templates.js";
export * from "./protocol/identity.js";
export * from "./protocol/gateway-admin.js";
export * from "./protocol/tooling.js";
export * from "./protocol/connectors.js";
export * from "./protocol/usage-policy.js";
export * from "./protocol/library.js";
export * from "./protocol/scheduler.js";
export * from "./protocol/collaboration.js";
export * from "./protocol/changesets.js";
export * from "./protocol/settings.js";
export * from "./protocol/sync-speech-capabilities.js";
export * from "./protocol/events.js";
export * from "./protocol/coordination.js";
export { MessageTypes } from "./protocol/message-types.js";
