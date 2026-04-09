import { randomUUID } from "node:crypto";
import type { CapabilityRegistry, SessionContinuityManager, SpaceAdminService, SpaceManager } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import { buildGatewayErrorPayload } from "./error-contract.js";
import type { ClientSession } from "./gateway-server.js";
import { authorizeSpaceAccess as evaluateSpaceAccess, resolveExecutionOrigin as determineExecutionOrigin, resolveSessionResetPrincipal as determineSessionResetPrincipal, type AccessControlContext } from "./handlers/access-control.js";
import type { AdapterCapabilityHandlerContext } from "./handlers/adapter-capability-handlers.js";
import type { ChangeSetHandlerContext } from "./handlers/changeset-handlers.js";
import type { GatewayAgentHandlerContext } from "./handlers/gateway-agent-handlers.js";
import type { GatewayConnectorHandlerContext } from "./handlers/gateway-connector-handlers.js";
import type { GatewayControlHandlerContext } from "./handlers/gateway-control-handlers.js";
import type { GatewayGovernanceHandlerContext } from "./handlers/gateway-governance-handlers.js";
import type { IdentityTemplateHandlerContext } from "./handlers/identity-template-handlers.js";
import type { PolicyHandlerContext } from "./handlers/policy-handlers.js";
import type { RealtimeCollaborationHandlerContext } from "./handlers/realtime-collaboration-handlers.js";
import { routeMessage } from "./handlers/route-dispatch.js";
import type { SchedulerHandlerContext } from "./handlers/scheduler-handlers.js";
import type { SpaceAdminHandlerContext } from "./handlers/space-admin-handlers.js";
import type { SpaceResourceHandlerContext } from "./handlers/space-resource-handlers.js";
import type { SpaceSharingHandlerContext } from "./handlers/space-sharing-handlers.js";
import type { TransportHandlerContext } from "./handlers/transport-handlers.js";
import type { TurnHandlerContext } from "./handlers/turn-handlers.js";
import {
  isGatewayErrorLike,
  normalizeString,
} from "./message-router-utils.js";
import {
  type DeviceIdentityService,
  type ConnectorAdminService,
  type ConciergeCallRuntimeService,
  type ConciergeEscalationService,
  type GatewayAdminService,
  type GatewayCapabilityAccessService,
  type GatewayExternalConnectivityService,
  type GatewayIdentityService,
  type GatewayKnowledgeBaseService,
  type GatewayLibraryService,
  type GatewayPolicyService,
  type GatewayResetService,
  type GatewaySkillCatalogService,
  type GatewaySyncService,
  type GatewayWorkspaceDefaultsService,
  type OrchestratorCommandService,
  type SchedulerService,
  type SpeechSessionService,
  type ToolAccessPolicyService,
  type UsageSnapshotService,
} from "./message-router-gateway-services.js";
import {
  type MemoryLifecycleService,
  type OrchestrationJournalService,
  type RouterSpaceDecorators,
  type SpaceArtifactReaderService,
  type SpaceChangeSetService,
  type SpaceContextService,
  type SpaceMemoryPolicyService,
  type SpaceMcpService,
  type SpaceQuotaService,
  type SpaceSharingService,
  type SpaceTemplateService,
  type SpaceToolPolicyService,
  type SpaceTurnTraceService,
  type SpaceWorkspaceService,
  type TurnHistoryService,
} from "./message-router-space-services.js";
import type { MessageRouterOptions, PendingAdapterInvocation } from "./message-router-types.js";
import { MessageTypes, type AdapterCapabilityProvider, type ErrorPayload, type GatewayMessage, type SpaceAssignmentSummary, type SpaceSummary } from "./protocol.js";
import { deterministicUuid, normalizeUuid } from "./uuid.js";

export type {
  ConnectorAdminService,
  ConciergeCallRuntimeService,
  ConciergeEscalationService,
  DeviceIdentityService,
  GatewayAdminService,
  GatewayCapabilityAccessService,
  GatewayExternalConnectivityService,
  GatewayIdentityService,
  GatewayKnowledgeBaseService,
  GatewayLibraryService,
  GatewayPolicyService,
  GatewayResetService,
  GatewaySkillCatalogService,
  GatewaySyncService,
  GatewayWorkspaceDefaultsService,
  OrchestratorCommandService,
  SchedulerService,
  SpeechSessionService,
  ToolAccessPolicyService,
  UsageSnapshotService,
} from "./message-router-gateway-services.js";
export type {
  MemoryLifecycleService,
  OrchestrationJournalService,
  SpaceArtifactReaderService as SpaceArtifactService,
  SpaceChangeSetService,
  SpaceContextService,
  SpaceMemoryPolicyService,
  SpaceMcpService,
  SpaceQuotaService,
  SpaceSharingService,
  SpaceTemplateService,
  SpaceToolPolicyService,
  SpaceTurnTraceService,
  SpaceWorkspaceService,
  TurnHistoryService,
} from "./message-router-space-services.js";
export type { MessageRouterOptions, PendingAdapterInvocation } from "./message-router-types.js";

export class MessageRouter {
  private readonly spaceUidBySpaceId = new Map<string, string>();
  private readonly spaceIdBySpaceUid = new Map<string, string>();
  private readonly continuityIdentityByClientSession = new Map<string, string>();
  private readonly activeSpacesByClientSession = new Map<string, Set<string>>();
  private readonly adapterProviderOwners = new Map<string, string>();
  private readonly adapterProvidersByClient = new Map<string, Set<string>>();
  private readonly pendingAdapterInvocations = new Map<string, PendingAdapterInvocation>();

  constructor(
    private readonly options: MessageRouterOptions,
  ) {}

  private get spaceManager(): SpaceManager { return this.options.spaceManager; }
  private get spaceAdminService(): SpaceAdminService | null { return this.options.spaceAdminService ?? null; }
  private get gatewayAdminService(): GatewayAdminService | null { return this.options.gatewayAdminService ?? null; }
  private get gatewayResetService(): GatewayResetService | null { return this.options.gatewayResetService ?? null; }
  private get connectorAdminService(): ConnectorAdminService | null { return this.options.connectorAdminService ?? null; }
  private get gatewayIdentityService(): GatewayIdentityService | null { return this.options.gatewayIdentityService ?? null; }
  private get gatewayPolicyService(): GatewayPolicyService | null { return this.options.gatewayPolicyService ?? null; }
  private get gatewaySkillCatalogService(): GatewaySkillCatalogService | null { return this.options.gatewaySkillCatalogService ?? null; }
  private get gatewayKnowledgeBaseService(): GatewayKnowledgeBaseService | null { return this.options.gatewayKnowledgeBaseService ?? null; }
  private get gatewayLibraryService(): GatewayLibraryService | null { return this.options.gatewayLibraryService ?? null; }
  private get gatewayCapabilityAccessService(): GatewayCapabilityAccessService | null { return this.options.gatewayCapabilityAccessService ?? null; }
  private get spaceTemplateService(): SpaceTemplateService | null { return this.options.spaceTemplateService ?? null; }
  private get usageSnapshotService(): UsageSnapshotService | null { return this.options.usageSnapshotService ?? null; }
  private get schedulerService(): SchedulerService | null { return this.options.schedulerService ?? null; }
  private get spaceContextService(): SpaceContextService | null { return this.options.spaceContextService ?? null; }
  private get spaceSharingService(): SpaceSharingService | null { return this.options.spaceSharingService ?? null; }
  private get turnHistoryService(): TurnHistoryService | null { return this.options.turnHistoryService ?? null; }
  private get orchestrationJournalService(): OrchestrationJournalService | null { return this.options.orchestrationJournalService ?? null; }
  private get spaceMemoryPolicyService(): SpaceMemoryPolicyService | null { return this.options.spaceMemoryPolicyService ?? null; }
  private get memoryLifecycleService(): MemoryLifecycleService | null { return this.options.memoryLifecycleService ?? null; }
  private get spaceWorkspaceService(): SpaceWorkspaceService | null { return this.options.spaceWorkspaceService ?? null; }
  private get spaceChangeSetService(): SpaceChangeSetService | null { return this.options.spaceChangeSetService ?? null; }
  private get spaceQuotaService(): SpaceQuotaService | null { return this.options.spaceQuotaService ?? null; }
  private get spaceTurnTraceService(): SpaceTurnTraceService | null { return this.options.spaceTurnTraceService ?? null; }
  private get spaceArtifactService(): SpaceArtifactReaderService | null { return this.options.spaceArtifactService ?? null; }
  private get spaceToolPolicyService(): SpaceToolPolicyService | null { return this.options.spaceToolPolicyService ?? null; }
  private get spaceMcpService(): SpaceMcpService | null { return this.options.spaceMcpService ?? null; }
  private get deviceIdentityService(): DeviceIdentityService | null { return this.options.deviceIdentityService ?? null; }
  private get orchestratorCommandService(): OrchestratorCommandService | null { return this.options.orchestratorCommandService ?? null; }
  private get gatewaySyncService(): GatewaySyncService | null { return this.options.gatewaySyncService ?? null; }
  private get speechSessionService(): SpeechSessionService | null { return this.options.speechSessionService ?? null; }
  private get conciergeCallRuntimeService(): ConciergeCallRuntimeService | null { return this.options.conciergeCallRuntimeService ?? null; }
  private get conciergeEscalationService(): ConciergeEscalationService | null { return this.options.conciergeEscalationService ?? null; }
  private get toolAccessPolicyService(): ToolAccessPolicyService | null { return this.options.toolAccessPolicyService ?? null; }
  private get gatewayWorkspaceDefaultsService(): GatewayWorkspaceDefaultsService | null { return this.options.gatewayWorkspaceDefaultsService ?? null; }
  private get gatewayExternalConnectivityService(): GatewayExternalConnectivityService | null { return this.options.gatewayExternalConnectivityService ?? null; }
  private get sessionContinuityManager(): SessionContinuityManager | null { return this.options.sessionContinuityManager ?? null; }
  private get onFeedbackResolved() { return this.options.onFeedbackResolved ?? null; }
  private get issueHttpPrincipalToken() { return this.options.issueHttpPrincipalToken ?? null; }
  private get capabilities(): CapabilityRegistry { return this.options.capabilities; }
  private get logger(): Logger { return this.options.logger; }
  private get sendToClient(): (clientId: string, msg: GatewayMessage) => void { return this.options.sendToClient ?? (() => {}); }
  private get broadcastToSpace(): (spaceUid: string, msg: GatewayMessage) => void { return this.options.broadcastToSpace ?? (() => {}); }
  private get adapterInvocationTimeoutMs(): number { return this.options.adapterInvocationTimeoutMs ?? 30_000; }
  private get agentSessionReplacementEnabled(): boolean { return this.options.agentSessionReplacementEnabled ?? true; }

  onClientDisconnected(client: ClientSession): void {
    const providers = this.adapterProvidersByClient.get(client.id);
    if (providers) {
      for (const providerId of providers) {
        this.capabilities.deregister(providerId);
        this.adapterProviderOwners.delete(providerId);
      }
      this.adapterProvidersByClient.delete(client.id);
    }
    for (const [invocationId, pending] of this.pendingAdapterInvocations) {
      if (pending.clientId !== client.id) continue;
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Adapter client disconnected during invocation: ${pending.providerId}`));
      this.pendingAdapterInvocations.delete(invocationId);
    }

    const continuityClientId = this.continuityIdentityByClientSession.get(client.id) ?? this.resolveContinuityClientId(client);
    const spaces = this.activeSpacesByClientSession.get(client.id);
    this.continuityIdentityByClientSession.delete(client.id);
    this.activeSpacesByClientSession.delete(client.id);
    if (!this.sessionContinuityManager || !spaces || spaces.size === 0) return;

    void Promise.all(Array.from(spaces.values()).map(async (spaceId) => {
      try {
        const spaceState = this.spaceManager.getActiveSpaceState(spaceId) ?? undefined;
        await this.sessionContinuityManager!.pause(spaceId, continuityClientId, spaceState);
      } catch (error) {
        this.logger.warn("Failed to pause session on client disconnect", {
          clientId: client.id,
          continuityClientId,
          spaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));
  }

  async handle(client: ClientSession, msg: GatewayMessage): Promise<GatewayMessage | null> {
    this.logger.debug("Routing message", { type: msg.type, id: msg.id, clientId: client.id });
    try {
      const accessError = await evaluateSpaceAccess(this.accessControlContext(), client, msg);
      if (accessError) return accessError;
      return await routeMessage(this, client, msg);
    } catch (err) {
      if (isGatewayErrorLike(err)) {
        return this.errorResponse(msg.id, err.code, err.message);
      }
      const message = err instanceof Error ? err.message : "Internal error";
      this.logger.error("Handler error", err instanceof Error ? err : undefined, { type: msg.type, id: msg.id });
      return this.errorResponse(msg.id, "INTERNAL", message, err);
    }
  }

  transportHandlerContext(): TransportHandlerContext {
    return {
      deviceIdentityService: this.deviceIdentityService,
      gatewaySyncService: this.gatewaySyncService,
      speechSessionService: this.speechSessionService,
      conciergeCallRuntimeService: this.conciergeCallRuntimeService,
      issueHttpPrincipalToken: this.issueHttpPrincipalToken,
      resolveSpaceUid: this.resolveSpaceUid.bind(this),
      response: this.response.bind(this),
      errorResponse: this.errorResponse.bind(this),
      broadcastToSpace: this.broadcastToSpace,
    };
  }
  policyHandlerContext(): PolicyHandlerContext {
    return { gatewayResetService: this.gatewayResetService, spaceQuotaService: this.spaceQuotaService, spaceToolPolicyService: this.spaceToolPolicyService, toolAccessPolicyService: this.toolAccessPolicyService, gatewayWorkspaceDefaultsService: this.gatewayWorkspaceDefaultsService, gatewayExternalConnectivityService: this.gatewayExternalConnectivityService, resolveExecutionOrigin: this.resolveExecutionOrigin.bind(this), response: this.response.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  accessControlContext(): AccessControlContext {
    return { spaceSharingService: this.spaceSharingService, gatewayAdminService: this.gatewayAdminService, resolveSpaceId: this.resolveSpaceId.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  turnHandlerContext(): TurnHandlerContext {
    return { capabilities: this.capabilities, logger: this.logger, onFeedbackResolved: this.onFeedbackResolved, sessionContinuityManager: this.sessionContinuityManager, spaceManager: this.spaceManager, touchContinuitySession: this.touchContinuitySession.bind(this), resolveExecutionOrigin: this.resolveExecutionOrigin.bind(this), resolveSpaceId: this.resolveSpaceId.bind(this), resolveSpaceUid: this.resolveSpaceUid.bind(this), response: this.response.bind(this), errorResponse: this.errorResponse.bind(this), broadcastToSpace: this.broadcastToSpace };
  }
  spaceAdminHandlerContext(): SpaceAdminHandlerContext {
    return { ...this.spaceDecorators(), spaceAdminService: this.spaceAdminService, spaceMemoryPolicyService: this.spaceMemoryPolicyService, spaceWorkspaceService: this.spaceWorkspaceService, spaceSharingService: this.spaceSharingService, spaceMcpService: this.spaceMcpService, spaceQuotaService: this.spaceQuotaService, spaceManager: this.spaceManager, agentSessionReplacementEnabled: this.agentSessionReplacementEnabled, resolveSessionResetPrincipal: this.resolveSessionResetPrincipal.bind(this), response: this.response.bind(this), errorResponse: this.errorResponse.bind(this), broadcastToSpace: this.broadcastToSpace };
  }
  spaceResourceHandlerContext(): SpaceResourceHandlerContext {
    return { ...this.spaceDecorators(), orchestrationJournalService: this.orchestrationJournalService, spaceAdminService: this.spaceAdminService, spaceMcpService: this.spaceMcpService, spaceWorkspaceService: this.spaceWorkspaceService, turnHistoryService: this.turnHistoryService, spaceManager: this.spaceManager, response: this.response.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  gatewayAgentHandlerContext(): GatewayAgentHandlerContext {
    return { gatewayAdminService: this.gatewayAdminService, spaceQuotaService: this.spaceQuotaService, agentSessionReplacementEnabled: this.agentSessionReplacementEnabled, resolveSessionResetPrincipal: this.resolveSessionResetPrincipal.bind(this), resolveSpaceUid: this.resolveSpaceUid.bind(this), response: this.response.bind(this), errorResponse: this.errorResponse.bind(this), broadcastToSpace: this.broadcastToSpace, spaceManager: this.spaceManager };
  }
  gatewayControlHandlerContext(): GatewayControlHandlerContext {
    return { gatewayAdminService: this.gatewayAdminService, gatewayResetService: this.gatewayResetService, response: this.response.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  gatewayConnectorHandlerContext(): GatewayConnectorHandlerContext {
    return {
      connectorAdminService: this.connectorAdminService,
      executeConnectorTurn: async (spaceId, input, client) =>
        this.spaceManager.executeTurn(
          spaceId,
          input,
          undefined,
          {
            principalId: client.publicKey,
            deviceId: client.deviceId,
            executionOrigin: "connector",
          },
        ),
      getGatewayGlobalFlags: () => this.gatewayPolicyService?.getPolicy().globalFlags,
      response: this.response.bind(this),
      errorResponse: this.errorResponse.bind(this),
    };
  }
  identityTemplateHandlerContext(): IdentityTemplateHandlerContext {
    return { ...this.spaceDecorators(), gatewayAdminService: this.gatewayAdminService, gatewayIdentityService: this.gatewayIdentityService, spaceTemplateService: this.spaceTemplateService, spaceWorkspaceService: this.spaceWorkspaceService, response: this.response.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  gatewayGovernanceHandlerContext(): GatewayGovernanceHandlerContext {
    return { gatewayCapabilityAccessService: this.gatewayCapabilityAccessService, gatewayKnowledgeBaseService: this.gatewayKnowledgeBaseService, gatewayLibraryService: this.gatewayLibraryService, gatewayPolicyService: this.gatewayPolicyService, gatewaySkillCatalogService: this.gatewaySkillCatalogService, usageSnapshotService: this.usageSnapshotService, response: this.response.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  schedulerHandlerContext(): SchedulerHandlerContext {
    return { orchestratorCommandService: this.orchestratorCommandService, schedulerService: this.schedulerService, resolveSpaceUid: this.resolveSpaceUid.bind(this), response: this.response.bind(this), errorResponse: this.errorResponse.bind(this), broadcastToSpace: this.broadcastToSpace };
  }
  spaceSharingHandlerContext(): SpaceSharingHandlerContext {
    return { spaceContextService: this.spaceContextService, spaceSharingService: this.spaceSharingService, resolveSpaceUid: this.resolveSpaceUid.bind(this), response: this.response.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  changeSetHandlerContext(): ChangeSetHandlerContext {
    return { memoryLifecycleService: this.memoryLifecycleService, spaceArtifactService: this.spaceArtifactService, spaceChangeSetService: this.spaceChangeSetService, spaceQuotaService: this.spaceQuotaService, spaceTurnTraceService: this.spaceTurnTraceService, response: this.response.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  adapterCapabilityHandlerContext(): AdapterCapabilityHandlerContext {
    return { adapterInvocationTimeoutMs: this.adapterInvocationTimeoutMs, adapterProviderOwners: this.adapterProviderOwners, adapterProvidersByClient: this.adapterProvidersByClient, pendingAdapterInvocations: this.pendingAdapterInvocations, capabilities: this.capabilities, logger: this.logger, sendToClient: this.sendToClient, response: this.response.bind(this), errorResponse: this.errorResponse.bind(this) };
  }
  realtimeCollaborationHandlerContext(): RealtimeCollaborationHandlerContext {
    return {
      logger: this.logger,
      sessionContinuityManager: this.sessionContinuityManager,
      spaceManager: this.spaceManager,
      conciergeEscalationService: this.conciergeEscalationService,
      rememberContinuityIdentity: this.rememberContinuityIdentity.bind(this),
      trackClientSpace: this.trackClientSpace.bind(this),
      resolveSpaceUid: this.resolveSpaceUid.bind(this),
      response: this.response.bind(this),
      errorResponse: this.errorResponse.bind(this),
      broadcastToSpace: this.broadcastToSpace,
    };
  }

  rememberContinuityIdentity(client: ClientSession): string {
    const continuityClientId = this.resolveContinuityClientId(client);
    this.continuityIdentityByClientSession.set(client.id, continuityClientId);
    return continuityClientId;
  }
  trackClientSpace(client: ClientSession, spaceId: string): void {
    const normalizedSpaceId = spaceId.trim();
    if (!normalizedSpaceId) return;
    let spaces = this.activeSpacesByClientSession.get(client.id);
    if (!spaces) {
      spaces = new Set<string>();
      this.activeSpacesByClientSession.set(client.id, spaces);
    }
    spaces.add(normalizedSpaceId);
  }

  private resolveContinuityClientId(client: ClientSession): string {
    const principalId = normalizeString(client.publicKey);
    if (principalId) return `principal:${principalId}`;
    const deviceId = normalizeString(client.deviceId);
    if (deviceId) return `device:${deviceId}`;
    return `session:${client.id}`;
  }
  private async touchContinuitySession(client: ClientSession, spaceId: string): Promise<void> {
    if (!this.sessionContinuityManager) return;
    const continuityClientId = this.rememberContinuityIdentity(client);
    this.trackClientSpace(client, spaceId);
    await this.sessionContinuityManager.getOrCreate(spaceId, continuityClientId, "session");
  }
  private resolveExecutionOrigin(spaceId: string, principalIdRaw?: string): "owner" | "guest" | "unknown" {
    return determineExecutionOrigin(this.accessControlContext(), spaceId, principalIdRaw);
  }
  private resolveSessionResetPrincipal(client: ClientSession): string {
    return determineSessionResetPrincipal(client);
  }

  private spaceDecorators(): RouterSpaceDecorators {
    return { decorateAssignments: this.decorateAssignments.bind(this), decorateSpaceSummary: this.decorateSpaceSummary.bind(this), decorateSpaceListSummaries: this.decorateSpaceListSummaries.bind(this), resolveSpaceId: this.resolveSpaceId.bind(this), resolveSpaceUid: this.resolveSpaceUid.bind(this) };
  }
  private decorateAssignments(spaceId: string, assignments: SpaceAssignmentSummary[]): SpaceAssignmentSummary[] {
    if (!this.spaceMcpService || assignments.length === 0) return assignments;
    const bindings = this.spaceMcpService.listBindings(spaceId);
    if (bindings.length === 0) return assignments;
    const bindingsByAgentId = new Map(bindings.map((binding) => [binding.agentId, binding]));
    return assignments.map((assignment) => {
      const binding = bindingsByAgentId.get(assignment.agentId);
      return binding ? { ...assignment, runtimeKind: "external_mcp", endpointId: binding.endpointId, remoteAgentId: binding.remoteAgentId, displayName: binding.displayName } : assignment;
    });
  }
  private async decorateSpaceSummary(space: SpaceSummary): Promise<SpaceSummary> {
    let decorated: SpaceSummary = { ...space, agents: this.decorateAssignments(space.id, space.agents) };
    if (this.spaceMemoryPolicyService) {
      decorated = {
        ...decorated,
        thinkingCapturePolicy: this.spaceMemoryPolicyService.getThinkingCapturePolicy(space.id),
        memoryPolicy: this.spaceMemoryPolicyService.getSpaceMemoryPolicy(space.id),
      };
    }
    if (!this.spaceWorkspaceService) return decorated;
    return { ...decorated, workspace: await this.spaceWorkspaceService.ensureWorkspace(space.id) };
  }
  private async decorateSpaceListSummaries(spaces: SpaceSummary[]): Promise<SpaceSummary[]> {
    return Promise.all(spaces.map((space) => this.decorateSpaceSummary(space)));
  }
  private cacheSpaceIdentity(spaceIdRaw: string, spaceUidRaw: string): void {
    const spaceId = normalizeString(spaceIdRaw);
    const spaceUid = normalizeUuid(spaceUidRaw) || normalizeString(spaceUidRaw);
    if (!spaceId || !spaceUid) return;
    this.spaceUidBySpaceId.set(spaceId, spaceUid);
    this.spaceIdBySpaceUid.set(spaceUid.toLowerCase(), spaceId);
  }
  private async resolveSpaceId(spaceUidRaw: string): Promise<string | null> {
    const spaceUid = normalizeUuid(spaceUidRaw) || normalizeString(spaceUidRaw);
    if (!spaceUid) return null;
    const cached = this.spaceIdBySpaceUid.get(spaceUid.toLowerCase());
    if (cached) return cached;
    if (!this.spaceAdminService) return spaceUid;
    try {
      const direct = await this.spaceAdminService.getSpace(spaceUid);
      if (direct) {
        this.cacheSpaceIdentity(direct.id, direct.spaceUid ?? spaceUid);
        return direct.id;
      }
    } catch {}
    try {
      const matched = (await this.spaceAdminService.listSpaces({ limit: 2_000 })).find((space) => (normalizeUuid(space.spaceUid) || normalizeString(space.spaceUid))?.toLowerCase() === spaceUid.toLowerCase());
      if (matched) {
        this.cacheSpaceIdentity(matched.id, matched.spaceUid);
        return matched.id;
      }
    } catch {}
    return null;
  }
  private async resolveSpaceUid(spaceIdRaw: string): Promise<string> {
    const spaceId = spaceIdRaw.trim();
    if (!spaceId) return deterministicUuid("unknown-space", "spaceskit.space.uuid");
    const cached = this.spaceUidBySpaceId.get(spaceId);
    if (cached) return cached;
    const fallback = deterministicUuid(spaceId, "spaceskit.space.uuid");
    if (!this.spaceAdminService || typeof this.spaceAdminService.getSpace !== "function") {
      this.cacheSpaceIdentity(spaceId, fallback);
      return fallback;
    }
    try {
      const spaceUid = normalizeUuid((await this.spaceAdminService.getSpace(spaceId))?.spaceUid);
      if (spaceUid) {
        this.cacheSpaceIdentity(spaceId, spaceUid);
        return spaceUid;
      }
    } catch {
      this.cacheSpaceIdentity(spaceId, fallback);
      return fallback;
    }
    this.cacheSpaceIdentity(spaceId, fallback);
    return fallback;
  }

  response(replyTo: string, type: string, payload: unknown): GatewayMessage {
    return { type, id: randomUUID(), replyTo, ts: new Date().toISOString(), payload };
  }
  errorResponse(replyTo: string, code: string, message: string, details?: unknown, retryable?: boolean): GatewayMessage {
    return { type: MessageTypes.ERROR, id: randomUUID(), replyTo, ts: new Date().toISOString(), payload: buildGatewayErrorPayload(code, message, replyTo, details, retryable) satisfies ErrorPayload };
  }
}
