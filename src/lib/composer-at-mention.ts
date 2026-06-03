const MENTION_PATTERN = /@([^\s@][^\s]*)/g;

export function normalizeMentionPath(raw: string): string {
  return raw.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

/** 从输入正文解析 @ 文件路径（提交 Loop 时用）。 */
export function extractAtMentionPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const path = normalizeMentionPath(match[1] ?? "");
    if (path) paths.push(path);
  }
  return [...new Set(paths)];
}

export function requestContainsAtPath(text: string, filePath: string): boolean {
  const norm = normalizeMentionPath(filePath);
  return extractAtMentionPaths(text).includes(norm);
}

export type RequestSegment =
  | { type: "text"; value: string }
  | { type: "mention"; path: string };

/** 拆分正文与 @ 提及，供输入框内高亮渲染。 */
export function parseRequestSegments(text: string): RequestSegment[] {
  if (!text) return [{ type: "text", value: "" }];

  const segments: RequestSegment[] = [];
  let last = 0;

  for (const match of text.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ type: "text", value: text.slice(last, index) });
    }
    segments.push({
      type: "mention",
      path: normalizeMentionPath(match[1] ?? ""),
    });
    last = index + match[0].length;
  }

  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

/** @路径 已确认（后接空白或光标在提及之后），不应再弹出联想。 */
export function isCommittedAtMention(
  text: string,
  atIndex: number,
  cursor: number,
): boolean {
  const rest = text.slice(atIndex);
  const mentionMatch = /^@([^\s@][^\s]*)/.exec(rest);
  if (!mentionMatch) return false;

  const mentionEnd = atIndex + mentionMatch[0].length;
  if (cursor < mentionEnd) return false;

  const boundary = text[mentionEnd];
  if (cursor > mentionEnd) {
    return boundary === " " || boundary === "\n" || boundary === "\t";
  }

  return boundary === " " || boundary === "\n" || boundary === "\t";
}

/** 解析输入框光标处的 @ 文件联想片段。 */
export function parseActiveAtQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;

  if (isCommittedAtMention(text, atIndex, safeCursor)) {
    return null;
  }

  const fragment = before.slice(atIndex + 1);
  if (/[\s\n]/.test(fragment)) return null;

  return { start: atIndex, query: fragment };
}

export function mergePathSuggestions(
  query: string,
  recentPaths: string[],
  searched: string[],
  limit = 12,
): string[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const merged: string[] = [];

  const push = (raw: string) => {
    const path = raw.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (!path || seen.has(path)) return;
    if (needle && !path.toLowerCase().includes(needle)) return;
    seen.add(path);
    merged.push(path);
  };

  for (const path of recentPaths) push(path);
  for (const path of searched) push(path);
  return merged.slice(0, limit);
}

export type MentionRange = { start: number; end: number; path: string };

export function findMentionRanges(text: string): MentionRange[] {
  const ranges: MentionRange[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const start = match.index ?? 0;
    ranges.push({
      start,
      end: start + match[0].length,
      path: normalizeMentionPath(match[1] ?? ""),
    });
  }
  return ranges;
}

function expandMentionDeleteEnd(text: string, end: number): number {
  return text[end] === " " ? end + 1 : end;
}

/** Backspace/Delete 时若落在 @提及 内，返回应整段删除的区间。 */
export function resolveMentionDeleteRange(
  text: string,
  selStart: number,
  selEnd: number,
  key: "Backspace" | "Delete",
): { start: number; end: number } | null {
  const ranges = findMentionRanges(text);
  if (ranges.length === 0) return null;

  if (selStart !== selEnd) {
    let delStart = selStart;
    let delEnd = selEnd;
    let hit = false;
    for (const range of ranges) {
      if (range.end > selStart && range.start < selEnd) {
        delStart = Math.min(delStart, range.start);
        delEnd = Math.max(delEnd, range.end);
        hit = true;
      }
    }
    if (!hit) return null;
    return { start: delStart, end: expandMentionDeleteEnd(text, delEnd) };
  }

  const cursor = selStart;

  if (key === "Backspace") {
    for (const range of ranges) {
      if (cursor > range.start && cursor <= range.end) {
        return {
          start: range.start,
          end: expandMentionDeleteEnd(text, range.end),
        };
      }
    }
  }

  if (key === "Delete") {
    for (const range of ranges) {
      if (cursor >= range.start && cursor < range.end) {
        return {
          start: range.start,
          end: expandMentionDeleteEnd(text, range.end),
        };
      }
    }
  }

  return null;
}

/** 左右方向键在 @提及 整块上跳转光标（不含 Shift 选区扩展）。 */
export function resolveMentionArrowCursor(
  text: string,
  cursor: number,
  direction: "left" | "right",
): number | null {
  const ranges = findMentionRanges(text);
  for (const range of ranges) {
    const blockEnd = expandMentionDeleteEnd(text, range.end);
    if (direction === "left") {
      if (cursor > range.start && cursor <= blockEnd) {
        return range.start;
      }
    } else if (cursor >= range.start && cursor < blockEnd) {
      return blockEnd;
    }
  }
  return null;
}

export function removeTextRange(
  text: string,
  start: number,
  end: number,
): { nextText: string; nextCursor: number } {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const nextText = text.slice(0, safeStart) + text.slice(safeEnd);
  return { nextText, nextCursor: safeStart };
}

export function insertAtMention(
  text: string,
  mentionStart: number,
  cursor: number,
  filePath: string,
): { nextText: string; nextCursor: number } {
  const token = `@${normalizeMentionPath(filePath)}`;
  const before = text.slice(0, mentionStart);
  const after = text.slice(cursor);
  const spacer = /^\s/.test(after) ? "" : " ";
  const nextText = `${before}${token}${spacer}${after}`;
  const nextCursor = before.length + token.length + spacer.length;
  return { nextText, nextCursor };
}
