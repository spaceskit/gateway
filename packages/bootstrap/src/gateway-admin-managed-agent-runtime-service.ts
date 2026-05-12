import { USER_ESCALATION_SKILL_ID } from "@spaceskit/core";
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
import {
  ensureGatewayAdminConciergeSpace,
  ensureGatewayAdminMainSpace,
  type GatewayAdminManagedSpaceRepairContext,
} from "./gateway-admin-managed-space-repair.js";
import {
  deriveProviderFromModel,
  isSpaceAdminErrorLike,
  mergeSkillIds,
  normalizeProviderId,
  normalizeSelectionMode,
  parseModelConfig,
  parseStringArray,
  resolveOpenAICompatibleModelsEndpoint,
  throwGatewayError,
  uniqueModelIds,
  withProviderPrefix,
} from "./gateway-admin-model-normalizers.js";
import {
  resolveGatewayAdminRuntimeDefaults,
  updateGatewayAdminManagedRuntimeProfile,
  validateGatewayAdminRuntimeDefaultSelection,
  type GatewayAdminRuntimeDefaultsContext,
} from "./gateway-admin-runtime-defaults.js";
import type { ProviderRuntimeConfig, PublicProviderRuntimeConfig } from "./gateway-admin-service.js";
import type { OpenAICompatibleDetectionResult } from "./services/local-agent-discovery-service.js";

export interface ProviderRuntimeValidationResult {
  valid: boolean;
  reason?: string;
  fallbackModelHint?: string;
}

export interface ResolvedProviderModelHint {
  valid: boolean;
  providerHint?: string;
  modelHint?: string;
  fallbackApplied: boolean;
  fallbackReason?: string;
  reason?: string;
}

export interface PinnedProviderModelValidation {
  valid: boolean;
  providerHint?: string;
  modelHint?: string;
  reason?: string;
}

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
    modelHint?: string;
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
    await this.ensureMainProfileActive(true);
    await this.ensureConciergeProfileActive(true);
    await this.ensureMainSpace(true);
    await this.ensureConciergeSpace(true);

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

  resolveFallbackProviderModel(): { providerHint: string; modelHint: string } | null {
    const providerConfigs = this.options.listProviderConfigs();
    if (providerConfigs.length > 0) {
      // Prefer non-Apple provider as fallback; Apple is always-available on macOS
      // but should not shadow user-configured or detected CLI providers.
      const fallback = providerConfigs.find((c) => c.providerId !== "apple")
        ?? providerConfigs[0];
      return {
        providerHint: fallback.providerId,
        modelHint: fallback.model,
      };
    }

    const defaultProvider = normalizeProviderId(this.options.defaultProviderId)
      || deriveProviderFromModel(this.options.defaultModelId);
    const defaultModelRaw = this.options.defaultModelId?.trim();
    if (defaultProvider && defaultModelRaw) {
      return {
        providerHint: defaultProvider,
        modelHint: withProviderPrefix(defaultProvider, defaultModelRaw),
      };
    }

    return null;
  }

  async resolveValidatedProviderModel(input: {
    providerHintRaw?: string;
    modelHintRaw?: string;
    repairIfInvalid: boolean;
    allowFallbackRepair?: boolean;
  }): Promise<ResolvedProviderModelHint> {
    const allowFallbackRepair = input.allowFallbackRepair ?? true;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    let pinned = this.validatePinnedProviderModel(
      input.providerHintRaw,
      input.modelHintRaw,
    );
    if (!pinned.valid) {
      if (!input.repairIfInvalid || !allowFallbackRepair) {
        return {
          valid: false,
          fallbackApplied: false,
          reason: pinned.reason || "Runtime/model selection is invalid",
        };
      }

      const fallback = this.resolveFallbackProviderModel();
      if (!fallback) {
        return {
          valid: false,
          fallbackApplied: false,
          reason: "Unable to repair runtime/model selection: no runtimes configured",
        };
      }

      fallbackApplied = true;
      fallbackReason = pinned.reason ?? "Configured runtime/model unavailable";
      pinned = {
        valid: true,
        providerHint: fallback.providerHint,
        modelHint: fallback.modelHint,
      };
    }

    if (!pinned.valid || !pinned.providerHint || !pinned.modelHint) {
      return {
        valid: false,
        fallbackApplied,
        fallbackReason,
        reason: pinned.reason || "Runtime/model selection is invalid",
      };
    }

    const runtimeValidation = await this.validateProviderRuntimeSelection(
      pinned.providerHint,
      pinned.modelHint,
    );
    if (!runtimeValidation.valid) {
      if (!input.repairIfInvalid || !allowFallbackRepair) {
        return {
          valid: false,
          fallbackApplied,
          fallbackReason,
          reason: runtimeValidation.reason || "Runtime model selection is invalid",
        };
      }

      let fallbackProviderHint: string | undefined;
      let fallbackModelHint: string | undefined;
      const runtimeFallbackModel = runtimeValidation.fallbackModelHint;
      if (
        runtimeFallbackModel
        && runtimeFallbackModel.trim().length > 0
        && runtimeFallbackModel.trim().toLowerCase() !== pinned.modelHint.trim().toLowerCase()
      ) {
        fallbackProviderHint = pinned.providerHint;
        fallbackModelHint = runtimeFallbackModel.trim();
      } else {
        const fallback = this.resolveFallbackProviderModel();
        if (fallback) {
          const sameProvider = fallback.providerHint === pinned.providerHint;
          const sameModel = fallback.modelHint.trim().toLowerCase() === pinned.modelHint.trim().toLowerCase();
          if (!(sameProvider && sameModel)) {
            fallbackProviderHint = fallback.providerHint;
            fallbackModelHint = fallback.modelHint;
          }
        }
      }

      if (!fallbackProviderHint || !fallbackModelHint) {
        return {
          valid: false,
          fallbackApplied,
          fallbackReason,
          reason: runtimeValidation.reason || "Unable to repair runtime model selection",
        };
      }

      const fallbackPinned = this.validatePinnedProviderModel(
        fallbackProviderHint,
        fallbackModelHint,
      );
      if (!fallbackPinned.valid || !fallbackPinned.providerHint || !fallbackPinned.modelHint) {
        return {
          valid: false,
          fallbackApplied,
          fallbackReason,
          reason: fallbackPinned.reason
            || runtimeValidation.reason
            || "Fallback runtime/model selection is invalid",
        };
      }

      const fallbackRuntimeValidation = await this.validateProviderRuntimeSelection(
        fallbackPinned.providerHint,
        fallbackPinned.modelHint,
      );
      if (!fallbackRuntimeValidation.valid) {
        return {
          valid: false,
          fallbackApplied,
          fallbackReason,
          reason: fallbackRuntimeValidation.reason
            || runtimeValidation.reason
            || "Fallback runtime model selection is invalid",
        };
      }

      fallbackApplied = true;
      fallbackReason = runtimeValidation.reason ?? "Configured runtime model unavailable";
      pinned = fallbackPinned;
    }

    return {
      valid: true,
      providerHint: pinned.providerHint,
      modelHint: pinned.modelHint,
      fallbackApplied,
      fallbackReason,
    };
  }

  validatePinnedProviderModel(
    providerHintRaw?: string,
    modelHintRaw?: string,
  ): PinnedProviderModelValidation {
    const providerHint = deriveProviderFromModel(modelHintRaw) || normalizeProviderId(providerHintRaw);
    if (!providerHint) {
      return {
        valid: false,
        reason: "Main profile is missing runtime/model hints.",
      };
    }

    const providerConfig = this.options.listProviderConfigs()
      .find((entry) => entry.providerId.trim().toLowerCase() === providerHint);
    if (!providerConfig) {
      return {
        valid: false,
        reason: `Configured provider is unavailable: ${providerHint}`,
      };
    }

    const modelHint = withProviderPrefix(
      providerHint,
      modelHintRaw?.trim() || providerConfig.model,
    );
    const allowedModels = this.options.mergeAllowedModels(
      providerHint,
      providerConfig.model,
      providerConfig.allowedModels,
    );
    if (!providerConfig.allowCustomModel && !allowedModels.includes(modelHint)) {
      return {
        valid: false,
        reason: `Configured model is unavailable for provider ${providerHint}: ${modelHint}`,
      };
    }

    return {
      valid: true,
      providerHint,
      modelHint,
    };
  }

  async validateProviderRuntimeSelection(
    providerId: string,
    modelIdRaw: string,
  ): Promise<ProviderRuntimeValidationResult> {
    if (providerId === "apple") {
      await this.options.ensureAppleFoundationAvailability();
      const eligibility = this.options.appleProviderRuntimeEligibleSync();
      if (!eligibility.eligible) {
        return {
          valid: false,
          reason: `Apple Foundation Models runtime is unavailable: ${eligibility.reason}`,
        };
      }
      return { valid: true };
    }

    if (providerId !== "lmstudio") {
      return { valid: true };
    }

    const modelId = withProviderPrefix(providerId, modelIdRaw);
    const baseURL = this.options.resolveProviderBaseURL(
      providerId,
      this.options.providerConfigs.get(providerId)?.baseURL,
    );
    const endpoint = resolveOpenAICompatibleModelsEndpoint(baseURL);
    const detection = await this.options.detectOpenAICompatibleModels(baseURL, {
      forceRefresh: true,
    });
    if (!detection.serviceReachable) {
      return {
        valid: false,
        reason: detection.detectionError
          || `LM Studio runtime is unreachable at ${endpoint}. Start LM Studio server and retry.`,
      };
    }

    const detectedModels = uniqueModelIds(
      detection.models.map((entry) => withProviderPrefix(providerId, entry.id)),
    );
    if (detectedModels.length === 0) {
      return {
        valid: false,
        reason: `LM Studio runtime is reachable at ${endpoint} but returned no models. Load a model in LM Studio and retry.`,
      };
    }

    const normalizedModelId = modelId.toLowerCase();
    if (detectedModels.some((candidate) => candidate.toLowerCase() === normalizedModelId)) {
      return { valid: true };
    }

    const preview = detectedModels.slice(0, 3);
    const overflowCount = detectedModels.length - preview.length;
    const overflowSuffix = overflowCount > 0 ? ` (+${overflowCount} more)` : "";

    return {
      valid: false,
      reason: `Model ${modelId} is not loaded in LM Studio runtime. Available models: ${preview.join(", ")}${overflowSuffix}. Load the model in LM Studio or select an available model.`,
      fallbackModelHint: detectedModels[0],
    };
  }

  async ensureAgentAssignment(
    spaceId: string,
    agentId: string,
    profileId: string,
  ): Promise<boolean> {
    try {
      const space = await this.options.spaceAdminService.getSpace(spaceId);
      if (!space) {
        throw new Error(`Space not found: ${spaceId}`);
      }

      const existing = space.agents.find((assignment) => assignment.agentId === agentId);
      if (!existing) {
        await this.options.spaceAdminService.addAgent({
          spaceId,
          agentId,
          profileId,
          role: "participant",
        });
        return true;
      }

      if (existing.profileId !== profileId) {
        await this.options.spaceAdminService.updateAgentAssignment({
          spaceId,
          agentId,
          profileId,
        });
        return true;
      }

      return false;
    } catch (err) {
      if (isSpaceAdminErrorLike(err) && err.code === "ALREADY_EXISTS") {
        return false;
      }
      throw err;
    }
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
      validatePinnedProviderModel: (providerHint, modelHint) => this.validatePinnedProviderModel(
        providerHint,
        modelHint,
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

  private async ensureMainProfileActive(
    repairIfMissing: boolean,
  ): Promise<{ repaired: boolean; updatedAt: string }> {
    const profileRepo = this.requireProfileRepo();
    const profileLabel = this.options.gatewayProfile === "external" ? "External" : "Embedded";
    const existing = profileRepo.getById(this.options.mainProfileId);
    if (!existing) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Main profile is missing: ${this.options.mainProfileId}`,
        );
      }
      profileRepo.create({
        profileId: this.options.mainProfileId,
        name: `${profileLabel} Main Agent`,
        description: `Default ${this.options.gatewayProfile} gateway startup profile for the main agent.`,
        canModerate: true,
        personalityPrompt: `You are the default ${this.options.gatewayProfile} main gateway agent. Coordinate spaces clearly and safely.`,
        defaultSkillIds: [USER_ESCALATION_SKILL_ID],
      });
      const created = profileRepo.getById(this.options.mainProfileId);
      if (!created) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to create main profile: ${this.options.mainProfileId}`,
        );
      }
      return {
        repaired: true,
        updatedAt: created.updated_at,
      };
    }

    if (existing.archived !== 1) {
      this.ensureProfileDefaultSkills(this.options.mainProfileId, [USER_ESCALATION_SKILL_ID], "gateway_main_defaults");
      return {
        repaired: false,
        updatedAt: existing.updated_at,
      };
    }

    if (!repairIfMissing) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Main profile is archived: ${this.options.mainProfileId}`,
      );
    }
    profileRepo.restore(this.options.mainProfileId);
    const restored = profileRepo.getById(this.options.mainProfileId);
    if (!restored || restored.archived === 1) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to restore archived main profile: ${this.options.mainProfileId}`,
      );
    }
    this.ensureProfileDefaultSkills(this.options.mainProfileId, [USER_ESCALATION_SKILL_ID], "gateway_main_defaults");
    return {
      repaired: true,
      updatedAt: restored.updated_at,
    };
  }

  private async ensureConciergeProfileActive(
    repairIfMissing: boolean,
  ): Promise<{ repaired: boolean; updatedAt: string }> {
    const profileRepo = this.requireProfileRepo();
    const profileLabel = this.options.gatewayProfile === "external" ? "External" : "Embedded";
    const existing = profileRepo.getById(this.options.conciergeProfileId);
    if (!existing) {
      if (!repairIfMissing) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Concierge profile is missing: ${this.options.conciergeProfileId}`,
        );
      }

      const legacyProfile = this.findLegacyConciergeProfile();
      const legacyRevision = legacyProfile
        ? profileRepo.getActiveRevision(legacyProfile.profile_id)
        : undefined;
      profileRepo.create({
        profileId: this.options.conciergeProfileId,
        personaId: legacyProfile?.persona_id || "",
        name: `${profileLabel} Concierge`,
        description: "General-purpose system concierge for workspace status, routing, and setup.",
        canModerate: true,
        personalityPrompt: legacyRevision?.personality_prompt
          || "You are the Spaces concierge. Be concise, route users to the right workspace or settings surface, and escalate runtime issues clearly.",
        defaultSkillIds: mergeSkillIds(
          legacyRevision ? parseStringArray(legacyRevision.default_skill_set_ids_json) : [],
          [USER_ESCALATION_SKILL_ID],
        ),
        providerHint: legacyRevision?.provider_hint?.trim() || undefined,
        modelHint: legacyRevision?.model_hint?.trim() || undefined,
        modelConfig: legacyRevision
          ? parseModelConfig(legacyRevision.model_config_json, legacyRevision.model_hint)
          : undefined,
        source: legacyProfile ? "gateway_concierge_profile_migration" : "gateway_concierge_defaults",
      });
      const created = profileRepo.getById(this.options.conciergeProfileId);
      if (!created) {
        throwGatewayError(
          "FAILED_PRECONDITION",
          `Unable to create concierge profile: ${this.options.conciergeProfileId}`,
        );
      }
      return {
        repaired: true,
        updatedAt: created.updated_at,
      };
    }

    if (existing.archived !== 1) {
      this.ensureProfileDefaultSkills(this.options.conciergeProfileId, [USER_ESCALATION_SKILL_ID], "gateway_concierge_defaults");
      return {
        repaired: false,
        updatedAt: existing.updated_at,
      };
    }

    if (!repairIfMissing) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Concierge profile is archived: ${this.options.conciergeProfileId}`,
      );
    }
    profileRepo.restore(this.options.conciergeProfileId);
    const restored = profileRepo.getById(this.options.conciergeProfileId);
    if (!restored || restored.archived === 1) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Unable to restore archived concierge profile: ${this.options.conciergeProfileId}`,
      );
    }
    this.ensureProfileDefaultSkills(this.options.conciergeProfileId, [USER_ESCALATION_SKILL_ID], "gateway_concierge_defaults");
    return {
      repaired: true,
      updatedAt: restored.updated_at,
    };
  }

  private ensureProfileDefaultSkills(
    profileId: string,
    requiredSkillIds: readonly string[],
    source: string,
  ): void {
    const profileRepo = this.requireProfileRepo();
    const activeRevision = profileRepo.getActiveRevision(profileId);
    if (!activeRevision) return;
    const existingSkillIds = parseStringArray(activeRevision.default_skill_set_ids_json);
    const mergedSkillIds = mergeSkillIds(existingSkillIds, requiredSkillIds);
    if (mergedSkillIds.length === existingSkillIds.length) {
      return;
    }
    profileRepo.update({
      profileId,
      defaultSkillIds: mergedSkillIds,
      source,
    });
  }

  private async ensureMainSpace(
    repairIfMissing: boolean,
  ): Promise<{ spaceUid: string; repaired: boolean; assignedProfileId?: string; updatedAt: string }> {
    return ensureGatewayAdminMainSpace(this.managedSpaceRepairContext(), repairIfMissing);
  }

  private async ensureConciergeSpace(
    repairIfMissing: boolean,
  ): Promise<{ spaceUid: string; repaired: boolean; assignedProfileId?: string; updatedAt: string }> {
    return ensureGatewayAdminConciergeSpace(this.managedSpaceRepairContext(), repairIfMissing);
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

  private async normalizeMainAssignment(spaceId: string): Promise<void> {
    if (spaceId !== this.options.mainSpaceId) {
      return;
    }
    await this.ensureMainSpace(true);
  }

  private async normalizeConciergeAssignment(spaceId: string): Promise<void> {
    if (spaceId !== this.options.conciergeSpaceId) {
      return;
    }
    await this.ensureConciergeSpace(true);
  }

  private async resolveMainAgentState(input: {
    spaceId: string;
    repairIfMissing: boolean;
  }): Promise<GatewayMainAgentStatePayload> {
    const profileRepo = this.requireProfileRepo();
    const profileRepair = await this.ensureMainProfileActive(input.repairIfMissing);
    const spaceRepair = await this.ensureMainSpace(input.repairIfMissing);
    let repaired = profileRepair.repaired || spaceRepair.repaired;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    const activeRevision = profileRepo.getActiveRevision(this.options.mainProfileId);
    if (!activeRevision) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Active main profile revision missing: ${this.options.mainProfileId}`,
      );
    }

    const resolvedPinned = await this.resolveValidatedProviderModel({
      providerHintRaw: activeRevision.provider_hint,
      modelHintRaw: activeRevision.model_hint,
      repairIfInvalid: input.repairIfMissing,
      allowFallbackRepair: true,
    });
    if (!resolvedPinned.valid || !resolvedPinned.providerHint || !resolvedPinned.modelHint) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        resolvedPinned.reason || "Main profile runtime/model selection is invalid",
      );
    }
    if (resolvedPinned.fallbackApplied) {
      repaired = true;
    }
    fallbackApplied = resolvedPinned.fallbackApplied;
    fallbackReason = resolvedPinned.fallbackReason;

    const refreshedProfile = profileRepo.getById(this.options.mainProfileId);
    const updatedAt = new Date().toISOString();
    return {
      spaceId: input.spaceId,
      spaceUid: spaceRepair.spaceUid,
      mainAgentId: this.options.mainAgentId,
      mainProfileId: this.options.mainProfileId,
      assignedProfileId: spaceRepair.assignedProfileId,
      providerHint: resolvedPinned.providerHint,
      modelHint: resolvedPinned.modelHint,
      status: fallbackApplied ? "fallback" : repaired ? "repaired" : "healthy",
      repaired,
      fallbackApplied,
      fallbackReason,
      updatedAt: refreshedProfile?.updated_at || updatedAt,
    };
  }

  private async resolveConciergeAgentState(input: {
    spaceId: string;
    repairIfMissing: boolean;
  }): Promise<GatewayConciergeAgentStatePayload> {
    const profileRepo = this.requireProfileRepo();
    const profileRepair = await this.ensureConciergeProfileActive(input.repairIfMissing);
    const spaceRepair = await this.ensureConciergeSpace(input.repairIfMissing);
    let repaired = profileRepair.repaired || spaceRepair.repaired;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    const activeRevision = profileRepo.getActiveRevision(this.options.conciergeProfileId);
    if (!activeRevision) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `Active concierge profile revision missing: ${this.options.conciergeProfileId}`,
      );
    }

    const resolvedPinned = await this.resolveValidatedProviderModel({
      providerHintRaw: activeRevision.provider_hint,
      modelHintRaw: activeRevision.model_hint,
      repairIfInvalid: input.repairIfMissing,
      allowFallbackRepair: false,
    });
    if (!resolvedPinned.valid || !resolvedPinned.providerHint || !resolvedPinned.modelHint) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        resolvedPinned.reason || "Concierge profile runtime/model selection is invalid",
      );
    }
    if (resolvedPinned.fallbackApplied) {
      repaired = true;
    }
    fallbackApplied = resolvedPinned.fallbackApplied;
    fallbackReason = resolvedPinned.fallbackReason;

    const refreshedProfile = profileRepo.getById(this.options.conciergeProfileId);
    const updatedAt = new Date().toISOString();
    return {
      spaceId: input.spaceId,
      spaceUid: spaceRepair.spaceUid,
      conciergeAgentId: this.options.conciergeAgentId,
      conciergeProfileId: this.options.conciergeProfileId,
      assignedProfileId: spaceRepair.assignedProfileId,
      providerHint: resolvedPinned.providerHint,
      modelHint: resolvedPinned.modelHint,
      status: fallbackApplied ? "fallback" : repaired ? "repaired" : "healthy",
      repaired,
      fallbackApplied,
      fallbackReason,
      updatedAt: refreshedProfile?.updated_at || updatedAt,
    };
  }

  private findLegacyConciergeProfile() {
    const profileRepo = this.requireProfileRepo();
    const candidates = profileRepo
      .list({ includeArchived: true })
      .filter((entry) => entry.profile_id.startsWith("system.concierge.profile."));
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates.sort((lhs, rhs) => rhs.updated_at.localeCompare(lhs.updated_at))[0];
  }
}
