/**
 * 轻量项目索引器。
 *
 * 不引入新依赖，先用文件路径和正则提取足够有用的开发上下文：
 * 路由、页面、组件、API route、imports、exports、业务关键词和摘要。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "@/agent/types";
import {
  resolveInsideWorkspace,
  toWorkspaceRelative,
} from "@/agent/tools/path-safety";
import type {
  ProjectFileIndex,
  ProjectFileKind,
  ProjectIndex,
} from "@/agent/indexer/types";

const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

const INDEXED_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function routeFromAppPath(filePath: string): string | undefined {
  const normalized = filePath.replaceAll("\\", "/");
  const match = /^src\/app\/(.+)\/(page|route)\.(tsx|ts|js|jsx)$/.exec(
    normalized,
  );
  if (!match) {
    if (/^src\/app\/page\.(tsx|ts|js|jsx)$/.test(normalized)) return "/";
    if (/^src\/app\/api\/.+\/route\.(ts|js)$/.test(normalized)) {
      return `/${normalized
        .replace(/^src\/app\//, "")
        .replace(/\/route\.(ts|js)$/, "")}`;
    }
    return undefined;
  }

  const rawRoute = match[1]
    .replace(/\/?\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]/g, ":$1")
    .replace(/\/page$/, "");

  if (rawRoute === "page") return "/";
  return `/${rawRoute}`.replace(/\/+/g, "/");
}

function detectKind(filePath: string): ProjectFileKind {
  const normalized = filePath.replaceAll("\\", "/");
  const basename = path.basename(normalized);

  if (/^src\/app\/.*\/page\.(tsx|ts|js|jsx)$/.test(normalized)) return "page";
  if (/^src\/app\/page\.(tsx|ts|js|jsx)$/.test(normalized)) return "page";
  if (/^src\/app\/.*\/layout\.(tsx|ts|js|jsx)$/.test(normalized)) {
    return "layout";
  }
  if (/^src\/app\/api\/.*\/route\.(ts|js)$/.test(normalized)) {
    return "api_route";
  }
  if (/^src\/components\/.+\.(tsx|jsx|ts|js)$/.test(normalized)) {
    return "component";
  }
  if (/^src\/agent\//.test(normalized)) return "agent";
  if (/^scripts\//.test(normalized)) return "script";
  if (basename.endsWith(".config.ts") || basename.endsWith(".config.mjs")) {
    return "config";
  }
  if (basename === "package.json" || basename === "tsconfig.json") return "config";
  if (basename.endsWith(".md")) return "doc";
  if (/^public\//.test(normalized)) return "asset";
  if (/^src\//.test(normalized)) return "source";
  return "unknown";
}

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  const importPattern = /import\s+(?:.+?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of content.matchAll(importPattern)) {
    imports.add(match[1]);
  }
  return [...imports].sort();
}

function extractExports(content: string): string[] {
  const exports = new Set<string>();
  const exportPattern =
    /export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z0-9_]+)/g;
  for (const match of content.matchAll(exportPattern)) {
    exports.add(match[1]);
  }
  return [...exports].sort();
}

function extractApiMethods(content: string): string[] {
  const methods = new Set<string>();
  const methodPattern =
    /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  for (const match of content.matchAll(methodPattern)) {
    methods.add(match[1]);
  }
  return [...methods].sort();
}

function extractBusinessKeywords(filePath: string, content: string): string[] {
  const keywords = new Set<string>();
  const fromPath = filePath
    .split(/[\\/._-]+/)
    .filter((part) => part.length >= 3 && !["src", "app", "tsx", "route"].includes(part));
  for (const part of fromPath) keywords.add(part);

  const chinesePattern = /[\u4e00-\u9fff]{2,}/g;
  for (const match of content.matchAll(chinesePattern)) {
    keywords.add(match[0].slice(0, 24));
    if (keywords.size >= 40) break;
  }

  return [...keywords].sort();
}

function summarizeFile(input: {
  filePath: string;
  kind: ProjectFileKind;
  route?: string;
  exports: string[];
  imports: string[];
  apiMethods: string[];
}): string {
  const parts = [`${input.kind} file at ${input.filePath}`];
  if (input.route) parts.push(`route ${input.route}`);
  if (input.exports.length) parts.push(`exports ${input.exports.join(", ")}`);
  if (input.apiMethods.length) {
    parts.push(`handles ${input.apiMethods.join(", ")}`);
  }
  if (input.imports.length) {
    parts.push(`imports ${input.imports.slice(0, 8).join(", ")}`);
  }
  return parts.join("; ");
}

async function walkFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!INDEXED_EXTENSIONS.has(ext)) continue;

      files.push(toWorkspaceRelative(rootPath, absolutePath));
    }
  }

  await visit(resolveInsideWorkspace(rootPath, "."));
  return files.sort();
}

export async function buildProjectIndex(rootPath: string): Promise<ProjectIndex> {
  const filePaths = await walkFiles(rootPath);
  const files: ProjectFileIndex[] = [];

  for (const filePath of filePaths) {
    const absolutePath = resolveInsideWorkspace(rootPath, filePath);
    const stat = await fs.stat(absolutePath);
    if (stat.size > 1_000_000) continue;

    const content = await fs.readFile(absolutePath, "utf8");
    const kind = detectKind(filePath);
    const route = routeFromAppPath(filePath);
    const imports = extractImports(content);
    const exports = extractExports(content);
    const apiMethods = extractApiMethods(content);
    const businessKeywords = extractBusinessKeywords(filePath, content);
    const summary = summarizeFile({
      filePath,
      kind,
      route,
      exports,
      imports,
      apiMethods,
    });

    files.push({
      filePath,
      kind,
      route,
      exports,
      imports,
      apiMethods,
      businessKeywords,
      summary,
      size: stat.size,
    });
  }

  const keywords: Record<string, string[]> = {};
  for (const file of files) {
    for (const keyword of file.businessKeywords) {
      keywords[keyword] ??= [];
      keywords[keyword].push(file.filePath);
    }
  }

  return {
    workspaceRoot: rootPath,
    generatedAt: nowIso(),
    files,
    routes: files.filter((file) => file.kind === "page"),
    apiRoutes: files.filter((file) => file.kind === "api_route"),
    components: files.filter((file) => file.kind === "component"),
    keywords,
  };
}
