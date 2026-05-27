/**
 * 审批详情中的文本快照（截断大文件内容，避免撑爆 JSON）。
 */
import type { ApprovalContentSnapshot } from "@/agent/types";

export const CONTENT_SNAPSHOT_LIMIT = 12_000;

export function contentSnapshot(content: string): ApprovalContentSnapshot {
  const truncated = content.length > CONTENT_SNAPSHOT_LIMIT;
  const text = truncated ? content.slice(0, CONTENT_SNAPSHOT_LIMIT) : content;
  return {
    text,
    length: content.length,
    lineCount: content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length,
    truncated,
  };
}
