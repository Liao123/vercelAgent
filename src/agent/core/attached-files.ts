/**
 * 用户 @path 附加文件（A080 MVP）+ 审查区选区行号（A108）。
 */
import { splitMentionToken } from "@/lib/review-editor-selection";
import { readTextFile } from "@/agent/tools/file-tools";

export type EditorSelectionContext = {
  path: string;
  startLine: number;
  endLine: number;
  selectedText?: string;
};

const ATTACHED_PATH =
  /@([\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|mjs|mts|yml|yaml)(?:#L\d+(?:-\d+)?)?)\b/gi;

const TEXT_FILE =
  /^[\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|mjs|mts|yml|yaml)$/i;

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "").trim();
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    const path = normalizePath(raw);
    if (!path || !TEXT_FILE.test(path) || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

/** 从用户输入解析 @path 引用，并返回去掉 @ 后的干净需求文本。 */
export function parseAtPathsFromRequest(userRequest: string): {
  cleanRequest: string;
  attachedPaths: string[];
  attachedSelections: EditorSelectionContext[];
} {
  const attachedPaths: string[] = [];
  const attachedSelections: EditorSelectionContext[] = [];

  for (const match of userRequest.matchAll(ATTACHED_PATH)) {
    const parsed = splitMentionToken(match[1]);
    attachedPaths.push(parsed.path);
    if (parsed.startLine != null && parsed.endLine != null) {
      attachedSelections.push({
        path: parsed.path,
        startLine: parsed.startLine,
        endLine: parsed.endLine,
      });
    }
  }

  const cleanRequest = userRequest
    .replace(ATTACHED_PATH, (_full, token: string) => {
      const parsed = splitMentionToken(token);
      return parsed.path;
    })
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    cleanRequest,
    attachedPaths: uniquePaths(attachedPaths),
    attachedSelections: mergeAttachedSelections(undefined, attachedSelections),
  };
}

export function mergeAttachedSelections(
  manual: EditorSelectionContext[] | undefined,
  parsed: EditorSelectionContext[],
): EditorSelectionContext[] {
  const byPath = new Map<string, EditorSelectionContext>();
  for (const item of [...(manual ?? []), ...parsed]) {
    const path = normalizePath(item.path);
    if (!path) continue;
    byPath.set(path, {
      path,
      startLine: item.startLine,
      endLine: item.endLine,
      selectedText: item.selectedText?.slice(0, 4_000),
    });
  }
  return [...byPath.values()].slice(0, 8);
}

export function selectionForPath(
  selections: EditorSelectionContext[] | undefined,
  path: string,
): EditorSelectionContext | undefined {
  const norm = normalizePath(path);
  return selections?.find((item) => normalizePath(item.path) === norm);
}

function sliceFileLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split(/\r\n|\n|\r/);
  const start = Math.max(1, startLine);
  const end = Math.min(lines.length, Math.max(start, endLine));
  return lines.slice(start - 1, end).join("\n");
}

export function mergeAttachedPaths(
  manualPaths: string[] | undefined,
  parsedPaths: string[],
): string[] {
  return uniquePaths([...(manualPaths ?? []), ...parsedPaths]).slice(0, 8);
}

export type PreloadedAttachedFile = {
  path: string;
  content?: string;
  error?: string;
  truncated?: boolean;
};

export async function preloadAttachedFiles(input: {
  rootPath: string;
  paths: string[];
  maxBytes?: number;
  selections?: EditorSelectionContext[];
}): Promise<PreloadedAttachedFile[]> {
  const maxBytes = input.maxBytes ?? 500_000;
  const results: PreloadedAttachedFile[] = [];

  for (const path of input.paths) {
    const selection = selectionForPath(input.selections, path);
    try {
      const read = await readTextFile(input.rootPath, path, maxBytes);
      let content = read.content;
      let truncated = read.truncated;
      if (selection && content) {
        content = sliceFileLines(
          content,
          selection.startLine,
          selection.endLine,
        );
        truncated = truncated || content.length >= maxBytes;
      }
      results.push({
        path: read.path,
        content,
        truncated,
      });
    } catch (error) {
      results.push({
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function formatAttachedFilesUserNote(
  paths: string[],
  selections?: EditorSelectionContext[],
): string {
  if (paths.length === 0) return "";
  const lines = [
    "[ATTACHED_FILES]",
    `User attached ${paths.length} file(s) for this task (content pre-loaded below):`,
  ];
  for (const path of paths) {
    const sel = selectionForPath(selections, path);
    if (sel) {
      lines.push(
        `- ${path} (editor selection lines ${sel.startLine}-${sel.endLine})`,
      );
    } else {
      lines.push(`- ${path}`);
    }
  }
  lines.push(
    "Prefer editing attached files when the request targets them; they already count as file.read evidence.",
  );
  if (selections?.length) {
    lines.push(
      "Line-bounded attachments reflect the user's current review/editor selection; focus changes within those lines.",
    );
  }
  return lines.join("\n");
}
