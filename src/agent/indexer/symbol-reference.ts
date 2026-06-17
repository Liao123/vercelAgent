/**
 * 轻量 JSX 文案定位与 import 引用查找（A078，无 AST 依赖）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { layoutCandidateBoost } from "@/agent/indexer/ui-layout-boost";
import { isUiLocationQuery } from "@/agent/core/prepare-gate";
import type { ProjectIndex } from "@/agent/indexer/types";
import type { AgentUiContext } from "@/agent/types";
import {
  resolveInsideWorkspace,
  toWorkspaceRelative,
} from "@/agent/tools/path-safety";

const JSX_EXTENSIONS = new Set([".tsx", ".jsx"]);
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".agent-state",
  ".agent-traces",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

export type JsxTextMatchKind = "jsx_children" | "attribute" | "string_literal";

export type JsxTextMatch = {
  filePath: string;
  line: number;
  lineText: string;
  matchKind: JsxTextMatchKind;
  componentName?: string;
  score: number;
  reasons: string[];
};

export type SymbolReferenceMatch = {
  filePath: string;
  importSpec: string;
  line?: number;
  lineText?: string;
  kind: "import";
};

export type SymbolDefinitionMatch = {
  filePath: string;
  exportName: string;
  kind: "definition";
};

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function pathRank(filePath: string): number {
  const normalized = normalizePath(filePath);
  if (normalized.startsWith("src/components/")) return 90;
  if (normalized.startsWith("src/app/")) return 80;
  if (normalized.startsWith("src/agent/core/")) return 10;
  if (normalized.startsWith("src/agent/")) return 25;
  return 50;
}

function classifyJsxMatchLine(lineText: string, query: string): JsxTextMatchKind {
  if (/>[^<{]+<\//.test(lineText) && lineText.includes(query)) {
    return "jsx_children";
  }
  if (/=\{?\s*["']/.test(lineText) && lineText.includes(query)) {
    return "attribute";
  }
  return "string_literal";
}

function inferComponentName(lines: string[], lineIndex: number): string | undefined {
  let best: string | undefined;
  for (let i = 0; i <= lineIndex && i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fnMatch = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/.exec(
      line,
    );
    if (fnMatch) {
      best = fnMatch[1];
      continue;
    }
    const constMatch =
      /export\s+(?:default\s+)?(?:const|function)\s+([A-Z][A-Za-z0-9_]*)\s*=/.exec(
        line,
      );
    if (constMatch) best = constMatch[1];
  }
  return best;
}

function scoreJsxMatch(input: {
  filePath: string;
  lineText: string;
  matchKind: JsxTextMatchKind;
  uiContext?: AgentUiContext;
  uiIntent: boolean;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = pathRank(input.filePath);
  reasons.push(`path rank ${score}`);

  const layoutBonus = layoutCandidateBoost(input.filePath, input.uiContext);
  if (layoutBonus !== 0) {
    score += layoutBonus;
    reasons.push(`layout ${layoutBonus}`);
  }

  if (input.matchKind === "jsx_children") {
    score += 12;
    reasons.push("jsx children text");
  } else if (input.matchKind === "attribute") {
    score += 8;
    reasons.push("attribute value");
  }

  if (/<(?:button|select|input|option|label)/i.test(input.lineText)) {
    score += 10;
    reasons.push("control element");
  }

  if (input.uiIntent && input.filePath.includes("agent-session-sidebar")) {
    if (/onNewSessionInProject/.test(input.lineText) || /^\s*\+\s*$/.test(input.lineText.trim())) {
      score += 16;
      reasons.push("sidebar session control");
    }
  }

  if (input.uiIntent && input.filePath.startsWith("src/agent/core/")) {
    score -= 35;
    reasons.push("agent runtime penalty");
  }

  return { score, reasons };
}

async function walkJsxFiles(rootPath: string): Promise<string[]> {
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
      if (!JSX_EXTENSIONS.has(ext)) continue;
      files.push(toWorkspaceRelative(rootPath, absolutePath));
    }
  }

  await visit(resolveInsideWorkspace(rootPath, "."));
  return files;
}

function resolveJsxSearchTerms(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  if (/^(?:加号|＋|plus)$/i.test(q)) return ["+"];
  if (/(?:加号|＋)/.test(q) && /(?:侧栏|项目|会话|新建)/.test(q)) {
    return ["+", "新建会话"];
  }
  return [q];
}

/** 在 TSX/JSX 中查找可见文案，返回带组件名推断与 UI 路径加权的结果。 */
export async function findJsxText(input: {
  rootPath: string;
  query: string;
  maxResults?: number;
  uiContext?: AgentUiContext;
}): Promise<{ query: string; matches: JsxTextMatch[] }> {
  const query = input.query.trim();
  if (!query) return { query, matches: [] };

  const searchTerms = resolveJsxSearchTerms(query);
  const maxResults = input.maxResults ?? 24;
  const uiIntent = isUiLocationQuery(query);
  const matches: JsxTextMatch[] = [];

  for (const relativePath of await walkJsxFiles(input.rootPath)) {
    let content: string;
    try {
      content = await fs.readFile(
        resolveInsideWorkspace(input.rootPath, relativePath),
        "utf8",
      );
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index]!;
      const matchedTerm = searchTerms.find((term) => {
        if (term === "+") {
          return /^\s*\+\s*$/.test(lineText.trim()) || />\s*\+\s*</.test(lineText);
        }
        return lineText.toLowerCase().includes(term.toLowerCase());
      });
      if (!matchedTerm) continue;

      const matchKind = classifyJsxMatchLine(lineText, matchedTerm);
      const { score, reasons } = scoreJsxMatch({
        filePath: relativePath,
        lineText,
        matchKind,
        uiContext: input.uiContext,
        uiIntent,
      });

      matches.push({
        filePath: relativePath,
        line: index + 1,
        lineText: lineText.trim(),
        matchKind,
        componentName: inferComponentName(lines, index),
        score,
        reasons,
      });
    }
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.line - b.line;
  });

  return { query, matches: matches.slice(0, maxResults) };
}

function moduleKeysForPath(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  const withoutExt = normalized.replace(/\.(tsx|ts|jsx|js)$/, "");
  const baseName = path.basename(withoutExt);
  const keys = new Set<string>([
    normalized,
    withoutExt,
    baseName,
    `@/${withoutExt.replace(/^src\//, "")}`,
    withoutExt.replace(/^src\//, ""),
  ]);
  return [...keys];
}

function importTargetsPath(importSpec: string, targetPath: string): boolean {
  const keys = moduleKeysForPath(targetPath);
  const spec = importSpec.replaceAll("\\", "/");
  const baseName = path.basename(
    normalizePath(targetPath).replace(/\.(tsx|ts|jsx|js)$/, ""),
  );

  if (keys.some((key) => spec === key || spec.endsWith(`/${baseName}`))) {
    return true;
  }
  if (spec.includes(baseName) && (spec.startsWith("@/") || spec.startsWith("."))) {
    return true;
  }
  return false;
}

/** 查找谁 import 了某文件，或谁 export/import 了某符号名。 */
export async function findSymbolReferences(input: {
  rootPath: string;
  index: ProjectIndex;
  path?: string;
  name?: string;
  maxResults?: number;
}): Promise<{
  path?: string;
  name?: string;
  definitions: SymbolDefinitionMatch[];
  references: SymbolReferenceMatch[];
}> {
  const maxResults = input.maxResults ?? 30;
  const definitions: SymbolDefinitionMatch[] = [];
  const references: SymbolReferenceMatch[] = [];

  if (input.name?.trim()) {
    const symbolName = input.name.trim();
    for (const file of input.index.files) {
      if (file.exports.includes(symbolName)) {
        definitions.push({
          filePath: file.filePath,
          exportName: symbolName,
          kind: "definition",
        });
      }
    }

    for (const file of input.index.files) {
      if (!/\.(tsx|ts|jsx|js)$/.test(file.filePath)) continue;
      let content: string;
      try {
        content = await fs.readFile(
          resolveInsideWorkspace(input.rootPath, file.filePath),
          "utf8",
        );
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        if (!/import\s+/.test(line)) continue;
        const namedImport = new RegExp(
          `import\\s+\\{[^}]*\\b${symbolName}\\b[^}]*\\}\\s+from\\s+["']([^"']+)["']`,
        ).exec(line);
        const defaultImport = new RegExp(
          `import\\s+${symbolName}\\s+from\\s+["']([^"']+)["']`,
        ).exec(line);
        const spec = namedImport?.[1] ?? defaultImport?.[1];
        if (!spec) continue;
        references.push({
          filePath: file.filePath,
          importSpec: spec,
          line: i + 1,
          lineText: line.trim(),
          kind: "import",
        });
      }
    }
  }

  if (input.path?.trim()) {
    const targetPath = normalizePath(input.path.trim());
    for (const file of input.index.files) {
      for (const importSpec of file.imports) {
        if (!importTargetsPath(importSpec, targetPath)) continue;
        references.push({
          filePath: file.filePath,
          importSpec,
          kind: "import",
        });
      }
    }
  }

  const dedupedRefs = [
    ...new Map(
      references.map((ref) => [
        `${ref.filePath}:${ref.importSpec}:${ref.line ?? 0}`,
        ref,
      ]),
    ).values(),
  ].slice(0, maxResults);

  return {
    path: input.path?.trim(),
    name: input.name?.trim(),
    definitions: definitions.slice(0, maxResults),
    references: dedupedRefs,
  };
}
