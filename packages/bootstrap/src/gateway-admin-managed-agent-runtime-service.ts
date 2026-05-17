import type { SpaceAdminService } from "@spaceskit/core";
import type {
  GatewayRuntimeDefaultsRepository,
  ProfileRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import type {
  GatewayConciergeAgentStatePayload,
  GatewayGetConciergeAgentPayload,
  GatewayGetMainAgentPayload,
  GatewayGetRuntimeDefaultsPayload,
  GatewayMainAgentStatePayload,
  GatewayModelProviderCatalogPayload,
  GatewayRuntimeDefaultsPayload,
  GatewaySetConciergeAgentPayload,
  GatewaySetMainAgentPayload,
  GatewaySetRuntimeDefaultsPayload,
  GatewaySetRuntimeDefaultsResponsePayload,
} from "@spaceskit/server";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import {
  applyManagedAgentDefinitionSelection,
  applyManagedAgentProviderModelSelection,
  type ManagedAgentSelectionContext,
} from "./gateway-admin-managed-agent-selection.js";
import { ensureGatewayAdminManagedAgentAssignment } from "./gateway-admin-managed-agent-assignment.js";
import {
  ensureGatewayAdminConciergeSpace,
  ensureGatewayAdminMainSpace,
  type GatewayAdminManagedSpaceRepairContext,
} from "./gateway-admin-managed-space-repair.js";
import { normalizeSelectionMode, throwGatewayError } from "./gateway-admin-model-normalizers.js";
import {
  resolveManagedAgentFallbackProviderModel,
  resolveManagedAgentValidatedProviderModel,
  validateManagedAgentPinnedProviderModel,
  validateManagedAgentProviderRuntimeSelection,
  type GatewayAdminManagedAgentProviderModelContext,
  type PinnedProviderModelValidation,
  type ProviderRuntimeValidationResult,
  type ResolvedProviderModelId,
} from "./gateway-admin-managed-agent-provider-model.js";
import {
  ensureGatewayAdminConciergeProfileActive,
  ensureGatewayAdminMainProfileActive,
  resolveGatewayAdminConciergeAgentState,
  resolveGatewayAdminMainAgentState,
  type GatewayAdminManagedAgentStateContext,
} from "./gateway-admin-managed-agent-state.js";
import {
  resolveGatewayAdminRuntimeDefaults,
  updateGatewayAdminManagedRuntimeProfile,
  validateGatewayAdminRuntimeDefaultSelection,
  type GatewayAdminRuntimeDefaultsContext,
} from "./gateway-admin-runtime-defaults.js";
import type { ProviderRuntimeConfig, PublicProviderRuntimeConfig } from "./gateway-admin-service.js";
import type { OpenAICompatibleDetectionResult } from "./services/local-agent-discovery-service.js";

export type { PinnedProviderModelValidation, ProviderRuntimeValidationResult, ResolvedProviderModelId } from "./gateway-admin-managed-agent-provider-model.js";

export interface GatewayAdminManagedAgentRuntimeServiceOptions {
  profileRepo: ProfileRepository | null;
  spaceAdminService: SpaceAdminService;
  spaceRepo?: SpaceRepository;
  gatewayRuntimeDefaultsRepo?: GatewayRuntimeDefaultsRepository;
  gatewayProfile: GatewayCoreProfileId;
  defaultProviderId?: string;
  defaultModelId?: string;
  mainSpaceId: string;
  mainSpaceName: string;
  mainSpaceResourceId: string;
  mainSpaceGoal: string;
  mainProfileId: string;
  mainAgentId: string;
  conciergeSpaceId: string;
  conciergeSpaceName: string;
  conciergeSpaceResourceId: string;
  conciergeSpaceGoal: string;
  conciergeProfileId: string;
  conciergeAgentId: string;
  mainAgentSwapEnabled: boolean;
  mainAgentAutoRepairEnabled: boolean;
  providerConfigs: Map<string, ProviderRuntimeConfig>;
  listProviderConfigs: () => PublicProviderRuntimeConfig[];
  listProviderCatalogs: (input?: {
    providerId?: string;
    refresh?: boolean;
  }) => Promise<GatewayModelProviderCatalogPayload[]>;
  isProviderConfigAllowed: (providerId: string) => boolean;
  mergeAllowedModels: (providerId: string, model: string, modelIds: string[]) => string[];
  ensureAppleFoundationAvailability: () => Promise<unknown>;
  appleProviderRuntimeEligibleSync: () => { eligible: boolean; reason: string };
  resolveProviderBaseURL: (providerId: string, configuredBaseURL?: string) => string | undefined;
  detectOpenAICompatibleModels: (
    baseURLRaw?: string,
    options?: { forceRefresh?: boolean },
  ) => Promise<OpenAICompatibleDetectionResult>;
  validateProfileModelSelection: (input: {
    providerHint?: string;
    modelId?: string;
    modelConfig?: import("@spaceskit/persistence").ProfileModelConfig;
  }) => void;
}

export class GatewayAdminManagedAgentRuntimeService {
  private readonly options: GatewayAdminManagedAgentRuntimeServiceOptions;

  constructor(options: GatewayAdminManagedAgentRuntimeServiceOptions) {
    this.options = options;
  }

  resolveMainSpaceId(): string {
    return this.options.mainSpaceId;
  }

  resolveConciergeSpaceId(): string {
    return this.options.conciergeSpaceId;
  }

  async getMainAgent(input: GatewayGetMainAgentPayload = {}): Promise<GatewayMainAgentStatePayload> {
    const spaceId = this.resolveMainTargetSpaceId(input.spaceId);
    const repairIfMissing = input.repairIfMissing ?? this.options.mainAgentAutoRepairEnabled;
    return this.resolveMainAgentState({ spaceId, repairIfMissing });
  }

  async getConciergeAgent(
    input: GatewayGetConciergeAgentPayload = {},
  ): Promise<GatewayConciergeAgentStatePayload> {
    const spaceId = this.resolveConciergeTargetSpaceId(input.spaceId);
    const repairIfMissing = input.repairIfMissing ?? this.options.mainAgentAutoRepairEnabled;
    return this.resolveConciergeAgentState({ spaceId, repairIfMissing });
  }

  async setMainAgent(input: GatewaySetMainAgentPayload): Promise<GatewayMainAgentStatePayload> {
    if (!this.options.mainAgentSwapEnabled) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Main-agent swap is disabled by SPACESKIT_MAIN_AGENT_SWAP_V1",
      );
    }

    const selectionMode = normalizeSelectionMode(input.selectionMode);
    if (!selectionMode) {
      throwGatewayError(
        "INVALID_ARGUMENT",
        "selectionMode must be either provider_model or agent_definition",
      );
    }

    const spaceId = this.resolveMainTargetSpaceId(input.spaceId);
    await this.resolveMainAgentState({ spaceId, repairIfMissing: true });
    const profileRepo = this.requireProfileRepo();
    const selectionContext = this.managedAgentSelectionContext(
      profileRepo,
      this.options.mainProfileId,
      "gateway_main_agent_swap",
    );

    if (selectionMode === "provider_model") {
      await applyManagedAgentProviderModelSelection(input, selectionContext);
    } else {
      await applyManagedAgentDefinitionSelection(input, selectionContext);
    }

    await this.normalizeMainAssignment(spaceId);
    return this.resolveMainAgentState({ spaceId, repairIfMissing: true });
  }

  async setConciergeAgent(
    input: GatewaySetConciergeAgentPayload,
  ): Promise<GatewayConciergeAgentStatePayload> {
    if (!this.options.mainAgentSwapEnabled) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        "Concierge-agent swap is disabled by SPACESKIT_MAIN_AGENT_SWAP_V1",
      );
    }

    const selectionMode = normalizeSelectionMode(input.selectionMode);
    if (!selectionMode) {
      throwGatewayError(
        "INVALID_ARGUMENT",
        "selectionMode must be either provider_model or agent_definition",
      );
    }

    const spaceId = this.resolveConciergeTargetSpaceId(input.spaceId);
    await this.resolveConciergeAgentState({ spaceId, repairIfMissing: true });
    const profileRepo = this.requireProfileRepo();
    const selectionContext = this.managedAgentSelectionContext(
      profileRepo,
      this.options.conciergeProfileId,
      "gateway_concierge_agent_swap",
    );

    if (selectionMode === "provider_model") {
      await applyManagedAgentProviderModelSelection(input, selectionContext);
    } else {
      await applyManagedAgentDefinitionSelection(input, selectionContext);
    }

    await this.normalizeConciergeAssignment(spaceId);
    return this.resolveConciergeAgentState({ spaceId, repairIfMissing: true });
  }

  async getRuntimeDefaults(
    _input: GatewayGetRuntimeDefaultsPayload = {},
  ): Promise<GatewayRuntimeDefaultsPayload> {
    return resolveGatewayAdminRuntimeDefaults(this.runtimeDefaultsContext());
  }

  async setRuntimeDefaults(
    input: GatewaySetRuntimeDefaultsPayload,
  ): Promise<GatewaySetRuntimeDefaultsResponsePayload> {
    if (!input.main && !input.concierge) {
      throwGatewayError(
        "INVALID_ARGUMENT",
        "At least one runtime-default branch must be provided.",
      );
    }

    const runtimeDefaultsContext = this.runtimeDefaultsContext();
    const current = await resolveGatewayAdminRuntimeDefaults(runtimeDefaultsContext);
    const main = input.main
      ? await validateGatewayAdminRuntimeDefaultSelection(runtimeDefaultsContext, input.main, "main")
      : current.main;
    const concierge = input.concierge
      ? await validateGatewayAdminRuntimeDefaultSelection(runtimeDefaultsContext, input.concierge, "concierge")
      : current.concierge;

    const persisted = this.options.gatewayRuntimeDefaultsRepo?.set({
      mainProviderId: main.providerId,
      mainModelId: main.modelId,
      conciergeProviderId: concierge.providerId,
      conciergeModelId: concierge.modelId,
    });

    const mainSpaceId = this.resolveMainTargetSpaceId(undefined);
    const conciergeSpaceId = this.resolveConciergeTargetSpaceId(undefined);
    const stateContext = this.managedAgentStateContext();
    const spaceRepairContext = this.managedSpaceRepairContext();
    await ensureGatewayAdminMainProfileActive(stateContext, true);
    await ensureGatewayAdminConciergeProfileActive(stateContext, true);
    await ensureGatewayAdminMainSpace(spaceRepairContext, true);
    await ensureGatewayAdminConciergeSpace(spaceRepairContext, true);

    updateGatewayAdminManagedRuntimeProfile(
      runtimeDefaultsContext,
      this.options.mainProfileId,
      main,
      true,
      "gateway_runtime_defaults",
    );
    updateGatewayAdminManagedRuntimeProfile(
      runtimeDefaultsContext,
      this.options.conciergeProfileId,
      concierge,
      false,
      "gateway_runtime_defaults",
    );

    await this.normalizeMainAssignment(mainSpaceId);
    await this.normalizeConciergeAssignment(conciergeSpaceId);

    const mainAgentState = await this.resolveMainAgentState({
      spaceId: mainSpaceId,
      repairIfMissing: true,
    });
    const conciergeAgentState = await this.resolveConciergeAgentState({
      spaceId: conciergeSpaceId,
      repairIfMissing: true,
    });

    return {
      defaults: {
        main,
        concierge,
        updatedAt: persisted?.updated_at ?? new Date().toISOString(),
      },
      mainAgentState,
      conciergeAgentState,
    };
  }

  resolveFallbackProviderModel(): { providerHint: string; modelId: string } | null {
    return resolveManagedAgentFallbackProviderModel(this.providerModelContext());
  }

  async resolveValidatedProviderModel(input: {
    providerHintRaw?: string;
    modelIdRaw?: string;
    repairIfInvalid: boolean;
    allowFallbackRepair?: boolean;
  }): Promise<ResolvedProviderModelId> {
    return resolveManagedAgentValidatedProviderModel(this.providerModelContext(), input);
  }

  validatePinnedProviderModel(
    providerHintRaw?: string,
    modelIdRaw?: string,
  ): PinnedProviderModelValidation {
    return validateManagedAgentPinnedProviderModel(
      this.providerModelContext(),
      providerHintRaw,
      modelIdRaw,
    );
  }

  async validateProviderRuntimeSelection(
    providerId: string,
    modelIdRaw: string,
  ): Promise<ProviderRuntimeValidationResult> {
    return validateManagedAgentProviderRuntimeSelection(
      this.providerModelContext(),
      providerId,
      modelIdRaw,
    );
  }

  async ensureAgentAssignment(
    spaceId: string,
    agentId: string,
    profileId: string,
  ): Promise<boolean> {
    return ensureGatewayAdminManagedAgentAssignment(
      this.options.spaceAdminService,
      spaceId,
      agentId,
      profileId,
    );
  }

  private resolveMainTargetSpaceId(spaceId?: string): string {
    const normalized = spaceId?.trim();
    if (!normalized) {
      return this.options.mainSpaceId;
    }
    if (normalized !== this.options.mainSpaceId) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Main-agent operations are restricted to configured main space: ${this.options.mainSpaceId}`,
      );
    }
    return normalized;
  }

  private resolveConciergeTargetSpaceId(spaceId?: string): string {
    const normalized = spaceId?.trim();
    if (!normalized) {
      return this.options.conciergeSpaceId;
    }
    if (normalized !== this.options.conciergeSpaceId) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Concierge-agent operations are restricted to configured concierge space: ${this.options.conciergeSpaceId}`,
      );
    }
    return normalized;
  }

  private requireProfileRepo(): ProfileRepository {
    if (!this.options.profileRepo) {
      throwGatewayError("FAILED_PRECONDITION", "Profile repository unavailable");
    }
    return this.options.profileRepo;
  }

  private managedAgentSelectionContext(
    profileRepo: ProfileRepository,
    profileId: string,
    updateSource: string,
  ): ManagedAgentSelectionContext {
    return {
      profileRepo,
      profileId,
      updateSource,
      listProviderConfigs: () => this.options.listProviderConfigs(),
      mergeAllowedModels: (providerId, model, modelIds) => this.options.mergeAllowedModels(
        providerId,
        model,
        modelIds,
      ),
      validateProviderRuntimeSelection: (providerId, modelId) => (
        this.validateProviderRuntimeSelection(providerId, modelId)
      ),
      validateProfileModelSelection: (input) => this.options.validateProfileModelSelection(input),
      validatePinnedProviderModel: (providerHint, modelId) => this.validatePinnedProviderModel(
        providerHint,
        modelId,
      ),
    };
  }

  private runtimeDefaultsContext(): GatewayAdminRuntimeDefaultsContext {
    return {
      profileRepo: this.options.profileRepo,
      gatewayRuntimeDefaultsRepo: this.options.gatewayRuntimeDefaultsRepo,
      mainProfileId: this.options.mainProfileId,
      conciergeProfileId: this.options.conciergeProfileId,
      defaultProviderId: this.options.defaultProviderId,
      defaultModelId: this.options.defaultModelId,
      listProviderConfigs: () => this.options.listProviderConfigs(),
      listProviderCatalogs: (input) => this.options.listProviderCatalogs(input),
      isProviderConfigAllowed: (providerId) => this.options.isProviderConfigAllowed(providerId),
      mergeAllowedModels: (providerId, model, modelIds) =>
        this.options.mergeAllowedModels(providerId, model, modelIds),
      validateProviderRuntimeSelection: (providerId, modelId) =>
        this.validateProviderRuntimeSelection(providerId, modelId),
      requireProfileRepo: () => this.requireProfileRepo(),
    };
  }

  private providerModelContext(): GatewayAdminManagedAgentProviderModelContext {
    return {
      providerConfigs: this.options.providerConfigs,
      defaultProviderId: this.options.defaultProviderId,
      defaultModelId: this.options.defaultModelId,
      listProviderConfigs: () => this.options.listProviderConfigs(),
      mergeAllowedModels: (providerId, model, modelIds) =>
        this.options.mergeAllowedModels(providerId, model, modelIds),
      ensureAppleFoundationAvailability: () => this.options.ensureAppleFoundationAvailability(),
      appleProviderRuntimeEligibleSync: () => this.options.appleProviderRuntimeEligibleSync(),
      resolveProviderBaseURL: (providerId, configuredBaseURL) =>
        this.options.resolveProviderBaseURL(providerId, configuredBaseURL),
      detectOpenAICompatibleModels: (baseURLRaw, options) =>
        this.options.detectOpenAICompatibleModels(baseURLRaw, options),
    };
  }

  private managedSpaceRepairContext(): GatewayAdminManagedSpaceRepairContext {
    return {
      spaceAdminService: this.options.spaceAdminService,
      spaceRepo: this.options.spaceRepo,
      main: {
        spaceId: this.options.mainSpaceId,
        resourceId: this.options.mainSpaceResourceId,
        name: this.options.mainSpaceName,
        goal: this.options.mainSpaceGoal,
        profileId: this.options.mainProfileId,
        agentId: this.options.mainAgentId,
      },
      concierge: {
        spaceId: this.options.conciergeSpaceId,
        resourceId: this.options.conciergeSpaceResourceId,
        name: this.options.conciergeSpaceName,
        goal: this.options.conciergeSpaceGoal,
        profileId: this.options.conciergeProfileId,
        agentId: this.options.conciergeAgentId,
      },
    };
  }

  private managedAgentStateContext(): GatewayAdminManagedAgentStateContext {
    return {
      gatewayProfile: this.options.gatewayProfile,
      mainProfileId: this.options.mainProfileId,
      mainAgentId: this.options.mainAgentId,
      conciergeProfileId: this.options.conciergeProfileId,
      conciergeAgentId: this.options.conciergeAgentId,
      requireProfileRepo: () => this.requireProfileRepo(),
      resolveValidatedProviderModel: (input) => this.resolveValidatedProviderModel(input),
      ensureMainSpace: (repairIfMissing) =>
        ensureGatewayAdminMainSpace(this.managedSpaceRepairContext(), repairIfMissing),
      ensureConciergeSpace: (repairIfMissing) =>
        ensureGatewayAdminConciergeSpace(this.managedSpaceRepairContext(), repairIfMissing),
    };
  }

  private async normalizeMainAssignment(spaceId: string): Promise<void> {
    if (spaceId !== this.options.mainSpaceId) {
      return;
    }
    await ensureGatewayAdminMainSpace(this.managedSpaceRepairContext(), true);
  }

  private async normalizeConciergeAssignment(spaceId: string): Promise<void> {
    if (spaceId !== this.options.conciergeSpaceId) {
      return;
    }
    await ensureGatewayAdminConciergeSpace(this.managedSpaceRepairContext(), true);
  }

  private async resolveMainAgentState(input: {
    spaceId: string;
    repairIfMissing: boolean;
  }): Promise<GatewayMainAgentStatePayload> {
    return resolveGatewayAdminMainAgentState(this.managedAgentStateContext(), input);
  }

  private async resolveConciergeAgentState(input: {
    spaceId: string;
    repairIfMissing: boolean;
  }): Promise<GatewayConciergeAgentStatePayload> {
    return resolveGatewayAdminConciergeAgentState(this.managedAgentStateContext(), input);
  }

}
