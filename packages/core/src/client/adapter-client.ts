import {
  GatewayClient,
  type AuthKeyPair,
  type GatewayClientOptions,
  type AdapterCapabilityProvider,
  type AdapterCapabilityInvokePayload,
} from "./gateway-client.js";

export type AdapterOperationHandler = (
  args: Record<string, unknown>,
  request: AdapterCapabilityInvokePayload,
) => unknown | Promise<unknown>;

export interface AdapterProviderRegistration {
  provider: AdapterCapabilityProvider;
  handlers: Record<string, AdapterOperationHandler>;
}

export interface GatewayAdapterClientOptions
  extends Omit<GatewayClientOptions, "clientType"> {
  authKeyPair?: AuthKeyPair;
}

/**
 * Adapter-oriented wrapper around GatewayClient.
 *
 * Responsibilities:
 * - Register/deregister adapter capability providers.
 * - Dispatch incoming `capability.invoke` requests to local handlers.
 * - Send `capability.result` / `capability.error` back to the gateway.
 */
export class GatewayAdapterClient {
  private gatewayClient: GatewayClient;
  private providers = new Map<string, AdapterProviderRegistration>();
  private unsubscribeInvoke?: () => void;
  private providerSyncPromise: Promise<void> | null = null;
  private static readonly providerSyncMaxAttempts = 8;
  private static readonly providerSyncRetryDelayMs = 150;

  constructor(options: GatewayAdapterClientOptions) {
    const onOpen = options.onOpen;
    this.gatewayClient = new GatewayClient({
      ...options,
      clientType: "adapter",
      onOpen: () => {
        onOpen?.();
        this.ensureInvokeSubscription();
        void this.syncProviderRegistrations();
      },
    });
    if (options.authKeyPair) {
      this.gatewayClient.setAuthKeyPair(options.authKeyPair);
    }
  }

  setAuthKeyPair(keyPair: AuthKeyPair): void {
    this.gatewayClient.setAuthKeyPair(keyPair);
  }

  get client(): GatewayClient {
    return this.gatewayClient;
  }

  get isConnected(): boolean {
    return this.gatewayClient.isConnected;
  }

  async connect(): Promise<void> {
    if (!this.gatewayClient.isConnected) {
      await this.gatewayClient.connect();
    }
    this.ensureInvokeSubscription();
    await this.syncProviderRegistrations();
  }

  async disconnect(): Promise<void> {
    this.unsubscribeInvoke?.();
    this.unsubscribeInvoke = undefined;
    this.providerSyncPromise = null;

    if (this.gatewayClient.isConnected && this.providers.size > 0) {
      await this.gatewayClient.deregisterCapabilities(Array.from(this.providers.keys()));
    }

    await this.gatewayClient.disconnect();
  }

  async registerProvider(registration: AdapterProviderRegistration): Promise<void> {
    this.providers.set(registration.provider.id, registration);
    await this.syncProviderRegistrations();
  }

  async registerProviders(registrations: AdapterProviderRegistration[]): Promise<void> {
    for (const registration of registrations) {
      this.providers.set(registration.provider.id, registration);
    }
    await this.syncProviderRegistrations();
  }

  async deregisterProvider(providerId: string): Promise<void> {
    this.providers.delete(providerId);
    if (this.gatewayClient.isConnected) {
      await this.gatewayClient.deregisterCapabilities([providerId]);
    }
  }

  private ensureInvokeSubscription(): void {
    this.unsubscribeInvoke?.();
    this.unsubscribeInvoke = this.gatewayClient.onCapabilityInvoke((request) => {
      return this.handleInvocation(request);
    });
  }

  private async syncProviderRegistrations(): Promise<void> {
    if (!this.gatewayClient.isConnected || this.providers.size === 0) {
      return;
    }

    if (this.providerSyncPromise) {
      await this.providerSyncPromise;
      return;
    }

    this.providerSyncPromise = this.syncProviderRegistrationsInternal()
      .finally(() => {
        this.providerSyncPromise = null;
      });
    await this.providerSyncPromise;
  }

  private async syncProviderRegistrationsInternal(): Promise<void> {
    const providers = Array.from(this.providers.values()).map((entry) => entry.provider);
    let lastError: unknown;

    for (let attempt = 0; attempt < GatewayAdapterClient.providerSyncMaxAttempts; attempt += 1) {
      if (!this.gatewayClient.isConnected) {
        return;
      }

      try {
        await this.gatewayClient.registerCapabilities(providers);
        return;
      } catch (error) {
        lastError = error;
        if (!isAuthRaceError(error)) {
          throw error;
        }
        const delayMs = GatewayAdapterClient.providerSyncRetryDelayMs * (attempt + 1);
        await sleep(delayMs);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("Failed to synchronize adapter capability providers");
  }

  private async handleInvocation(request: AdapterCapabilityInvokePayload): Promise<void> {
    const provider = request.targetProvider
      ? this.providers.get(request.targetProvider)
      : Array.from(this.providers.values()).find(
          (entry) => entry.provider.capabilityType === request.capability,
        );

    if (!provider) {
      await this.gatewayClient.sendCapabilityError({
        invocationId: request.invocationId,
        providerId: request.targetProvider,
        code: "PROVIDER_NOT_FOUND",
        message: `No adapter provider found for invocation (${request.capability}.${request.operation})`,
      });
      return;
    }

    const handler = provider.handlers[request.operation];
    if (!handler) {
      await this.gatewayClient.sendCapabilityError({
        invocationId: request.invocationId,
        providerId: provider.provider.id,
        code: "OPERATION_NOT_SUPPORTED",
        message: `Operation not supported: ${request.operation}`,
      });
      return;
    }

    const startedAt = Date.now();
    try {
      const data = await handler(request.args, request);
      await this.gatewayClient.sendCapabilityResult({
        invocationId: request.invocationId,
        providerId: provider.provider.id,
        data,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      await this.gatewayClient.sendCapabilityError({
        invocationId: request.invocationId,
        providerId: provider.provider.id,
        code: "INVOKE_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function isAuthRaceError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : String(error);
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("unauthenticated")
    || normalized.includes("authentication required")
    || normalized.includes("auth")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
