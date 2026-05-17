import type {
  ConnectorBindingRow,
  ConnectorFamilyRow,
  ConnectorInstanceRow,
  ConnectorPolicyRow,
} from "@spaceskit/persistence";
import { isCapabilityType, type ConnectorAction } from "@spaceskit/core";
import {
  VALID_ACTIONS,
  policyDisabled,
  safeParseObject,
  safeParseStringArray,
} from "./connector-admin-normalizers.js";
import type {
  ConnectorBindingRecord,
  ConnectorFamilyRecord,
  ConnectorInstanceRecord,
  ConnectorPolicyRecord,
} from "./connector-admin-service-types.js";

export function mapConnectorFamilyRow(row: ConnectorFamilyRow): ConnectorFamilyRecord {
  return {
    familyId: row.family_id,
    displayName: row.display_name,
    kind: row.kind,
    runtime: row.runtime,
    trustClass: row.trust_class,
    embeddedEnabled: row.embedded_enabled === 1,
    capabilityTypes: safeParseStringArray(row.capability_types_json)
      .filter((entry) => isCapabilityType(entry)),
    features: safeParseObject(row.features_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapConnectorInstanceRow(row: ConnectorInstanceRow): ConnectorInstanceRecord {
  return {
    connectorId: row.connector_id,
    familyId: row.family_id,
    displayName: row.display_name,
    accountFingerprintHash: row.account_fingerprint_hash,
    labelSlug: row.label_slug,
    status: row.status,
    metadata: safeParseObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapConnectorBindingRow(row: ConnectorBindingRow): ConnectorBindingRecord {
  return {
    bindingId: row.binding_id,
    connectorId: row.connector_id,
    bindingType: row.binding_type,
    selector: safeParseObject(row.selector_json),
    targetType: row.target_type,
    targetSpaceId: row.target_space_id || undefined,
    allowedActions: safeParseStringArray(row.allowed_actions_json)
      .filter((entry): entry is ConnectorAction => VALID_ACTIONS.has(entry as ConnectorAction)),
    capabilityTypes: safeParseStringArray(row.capability_types_json)
      .filter((entry) => isCapabilityType(entry)),
    priority: row.priority,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapConnectorPolicyRow(row: ConnectorPolicyRow): ConnectorPolicyRecord {
  return {
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    requestsPerMinute: row.requests_per_minute,
    burst: row.burst,
    disabled: policyDisabled(row),
    disableReason: row.disable_reason || undefined,
    disabledUntil: row.disabled_until || undefined,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

