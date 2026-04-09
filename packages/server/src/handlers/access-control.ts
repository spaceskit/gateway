import type { ErrorPayload, GatewayMessage } from "../protocol.js";
import { MessageTypes } from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { GatewayAdminService, SpaceSharingService } from "../message-router.js";
import { normalizeString } from "../message-router-utils.js";

export interface AccessControlContext {
  spaceSharingService: SpaceSharingService | null;
  gatewayAdminService: GatewayAdminService | null;
  resolveSpaceId: (spaceUidRaw: string) => Promise<string | null>;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

export async function authorizeSpaceAccess(
  context: AccessControlContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceSharingService) {
    return null;
  }

  const checks = await buildSpaceAccessChecks(context, msg);
  if (checks.length === 0) {
    return null;
  }

  const principalId = client.publicKey?.trim();
  for (const check of checks) {
    const decision = context.spaceSharingService.evaluateAccess({
      spaceId: check.spaceId,
      principalId,
      action: check.action,
    });
    if (!decision.allowed) {
      return context.errorResponse(
        msg.id,
        "PERMISSION_DENIED",
        decision.reason ?? "Access denied for shared space",
      );
    }
  }

  return null;
}

export function resolveExecutionOrigin(
  context: AccessControlContext,
  spaceId: string,
  principalIdRaw?: string,
): "owner" | "guest" | "unknown" {
  const principalId = principalIdRaw?.trim();
  if (!principalId) {
    return "unknown";
  }
  const participant = context.spaceSharingService?.getActiveParticipant?.(spaceId, principalId);
  if (participant?.joinedViaInviteId) {
    return "guest";
  }
  if (participant) {
    return "owner";
  }
  const access = context.spaceSharingService?.evaluateAccess({
    spaceId,
    principalId,
    action: "read",
  });
  if (access?.allowed && !access.enforced) {
    return "owner";
  }
  return "unknown";
}

export function resolveSessionResetPrincipal(client: ClientSession): string {
  const publicKey = normalizeString(client.publicKey);
  if (publicKey) {
    return publicKey;
  }

  const deviceId = normalizeString(client.deviceId);
  if (deviceId) {
    return `device:${deviceId}`;
  }

  return "system:agent-session-replacement";
}

async function buildSpaceAccessChecks(
  context: AccessControlContext,
  msg: GatewayMessage,
): Promise<Array<{ spaceId: string; action: "read" | "write" }>> {
  const payload = (msg.payload ?? {}) as Record<string, unknown>;
  const checks: Array<{ spaceId: string; action: "read" | "write" }> = [];
  const add = (spaceId: unknown, action: "read" | "write") => {
    if (typeof spaceId !== "string") return;
    const normalized = spaceId.trim();
    if (!normalized) return;
    if (checks.some((entry) => entry.spaceId === normalized && entry.action === action)) return;
    checks.push({ spaceId: normalized, action });
  };

  switch (msg.type) {
    case MessageTypes.EXECUTE_TURN:
    case MessageTypes.RESUME_FEEDBACK:
    case MessageTypes.SESSION_RESUME:
      add(payload.spaceId, "write");
      if (checks.length === 0 && typeof payload.spaceUid === "string") {
        const resolvedSpaceId = await context.resolveSpaceId(payload.spaceUid);
        if (resolvedSpaceId) {
          add(resolvedSpaceId, "write");
        }
      }
      break;
    case MessageTypes.SPACE_ADD_AGENT:
    case MessageTypes.SPACE_REMOVE_AGENT:
    case MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT:
    case MessageTypes.SPACE_SET_ORCHESTRATOR:
    case MessageTypes.SPACE_SET_THINKING_CAPTURE_POLICY:
    case MessageTypes.SPACE_SET_MEMORY_POLICY:
    case MessageTypes.SPACE_END_INCOGNITO_SESSION:
    case MessageTypes.SPACE_ARCHIVE:
    case MessageTypes.SPACE_DELETE:
    case MessageTypes.SPACE_SET_MCP_ENDPOINT:
    case MessageTypes.SPACE_CLEAR_MCP_ENDPOINT:
    case MessageTypes.SPACE_APPROVE_MCP_AGENT:
    case MessageTypes.SPACE_ADD_SKILL:
    case MessageTypes.SPACE_REMOVE_SKILL:
    case MessageTypes.SPACE_SET_WORKSPACE:
    case MessageTypes.SPACE_ADD_RESOURCE:
    case MessageTypes.SPACE_REMOVE_RESOURCE:
    case MessageTypes.SPACE_ACCEPT_INSIGHT:
    case MessageTypes.SPACE_REJECT_INSIGHT:
    case MessageTypes.SPACE_DISMISS_INSIGHT:
    case MessageTypes.SPACE_UPDATE_SPACE_AGENT_NOTES:
    case MessageTypes.SPACE_SHARE_CREATE_INVITE:
    case MessageTypes.SPACE_SHARE_REVOKE:
    case MessageTypes.SPACE_CREATE_CHANGESET:
    case MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_INIT:
    case MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_COMPLETE:
    case MessageTypes.SPACE_SUBMIT_CHANGESET:
    case MessageTypes.SPACE_REVIEW_CHANGESET:
    case MessageTypes.SPACE_APPLY_CHANGESET:
    case MessageTypes.SPACE_UPDATE_QUOTA_POLICY:
    case MessageTypes.SPACE_RESET:
    case MessageTypes.SPACE_RESET_AGENT_USAGE_SESSION:
    case MessageTypes.SPACE_UPDATE_TOOL_POLICY:
    case MessageTypes.SPEECH_START:
      add(payload.spaceId, "write");
      break;
    case MessageTypes.GATEWAY_SET_MAIN_AGENT:
      add(payload.spaceId, "write");
      if (checks.length === 0) {
        add(context.gatewayAdminService?.resolveMainSpaceId?.(), "write");
      }
      break;
    case MessageTypes.GATEWAY_SET_CONCIERGE_AGENT:
      add(payload.spaceId, "write");
      if (checks.length === 0) {
        add(context.gatewayAdminService?.resolveConciergeSpaceId?.(), "write");
      }
      break;
    case MessageTypes.SPACE_LIST_TURNS:
    case MessageTypes.SPACE_LIST_ORCHESTRATION_JOURNAL:
      add(payload.spaceId, "read");
      if (checks.length === 0 && typeof payload.spaceUid === "string") {
        const resolvedSpaceId = await context.resolveSpaceId(payload.spaceUid);
        if (resolvedSpaceId) {
          add(resolvedSpaceId, "read");
        }
      }
      break;
    case MessageTypes.SPACE_GET:
    case MessageTypes.SPACE_GET_MCP_ENDPOINT:
    case MessageTypes.SPACE_DISCOVER_MCP_AGENTS:
    case MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS:
    case MessageTypes.SPACE_LIST_SKILLS:
    case MessageTypes.SPACE_GET_MEMORY_POLICY:
    case MessageTypes.SPACE_GET_WORKSPACE:
    case MessageTypes.SPACE_LIST_RESOURCES:
    case MessageTypes.SPACE_SHARE_LIST_PARTICIPANTS:
    case MessageTypes.SPACE_LIST_CHANGESETS:
    case MessageTypes.SPACE_GET_CHANGESET_DIFF:
    case MessageTypes.SPACE_GET_QUOTA:
    case MessageTypes.SPACE_GET_USAGE:
    case MessageTypes.SPACE_LIST_ACTIVITY_LOG:
    case MessageTypes.SPACE_GET_TURN_TRACE:
    case MessageTypes.SPACE_LIST_EXPERIENCES:
    case MessageTypes.SPACE_GET_EXPERIENCE:
    case MessageTypes.SPACE_LIST_INSIGHTS:
    case MessageTypes.SPACE_GET_SPACE_AGENT_NOTES:
    case MessageTypes.SPACE_LIST_MEMORIES:
    case MessageTypes.SPACE_LIST_ARTIFACTS:
    case MessageTypes.SPACE_GET_ARTIFACT:
    case MessageTypes.SPACE_GET_EFFECTIVE_TOOLS:
    case MessageTypes.SPACE_GET_EFFECTIVE_TOOL_ACCESS:
    case MessageTypes.SPACE_GET_TOOL_POLICY:
      add(payload.spaceId, "read");
      break;
    case MessageTypes.SPACE_GET_INSIGHT:
      add(payload.spaceId, "read");
      break;
    case MessageTypes.SPACE_UPDATE_USER_PROFILE:
    case MessageTypes.SPACE_DELETE_MEMORY:
    case MessageTypes.SPACE_UPDATE_MEMORY_IMPORTANCE:
      add(payload.spaceId, "write");
      break;
    case MessageTypes.SPACE_GET_USER_PROFILE:
      add(payload.spaceId, "read");
      break;
    case MessageTypes.GATEWAY_GET_MAIN_AGENT:
      add(payload.spaceId, "read");
      if (checks.length === 0) {
        add(context.gatewayAdminService?.resolveMainSpaceId?.(), "read");
      }
      break;
    case MessageTypes.GATEWAY_GET_CONCIERGE_AGENT:
      add(payload.spaceId, "read");
      if (checks.length === 0) {
        add(context.gatewayAdminService?.resolveConciergeSpaceId?.(), "read");
      }
      break;
    case MessageTypes.GATEWAY_KB_LIST_ENTRIES:
      add(payload.spaceId, "read");
      break;
    case MessageTypes.GATEWAY_KB_UPSERT_ENTRY:
      if (payload.scopeType === "space") {
        add(payload.spaceId, "write");
      }
      break;
    case MessageTypes.SPACE_LINK:
    case MessageTypes.SPACE_UNLINK:
    case MessageTypes.SPACE_SHARE_CONTEXT:
      add(payload.sourceSpaceId, "write");
      add(payload.targetSpaceId, "write");
      break;
    case MessageTypes.SPACE_PULL_SHARED_CONTEXT:
      add(payload.sourceSpaceId, "read");
      add(payload.targetSpaceId, "write");
      break;
    case MessageTypes.SPACE_SAVE_TEMPLATE:
      add(payload.sourceSpaceId, "read");
      break;
    case MessageTypes.ORCHESTRATOR_COMMAND:
      add(payload.targetSpaceId, "write");
      break;
    case MessageTypes.SCHEDULER_CREATE_JOB:
    case MessageTypes.SCHEDULER_UPDATE_JOB:
      add(payload.primarySpaceId, "write");
      if (Array.isArray(payload.relatedSpaceIds)) {
        for (const relatedSpaceId of payload.relatedSpaceIds) {
          add(relatedSpaceId, "write");
        }
      }
      break;
    case MessageTypes.SCHEDULER_LINK_SPACE:
    case MessageTypes.SCHEDULER_UNLINK_SPACE:
      add(payload.spaceId, "write");
      break;
    default:
      break;
  }

  return checks;
}
