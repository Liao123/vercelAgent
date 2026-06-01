import type { ApprovalContentSnapshot } from "@/agent/types";

/** 去掉快照中的省略提示行，供 diff 计算；保留 startLine 供行号展示。 */
export function snapshotDiffText(
  snapshot?: ApprovalContentSnapshot | string,
): { text: string; startLine: number } {
  if (!snapshot) return { text: "", startLine: 1 };

  const raw = typeof snapshot === "string" ? snapshot : snapshot.text;
  const baseStart =
    typeof snapshot === "object" && snapshot.startLine
      ? snapshot.startLine
      : 1;

  if (!raw) return { text: "", startLine: baseStart };

  const lines = raw.split(/\r\n|\n|\r/);
  let start = 0;
  let end = lines.length;
  if (lines[0]?.startsWith("…（前")) start = 1;
  if (end > start && lines[end - 1]?.startsWith("…（后")) end -= 1;

  return {
    text: lines.slice(start, end).join("\n"),
    startLine: baseStart,
  };
}

export function snapshotDiffHint(
  before?: ApprovalContentSnapshot,
  after?: ApprovalContentSnapshot,
): string | null {
  const parts: string[] = [];
  if (before?.truncated && before.startLine) {
    parts.push(`变更前片段起始于约第 ${before.startLine} 行`);
  }
  if (after?.truncated && after.startLine) {
    parts.push(`变更后片段起始于约第 ${after.startLine} 行`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}
