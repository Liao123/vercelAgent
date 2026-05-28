/** DOM id for scrolling to an approval card in the review / inline panels. */
export function approvalAnchorId(approvalId: string): string {
  return `approval-anchor-${approvalId}`;
}

/** DOM id for the compacted memory panel in the Agent center column. */
export const AGENT_COMPACTED_MEMORY_PANEL_ID = "agent-compacted-memory-panel";

/** Extract approval id from tool results or SSE approval payloads. */
export function extractApprovalIdFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  if (typeof record.approvalId === "string" && record.approvalId) {
    return record.approvalId;
  }

  if (record.approval && typeof record.approval === "object") {
    const approval = record.approval as Record<string, unknown>;
    if (typeof approval.id === "string" && approval.id) {
      return approval.id;
    }
  }

  return null;
}
