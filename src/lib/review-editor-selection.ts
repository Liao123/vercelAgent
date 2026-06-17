/** 审查区 diff 文本选区 → 文件行号（A108 MVP）。 */

export type ReviewEditorSelection = {
  path: string;
  startLine: number;
  endLine: number;
  selectedText: string;
};

export type DiffDomSelection = {
  startLine: number;
  endLine: number;
  selectedText: string;
};

function lineFromNode(root: HTMLElement, node: Node | null): number | null {
  let el: Element | null =
    node instanceof Element ? node : node?.parentElement ?? null;
  while (el && el !== root) {
    const raw = el.getAttribute("data-diff-line");
    if (raw) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    el = el.parentElement;
  }
  return null;
}

/** 从 diff 容器内浏览器选区解析绝对行号。 */
export function parseDiffDomSelection(root: HTMLElement): DiffDomSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) {
    return null;
  }

  const selectedText = sel.toString();
  if (!selectedText.trim()) return null;

  const startLine = lineFromNode(root, sel.anchorNode);
  const endLine = lineFromNode(root, sel.focusNode);
  if (startLine == null || endLine == null) return null;

  return {
    startLine: Math.min(startLine, endLine),
    endLine: Math.max(startLine, endLine),
    selectedText: selectedText.slice(0, 4_000),
  };
}

export function formatMentionLineRange(
  startLine: number,
  endLine: number,
): string {
  if (startLine === endLine) return `#L${startLine}`;
  return `#L${startLine}-${endLine}`;
}

export function splitMentionToken(raw: string): {
  path: string;
  startLine?: number;
  endLine?: number;
} {
  const normalized = raw.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const match = /^(.+?)#L(\d+)(?:-(\d+))?$/.exec(normalized);
  if (!match) return { path: normalized };
  const startLine = Number.parseInt(match[2], 10);
  const endLine = match[3]
    ? Number.parseInt(match[3], 10)
    : startLine;
  if (!Number.isFinite(startLine) || startLine < 1) {
    return { path: normalized };
  }
  return {
    path: match[1],
    startLine,
    endLine: Number.isFinite(endLine) && endLine >= startLine ? endLine : startLine,
  };
}
