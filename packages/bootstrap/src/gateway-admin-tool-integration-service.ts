import { randomUUID } from "node:crypto";
import type { IntegrationRequestRepository } from "@spaceskit/persistence";
import type {
  GatewayCreateIntegrationRequestPayload,
  GatewayCreateIntegrationRequestResponsePayload,
  GatewayGetToolResponsePayload,
  GatewayListIntegrationRequestsPayload,
  GatewayListIntegrationRequestsResponsePayload,
  GatewayListInterconnectorsPayload,
  GatewayListInterconnectorsResponsePayload,
  GatewayListToolApprovalGrantsPayload,
  GatewayListToolApprovalGrantsResponsePayload,
  GatewayListToolsPayload,
  GatewayListToolsResponsePayload,
  GatewayRegisterToolPayload,
  GatewayRegisterToolResponsePayload,
  GatewayRemoveToolResponsePayload,
  GatewayRescanInterconnectorsPayload,
  GatewayRescanInterconnectorsResponsePayload,
  GatewayRevokeToolApprovalGrantPayload,
  GatewayRevokeToolApprovalGrantResponsePayload,
  GatewayScaffoldToolPayload,
  GatewayScaffoldToolResponsePayload,
  GatewaySetToolEnabledPayload,
  GatewaySetToolEnabledResponsePayload,
} from "@spaceskit/server";
import type { AccessGrantService } from "./services/access-grant-service.js";
import type { CliToolService } from "./services/cli-tool-service.js";
import type { InterconnectorCatalogService } from "./services/interconnector-catalog-service.js";
import type { ToolApprovalGrantService } from "./services/tool-approval-grant-service.js";
import {
  mapIntegrationRequestRow,
  normalizeIntegrationClass,
} from "./gateway-admin-model-normalizers.js";
import { asString } from "./gateway-admin-value-normalizers.js";

export interface GatewayAdminToolIntegrationServiceOptions {
  cliToolService?: CliToolService;
  interconnectorCatalogService?: InterconnectorCatalogService;
  accessGrantService?: AccessGrantService;
  toolApprovalGrantService?: ToolApprovalGrantService;
  integrationRequestRepo?: IntegrationRequestRepository;
}

export class GatewayAdminToolIntegrationService {
  constructor(private readonly options: GatewayAdminToolIntegrationServiceOptions) {}

  listTools(_input: GatewayListToolsPayload = {}): GatewayListToolsResponsePayload["tools"] {
    return this.options.cliToolService?.listTools() ?? [];
  }

  getTool(toolId: string): GatewayGetToolResponsePayload["tool"] {
    return this.options.cliToolService?.getTool(toolId) ?? null;
  }

  listInterconnectors(
    _input: GatewayListInterconnectorsPayload = {},
  ): GatewayListInterconnectorsResponsePayload["interconnectors"] {
    return this.options.interconnectorCatalogService?.listBundles() ?? [];
  }

  async rescanInterconnectors(
    _input: GatewayRescanInterconnectorsPayload = {},
  ): Promise<GatewayRescanInterconnectorsResponsePayload["interconnectors"]> {
    if (!this.options.interconnectorCatalogService) {
      return [];
    }
    const result = await this.options.interconnectorCatalogService.rescan();
    return result.interconnectors;
  }

  scaffoldTool(input: GatewayScaffoldToolPayload): GatewayScaffoldToolResponsePayload {
    const cliToolService = this.requireCliToolService();
    return cliToolService.scaffoldTool({
      id: input.id,
      displayName: input.displayName,
      description: input.description,
      outputMode: input.outputMode,
    });
  }

  async registerTool(
    input: GatewayRegisterToolPayload,
  ): Promise<GatewayRegisterToolResponsePayload["tool"]> {
    const cliToolService = this.requireCliToolService();
    return cliToolService.registerTool({
      schemaVersion: input.schemaVersion,
      id: input.id,
      displayName: input.displayName,
      description: input.description,
      bundleId: input.bundleId,
      bundleDisplayName: input.bundleDisplayName,
      bundleDescription: input.bundleDescription,
      toolGroupId: input.toolGroupId,
      toolGroupDisplayName: input.toolGroupDisplayName,
      executable: input.executable,
      argsTemplate: input.argsTemplate,
      inputSchema: input.inputSchema,
      instructions: input.instructions,
      examples: input.examples,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      cwdMode: input.cwdMode,
      fixedCwd: input.fixedCwd,
      outputMode: input.outputMode,
      dangerLevel: input.dangerLevel,
      readme: input.readme,
      enabled: input.enabled,
    });
  }

  async removeTool(toolId: string): Promise<GatewayRemoveToolResponsePayload> {
    const cliToolService = this.requireCliToolService();
    const removed = await cliToolService.removeTool(toolId);
    return {
      toolId,
      removed,
    };
  }

  async setToolEnabled(
    input: GatewaySetToolEnabledPayload,
  ): Promise<GatewaySetToolEnabledResponsePayload> {
    const cliToolService = this.requireCliToolService();
    return {
      tools: await cliToolService.setToolEnabled(input.toolId, input.enabled),
    };
  }

  listToolApprovalGrants(
    input: GatewayListToolApprovalGrantsPayload,
    principalId: string,
    deviceId?: string,
  ): GatewayListToolApprovalGrantsResponsePayload["grants"] {
    const toolApprovalGrantService = this.requireToolApprovalGrantService();
    return toolApprovalGrantService.listGrants({
      principalId,
      deviceId: asString(input.deviceId) ?? deviceId,
      spaceId: asString(input.spaceId),
      toolId: asString(input.toolId),
      includeExpired: input.includeExpired,
      includeRevoked: input.includeRevoked,
    });
  }

  revokeToolApprovalGrant(
    input: GatewayRevokeToolApprovalGrantPayload,
    principalId: string,
    deviceId?: string,
  ): GatewayRevokeToolApprovalGrantResponsePayload {
    const toolApprovalGrantService = this.requireToolApprovalGrantService();
    const resolvedDeviceId = asString(input.deviceId) ?? deviceId;
    const result = toolApprovalGrantService.revokeGrant({
      principalId,
      deviceId: resolvedDeviceId,
      spaceId: input.spaceId,
      toolId: input.toolId,
      reason: input.reason,
    });
    this.options.accessGrantService?.revokeAccess({
      principalId,
      deviceId: resolvedDeviceId,
      spaceId: input.spaceId,
      targetKind: "tool_selector",
      targetId: `tool_operation:${input.toolId}`,
      reason: input.reason ?? `Revoked tool approval for ${input.toolId}.`,
    });
    return result;
  }

  createIntegrationRequest(
    input: GatewayCreateIntegrationRequestPayload,
    principalId?: string,
    deviceId?: string,
  ): GatewayCreateIntegrationRequestResponsePayload["request"] {
    if (!this.options.integrationRequestRepo) {
      throw new Error("Integration request repository unavailable");
    }
    const requestedName = input.requestedName?.trim();
    if (!requestedName) {
      throw new Error("requestedName is required");
    }
    const integrationClass = normalizeIntegrationClass(input.integrationClass);
    if (!integrationClass) {
      throw new Error("integrationClass is required");
    }
    const row = this.options.integrationRequestRepo.create({
      integrationRequestId: randomUUID(),
      integrationClass,
      requestedName,
      useCase: input.useCase?.trim(),
      sourceUrl: input.sourceURL?.trim(),
      notes: input.notes?.trim(),
      principalId: principalId?.trim(),
      deviceId: deviceId?.trim(),
    });
    return mapIntegrationRequestRow(row);
  }

  listIntegrationRequests(
    input?: GatewayListIntegrationRequestsPayload,
  ): GatewayListIntegrationRequestsResponsePayload["requests"] {
    if (!this.options.integrationRequestRepo) {
      return [];
    }
    const integrationClass = normalizeIntegrationClass(input?.integrationClass);
    return this.options.integrationRequestRepo
      .list(input?.limit, integrationClass)
      .map((row) => mapIntegrationRequestRow(row));
  }

  private requireCliToolService(): CliToolService {
    if (!this.options.cliToolService) {
      throw new Error("CLI tool service unavailable");
    }
    return this.options.cliToolService;
  }

  private requireToolApprovalGrantService(): ToolApprovalGrantService {
    if (!this.options.toolApprovalGrantService) {
      throw new Error("Tool approval grant service unavailable");
    }
    return this.options.toolApprovalGrantService;
  }
}
