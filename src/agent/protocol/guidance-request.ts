export type AgentGuidanceRequestBody = {
  threadId?: unknown;
  text?: unknown;
};

export function parseAgentGuidanceRequestBody(
  body: AgentGuidanceRequestBody,
): { threadId: string; text: string } | { error: string } {
  const threadId =
    typeof body.threadId === "string" ? body.threadId.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!threadId) {
    return { error: "threadId is required." };
  }
  if (!text) {
    return { error: "text is required." };
  }
  return { threadId, text };
}
