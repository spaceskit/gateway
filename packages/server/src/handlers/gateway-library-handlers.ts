import {
  MessageTypes,
  type GatewayMessage,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { GatewayGovernanceHandlerContext } from "./gateway-governance-handlers.js";

export async function handleLibraryListEntries(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = (msg.payload ?? {}) as Record<string, unknown>;
  const entries = context.gatewayLibraryService.listEntries(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_LIST_ENTRIES, { entries });
}

export async function handleLibraryGetEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as { entryId?: string; includeContent?: boolean } | undefined;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }
  const entry = context.gatewayLibraryService.getEntry(payload.entryId, payload.includeContent);
  if (!entry) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Library entry not found: ${payload.entryId}`);
  }
  return context.response(msg.id, MessageTypes.LIBRARY_GET_ENTRY, { entry });
}

export async function handleLibrarySaveSkill(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.name || !payload?.contentMarkdown) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "name and contentMarkdown are required");
  }
  const result = context.gatewayLibraryService.saveSkill(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_SAVE_SKILL, result);
}

export async function handleLibraryImportEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }
  const result = context.gatewayLibraryService.importEntry(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_IMPORT_ENTRY, result);
}

export async function handleLibraryArchiveEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }
  const result = context.gatewayLibraryService.archiveEntry(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_ARCHIVE_ENTRY, result);
}

export async function handleLibrarySetEntryEnabled(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.entryId || typeof payload?.enabled !== "boolean") {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId and enabled are required");
  }
  const result = context.gatewayLibraryService.setEntryEnabled(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_SET_ENTRY_ENABLED, result);
}

export async function handleLibraryDeleteEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }
  const result = context.gatewayLibraryService.deleteEntry(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_DELETE_ENTRY, result);
}

export async function handleLibraryScanEntries(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const result = context.gatewayLibraryService.scanEntries();
  return context.response(msg.id, MessageTypes.LIBRARY_SCAN_ENTRIES, result);
}

export async function handleLibraryListSkillDrafts(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const drafts = context.gatewayLibraryService.listSkillDrafts();
  return context.response(msg.id, MessageTypes.LIBRARY_LIST_SKILL_DRAFTS, { drafts });
}

export async function handleLibraryGetSkillDraft(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as { draftId?: string } | undefined;
  if (!payload?.draftId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "draftId is required");
  }
  const draft = context.gatewayLibraryService.getSkillDraft(payload.draftId);
  if (!draft) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Skill draft not found: ${payload.draftId}`);
  }
  return context.response(msg.id, MessageTypes.LIBRARY_GET_SKILL_DRAFT, { draft });
}

export async function handleLibraryCreateSkillDraft(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.requestPrompt) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "requestPrompt is required");
  }
  const result = context.gatewayLibraryService.createSkillDraft(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_CREATE_SKILL_DRAFT, result);
}

export async function handleLibraryDeleteSkillDraft(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.draftId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "draftId is required");
  }
  const result = context.gatewayLibraryService.deleteSkillDraft(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_DELETE_SKILL_DRAFT, result);
}
