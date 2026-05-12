import type {
  GenerateOptions,
  ProviderFeedbackRequest,
  ProviderFeedbackResponse,
} from "@spaceskit/core";

type JsonRecord = Record<string, unknown>;

export async function requestProviderFeedback(
  feedbackHandler: GenerateOptions["feedbackHandler"],
  request: ProviderFeedbackRequest,
): Promise<ProviderFeedbackResponse> {
  if (!feedbackHandler) {
    return { action: "reject" };
  }
  return await feedbackHandler(request);
}

export function buildCommandApprovalRequest(params: unknown): ProviderFeedbackRequest {
  const record = asRecord(params);
  return {
    triggerClass: "permission_gate",
    description: asString(record?.reason)
      || `Command execution requires approval${asString(record?.command) ? `: ${asString(record?.command)}` : ""}.`,
    options: ["approve", "reject"],
    context: {
      providerApprovalType: "command_execution",
      itemId: asString(record?.itemId),
      approvalId: asString(record?.approvalId),
      command: asString(record?.command),
      cwd: asString(record?.cwd),
    },
  };
}

export function buildFileApprovalRequest(params: unknown): ProviderFeedbackRequest {
  const record = asRecord(params);
  return {
    triggerClass: "permission_gate",
    description: asString(record?.reason) || "File changes require approval.",
    options: ["approve", "reject"],
    context: {
      providerApprovalType: "file_change",
      itemId: asString(record?.itemId),
      grantRoot: asString(record?.grantRoot),
    },
  };
}

export function mapCommandApprovalDecision(feedback: ProviderFeedbackResponse):
  | "accept"
  | "decline"
  | "cancel" {
  switch (feedback.action) {
    case "approve":
      return "accept";
    case "defer":
      return "cancel";
    default:
      return "decline";
  }
}

export function mapFileApprovalDecision(feedback: ProviderFeedbackResponse):
  | "accept"
  | "decline"
  | "cancel" {
  switch (feedback.action) {
    case "approve":
      return "accept";
    case "defer":
      return "cancel";
    default:
      return "decline";
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}
