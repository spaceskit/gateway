import type { ConnectorFamilyRow } from "@spaceskit/persistence";
import {
  ConnectorAdminError,
  serializeSelectorSchemasForFamily,
} from "./connector-admin-normalizers.js";
import { DEFAULT_CONNECTOR_FAMILIES } from "./connector-admin-default-families.js";
import type { ConnectorAdminServiceOptions } from "./connector-admin-service-types.js";

export function seedDefaultConnectorFamilies(options: ConnectorAdminServiceOptions): void {
  for (const family of DEFAULT_CONNECTOR_FAMILIES) {
    const rolloutEnabled = isConnectorFamilyEnabledByFlag(options, family.familyId);
    const selectorSchemas = serializeSelectorSchemasForFamily(family.familyId);
    options.familyRepo.upsert({
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

export function assertConnectorFamilyAllowedByProfile(
  options: ConnectorAdminServiceOptions,
  row: ConnectorFamilyRow,
): void {
  if (options.gatewayProfile === "external") {
    return;
  }

  if (row.trust_class !== "embedded_safe" || row.embedded_enabled !== 1) {
    throw new ConnectorAdminError(
      "PERMISSION_DENIED",
      `Connector family not allowed in embedded profile: ${row.family_id}`,
    );
  }
}

export function assertConnectorFamilyRolloutEnabled(
  options: ConnectorAdminServiceOptions,
  row: ConnectorFamilyRow,
): void {
  if (isConnectorFamilyEnabledByFlag(options, row.family_id)) {
    return;
  }
  throw new ConnectorAdminError(
    "PERMISSION_DENIED",
    `Connector family disabled by rollout flag: ${row.family_id}`,
  );
}

function isConnectorFamilyEnabledByFlag(
  options: ConnectorAdminServiceOptions,
  familyId: string,
): boolean {
  if (familyId === "whatsapp-cloud") {
    return options.enableWhatsappFamily ?? false;
  }
  if (familyId === "discord-bot") {
    return options.enableDiscordFamily ?? false;
  }
  return true;
}

