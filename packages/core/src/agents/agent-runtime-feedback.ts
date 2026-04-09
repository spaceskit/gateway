export type FeedbackAction = "approve" | "reject" | "revise" | "defer";

export type FeedbackResponse = {
  action: FeedbackAction;
  revision?: string;
};
