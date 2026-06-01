/**
 * 用户 @path 附加文件（A080 MVP）。
 */
import { readTextFile } from "@/agent/tools/file-tools";

const ATTACHED_PATH =
  /@([\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|mjs|mts|yml|yaml))\b/gi;

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
} {
  const attachedPaths: string[] = [];
  for (const match of userRequest.matchAll(ATTACHED_PATH)) {
    attachedPaths.push(normalizePath(match[1]));
  }
  const cleanRequest = userRequest
    .replace(ATTACHED_PATH, (_full, path: string) => normalizePath(path))
    .replace(/\s{2,}/g, " ")
    .trim();
  return {
    cleanRequest,
    attachedPaths: uniquePaths(attachedPaths),
  };
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
}): Promise<PreloadedAttachedFile[]> {
  const maxBytes = input.maxBytes ?? 500_000;
  const results: PreloadedAttachedFile[] = [];

  for (const path of input.paths) {
    try {
      const read = await readTextFile(input.rootPath, path, maxBytes);
      results.push({
        path: read.path,
        content: read.content,
        truncated: read.truncated,
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

export function formatAttachedFilesUserNote(paths: string[]): string {
  if (paths.length === 0) return "";
  return [
    "[ATTACHED_FILES]",
    `User attached ${paths.length} file(s) for this task (content pre-loaded below):`,
    ...paths.map((path) => `- ${path}`),
    "Prefer editing attached files when the request targets them; they already count as file.read evidence.",
  ].join("\n");
}
