// Database initialization
export { initDatabase } from "./database.js";
export type { DatabaseManager, DatabaseOptions, GenerationResetInfo } from "./database.js";

// Schema
export { migrations, seedStatements } from "./schema.js";
export type { Migration } from "./schema.js";

// Repositories
export { SpaceRepository } from "./repositories/spaces.js";
export type { SpaceRow, CreateSpaceInput, ListSpacesOptions } from "./repositories/spaces.js";

export { SpaceAgentAssignmentRepository } from "./repositories/space-agent-assignments.js";
export type {
  SpaceAgentAssignmentRow,
  UpsertSpaceAgentAssignmentInput,
} from "./repositories/space-agent-assignments.js";

export { SpaceSkillRepository } from "./repositories/space-skills.js";
export type {
  SpaceSkillRow,
  UpsertSpaceSkillInput,
} from "./repositories/space-skills.js";

export { SpaceResourceRepository } from "./repositories/space-resources.js";
export type {
  SpaceResourceRow,
  SpaceResourceType,
  UpsertSpaceResourceInput,
} from "./repositories/space-resources.js";

export { SpaceWorkspaceRepository } from "./repositories/space-workspaces.js";
export type {
  SpaceWorkspaceRow,
  UpsertSpaceWorkspaceInput,
} from "./repositories/space-workspaces.js";

export { SpaceMcpEndpointRepository } from "./repositories/space-mcp-endpoints.js";
export type {
  SpaceMcpTransport,
  SpaceMcpEndpointHealth,
  SpaceMcpEndpointRow,
  UpsertSpaceMcpEndpointInput,
  UpdateSpaceMcpEndpointHealthInput,
} from "./repositories/space-mcp-endpoints.js";

export { SpaceExternalAgentBindingRepository } from "./repositories/space-external-agent-bindings.js";
export type {
  SpaceExternalAgentBindingRow,
  UpsertSpaceExternalAgentBindingInput,
} from "./repositories/space-external-agent-bindings.js";

export { IdempotencyRepository } from "./repositories/idempotency.js";
export type { IdempotencyRecordRow, CreateIdempotencyRecordInput } from "./repositories/idempotency.js";

export { GatewayPolicyRepository } from "./repositories/gateway-policy.js";
export type { GatewayPolicyRow, SetGatewayPolicyInput } from "./repositories/gateway-policy.js";

export { AuditEventsRepository } from "./repositories/audit-events.js";
export type { AuditEventRow, CreateAuditEventInput } from "./repositories/audit-events.js";

export { ConnectorFamilyRepository } from "./repositories/connector-families.js";
export type {
  ConnectorKind,
  ConnectorRuntime,
  ConnectorTrustClass,
  ConnectorFamilyRow,
  UpsertConnectorFamilyInput,
} from "./repositories/connector-families.js";

export { ConnectorInstanceRepository } from "./repositories/connector-instances.js";
export type {
  ConnectorInstanceStatus,
  ConnectorInstanceRow,
  UpsertConnectorInstanceInput,
} from "./repositories/connector-instances.js";

export { ConnectorBindingRepository } from "./repositories/connector-bindings.js";
export type {
  ConnectorBindingType,
  ConnectorBindingTarget,
  ConnectorBindingRow,
  UpsertConnectorBindingInput,
} from "./repositories/connector-bindings.js";

export { ConnectorPolicyRepository } from "./repositories/connector-policy.js";
export type {
  ConnectorPolicyScopeType,
  ConnectorPolicyRow,
  UpsertConnectorPolicyInput,
} from "./repositories/connector-policy.js";

export { ConnectorSecretRefRepository } from "./repositories/connector-secret-refs.js";
export type {
  ConnectorSecretRefRow,
  UpsertConnectorSecretRefInput,
} from "./repositories/connector-secret-refs.js";

export { ProviderSecretRefRepository } from "./repositories/provider-secret-refs.js";
export type {
  ProviderSecretRefRow,
  UpsertProviderSecretRefInput,
} from "./repositories/provider-secret-refs.js";

export { ProviderConfigRepository } from "./repositories/provider-configs.js";
export type {
  ProviderConfigRow,
  UpsertProviderConfigInput,
} from "./repositories/provider-configs.js";

export { KnowledgeBaseEntryRepository } from "./repositories/knowledge-base.js";
export type {
  KnowledgeBaseEntryKind,
  KnowledgeBaseEntryScopeType,
  KnowledgeBaseEntryRow,
  UpsertKnowledgeBaseEntryInput,
  ListKnowledgeBaseEntriesQuery,
} from "./repositories/knowledge-base.js";

export { GatewayCapabilityGrantRepository } from "./repositories/gateway-capability-grants.js";
export type {
  GatewayCapabilityGrantLevel,
  GatewayCapabilityGrantRow,
  UpsertGatewayCapabilityGrantInput,
  RevokeGatewayCapabilityGrantInput,
  ListGatewayCapabilityGrantsQuery,
  ListEffectiveGatewayCapabilityGrantsQuery,
} from "./repositories/gateway-capability-grants.js";
export { GLOBAL_SCOPE } from "./repositories/gateway-capability-grants.js";

export { GatewayLinkedSkillIndexRepository } from "./repositories/gateway-linked-skill-index.js";
export type {
  GatewayLinkedSkillSyncState,
  GatewayLinkedSkillIndexRow,
  UpsertGatewayLinkedSkillIndexInput,
} from "./repositories/gateway-linked-skill-index.js";

export { AccessGrantRepository } from "./repositories/access-grants.js";
export type {
  AccessGrantMode,
  AccessGrantRow,
  AccessGrantTargetKind,
  UpsertAccessGrantInput,
  RevokeAccessGrantInput,
  ListEffectiveAccessGrantsQuery,
} from "./repositories/access-grants.js";
export { ACCESS_GRANT_GLOBAL_SCOPE } from "./repositories/access-grants.js";

export { ToolApprovalGrantRepository } from "./repositories/tool-approval-grants.js";
export type {
  ToolApprovalGrantMode,
  ToolApprovalGrantRow,
  UpsertToolApprovalGrantInput,
  RevokeToolApprovalGrantInput,
  ListToolApprovalGrantsQuery,
  ListEffectiveToolApprovalGrantsQuery,
} from "./repositories/tool-approval-grants.js";
export { TOOL_APPROVAL_GLOBAL_SCOPE } from "./repositories/tool-approval-grants.js";

export { TurnRepository } from "./repositories/turns.js";
export type { TurnRow, CreateTurnInput, SpaceAgentTurnAggregate } from "./repositories/turns.js";

export { RunRepository } from "./repositories/runs.js";
export type { RunStatus, RunRow, CreateRunInput, UpdateRunStatusInput } from "./repositories/runs.js";

export { RunStepRepository } from "./repositories/run-steps.js";
export type {
  RunStepKind,
  RunStepStatus,
  RunStepRow,
  CreateRunStepInput,
  UpdateRunStepStatusInput,
} from "./repositories/run-steps.js";

export { InvocationRecordRepository } from "./repositories/invocation-records.js";
export type {
  IntegrationClass,
  InvocationRecordStatus,
  InvocationRecordRow,
  CreateInvocationRecordInput,
  UpdateInvocationRecordInput,
} from "./repositories/invocation-records.js";

export { ApprovalRequestRepository } from "./repositories/approval-requests.js";
export type {
  ApprovalRequestStatus,
  ApprovalRequestRow,
  CreateApprovalRequestInput,
} from "./repositories/approval-requests.js";

export { ConciergeEscalationRequestRepository } from "./repositories/concierge-escalation-requests.js";
export type {
  ConciergeEscalationAllowedResponse,
  ConciergeEscalationDeliveryChannel,
  ConciergeEscalationFallbackPolicy,
  ConciergeEscalationRequestRow,
  ConciergeEscalationResponseMode,
  ConciergeEscalationStatus,
  ConciergeEscalationUrgency,
  CreateConciergeEscalationRequestInput,
  UpdateConciergeEscalationRequestInput,
} from "./repositories/concierge-escalation-requests.js";

export { AppleNotificationRepository } from "./repositories/apple-notifications.js";
export type {
  AppleNotificationDeliveryRow,
  AppleNotificationPreferencesRow,
  ApplePushDeviceRegistrationRow,
} from "./repositories/apple-notifications.js";

export { UsageRecordRepository } from "./repositories/usage-records.js";
export type { UsageRecordRow, CreateUsageRecordInput } from "./repositories/usage-records.js";

export { IntegrationRequestRepository } from "./repositories/integration-requests.js";
export type {
  IntegrationRequestStatus,
  IntegrationRequestClass,
  IntegrationRequestRow,
  CreateIntegrationRequestInput,
} from "./repositories/integration-requests.js";

export { EventLogRepository } from "./repositories/event-log.js";
export type { EventLogRow, CreateEventLogInput, ListEventLogQuery } from "./repositories/event-log.js";

export { AgentUsageSessionRepository } from "./repositories/agent-usage-sessions.js";
export type {
  AgentUsageSessionStatus,
  AgentUsageSessionRow,
  EnsureAgentUsageSessionInput,
  ResetAgentUsageSessionInput,
  AgentUsageSessionResetResult,
  UpdateAgentUsageSessionRuntimeMetadataInput,
} from "./repositories/agent-usage-sessions.js";

export { UsageAnalyticsRepository } from "./repositories/usage-analytics.js";
export type { AgentTokenAggregate, TokenAggregate, ProviderTokenAggregate } from "./repositories/usage-analytics.js";


export * from "./index-extended-repositories.js";
