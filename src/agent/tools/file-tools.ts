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
  "node_modules",
  "dist",
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
): Promise<SearchMatch[]> {
  if (!query.trim()) return [];
  const normalizedQuery = query.toLowerCase();
  const matches: SearchMatch[] = [];

  async function visit(directory: string): Promise<void> {
    if (matches.length >= maxResults) return;

    const entries = await fs.readdir(directory, { withFileTypes: true });
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

  await visit(resolveInsideWorkspace(rootPath, "."));
  return matches;
}
