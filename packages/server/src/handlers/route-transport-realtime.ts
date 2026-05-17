import { MessageTypes, type GatewayMessage } from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { MessageRouter } from "../message-router.js";
import {
  handleConciergeCallAnswer,
  handleConciergeCallAudioChunk,
  handleConciergeCallControl,
  handleConciergeCallEnd,
  handleConciergeCallHandoffAccept,
  handleConciergeCallHandoffPrepare,
  handleConciergeCallRegisterPush,
  handleConciergeCallSetMuted,
  handleConciergeCallStart,
} from "./concierge-call-handlers.js";
import {
  handleAgentMessage,
  handleAgentPoke,
  handleConciergeActionResult,
  handleSessionListResumable,
  handleSessionResume,
  handleTaskDependency,
} from "./realtime-collaboration-handlers.js";

export async function routeTransportRealtimeMessage(
  router: MessageRouter,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  switch (msg.type) {
    case MessageTypes.CONCIERGE_CALL_START:
      return handleConciergeCallStart(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_ANSWER:
      return handleConciergeCallAnswer(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_END:
      return handleConciergeCallEnd(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_SET_MUTED:
      return handleConciergeCallSetMuted(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_AUDIO_CHUNK:
      return handleConciergeCallAudioChunk(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_CONTROL:
      return handleConciergeCallControl(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_HANDOFF_PREPARE:
      return handleConciergeCallHandoffPrepare(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_HANDOFF_ACCEPT:
      return handleConciergeCallHandoffAccept(router.transportHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_CALL_REGISTER_PUSH:
      return handleConciergeCallRegisterPush(router.transportHandlerContext(), client, msg);
    case MessageTypes.AGENT_MESSAGE:
      return handleAgentMessage(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.AGENT_POKE:
      return handleAgentPoke(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.TASK_DEPENDENCY:
      return handleTaskDependency(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.CONCIERGE_ACTION_RESULT:
      return handleConciergeActionResult(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.SESSION_LIST_RESUMABLE:
      return handleSessionListResumable(router.realtimeCollaborationHandlerContext(), client, msg);
    case MessageTypes.SESSION_RESUME:
      return handleSessionResume(router.realtimeCollaborationHandlerContext(), client, msg);
    default:
      return router.errorResponse(msg.id, "INVALID_ARGUMENT", `Unknown message type: ${msg.type}`);
  }
}
