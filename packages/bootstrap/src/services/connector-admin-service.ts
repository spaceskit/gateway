import { randomUUID } from "node:crypto";
import type { Logger } from "@spaceskit/observability";
import {
  AuditEventsRepository,
  ConnectorBindingRepository,
  type ConnectorBindingRow,
  ConnectorFamilyRepository,
  type ConnectorFamilyRow,
  ConnectorInstanceRepository,
  type ConnectorInstanceRow,
  ConnectorPolicyRepository,
  type ConnectorPolicyRow,
  ConnectorSecretRefRepository,
  type ConnectorPolicyScopeType,
} from "@spaceskit/persistence";
import { isCapabilityType, type CapabilityType, type ConnectorAction } from "@spaceskit/core";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import {
  ConnectorAdminError,
  VALID_ACTIONS,
  normalizeAction,
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
  safeParseObject,
  safeParseStringArray,
  selectorMatchScore,
  serializeSelectorSchemasForFamily,
  sha256,
  slugify,
  stableJson,
  validateSelectorKeysForFamily,
} from "./connector-admin-normalizers.js";

export { ConnectorAdminError } from "./connector-admin-normalizers.js";

export type ConnectorKind = "channel" | "capability" | "hybrid";
export type ConnectorRuntime = "adapter" | "connector" | "builtin";
export type ConnectorTrustClass = "embedded_safe" | "external_only";
export type ConnectorInstanceStatus = "active" | "paused" | "error";
export type ConnectorBindingType = "inbound_route" | "outbound_action" | "capability_export";
export type ConnectorBindingTarget = "main_orchestrator" | "space_orchestrator";

export interface ConnectorFamilyRecord {
  familyId: string;
  displayName: string;
  kind: ConnectorKind;
  runtime: ConnectorRuntime;
  trustClass: ConnectorTrustClass;
  embeddedEnabled: boolean;
  capabilityTypes: CapabilityType[];
  features: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorInstanceRecord {
  connectorId: string;
  familyId: string;
  displayName: string;
  accountFingerprintHash: string;
  labelSlug: string;
  status: ConnectorInstanceStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorBindingRecord {
  bindingId: string;
  connectorId: string;
  bindingType: ConnectorBindingType;
  selector: Record<string, unknown>;
  targetType: ConnectorBindingTarget;
  targetSpaceId?: string;
  allowedActions: ConnectorAction[];
  capabilityTypes: CapabilityType[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorPolicyRecord {
  scopeType: ConnectorPolicyScopeType;
  scopeId: string;
  requestsPerMinute: number;
  burst: number;
  disabled: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ConnectorSecretRefInput {
  key: string;
  ref: string;
  backend?: string;
}

export interface UpsertConnectorInput {
  connectorId?: string;
  familyId: string;
  displayName: string;
  accountFingerprint: string;
  label: string;
  status?: ConnectorInstanceStatus;
  metadata?: Record<string, unknown>;
  secretRefs?: ConnectorSecretRefInput[];
}

export interface ListConnectorsInput {
  familyId?: string;
}

export interface UpsertConnectorBindingInput {
  bindingId?: string;
  connectorId: string;
  bindingType: ConnectorBindingType;
  selector?: Record<string, unknown>;
  targetType: ConnectorBindingTarget;
  targetSpaceId?: string;
  allowedActions?: ConnectorAction[];
  capabilityTypes?: string[];
  priority?: number;
  enabled?: boolean;
}

export interface UpdateConnectorPolicyInput {
  scopeType: ConnectorPolicyScopeType;
  scopeId: string;
  requestsPerMinute?: number;
  burst?: number;
  disabled?: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
}

export interface GetConnectorPolicyInput {
  scopeType: string;
  scopeId: string;
}

export interface ResolveInboundRouteInput {
  connectorId: string;
  selector?: Record<string, unknown>;
}

export interface ResolveInboundRouteResult {
  route: "binding" | "main_fallback";
  targetType: ConnectorBindingTarget;
  targetSpaceId?: string;
  bindingId?: string;
  matchedScore?: number;
}

export interface EnforceOutboundInput {
  connectorId: string;
  action: ConnectorAction;
  selector?: Record<string, unknown>;
}

export interface EnforceOutboundResult {
  allowed: boolean;
  reason?: string;
  bindingId?: string;
}

export interface ConnectorAdminServiceOptions {
  logger: Logger;
  gatewayProfile: GatewayCoreProfileId;
  auditRepo?: AuditEventsRepository | null;
  familyRepo: ConnectorFamilyRepository;
  instanceRepo: ConnectorInstanceRepository;
  bindingRepo: ConnectorBindingRepository;
  policyRepo: ConnectorPolicyRepository;
  secretRefRepo: ConnectorSecretRefRepository;
  defaultTargetSpaceId: string;
  enableWhatsappFamily?: boolean;
  enableDiscordFamily?: boolean;
}

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

const DEFAULT_CONNECTOR_FAMILIES: Array<Omit<ConnectorFamilyRecord, "createdAt" | "updatedAt">> = [
  {
    familyId: "apple-calendar-eventkit",
    displayName: "Apple Calendar (EventKit)",
    kind: "capability",
    runtime: "adapter",
    trustClass: "embedded_safe",
    embeddedEnabled: true,
    capabilityTypes: ["calendar"],
    features: { platform: "apple", native: true },
  },
  {
    familyId: "apple-reminders-eventkit",
    displayName: "Apple Reminders (EventKit)",
    kind: "capability",
    runtime: "adapter",
    trustClass: "embedded_safe",
    embeddedEnabled: true,
    capabilityTypes: ["lists"],
    features: { platform: "apple", native: true },
  },
  {
    familyId: "apple-mail-mailkit",
    displayName: "Apple Mail (MailKit)",
    kind: "hybrid",
    runtime: "adapter",
    trustClass: "embedded_safe",
    embeddedEnabled: true,
    capabilityTypes: ["email"],
    features: { platform: "apple", native: true },
  },
  {
    familyId: "apple-contacts-contactsframework",
    displayName: "Apple Contacts (Contacts.framework)",
    kind: "capability",
    runtime: "adapter",
    trustClass: "embedded_safe",
    embeddedEnabled: true,
    capabilityTypes: ["contacts"],
    features: { platform: "apple", native: true },
  },
  {
    familyId: "apple-notifications-usernotifications",
    displayName: "Apple Notifications (UserNotifications)",
    kind: "hybrid",
    runtime: "adapter",
    trustClass: "embedded_safe",
    embeddedEnabled: true,
    capabilityTypes: ["notifications"],
    features: { platform: "apple", native: true },
  },
  {
    familyId: "whatsapp-cloud",
    displayName: "WhatsApp Cloud API",
    kind: "channel",
    runtime: "connector",
    trustClass: "external_only",
    embeddedEnabled: false,
    capabilityTypes: ["messaging", "notifications"],
    features: { channel: "whatsapp", provider: "meta" },
  },
  {
    familyId: "discord-bot",
    displayName: "Discord Bot API",
    kind: "channel",
    runtime: "connector",
    trustClass: "external_only",
    embeddedEnabled: false,
    capabilityTypes: ["messaging", "notifications"],
    features: { channel: "discord" },
  },
];

export class ConnectorAdminService {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly options: ConnectorAdminServiceOptions) {
    this.seedDefaultFamilies();
  }

  listConnectorFamilies(): ConnectorFamilyRecord[] {
    return this.options.familyRepo.list().map((row) => this.mapFamilyRow(row));
  }

  listConnectors(input: ListConnectorsInput = {}): ConnectorInstanceRecord[] {
    const rows = this.options.instanceRepo.list(input.familyId?.trim() || undefined);
    return rows.map((row) => this.mapInstanceRow(row));
  }

  upsertConnector(input: UpsertConnectorInput): ConnectorInstanceRecord {
    const familyId = normalizeRequired(input.familyId, "familyId");
    const family = this.options.familyRepo.get(familyId);
    if (!family) {
      throw new ConnectorAdminError("NOT_FOUND", `Connector family not found: ${familyId}`);
    }
    this.assertFamilyAllowedByProfile(family);
    this.assertFamilyRolloutEnabled(family);

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

    return this.mapInstanceRow(row);
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
    return rows.map((row) => this.mapBindingRow(row));
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

    return this.mapBindingRow(row);
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
        return this.mapPolicyRow(created);
      }
      throw new ConnectorAdminError("NOT_FOUND", `Connector policy not found: ${scopeType}/${scopeId}`);
    }
    return this.mapPolicyRow(row);
  }

  listConnectorPolicies(scopeTypeRaw?: string): ConnectorPolicyRecord[] {
    const rows = scopeTypeRaw
      ? this.options.policyRepo.list(normalizeScopeType(scopeTypeRaw))
      : this.options.policyRepo.list();
    return rows.map((row) => this.mapPolicyRow(row));
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
    const mapped = this.mapPolicyRow(row);

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
    const connectorId = normalizeRequired(input.connectorId, "connectorId");
    const connector = this.options.instanceRepo.get(connectorId);
    if (!connector) {
      throw new ConnectorAdminError("NOT_FOUND", `Connector not found: ${connectorId}`);
    }

    const allowed = this.enforceConnectorEnabled(connector.family_id, connectorId);
    if (!allowed.allowed) {
      throw new ConnectorAdminError("PERMISSION_DENIED", allowed.reason ?? "Connector disabled by policy");
    }

    const selector = input.selector ?? {};
    const bindings = this.options.bindingRepo.listByConnector(connectorId)
      .filter((row) => row.binding_type === "inbound_route" && row.enabled === 1)
      .sort((lhs, rhs) => lhs.priority - rhs.priority);

    let best: { row: ConnectorBindingRow; score: number } | null = null;
    for (const row of bindings) {
      const bindingSelector = safeParseObject(row.selector_json);
      const score = selectorMatchScore(selector, bindingSelector);
      if (score < 0) continue;
      if (!best || score > best.score || (score === best.score && row.priority < best.row.priority)) {
        best = { row, score };
      }
    }

    if (best) {
      return {
        route: "binding",
        targetType: best.row.target_type,
        targetSpaceId: best.row.target_space_id || undefined,
        bindingId: best.row.binding_id,
        matchedScore: best.score,
      };
    }

    return {
      route: "main_fallback",
      targetType: "main_orchestrator",
      targetSpaceId: this.options.defaultTargetSpaceId,
    };
  }

  enforceOutbound(input: EnforceOutboundInput): EnforceOutboundResult {
    const connectorId = normalizeRequired(input.connectorId, "connectorId");
    const action = normalizeAction(input.action);

    const connector = this.options.instanceRepo.get(connectorId);
    if (!connector) {
      throw new ConnectorAdminError("NOT_FOUND", `Connector not found: ${connectorId}`);
    }

    const enabled = this.enforceConnectorEnabled(connector.family_id, connectorId);
    if (!enabled.allowed) {
      this.recordAudit("connector.outbound.denied", `connector:${connectorId}`, {
        connectorId,
        familyId: connector.family_id,
        action,
        reason: enabled.reason ?? "Connector disabled by policy",
      });
      return enabled;
    }

    const policy = this.resolveEffectivePolicy(connector.family_id, connectorId);
    if (!this.consumeRateToken(connectorId, policy.requestsPerMinute, policy.burst)) {
      this.recordAudit("connector.outbound.rate_limited", `connector:${connectorId}`, {
        connectorId,
        familyId: connector.family_id,
        action,
        requestsPerMinute: policy.requestsPerMinute,
        burst: policy.burst,
      });
      throw new ConnectorAdminError("RATE_LIMITED", `Connector rate limit exceeded: ${connectorId}`);
    }

    const selector = input.selector ?? {};
    const outboundBindings = this.options.bindingRepo.listByConnector(connectorId)
      .filter((row) => row.binding_type === "outbound_action" && row.enabled === 1)
      .sort((lhs, rhs) => lhs.priority - rhs.priority);

    for (const row of outboundBindings) {
      const bindingSelector = safeParseObject(row.selector_json);
      if (selectorMatchScore(selector, bindingSelector) < 0) {
        continue;
      }
      const actions = safeParseStringArray(row.allowed_actions_json)
        .filter((entry): entry is ConnectorAction => VALID_ACTIONS.has(entry as ConnectorAction));
      if (!actions.includes(action)) {
        continue;
      }

      this.recordAudit("connector.outbound.allowed", `connector:${connectorId}`, {
        connectorId,
        familyId: connector.family_id,
        action,
        bindingId: row.binding_id,
      });
      return {
        allowed: true,
        bindingId: row.binding_id,
      };
    }

    this.recordAudit("connector.outbound.denied", `connector:${connectorId}`, {
      connectorId,
      familyId: connector.family_id,
      action,
      reason: `Action not allowed by connector binding: ${action}`,
    });
    return {
      allowed: false,
      reason: `Action not allowed by connector binding: ${action}`,
    };
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
      this.assertFamilyAllowedByProfile(family);
      this.assertFamilyRolloutEnabled(family);
      const inboundRoute = this.resolveInboundRoute({ connectorId, selector: {} });
      const policy = this.resolveEffectivePolicy(connector.family_id, connectorId);
      return {
        ok: true,
        connector: this.mapInstanceRow(connector),
        inboundRoute,
        policy,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: message };
    }
  }

  private seedDefaultFamilies(): void {
    for (const family of DEFAULT_CONNECTOR_FAMILIES) {
      const rolloutEnabled = this.isFamilyEnabledByFlag(family.familyId);
      const selectorSchemas = serializeSelectorSchemasForFamily(family.familyId);
      this.options.familyRepo.upsert({
        familyId: family.familyId,
        displayName: family.displayName,
        kind: family.kind,
        runtime: family.runtime,
        trustClass: family.trustClass,
        embeddedEnabled: family.embeddedEnabled,
        capabilityTypes: family.capabilityTypes,
        features: {
          ...family.features,
          rolloutEnabled,
          ...(selectorSchemas ? { selectorSchemas } : {}),
        },
      });
    }
  }

  private assertFamilyAllowedByProfile(row: ConnectorFamilyRow): void {
    if (this.options.gatewayProfile === "external") {
      return;
    }

    if (row.trust_class !== "embedded_safe" || row.embedded_enabled !== 1) {
      throw new ConnectorAdminError(
        "PERMISSION_DENIED",
        `Connector family not allowed in embedded profile: ${row.family_id}`,
      );
    }
  }

  private assertFamilyRolloutEnabled(row: ConnectorFamilyRow): void {
    if (this.isFamilyEnabledByFlag(row.family_id)) {
      return;
    }
    throw new ConnectorAdminError(
      "PERMISSION_DENIED",
      `Connector family disabled by rollout flag: ${row.family_id}`,
    );
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

  private isFamilyEnabledByFlag(familyId: string): boolean {
    if (familyId === "whatsapp-cloud") {
      return this.options.enableWhatsappFamily ?? false;
    }
    if (familyId === "discord-bot") {
      return this.options.enableDiscordFamily ?? false;
    }
    return true;
  }

  private resolveEffectivePolicy(familyId: string, connectorId: string): ConnectorPolicyRecord {
    const global = this.options.policyRepo.get("global", "*");
    const family = this.options.policyRepo.get("family", familyId);
    const instance = this.options.policyRepo.get("instance", connectorId);

    const merged = {
      scopeType: "instance" as const,
      scopeId: connectorId,
      requestsPerMinute: global?.requests_per_minute ?? 60,
      burst: global?.burst ?? 60,
      disabled: policyDisabled(global),
      disableReason: global?.disable_reason || undefined,
      disabledUntil: global?.disabled_until || undefined,
      updatedBy: global?.updated_by ?? "system",
      updatedAt: global?.updated_at ?? new Date().toISOString(),
    };

    if (family) {
      merged.requestsPerMinute = family.requests_per_minute;
      merged.burst = family.burst;
      if (policyDisabled(family)) {
        merged.disabled = true;
        merged.disableReason = family.disable_reason || merged.disableReason;
        merged.disabledUntil = family.disabled_until || merged.disabledUntil;
      }
      merged.updatedBy = family.updated_by;
      merged.updatedAt = family.updated_at;
    }

    if (instance) {
      merged.requestsPerMinute = instance.requests_per_minute;
      merged.burst = instance.burst;
      if (policyDisabled(instance)) {
        merged.disabled = true;
        merged.disableReason = instance.disable_reason || merged.disableReason;
        merged.disabledUntil = instance.disabled_until || merged.disabledUntil;
      }
      merged.updatedBy = instance.updated_by;
      merged.updatedAt = instance.updated_at;
    }

    return merged;
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
    if (requestsPerMinute <= 0 || burst <= 0) {
      return true;
    }

    const now = Date.now();
    const limit = Math.max(1, burst);
    const refillRatePerMs = requestsPerMinute / 60000;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: limit, lastRefillMs: now };
      this.buckets.set(key, bucket);
    }

    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillRatePerMs);
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      return false;
    }

    bucket.tokens -= 1;
    return true;
  }

  private mapFamilyRow(row: ConnectorFamilyRow): ConnectorFamilyRecord {
    return {
      familyId: row.family_id,
      displayName: row.display_name,
      kind: row.kind,
      runtime: row.runtime,
      trustClass: row.trust_class,
      embeddedEnabled: row.embedded_enabled === 1,
      capabilityTypes: safeParseStringArray(row.capability_types_json)
        .filter((entry): entry is CapabilityType => isCapabilityType(entry)),
      features: safeParseObject(row.features_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapInstanceRow(row: ConnectorInstanceRow): ConnectorInstanceRecord {
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

  private mapBindingRow(row: ConnectorBindingRow): ConnectorBindingRecord {
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
        .filter((entry): entry is CapabilityType => isCapabilityType(entry)),
      priority: row.priority,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapPolicyRow(row: ConnectorPolicyRow): ConnectorPolicyRecord {
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
