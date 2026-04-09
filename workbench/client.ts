import {
  GatewayClient,
  generateAuthKeyPair,
  type AdapterCapabilityInvokePayload,
  type AdapterCapabilityProvider,
  type AuthKeyPair,
  type GatewayClientOptions,
  type SpaceTurnTrace,
  type TurnEventPayload,
} from "../../client-ts/src/gateway-client.ts";

export {
  GatewayClient,
  generateAuthKeyPair,
};

export type {
  SpaceTurnTrace,
  TurnEventPayload,
};

export type AdapterOperationHandler = (
  args: Record<string, unknown>,
  request: AdapterCapabilityInvokePayload,
) => unknown | Promise<unknown>;

export interface AdapterProviderRegistration {
  provider: AdapterCapabilityProvider;
  handlers: Record<string, AdapterOperationHandler>;
}

export interface WorkbenchAdapterClientOptions
  extends Omit<GatewayClientOptions, "clientType"> {
  authKeyPair?: AuthKeyPair;
}

export class WorkbenchAdapterClient {
  private readonly gatewayClient: GatewayClient;
  private readonly providers = new Map<string, AdapterProviderRegistration>();
  private unsubscribeInvoke?: () => void;

  constructor(options: WorkbenchAdapterClientOptions) {
    this.gatewayClient = new GatewayClient({
      ...options,
      clientType: "adapter",
    });
    if (options.authKeyPair) {
      this.gatewayClient.setAuthKeyPair(options.authKeyPair);
    }
  }

  async connect(): Promise<void> {
    await this.gatewayClient.connect();

    this.unsubscribeInvoke?.();
    this.unsubscribeInvoke = this.gatewayClient.onCapabilityInvoke((request) => {
      return this.handleInvocation(request);
    });

    if (this.providers.size > 0) {
      await this.gatewayClient.registerCapabilities(
        Array.from(this.providers.values()).map((entry) => entry.provider),
      );
    }
  }

  async disconnect(): Promise<void> {
    this.unsubscribeInvoke?.();
    this.unsubscribeInvoke = undefined;

    if (this.gatewayClient.isConnected && this.providers.size > 0) {
      await this.gatewayClient.deregisterCapabilities(Array.from(this.providers.keys()));
    }
    await this.gatewayClient.disconnect();
  }

  async registerProviders(registrations: AdapterProviderRegistration[]): Promise<void> {
    if (registrations.length === 0) {
      return;
    }

    for (const registration of registrations) {
      this.providers.set(registration.provider.id, registration);
    }

    if (this.gatewayClient.isConnected) {
      await this.gatewayClient.registerCapabilities(
        registrations.map((registration) => registration.provider),
      );
    }
  }

  private async handleInvocation(request: AdapterCapabilityInvokePayload): Promise<void> {
    const registration = request.targetProvider
      ? this.providers.get(request.targetProvider)
      : Array.from(this.providers.values()).find(
        (entry) => entry.provider.capabilityType === request.capability,
      );
    const handler = registration?.handlers[request.operation];
    if (!registration || !handler) {
      await this.gatewayClient.sendCapabilityError({
        invocationId: request.invocationId,
        providerId: request.targetProvider,
        code: "PROVIDER_NOT_FOUND",
        message: `No adapter provider found for invocation (${request.capability}.${request.operation})`,
      });
      return;
    }

    const startedAt = Date.now();
    try {
      const result = await handler(request.args ?? {}, request);
      await this.gatewayClient.sendCapabilityResult({
        invocationId: request.invocationId,
        providerId: registration.provider.id,
        data: result,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.gatewayClient.sendCapabilityError({
        invocationId: request.invocationId,
        providerId: registration.provider.id,
        code: "INVOKE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
