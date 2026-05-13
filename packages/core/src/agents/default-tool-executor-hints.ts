/**
 * Tool definition hints (descriptions + JSON Schemas) for capability operations.
 *
 * Extracted from `default-tool-executor.ts` to keep the executor focused on
 * routing/execution while the static schema metadata lives alongside it.
 *
 * Behavior is unchanged — this module re-exports the same constants/helpers
 * used previously inline.
 */

import type { CapabilityType } from "../capabilities/types.js";
import { isCapabilityType } from "../capabilities/types.js";

export interface ToolDefinitionHint {
  description: string;
  inputSchema: Record<string, unknown>;
}

const TARGET_PROVIDER_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Optional provider ID override when multiple providers are available.",
};

export function buildObjectSchema(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      targetProvider: TARGET_PROVIDER_PROPERTY,
      ...properties,
    },
    ...(required.length > 0 ? { required } : {}),
  };
}

function iso8601TimestampProperty(description: string): Record<string, unknown> {
  return {
    type: "string",
    description: `${description} Use ISO-8601 timestamp format.`,
  };
}

const DEFAULT_TOOL_INPUT_SCHEMA: Record<string, unknown> = buildObjectSchema({});

const REMINDER_LIST_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Reminder list identifier returned by lists.listLists.",
};

const REMINDER_ITEM_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Reminder/task item identifier.",
};

const REMINDER_PRIORITY_PROPERTY: Record<string, unknown> = {
  type: "integer",
  description: "Optional priority from 0 to 9.",
  minimum: 0,
  maximum: 9,
};

const CALENDAR_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Calendar identifier returned by calendar.listCalendars.",
};

const CALENDAR_EVENT_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Calendar event identifier.",
};

const EMAIL_ACCOUNT_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Email account identifier returned by email.listAccounts.",
};

const EMAIL_MAILBOX_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Mailbox identifier returned by email.listMailboxes.",
};

const EMAIL_MESSAGE_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Observed email message identifier.",
};

const EMAIL_COMPOSE_SESSION_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Observed Apple Mail compose session identifier.",
};

const RECURRENCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  description: "Optional recurrence rule. Current Apple Calendar support is daily or weekly.",
  properties: {
    frequency: {
      type: "string",
      enum: ["daily", "weekly"],
      description: "Recurrence frequency.",
    },
    interval: {
      type: "integer",
      minimum: 1,
      description: "Repeat interval. Defaults to 1 when omitted.",
    },
    daysOfWeek: {
      type: "array",
      description: "Weekly recurrence day numbers from 1 (Sunday) to 7 (Saturday).",
      items: {
        type: "integer",
        minimum: 1,
        maximum: 7,
      },
    },
  },
};

const TOOL_HINTS_BY_CAPABILITY: Partial<Record<CapabilityType, Record<string, ToolDefinitionHint>>> = {
  lists: {
    listLists: {
      description: "List reminder/task lists from connected list providers (for example Apple Reminders).",
      inputSchema: buildObjectSchema({}),
    },
    createList: {
      description: "Create a reminder/task list.",
      inputSchema: buildObjectSchema({
        name: {
          type: "string",
          description: "List name.",
        },
      }, ["name"]),
    },
    updateList: {
      description: "Rename/update a reminder/task list. Use lists.listLists first when listId is unknown.",
      inputSchema: buildObjectSchema({
        listId: REMINDER_LIST_ID_PROPERTY,
        name: {
          type: "string",
          description: "Updated list name.",
        },
      }, ["listId", "name"]),
    },
    deleteList: {
      description: "Delete a reminder/task list. Use lists.listLists first when listId is unknown.",
      inputSchema: buildObjectSchema({
        listId: REMINDER_LIST_ID_PROPERTY,
      }, ["listId"]),
    },
    listItems: {
      description: "List reminders/tasks in a list. Use lists.listLists first when listId is unknown. Returns at most 50 items by default; set limit higher if needed. Response includes totalCount and truncated flag when results are capped.",
      inputSchema: buildObjectSchema({
        listId: REMINDER_LIST_ID_PROPERTY,
        includeCompleted: {
          type: "boolean",
          description: "Include completed reminders/tasks. Defaults to true.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of items to return. Defaults to 50 if omitted.",
          minimum: 1,
        },
      }),
    },
    createItem: {
      description: "Create a new reminder/task item in the target list. Use lists.listLists first when listId is unknown.",
      inputSchema: buildObjectSchema({
        listId: REMINDER_LIST_ID_PROPERTY,
        title: {
          type: "string",
          description: "Reminder/task title.",
        },
        notes: {
          type: "string",
          description: "Optional notes/details for the reminder.",
        },
        startAt: iso8601TimestampProperty("Optional start date/time."),
        dueAt: iso8601TimestampProperty("Optional due date/time."),
        priority: REMINDER_PRIORITY_PROPERTY,
        location: {
          type: "string",
          description: "Optional reminder location text.",
        },
        url: {
          type: "string",
          description: "Optional URL associated with the reminder.",
        },
      }, ["listId", "title"]),
    },
    updateItem: {
      description: "Update an existing reminder/task item. Use this for general edits, or reopen a completed item with isCompleted: false. Set isCompleted: true to mark it done if lists.completeItem is unavailable.",
      inputSchema: buildObjectSchema({
        itemId: REMINDER_ITEM_ID_PROPERTY,
        listId: REMINDER_LIST_ID_PROPERTY,
        title: {
          type: "string",
          description: "Updated reminder/task title.",
        },
        notes: {
          type: "string",
          description: "Updated notes/details. Use null to clear.",
        },
        startAt: {
          ...iso8601TimestampProperty("Updated start date/time."),
          description: "Updated start date/time. Use null to clear. Use ISO-8601 timestamp format.",
        },
        dueAt: {
          ...iso8601TimestampProperty("Updated due date/time."),
          description: "Updated due date/time. Use null to clear. Use ISO-8601 timestamp format.",
        },
        priority: {
          ...REMINDER_PRIORITY_PROPERTY,
          description: "Updated priority from 0 to 9. Use null to clear.",
        },
        location: {
          type: "string",
          description: "Updated location text. Use null to clear.",
        },
        url: {
          type: "string",
          description: "Updated URL. Use null to clear.",
        },
        isCompleted: {
          type: "boolean",
          description: "Set true to mark the reminder done. Set false to reopen it.",
        },
      }, ["itemId"]),
    },
    completeItem: {
      description: "Mark a reminder/task item as completed/done. Prefer this over lists.updateItem for direct 'mark done' requests.",
      inputSchema: buildObjectSchema({
        itemId: REMINDER_ITEM_ID_PROPERTY,
      }, ["itemId"]),
    },
    deleteItem: {
      description: "Delete a reminder/task item.",
      inputSchema: buildObjectSchema({
        itemId: REMINDER_ITEM_ID_PROPERTY,
      }, ["itemId"]),
    },
  },
  calendar: {
    listCalendars: {
      description: "List calendars from connected calendar providers (for example Apple Calendar).",
      inputSchema: buildObjectSchema({}),
    },
    listEvents: {
      description: "List calendar events in a time window. Use calendar.listCalendars first when calendarId is unknown. Defaults to a rolling time range when startAt/endAt are omitted.",
      inputSchema: buildObjectSchema({
        calendarId: CALENDAR_ID_PROPERTY,
        startAt: iso8601TimestampProperty("Optional window start."),
        endAt: iso8601TimestampProperty("Optional window end."),
        limit: {
          type: "integer",
          description: "Maximum number of events to return. Defaults to 100.",
          minimum: 1,
        },
      }),
    },
    getEvent: {
      description: "Fetch one calendar event by id.",
      inputSchema: buildObjectSchema({
        eventId: CALENDAR_EVENT_ID_PROPERTY,
      }, ["eventId"]),
    },
    createEvent: {
      description: "Create a calendar event. Use calendar.listCalendars first when calendarId is unknown.",
      inputSchema: buildObjectSchema({
        calendarId: CALENDAR_ID_PROPERTY,
        title: {
          type: "string",
          description: "Event title.",
        },
        startAt: iso8601TimestampProperty("Event start date/time."),
        endAt: iso8601TimestampProperty("Event end date/time."),
        notes: {
          type: "string",
          description: "Optional event notes/body.",
        },
        recurrence: RECURRENCE_SCHEMA,
      }, ["calendarId", "title", "startAt", "endAt"]),
    },
    updateEvent: {
      description: "Update a calendar event. Use this for general edits, and set recurrence to null to remove an existing recurrence rule.",
      inputSchema: buildObjectSchema({
        eventId: CALENDAR_EVENT_ID_PROPERTY,
        calendarId: CALENDAR_ID_PROPERTY,
        title: {
          type: "string",
          description: "Updated event title.",
        },
        startAt: {
          ...iso8601TimestampProperty("Updated event start date/time."),
          description: "Updated event start date/time. Use null to clear. Use ISO-8601 timestamp format.",
        },
        endAt: {
          ...iso8601TimestampProperty("Updated event end date/time."),
          description: "Updated event end date/time. Use null to clear. Use ISO-8601 timestamp format.",
        },
        notes: {
          type: "string",
          description: "Updated notes/body. Use null to clear.",
        },
        recurrence: {
          ...RECURRENCE_SCHEMA,
          description: "Updated recurrence rule. Use null to clear recurrence.",
        },
      }, ["eventId"]),
    },
    deleteEvent: {
      description: "Delete a calendar event.",
      inputSchema: buildObjectSchema({
        eventId: CALENDAR_EVENT_ID_PROPERTY,
      }, ["eventId"]),
    },
  },
  email: {
    listAccounts: {
      description: "List observed Apple Mail accounts from the built-in MailKit provider.",
      inputSchema: buildObjectSchema({}),
    },
    listMailboxes: {
      description: "List observed Apple Mail mailboxes. Use email.listAccounts first when accountId is unknown.",
      inputSchema: buildObjectSchema({
        accountId: EMAIL_ACCOUNT_ID_PROPERTY,
      }),
    },
    listMessages: {
      description: "List observed and recent Apple Mail messages. This is not a full mailbox sync. Use email.listMailboxes first when mailboxId is unknown.",
      inputSchema: buildObjectSchema({
        accountId: EMAIL_ACCOUNT_ID_PROPERTY,
        mailboxId: EMAIL_MAILBOX_ID_PROPERTY,
        threadId: {
          type: "string",
          description: "Optional thread identifier filter.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of observed messages to return. Defaults to 50.",
          minimum: 1,
        },
      }),
    },
    getMessage: {
      description: "Fetch one observed Apple Mail message by id.",
      inputSchema: buildObjectSchema({
        messageId: EMAIL_MESSAGE_ID_PROPERTY,
      }, ["messageId"]),
    },
    listComposeSessions: {
      description: "List observed Apple Mail compose sessions captured through MailKit.",
      inputSchema: buildObjectSchema({}),
    },
    getComposeSession: {
      description: "Fetch one observed Apple Mail compose session by id.",
      inputSchema: buildObjectSchema({
        composeSessionId: EMAIL_COMPOSE_SESSION_ID_PROPERTY,
      }, ["composeSessionId"]),
    },
  },
};

export function resolveToolHint(capability: CapabilityType, operation: string): ToolDefinitionHint {
  const exactHint = TOOL_HINTS_BY_CAPABILITY[capability]?.[operation];
  if (exactHint) {
    return exactHint;
  }
  return {
    description: `${humanizeCapability(capability)}: ${humanizeOperation(operation)}.`,
    inputSchema: DEFAULT_TOOL_INPUT_SCHEMA,
  };
}

export function capabilityTypeFromToolName(toolName: string): CapabilityType | null {
  const separatorIndex = toolName.indexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }
  const candidate = toolName.slice(0, separatorIndex);
  return isCapabilityType(candidate) ? candidate : null;
}

function humanizeCapability(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Capability";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function humanizeOperation(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "operation";
  const spaced = normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
