import { randomUUID } from "node:crypto";
import type { ConnectorPolicyRow } from "@spaceskit/persistence";
import type { ConnectorAction } from "@spaceskit/core";
import {
  ConnectorAdminError,
  normalizeActions,
  normalizeBindingType,
  normalizeCapabilityTypes,
  normalizeConnectorId,
  normalizePriority,
  normalizeRequired,
  normalizeScopeType,
  normalizeSelector,
  normalizeStatus,
  normalizeTargetType,
  policyDisabled,
  sha256,
  slugify,
  stableJson,
  validateSelectorKeysForFamily,
} from "./connector-admin-normalizers.js";
import {
  assertConnectorFamilyAllowedByProfile,
  assertConnectorFamilyRolloutEnabled,
  seedDefaultConnectorFamilies,
} from "./connector-admin-family-rollout.js";
import {
  consumeConnectorRateToken,
  resolveEffectiveConnectorPolicy,
  type ConnectorTokenBucket,
} from "./connector-admin-policy-runtime.js";
import {
  mapConnectorBindingRow,
  mapConnectorFamilyRow,
  mapConnectorInstanceRow,
  mapConnectorPolicyRow,
} from "./connector-admin-service-mappers.js";
import {
  enforceConnectorOutbound,
  resolveConnectorInboundRoute,
} from "./connector-admin-routing.js";
import type {
  ConnectorAdminServiceOptions,
  ConnectorBindingRecord,
  ConnectorBindingTarget,
  ConnectorFamilyRecord,
  ConnectorInstanceRecord,
  ConnectorPolicyRecord,
  EnforceOutboundInput,
  EnforceOutboundResult,
  GetConnectorPolicyInput,
  ListConnectorsInput,
  ResolveInboundRouteInput,
  ResolveInboundRouteResult,
  UpdateConnectorPolicyInput,
  UpsertConnectorBindingInput,
  UpsertConnectorInput,
} from "./connector-admin-service-types.js";

export { ConnectorAdminError } from "./connector-admin-normalizers.js";
export type {
  ConnectorAdminServiceOptions,
  ConnectorBindingRecord,
  ConnectorBindingTarget,
  ConnectorBindingType,
  ConnectorFamilyRecord,
  ConnectorInstanceRecord,
  ConnectorInstanceStatus,
  ConnectorKind,
  ConnectorPolicyRecord,
  ConnectorRuntime,
  ConnectorSecretRefInput,
  ConnectorTrustClass,
  EnforceOutboundInput,
  EnforceOutboundResult,
  GetConnectorPolicyInput,
  ListConnectorsInput,
  ResolveInboundRouteInput,
  ResolveInboundRouteResult,
  UpdateConnectorPolicyInput,
  UpsertConnectorBindingInput,
  UpsertConnectorInput,
} from "./connector-admin-service-types.js";

export class ConnectorAdminService {
  private readonly buckets = new Map<string, ConnectorTokenBucket>();

  constructor(private readonly options: ConnectorAdminServiceOptions) {
    seedDefaultConnectorFamilies(options);
  }

  listConnectorFamilies(): ConnectorFamilyRecord[] {
    return this.options.familyRepo.list().map((row) => mapConnectorFamilyRow(row));
  }

  listConnectors(input: ListConnectorsInput = {}): ConnectorInstanceRecord[] {
    const rows = this.options.instanceRepo.list(input.familyId?.trim() || undefined);
    return rows.map((row) => mapConnectorInstanceRow(row));
  }

  upsertConnector(input: UpsertConnectorInput): ConnectorInstanceRecord {
    const familyId = normalizeRequired(input.familyId, "familyId");
    const family = this.options.familyRepo.get(familyId);
    if (!family) {
      throw new ConnectorAdminError("NOT_FOUND", `Connector family not found: ${familyId}`);
    }
      assertConnectorFamilyAllowedByProfile(this.options, family);
      assertConnectorFamilyRolloutEnabled(this.options, family);

    const accountFingerprint = normalizeRequired(input.accountFingerprint, "accountFingerprint");
    const labelSlug = slugify(normalizeRequired(input.label, "label"));
    if (!labelSlug) {
      throw new ConnectorAdminError("INVALID_ARGUMENT", "label resolves to an empty slug");
    }

    const connectorId = input.connectorId?.trim()
      ? normalizeConnectorId(input.connectorId)
      : this.buildConnectorId(familyId, accountFingerprint, labelSlug);

    if (!connectorId.startsWith(`${familyId}:`)) {
      throw new ConnectorAdminError(
        "INVALID_ARGUMENT",
        `connectorId must start with "${familyId}:"`,
      );
    }

    const existing = this.options.instanceRepo.get(connectorId);
    if (existing) {
      if (existing.family_id !== familyId) {
        throw new ConnectorAdminError(
          "FAILED_PRECONDITION",
          "connectorId is immutable and bound to a single familyId",
        );
      }
      if (existing.account_fingerprint_hash !== sha256(accountFingerprint)) {
        throw new ConnectorAdminError(
          "FAILED_PRECONDITION",
          "connectorId is immutable and bound to the original account fingerprint",
        );
      }
      if (existing.label_slug !== labelSlug) {
        throw new ConnectorAdminError(
          "FAILED_PRECONDITION",
          "connectorId is immutable and bound to the original label slug",
        );
      }
    }

    const status = normalizeStatus(input.status ?? "active");
    const row = this.options.instanceRepo.upsert({
      connectorId,
      familyId,
      displayName: normalizeRequired(input.displayName, "displayName"),
      accountFingerprintHash: sha256(accountFingerprint),
      labelSlug,
      status,
      metadata: input.metadata ?? {},
    });

    for (const ref of input.secretRefs ?? []) {
      const key = normalizeRequired(ref.key, "secretRefs[].key");
      const secretRef = normalizeRequired(ref.ref, "secretRefs[].ref");
      const backend = ref.backend?.trim() || this.defaultSecretBackend();
      this.options.secretRefRepo.upsert({
        connectorId,
        secretKey: key,
        secretRef,
        backend,
      });
    }

    return mapConnectorInstanceRow(row);
  }

  removeConnector(connectorIdRaw: string): { removed: boolean } {
    const connectorId = normalizeRequired(connectorIdRaw, "connectorId");
    this.options.secretRefRepo.deleteAllForConnector(connectorId);
    return {
      removed: this.options.instanceRepo.delete(connectorId),
    };
  }

  listConnectorBindings(input?: { connectorId?: string }): ConnectorBindingRecord[] {
    const connectorId = input?.connectorId?.trim();
    const rows = connectorId
      ? this.options.bindingRepo.listByConnector(connectorId)
      : this.options.bindingRepo.listAll();
    return rows.map((row) => mapConnectorBindingRow(row));
  }

  upsertConnectorBinding(input: UpsertConnectorBindingInput): ConnectorBindingRecord {
    const connectorId = normalizeRequired(input.connectorId, "connectorId");
    const connector = this.options.instanceRepo.get(connectorId);
    if (!connector) {
      throw new ConnectorAdminError("NOT_FOUND", `Connector not found: ${connectorId}`);
    }

    const bindingType = normalizeBindingType(input.bindingType);
    const targetType = normalizeTargetType(input.targetType);

    const selector = normalizeSelector(input.selector);
    validateSelectorKeysForFamily(connector.family_id, bindingType, selector);
    const selectorJson = stableJson(selector);
    const selectorHash = sha256(selectorJson);

    const allowedActions = normalizeActions(input.allowedActions ?? []);
    // Keep send_message last when present so downstream policy checks remain deterministic.
    const sanitizedActions: ConnectorAction[] = allowedActions.filter(
      (action): action is Exclude<ConnectorAction, "send_message"> => action !== "send_message",
    );
    if (allowedActions.includes("send_message")) {
      sanitizedActions.push("send_message");
    }

    const capabilityTypes = normalizeCapabilityTypes(input.capabilityTypes ?? []);
    const priority = normalizePriority(input.priority ?? 100);

    const existing = this.options.bindingRepo.listByConnector(connectorId);
    const bindingId = input.bindingId?.trim() || `binding-${randomUUID()}`;
    const collision = existing.find((row) =>
      row.binding_id !== bindingId
      && row.binding_type === bindingType
      && row.selector_hash === selectorHash
      && row.priority === priority,
    );
    if (collision) {
      throw new ConnectorAdminError(
        "FAILED_PRECONDITION",
        "Overlapping selector with same priority already exists for this connector",
      );
    }

    const row = this.options.bindingRepo.upsert({
      bindingId,
      connectorId,
      bindingType,
      selectorJson,
      selectorHash,
      targetType,
      targetSpaceId: input.targetSpaceId?.trim(),
      allowedActionsJson: JSON.stringify(sanitizedActions),
      capabilityTypesJson: JSON.stringify(capabilityTypes),
      priority,
      enabled: input.enabled ?? true,
    });

    return mapConnectorBindingRow(row);
  }

  removeConnectorBinding(bindingIdRaw: string): { removed: boolean } {
    const bindingId = normalizeRequired(bindingIdRaw, "bindingId");
    return {
      removed: this.options.bindingRepo.delete(bindingId),
    };
  }

  getConnectorPolicy(input: GetConnectorPolicyInput): ConnectorPolicyRecord {
    const scopeType = normalizeScopeType(input.scopeType);
    const scopeId = normalizeRequired(input.scopeId, "scopeId");
    const row = this.options.policyRepo.get(scopeType, scopeId);
    if (!row) {
      if (scopeType === "global" && scopeId === "*") {
        const created = this.options.policyRepo.upsert({
          scopeType,
          scopeId,
          requestsPerMinute: 60,
          burst: 60,
          disabled: false,
          disableReason: "",
          disabledUntil: null,
          updatedBy: "system",
        });
        return mapConnectorPolicyRow(created);
      }
      throw new ConnectorAdminError("NOT_FOUND", `Connector policy not found: ${scopeType}/${scopeId}`);
    }
    return mapConnectorPolicyRow(row);
  }

  listConnectorPolicies(scopeTypeRaw?: string): ConnectorPolicyRecord[] {
    const rows = scopeTypeRaw
      ? this.options.policyRepo.list(normalizeScopeType(scopeTypeRaw))
      : this.options.policyRepo.list();
    return rows.map((row) => mapConnectorPolicyRow(row));
  }

  updateConnectorPolicy(input: UpdateConnectorPolicyInput): ConnectorPolicyRecord {
    const scopeType = normalizeScopeType(input.scopeType);
    const scopeId = normalizeRequired(input.scopeId, "scopeId");

    const current = this.options.policyRepo.get(scopeType, scopeId)
      ?? {
        scope_type: scopeType,
        scope_id: scopeId,
        requests_per_minute: 60,
        burst: 60,
        disabled: 0,
        disable_reason: "",
        disabled_until: null,
        updated_by: "system",
        updated_at: new Date().toISOString(),
      } satisfies ConnectorPolicyRow;
    const previousDisabled = policyDisabled(current);

    const requestsPerMinute = input.requestsPerMinute ?? current.requests_per_minute;
    const burst = input.burst ?? current.burst;

    if (!Number.isFinite(requestsPerMinute) || requestsPerMinute < 0) {
      throw new ConnectorAdminError("INVALID_ARGUMENT", "requestsPerMinute must be >= 0");
    }
    if (!Number.isFinite(burst) || burst < 0) {
      throw new ConnectorAdminError("INVALID_ARGUMENT", "burst must be >= 0");
    }

    const row = this.options.policyRepo.upsert({
      scopeType,
      scopeId,
      requestsPerMinute,
      burst,
      disabled: input.disabled ?? current.disabled === 1,
      disableReason: input.disableReason ?? current.disable_reason,
      disabledUntil: input.disabledUntil === undefined ? current.disabled_until : input.disabledUntil,
      updatedBy: normalizeRequired(input.updatedBy, "updatedBy"),
    });
    const mapped = mapConnectorPolicyRow(row);

    this.recordAudit("connector.policy.updated", input.updatedBy, {
      scopeType: mapped.scopeType,
      scopeId: mapped.scopeId,
      requestsPerMinute: mapped.requestsPerMinute,
      burst: mapped.burst,
      disabled: mapped.disabled,
      disableReason: mapped.disableReason ?? null,
      disabledUntil: mapped.disabledUntil ?? null,
    });

    if (previousDisabled !== mapped.disabled) {
      this.recordAudit(
        mapped.disabled ? "connector.policy.disabled" : "connector.policy.reenabled",
        input.updatedBy,
        {
          scopeType: mapped.scopeType,
          scopeId: mapped.scopeId,
          disabled: mapped.disabled,
          disableReason: mapped.disableReason ?? null,
          disabledUntil: mapped.disabledUntil ?? null,
        },
      );
    }

    return mapped;
  }

  resolveInboundRoute(input: ResolveInboundRouteInput): ResolveInboundRouteResult {
    return resolveConnectorInboundRoute(this.routingContext(), input);
  }

  enforceOutbound(input: EnforceOutboundInput): EnforceOutboundResult {
    return enforceConnectorOutbound(this.routingContext(), input);
  }

  testConnector(connectorIdRaw: string): {
    ok: boolean;
    connector?: ConnectorInstanceRecord;
    inboundRoute?: ResolveInboundRouteResult;
    policy?: ConnectorPolicyRecord;
    reason?: string;
  } {
    const connectorId = normalizeRequired(connectorIdRaw, "connectorId");
    const connector = this.options.instanceRepo.get(connectorId);
    if (!connector) {
      return { ok: false, reason: `Connector not found: ${connectorId}` };
    }

    try {
      const family = this.options.familyRepo.get(connector.family_id);
      if (!family) {
        return { ok: false, reason: `Connector family missing: ${connector.family_id}` };
      }
      assertConnectorFamilyAllowedByProfile(this.options, family);
      assertConnectorFamilyRolloutEnabled(this.options, family);
      const inboundRoute = this.resolveInboundRoute({ connectorId, selector: {} });
      const policy = this.resolveEffectivePolicy(connector.family_id, connectorId);
      return {
        ok: true,
        connector: mapConnectorInstanceRow(connector),
        inboundRoute,
        policy,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: message };
    }
  }

  private buildConnectorId(
    familyId: string,
    accountFingerprint: string,
    labelSlug: string,
  ): string {
    const accountHash = sha256(accountFingerprint).slice(0, 8);
    return `${familyId}:acct_${accountHash}:${labelSlug}`;
  }

  private defaultSecretBackend(): string {
    return this.options.gatewayProfile === "embedded" ? "native_adapter" : "env_ref";
  }

  private resolveEffectivePolicy(familyId: string, connectorId: string): ConnectorPolicyRecord {
    return resolveEffectiveConnectorPolicy(this.options.policyRepo, familyId, connectorId);
  }

  private routingContext() {
    return {
      options: this.options,
      enforceConnectorEnabled: (familyId: string, connectorId: string) =>
        this.enforceConnectorEnabled(familyId, connectorId),
      resolveEffectivePolicy: (familyId: string, connectorId: string) =>
        this.resolveEffectivePolicy(familyId, connectorId),
      consumeRateToken: (key: string, requestsPerMinute: number, burst: number) =>
        this.consumeRateToken(key, requestsPerMinute, burst),
      recordAudit: (eventType: string, actor: string, payload: Record<string, unknown>) =>
        this.recordAudit(eventType, actor, payload),
    };
  }

  private enforceConnectorEnabled(
    familyId: string,
    connectorId: string,
  ): EnforceOutboundResult {
    const policy = this.resolveEffectivePolicy(familyId, connectorId);
    if (policy.disabled) {
      return {
        allowed: false,
        reason: policy.disableReason || "Connector disabled by policy",
      };
    }

    return { allowed: true };
  }

  private consumeRateToken(
    key: string,
    requestsPerMinute: number,
    burst: number,
  ): boolean {
    return consumeConnectorRateToken(this.buckets, key, requestsPerMinute, burst);
  }

  private recordAudit(
    eventType: string,
    actor: string,
    payload: Record<string, unknown>,
    spaceId = this.options.defaultTargetSpaceId,
  ): void {
    try {
      if (this.options.auditRepo) {
        this.options.auditRepo.create({
          auditEventId: `audit-${randomUUID()}`,
          eventType,
          actor,
          spaceId,
          payload,
        });
      } else {
        this.options.logger.info("connector audit", { eventType, actor, spaceId, ...payload });
      }
    } catch (err) {
      this.options.logger.warn("Failed to persist connector audit event", {
        eventType,
        actor,
        spaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
