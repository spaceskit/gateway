/**
 * Per-family selector schema definitions for connector bindings.
 * Pure validation -- no I/O.
 */

export interface ConnectorSelectorFieldDef {
  key: string;
  required: boolean;
  description: string;
}

export interface ConnectorSelectorSchema {
  family: string;
  fields: ConnectorSelectorFieldDef[];
}

// Default families and their known selector keys
export const SELECTOR_SCHEMAS: ConnectorSelectorSchema[] = [
  {
    family: "messaging",
    fields: [
      { key: "accountId", required: true, description: "Messaging platform account identifier" },
      { key: "chatId", required: false, description: "Specific chat/channel to bind" },
      { key: "threadId", required: false, description: "Specific thread within a chat" },
    ],
  },
  {
    family: "calendar",
    fields: [
      { key: "accountId", required: true, description: "Calendar provider account" },
      { key: "calendarId", required: false, description: "Specific calendar" },
    ],
  },
  {
    family: "storage",
    fields: [
      { key: "accountId", required: true, description: "Storage provider account" },
      { key: "bucketId", required: false, description: "Specific storage bucket or folder" },
    ],
  },
  {
    family: "generic",
    fields: [],  // No schema enforcement -- any keys allowed
  },
];

export interface SelectorValidationResult {
  valid: boolean;
  errors: string[];
}

export function getSchemaForFamily(family: string): ConnectorSelectorSchema | undefined {
  return SELECTOR_SCHEMAS.find((s) => s.family === family);
}

export function validateConnectorSelector(
  family: string,
  selector: Record<string, unknown>,
): SelectorValidationResult {
  const schema = getSchemaForFamily(family);

  // Unknown family or generic -- allow anything
  if (!schema || schema.fields.length === 0) {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];
  const knownKeys = new Set(schema.fields.map((f) => f.key));

  // Check required fields
  for (const field of schema.fields) {
    if (field.required && !(field.key in selector)) {
      errors.push(`Missing required field: ${field.key}`);
    }
  }

  // Check for unknown keys
  for (const key of Object.keys(selector)) {
    if (!knownKeys.has(key)) {
      errors.push(`Unknown selector key for family "${family}": ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
