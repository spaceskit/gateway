import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import {
  API_KEY_ENV_BY_PROVIDER,
  LOCAL_PROVIDER_IDS,
} from "./services/provider-catalog-support.js";
import {
  providerCatalogGroup,
  throwGatewayError,
} from "./gateway-admin-model-normalizers.js";
import { resolveProviderBaseURLForGateway } from "./gateway-admin-provider-config-support.js";

export interface AppleFoundationAvailabilitySnapshot {
  available: boolean;
  reason: string;
}

export interface ProviderConfigPolicyInput {
  baseURL?: string;
}

export interface ExistingProviderConfigPolicyInput {
  baseURL?: string;
}

export interface GatewayAdminProviderPolicyServiceOptions {
  gatewayProfile: GatewayCoreProfileId;
  enableAppleFoundationProvider: boolean;
  hostPlatform: string;
  hostArch: string;
  appleFoundationAvailability?: AppleFoundationAvailabilitySnapshot;
}

export class GatewayAdminProviderPolicyService {
  private readonly gatewayProfile: GatewayCoreProfileId;
  private readonly enableAppleFoundationProvider: boolean;
  private readonly hostPlatform: string;
  private readonly hostArch: string;
  private appleFoundationAvailability?: AppleFoundationAvailabilitySnapshot;

  constructor(options: GatewayAdminProviderPolicyServiceOptions) {
    this.gatewayProfile = options.gatewayProfile;
    this.enableAppleFoundationProvider = options.enableAppleFoundationProvider;
    this.hostPlatform = options.hostPlatform;
    this.hostArch = options.hostArch;
    this.appleFoundationAvailability = options.appleFoundationAvailability;
  }

  appleFoundationHostSupported(): boolean {
    return this.hostPlatform === "darwin" && this.hostArch === "arm64";
  }

  async ensureAppleFoundationAvailability(): Promise<AppleFoundationAvailabilitySnapshot> {
    if (this.appleFoundationAvailability) {
      return this.appleFoundationAvailability;
    }

    if (!this.enableAppleFoundationProvider) {
      this.appleFoundationAvailability = {
        available: false,
        reason: "SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER is disabled.",
      };
      return this.appleFoundationAvailability;
    }

    if (!this.appleFoundationHostSupported()) {
      this.appleFoundationAvailability = {
        available: false,
        reason: `Apple Foundation Models require darwin/arm64. Current host: ${this.hostPlatform}/${this.hostArch}.`,
      };
      return this.appleFoundationAvailability;
    }

    this.appleFoundationAvailability = {
      available: false,
      reason: "Apple Foundation availability probe did not complete.",
    };
    return this.appleFoundationAvailability;
  }

  appleProviderEnabledSync(): { enabled: boolean; reason: string } {
    if (!this.enableAppleFoundationProvider) {
      return {
        enabled: false,
        reason: "SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER is disabled.",
      };
    }

    return { enabled: true, reason: "Apple Foundation provider is enabled." };
  }

  appleProviderRuntimeEligibleSync(): { eligible: boolean; reason: string } {
    const enabled = this.appleProviderEnabledSync();
    if (!enabled.enabled) {
      return { eligible: false, reason: enabled.reason };
    }

    if (!this.appleFoundationHostSupported()) {
      return {
        eligible: false,
        reason: `Apple Foundation Models require darwin/arm64. Current host: ${this.hostPlatform}/${this.hostArch}.`,
      };
    }

    if (!this.appleFoundationAvailability || this.appleFoundationAvailability.available !== true) {
      return {
        eligible: false,
        reason: this.appleFoundationAvailability?.reason
          ?? "Apple Intelligence availability check has not passed.",
      };
    }

    return { eligible: true, reason: "Apple Intelligence available." };
  }

  embeddedLocalIntegrationsAllowed(): boolean {
    return this.gatewayProfile === "embedded"
      && this.hostPlatform === "darwin"
      && this.hostArch === "arm64";
  }

  ensureAppleProviderEnabledSync(operation: string): void {
    const enabled = this.appleProviderEnabledSync();
    if (enabled.enabled) {
      return;
    }
    throwGatewayError(
      "FAILED_PRECONDITION",
      `${operation} blocked for provider apple: ${enabled.reason}`,
    );
  }

  ensureAppleProviderRuntimeEligibleSync(operation: string): void {
    const eligibility = this.appleProviderRuntimeEligibleSync();
    if (eligibility.eligible) {
      return;
    }
    throwGatewayError(
      "FAILED_PRECONDITION",
      `${operation} blocked for provider apple: ${eligibility.reason}`,
    );
  }

  providerVisibleInCatalog(providerId: string): boolean {
    if (providerId !== "apple") {
      return true;
    }
    return this.appleProviderEnabledSync().enabled && this.appleFoundationHostSupported();
  }

  providerPolicyRestrictionReason(providerId: string): string | undefined {
    if (this.gatewayProfile !== "embedded") {
      return undefined;
    }
    if (providerCatalogGroup(providerId) === "cloud") {
      return undefined;
    }
    if (this.embeddedLocalIntegrationsAllowed()) {
      return undefined;
    }
    return `Provider ${providerId} is disabled in embedded profile on ${this.hostPlatform}/${this.hostArch}. Local executors and local runtimes require embedded macOS on Apple Silicon or an external gateway.`;
  }

  assertProviderConfigAllowed(
    providerId: string,
    input: ProviderConfigPolicyInput,
    existing?: ExistingProviderConfigPolicyInput,
  ): void {
    if (this.gatewayProfile !== "embedded") {
      return;
    }

    const policyRestrictionReason = this.providerPolicyRestrictionReason(providerId);
    if (policyRestrictionReason) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        policyRestrictionReason,
      );
    }

    if (!API_KEY_ENV_BY_PROVIDER[providerId] && !LOCAL_PROVIDER_IDS.has(providerId)) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Custom runtime configuration requires external gateway profile.",
      );
    }

    const nextBaseURL = input.baseURL?.trim() || existing?.baseURL;
    if (nextBaseURL) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Custom model endpoints require external gateway profile.",
      );
    }
  }

  isProviderConfigAllowed(providerId: string): boolean {
    return !this.providerPolicyRestrictionReason(providerId);
  }

  resolveProviderBaseURL(providerId: string, configuredBaseURL?: string): string | undefined {
    return resolveProviderBaseURLForGateway({
      providerId,
      configuredBaseURL,
      gatewayProfile: this.gatewayProfile,
      isProviderConfigAllowed: (candidateProviderId) =>
        this.isProviderConfigAllowed(candidateProviderId),
    });
  }
}
