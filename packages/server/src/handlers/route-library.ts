import { MessageTypes, type GatewayMessage } from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { MessageRouter } from "../message-router.js";
import {
  handleLibraryArchiveEntry,
  handleLibraryCreateSkillDraft,
  handleLibraryDeleteEntry,
  handleLibraryDeleteSkillDraft,
  handleLibraryGetEntry,
  handleLibraryGetSkillDraft,
  handleLibraryImportEntry,
  handleLibraryListEntries,
  handleLibraryListSkillDrafts,
  handleLibrarySaveSkill,
  handleLibraryScanEntries,
  handleLibrarySetEntryEnabled,
} from "./gateway-governance-handlers.js";

export async function routeLibraryMessage(
  router: MessageRouter,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  switch (msg.type) {
    case MessageTypes.LIBRARY_LIST_ENTRIES:
      return handleLibraryListEntries(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_GET_ENTRY:
      return handleLibraryGetEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_SAVE_SKILL:
      return handleLibrarySaveSkill(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_IMPORT_ENTRY:
      return handleLibraryImportEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_ARCHIVE_ENTRY:
      return handleLibraryArchiveEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_SET_ENTRY_ENABLED:
      return handleLibrarySetEntryEnabled(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_DELETE_ENTRY:
      return handleLibraryDeleteEntry(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_SCAN_ENTRIES:
      return handleLibraryScanEntries(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_LIST_SKILL_DRAFTS:
      return handleLibraryListSkillDrafts(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_GET_SKILL_DRAFT:
      return handleLibraryGetSkillDraft(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_CREATE_SKILL_DRAFT:
      return handleLibraryCreateSkillDraft(router.gatewayGovernanceHandlerContext(), client, msg);
    case MessageTypes.LIBRARY_DELETE_SKILL_DRAFT:
      return handleLibraryDeleteSkillDraft(router.gatewayGovernanceHandlerContext(), client, msg);
    default:
      return router.errorResponse(msg.id, "INVALID_ARGUMENT", `Unknown message type: ${msg.type}`);
  }
}
