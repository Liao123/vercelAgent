/**
 * 只读文件工具。
 *
 * 当前阶段只实现目录读取、文本文件读取和搜索。写文件、patch、删除文件属于后续
 * 审批机制完成后的工作项，不能混在这里提前放开。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveInsideWorkspace,
  toWorkspaceRelative,
} from "@/agent/tools/path-safety";

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".agent-state",
  ".agent-traces",
  "node_modules",
  "dist",
  "dist-desktop",
  "build",
  "coverage",
]);

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".scss",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

export type DirectoryEntryInfo = {
  name: string;
  path: string;
  type: "file" | "directory";
};

export type ReadFileResult = {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
};

export type SearchMatch = {
  path: string;
  line: number;
  text: string;
};

export async function listDirectory(
  rootPath: string,
  relativePath = ".",
): Promise<DirectoryEntryInfo[]> {
  const absolutePath = resolveInsideWorkspace(rootPath, relativePath);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });

  return entries
    .filter((entry) => !DEFAULT_IGNORED_DIRS.has(entry.name))
    .map((entry) => {
      const entryPath = path.join(absolutePath, entry.name);
      return {
        name: entry.name,
        path: toWorkspaceRelative(rootPath, entryPath),
        type: entry.isDirectory() ? "directory" : "file",
      } satisfies DirectoryEntryInfo;
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function readTextFile(
  rootPath: string,
  relativePath: string,
  maxBytes = 200_000,
): Promise<ReadFileResult> {
  const absolutePath = resolveInsideWorkspace(rootPath, relativePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${relativePath}`);
  }

  const handle = await fs.open(absolutePath, "r");
  try {
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return {
      path: toWorkspaceRelative(rootPath, absolutePath),
      content: buffer.toString("utf8"),
      size: stat.size,
      truncated: stat.size > maxBytes,
    };
  } finally {
    await handle.close();
  }
}

export async function searchText(
  rootPath: string,
  query: string,
  maxResults = 100,
  options?: { scopeRelativeDirs?: string[] },
): Promise<SearchMatch[]> {
  if (!query.trim()) return [];
  const normalizedQuery = query.toLowerCase();
  const matches: SearchMatch[] = [];

  async function visit(directory: string): Promise<void> {
    if (matches.length >= maxResults) return;

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= maxResults) return;
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      const stat = await fs.stat(absolutePath);
      if (stat.size > 1_000_000) continue;

      const content = await fs.readFile(absolutePath, "utf8");
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].toLowerCase().includes(normalizedQuery)) {
          matches.push({
            path: toWorkspaceRelative(rootPath, absolutePath),
            line: index + 1,
            text: lines[index],
          });
          if (matches.length >= maxResults) return;
        }
      }
    }
  }

  const scopeDirs = options?.scopeRelativeDirs?.filter(Boolean);
  if (scopeDirs && scopeDirs.length > 0) {
    for (const relativeDir of scopeDirs) {
      await visit(resolveInsideWorkspace(rootPath, relativeDir));
      if (matches.length >= maxResults) break;
    }
  } else {
    await visit(resolveInsideWorkspace(rootPath, "."));
  }

  return rankSearchMatchesForUiIntent(query, matches);
}

/** @ 联想：按路径片段匹配文件名（仅文本类扩展名）。 */
export async function suggestFilePaths(
  rootPath: string,
  query: string,
  maxResults = 24,
): Promise<string[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const results: string[] = [];
  let visited = 0;
  const maxVisited = 12_000;

  async function visit(directory: string): Promise<void> {
    if (results.length >= maxResults || visited >= maxVisited) return;
    visited += 1;

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults || visited >= maxVisited) return;
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      const relative = toWorkspaceRelative(rootPath, absolutePath);
      const normalized = relative.replaceAll("\\", "/").toLowerCase();
      if (
        normalized.includes(needle) ||
        entry.name.toLowerCase().includes(needle)
      ) {
        results.push(relative.replaceAll("\\", "/"));
      }
    }
  }

  await visit(resolveInsideWorkspace(rootPath, "."));
  return sortPathSuggestions(results, needle);
}

function sortPathSuggestions(results: string[], needle: string): string[] {
  return [...new Set(results)].sort((a, b) => {
    const aName = a.split("/").pop() ?? a;
    const bName = b.split("/").pop() ?? b;
    const aExact = aName.toLowerCase() === needle ? 1 : 0;
    const bExact = bName.toLowerCase() === needle ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aStarts = aName.toLowerCase().startsWith(needle) ? 1 : 0;
    const bStarts = bName.toLowerCase().startsWith(needle) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;
    return a.length - b.length;
  });
}

/** @ 刚弹出时（无筛选词）展示的常用路径。 */
export async function listWorkspaceFileHints(
  rootPath: string,
  maxResults = 32,
): Promise<string[]> {
  const results: string[] = [];
  const maxDepth = 8;

  async function visit(directory: string, depth: number): Promise<void> {
    if (results.length >= maxResults || depth > maxDepth) return;

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, depth + 1);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      results.push(toWorkspaceRelative(rootPath, absolutePath).replaceAll("\\", "/"));
    }
  }

  await visit(resolveInsideWorkspace(rootPath, "."), 0);
  return results
    .sort((a, b) => composerHintRank(a) - composerHintRank(b))
    .slice(0, maxResults);
}

function composerHintRank(filePath: string): number {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("src/")) return 0;
  if (normalized.startsWith("docs/")) return 10;
  if (normalized.startsWith("scripts/")) return 20;
  if (normalized === "package.json") return 5;
  return 100 + normalized.length;
}

function searchPathRank(filePath: string): number {
  const normalized = filePath.replaceAll("\\", "/");
  if (/^src\/app\/page\./.test(normalized)) return 100;
  if (/^src\/components\//.test(normalized)) return 85;
  if (/^src\/app\//.test(normalized)) return 75;
  if (/^src\/agent\/core\//.test(normalized)) return 15;
  if (/^src\/agent\//.test(normalized)) return 25;
  return 50;
}

/** 搜可见 UI 文案（如「闭环」）时，优先 components / app，避免先命中 agent 运行时。 */
function rankSearchMatchesForUiIntent(
  query: string,
  matches: SearchMatch[],
): SearchMatch[] {
  const q = query.toLowerCase();
  const uiLabelSearch =
    /闭环|loop|按钮|选择|记忆|审批|工作区/.test(q) &&
    !/agent-loop|agent_loop/.test(q);

  if (!uiLabelSearch) return matches;

  return [...matches].sort((a, b) => {
    const rankDiff = searchPathRank(b.path) - searchPathRank(a.path);
    if (rankDiff !== 0) return rankDiff;
    return a.path.localeCompare(b.path);
  });
}
