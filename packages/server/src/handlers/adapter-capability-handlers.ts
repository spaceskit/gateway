import { randomUUID } from "node:crypto";
import { isCapabilityType, type CapabilityRegistry, type CapabilityType } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type AdapterCapabilityInvokePayload,
  type AdapterCapabilityProvider,
  type CapabilitiesDeregisterPayload,
  type CapabilitiesRegisterPayload,
  type CapabilityErrorPayload,
  type CapabilityResultPayload,
  type GatewayMessage,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { PendingAdapterInvocation } from "../message-router-types.js";

export interface AdapterCapabilityHandlerContext {
  adapterInvocationTimeoutMs: number;
  adapterProviderOwners: Map<string, string>;
  adapterProvidersByClient: Map<string, Set<string>>;
  pendingAdapterInvocations: Map<string, PendingAdapterInvocation>;
  capabilities: CapabilityRegistry;
  logger: Logger;
  sendToClient: (clientId: string, msg: GatewayMessage) => void;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

function isAdapterClient(client: ClientSession): boolean {
  if (!client.clientType) return false;
  return client.clientType === "adapter" || client.clientType.endsWith("-adapter");
}

function validateAdapterProvider(provider: AdapterCapabilityProvider | undefined): string | null {
  if (!provider) return "provider is required";
  if (!provider.id) return "provider.id is required";
  if (!provider.name) return "provider.name is required";
  if (!provider.capabilityType) return "provider.capabilityType is required";
  if (!isCapabilityType(provider.capabilityType)) {
    return `Unknown capability type: ${provider.capabilityType}`;
  }
  if (provider.source !== "adapter") {
    return "provider.source must be \"adapter\"";
  }
  if (!Array.isArray(provider.operations) || provider.operations.length === 0) {
    return "provider.operations[] is required";
  }
  return null;
}

function invokeAdapterCapability(
  context: AdapterCapabilityHandlerContext,
  provider: AdapterCapabilityProvider,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const clientId = context.adapterProviderOwners.get(provider.id);
  if (!clientId) {
    throw new Error(`Adapter provider unavailable: ${provider.id}`);
  }

  const invocationId = randomUUID();
  const payload: AdapterCapabilityInvokePayload = {
    invocationId,
    capability: provider.capabilityType,
    operation,
    args,
    targetProvider: provider.id,
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      context.pendingAdapterInvocations.delete(invocationId);
      reject(new Error(`Adapter invocation timeout: ${provider.id}.${operation}`));
    }, context.adapterInvocationTimeoutMs);

    context.pendingAdapterInvocations.set(invocationId, {
      clientId,
      providerId: provider.id,
      resolve,
      reject,
      timeout,
    });

    try {
      context.sendToClient(clientId, {
        type: MessageTypes.CAPABILITY_INVOKE_ADAPTER,
        id: randomUUID(),
        ts: new Date().toISOString(),
        payload,
      });
    } catch (err) {
      clearTimeout(timeout);
      context.pendingAdapterInvocations.delete(invocationId);
      reject(err);
    }
  });
}

export async function handleCapabilitiesRegister(
  context: AdapterCapabilityHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!isAdapterClient(client)) {
    return context.errorResponse(msg.id, "PERMISSION_DENIED", "capabilities.register is only allowed for adapter clients");
  }

  const payload = msg.payload as CapabilitiesRegisterPayload;
  const providers = payload?.providers;
  if (!Array.isArray(providers) || providers.length === 0) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providers[] is required");
  }

  const registered: string[] = [];
  for (const provider of providers) {
    const validationError = validateAdapterProvider(provider);
    if (validationError) {
      return context.errorResponse(msg.id, "INVALID_ARGUMENT", validationError);
    }

    const existingOwner = context.adapterProviderOwners.get(provider.id);
    if (existingOwner && existingOwner !== client.id) {
      context.logger.warn("Adapter provider re-registered by a different client", {
        providerId: provider.id,
        previousClientId: existingOwner,
        nextClientId: client.id,
      });
      context.capabilities.deregister(provider.id);
      context.adapterProvidersByClient.get(existingOwner)?.delete(provider.id);
    } else {
      context.capabilities.deregister(provider.id);
    }

    context.capabilities.register(
      {
        id: provider.id,
        name: provider.name,
        source: "adapter",
        capabilityType: provider.capabilityType as CapabilityType,
        operations: provider.operations,
        available: true,
        lastHealthCheck: new Date(),
      },
      {
        invoke: async (operation, args) => invokeAdapterCapability(context, provider, operation, args),
      },
    );

    context.adapterProviderOwners.set(provider.id, client.id);
    if (!context.adapterProvidersByClient.has(client.id)) {
      context.adapterProvidersByClient.set(client.id, new Set());
    }
    context.adapterProvidersByClient.get(client.id)!.add(provider.id);
    registered.push(provider.id);
  }

  context.logger.info("Adapter providers registered", {
    clientId: client.id,
    providers: registered,
  });
  return context.response(msg.id, "capabilities_registered", {
    providerIds: registered,
  });
}

export async function handleCapabilitiesDeregister(
  context: AdapterCapabilityHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!isAdapterClient(client)) {
    return context.errorResponse(msg.id, "PERMISSION_DENIED", "capabilities.deregister is only allowed for adapter clients");
  }
  const payload = msg.payload as CapabilitiesDeregisterPayload;
  if (!Array.isArray(payload?.providerIds) || payload.providerIds.length === 0) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerIds[] is required");
  }

  const removed: string[] = [];
  for (const providerId of payload.providerIds) {
    const owner = context.adapterProviderOwners.get(providerId);
    if (!owner || owner !== client.id) continue;
    context.capabilities.deregister(providerId);
    context.adapterProviderOwners.delete(providerId);
    context.adapterProvidersByClient.get(client.id)?.delete(providerId);
    removed.push(providerId);
  }

  return context.response(msg.id, "capabilities_deregistered", {
    providerIds: removed,
  });
}

export async function handleCapabilityResult(
  context: AdapterCapabilityHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as CapabilityResultPayload;
  if (!payload?.invocationId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "invocationId is required");
  }

  const pending = context.pendingAdapterInvocations.get(payload.invocationId);
  if (!pending) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Unknown invocation: ${payload.invocationId}`);
  }
  if (pending.clientId !== client.id) {
    return context.errorResponse(msg.id, "PERMISSION_DENIED", "Invocation does not belong to this client");
  }

  clearTimeout(pending.timeout);
  context.pendingAdapterInvocations.delete(payload.invocationId);
  pending.resolve(payload.data);
  return null;
}

export async function handleCapabilityError(
  context: AdapterCapabilityHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as CapabilityErrorPayload;
  if (!payload?.invocationId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "invocationId is required");
  }

  const pending = context.pendingAdapterInvocations.get(payload.invocationId);
  if (!pending) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Unknown invocation: ${payload.invocationId}`);
  }
  if (pending.clientId !== client.id) {
    return context.errorResponse(msg.id, "PERMISSION_DENIED", "Invocation does not belong to this client");
  }

  clearTimeout(pending.timeout);
  context.pendingAdapterInvocations.delete(payload.invocationId);
  const codePrefix = payload.code ? `[${payload.code}] ` : "";
  pending.reject(new Error(`${codePrefix}${payload.message}`));
  return null;
}
