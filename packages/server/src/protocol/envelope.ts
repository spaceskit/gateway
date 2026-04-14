import type { GatewayToolApprovalGrantModePayload } from "./tooling.js";

export interface GatewayMessage<T = unknown> {
  type: string;
  id: string;
  replyTo?: string;
  ts: string;
  payload: T;
}

export interface AuthenticatePayload {
  publicKey: string;
  signature: string;
  clientType: string;
  clientVersion: string;
  deviceId?: string;
  devicePublicKey?: string;
  deviceProofSignature?: string;
}

export interface ExecuteTurnPayload {
  spaceUid: string;
  input: string;
  targetAgentId?: string;
  targetAgentIds?: string[];
  replyToTurnId?: string;
  conversationTopology?: "direct" | "shared_team_chat" | "broadcast_team";
  mode?: "ask" | "plan" | "execute";
  effort?: "low" | "medium" | "high" | "max";
  accessMode?: "default" | "full_access";
}

export interface ApprovalGrantPayload {
  mode: GatewayToolApprovalGrantModePayload;
  ttlSeconds?: number;
}

export interface CancelTurnPayload {
  spaceUid: string;
  turnId: string;
}

export interface ResumeFeedbackPayload {
  spaceUid: string;
  turnId: string;
  response: "approve" | "reject" | "revise" | "defer";
  revision?: string;
  approvalGrant?: ApprovalGrantPayload;
}

export interface SubscribePayload {
  spaceUids: string[];
}

export interface SubscribeDeniedSpace {
  spaceUid: string;
  reason: string;
}

export interface SubscribeResponsePayload {
  subscribedSpaceUids: string[];
  denied: SubscribeDeniedSpace[];
}

export interface CapabilityInvokePayload {
  capability: string;
  method: string;
  params: Record<string, unknown>;
  targetProvider?: string;
}
