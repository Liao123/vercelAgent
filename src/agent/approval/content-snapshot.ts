/**
 * 审批详情中的文本快照（截断大文件内容，避免撑爆 JSON）。
 */
import { computeLineDiff } from "@/lib/line-diff";
import type { ApprovalContentSnapshot } from "@/agent/types";

export const CONTENT_SNAPSHOT_LIMIT = 12_000;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r\n|\n|\r/);
}

export function contentSnapshot(content: string): ApprovalContentSnapshot {
  const truncated = content.length > CONTENT_SNAPSHOT_LIMIT;
  const text = truncated ? content.slice(0, CONTENT_SNAPSHOT_LIMIT) : content;
  return {
    text,
    length: content.length,
    lineCount: content.length === 0 ? 0 : splitLines(content).length,
    truncated,
  };
}

function buildFocusedSlice(
  lines: string[],
  start: number,
  end: number,
  totalLength: number,
  limit: number,
): ApprovalContentSnapshot {
  let prefix = "";
  if (start > 0) {
    prefix = `…（前 ${start} 行已省略）\n`;
  }
  let suffix = "";
  if (end < lines.length) {
    suffix = `\n…（后 ${lines.length - end} 行已省略）`;
  }
  let text = `${prefix}${lines.slice(start, end).join("\n")}${suffix}`;
  let truncated = start > 0 || end < lines.length || totalLength > limit;
  if (text.length > limit) {
    text = text.slice(0, limit);
    truncated = true;
  }
  return {
    text,
    length: totalLength,
    lineCount: lines.length,
    truncated,
    startLine: start + 1,
  };
}

/** 围绕首次 diff 截取快照，避免大文件小改动在「文件头截断」下 diff 为空。 */
export function contentSnapshotPair(
  oldContent: string,
  newContent: string,
  limit = CONTENT_SNAPSHOT_LIMIT,
): { old: ApprovalContentSnapshot; new: ApprovalContentSnapshot } {
  if (oldContent === newContent) {
    const snap = contentSnapshot(oldContent);
    return { old: snap, new: snap };
  }

  if (oldContent.length <= limit && newContent.length <= limit) {
    return {
      old: contentSnapshot(oldContent),
      new: contentSnapshot(newContent),
    };
  }

  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const diff = computeLineDiff(oldContent, newContent);

  let oldIdx = 0;
  let newIdx = 0;
  let firstOld = oldLines.length;
  let firstNew = newLines.length;
  let lastOld = -1;
  let lastNew = -1;

  for (const row of diff) {
    if (row.kind === "equal") {
      oldIdx += 1;
      newIdx += 1;
    } else if (row.kind === "delete") {
      firstOld = Math.min(firstOld, oldIdx);
      lastOld = Math.max(lastOld, oldIdx);
      oldIdx += 1;
    } else {
      firstNew = Math.min(firstNew, newIdx);
      lastNew = Math.max(lastNew, newIdx);
      newIdx += 1;
    }
  }

  if (lastOld < 0 && lastNew < 0) {
    return {
      old: contentSnapshot(oldContent),
      new: contentSnapshot(newContent),
    };
  }

  const context = 12;
  const startOld = Math.max(
    0,
    (firstOld === oldLines.length ? Math.max(lastOld, 0) : firstOld) - context,
  );
  const endOld = Math.min(
    oldLines.length,
    Math.max(lastOld, firstOld) + context + 1,
  );
  const startNew = Math.max(
    0,
    (firstNew === newLines.length ? Math.max(lastNew, 0) : firstNew) - context,
  );
  const endNew = Math.min(
    newLines.length,
    Math.max(lastNew, firstNew) + context + 1,
  );

  return {
    old: buildFocusedSlice(
      oldLines,
      startOld,
      endOld,
      oldContent.length,
      limit,
    ),
    new: buildFocusedSlice(
      newLines,
      startNew,
      endNew,
      newContent.length,
      limit,
    ),
  };
}
