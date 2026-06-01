/**
 * 从路由入口页（默认 src/app/page.tsx）沿 import 链追踪 UI 组件树。
 * 帮助 Agent 像 Cursor 一样从「用户看到的页面」往下找真正该改的文件。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveInsideWorkspace,
  toWorkspaceRelative,
} from "@/agent/tools/path-safety";
import type { AgentUiContext } from "@/agent/types";
import { isUiLocationQuery } from "@/agent/core/prepare-gate";
import { layoutCandidateBoost } from "@/agent/indexer/ui-layout-boost";

const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

export type UiTraceNode = {
  filePath: string;
  depth: number;
  importedFrom?: string;
  /** 文件中出现的可见 UI 文案片段（中文、引号内短标签） */
  visibleLabels: string[];
};

export type UiEntryTraceResult = {
  entryPath: string;
  route?: string;
  nodes: UiTraceNode[];
  /** 建议按此顺序 file.read */
  suggestedReadOrder: string[];
  summary: string;
};

function normalizeRelative(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function routeFromPagePath(filePath: string): string | undefined {
  const normalized = normalizeRelative(filePath);
  if (normalized === "src/app/page.tsx" || normalized === "src/app/page.ts") {
    return "/";
  }
  const match = /^src\/app\/(.+)\/page\.(tsx|ts|jsx|js)$/.exec(normalized);
  if (!match) return undefined;
  const segment = match[1].replace(/\/?\(.*?\)/g, "").replace(/\/+/g, "/");
  return segment ? `/${segment}` : "/";
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveImportModule(
  rootPath: string,
  fromRelativePath: string,
  spec: string,
): Promise<string | null> {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith(".") && !trimmed.startsWith("@/")) return null;

  let target: string;
  if (trimmed.startsWith("@/")) {
    target = `src/${trimmed.slice(2)}`;
  } else {
    const fromDir = path.dirname(
      resolveInsideWorkspace(rootPath, fromRelativePath),
    );
    target = toWorkspaceRelative(rootPath, path.join(fromDir, trimmed));
  }

  target = normalizeRelative(target);

  const candidates: string[] = [];
  if (RESOLVE_EXTENSIONS.some((ext) => target.endsWith(ext))) {
    candidates.push(target);
  } else {
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(`${target}${ext}`);
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(`${target}/index${ext}`);
    }
  }

  for (const candidate of candidates) {
    const absolute = resolveInsideWorkspace(rootPath, candidate);
    if (await fileExists(absolute)) {
      return normalizeRelative(toWorkspaceRelative(rootPath, absolute));
    }
  }

  return null;
}

function parseLocalImports(content: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /import\s+(?:type\s+)?(?:[\w*\s{},]+)\s+from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /export\s+[\w*\s{},]+\s+from\s+["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const spec = match[1]?.trim();
      if (spec) specs.add(spec);
    }
  }

  return [...specs];
}

function extractVisibleLabels(content: string, limit = 12): string[] {
  const labels = new Set<string>();

  for (const match of content.matchAll(/[\u4e00-\u9fff]{2,12}/g)) {
    labels.add(match[0]);
    if (labels.size >= limit) break;
  }

  for (const match of content.matchAll(/>([^<>{}]{1,24})<\//g)) {
    const text = match[1]?.trim();
    if (text && text.length >= 2 && !text.includes("{")) {
      labels.add(text);
      if (labels.size >= limit) break;
    }
  }

  for (const match of content.matchAll(
    /["'](Loop|闭环|Agent|Workspace|记忆|审批|发送|运行)[^"']{0,20}["']/gi,
  )) {
    labels.add(match[0].slice(1, -1));
    if (labels.size >= limit) break;
  }

  return [...labels].slice(0, limit);
}

/** 组件树内优先读含可见控件文案（如 Loop/闭环）的文件，再按 depth 浅→深。 */
function rankSuggestedReadOrder(
  nodes: UiTraceNode[],
  query?: string,
  uiContext?: AgentUiContext,
): string[] {
  const normalizedQuery = query?.toLowerCase() ?? "";
  const queryMentionsRunMode =
    /闭环|loop|运行模式|runmode|run mode/.test(normalizedQuery);

  function boost(node: UiTraceNode): number {
    const labels = node.visibleLabels.join(" ").toLowerCase();
    let score = layoutCandidateBoost(node.filePath, uiContext);
    if (/闭环|loop/.test(labels)) score += 20;
    if (queryMentionsRunMode && /闭环|loop/.test(labels)) score += 30;
    return score;
  }

  return nodes
    .filter((node) => node.filePath.startsWith("src/components/"))
    .sort((a, b) => {
      const boostDiff = boost(b) - boost(a);
      if (boostDiff !== 0) return boostDiff;
      return a.depth - b.depth;
    })
    .map((node) => node.filePath);
}

export async function traceUiEntryFromPage(
  rootPath: string,
  entryPath = "src/app/page.tsx",
  maxDepth = 5,
  uiContext?: AgentUiContext,
): Promise<UiEntryTraceResult> {
  const normalizedEntry = normalizeRelative(entryPath);
  const nodes: UiTraceNode[] = [];
  const visited = new Set<string>();
  const queue: Array<{ filePath: string; depth: number; importedFrom?: string }> =
    [{ filePath: normalizedEntry, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.filePath)) continue;
    visited.add(current.filePath);

    let content = "";
    try {
      const absolute = resolveInsideWorkspace(rootPath, current.filePath);
      content = await fs.readFile(absolute, "utf8");
    } catch {
      continue;
    }

    nodes.push({
      filePath: current.filePath,
      depth: current.depth,
      importedFrom: current.importedFrom,
      visibleLabels: extractVisibleLabels(content),
    });

    if (current.depth >= maxDepth) continue;

    for (const spec of parseLocalImports(content)) {
      const resolved = await resolveImportModule(
        rootPath,
        current.filePath,
        spec,
      );
      if (!resolved || visited.has(resolved)) continue;
      if (resolved.startsWith("src/agent/core/")) continue;

      queue.push({
        filePath: resolved,
        depth: current.depth + 1,
        importedFrom: current.filePath,
      });
    }
  }

  const suggestedReadOrder = rankSuggestedReadOrder(nodes, undefined, uiContext);

  if (suggestedReadOrder.length === 0) {
    for (const node of nodes) {
      if (node.filePath !== normalizedEntry) {
        suggestedReadOrder.push(node.filePath);
      }
    }
  }

  const route = routeFromPagePath(normalizedEntry);
  const componentCount = nodes.filter((n) =>
    n.filePath.startsWith("src/components/"),
  ).length;

  return {
    entryPath: normalizedEntry,
    route,
    nodes,
    suggestedReadOrder,
    summary: `从 ${normalizedEntry}${route ? ` (${route})` : ""} 沿 import 追踪到 ${nodes.length} 个文件（${componentCount} 个 component）。UI 改动请优先 file.read suggestedReadOrder 中的文件，不要只改 agent 运行时。`,
  };
}

/** 供 file.locate 加权重：首页/UI 意图时合并入口追踪结果。 */
export async function traceUiEntryForQuery(
  rootPath: string,
  query: string,
  uiContext?: AgentUiContext,
): Promise<UiEntryTraceResult | null> {
  const normalized = query.toLowerCase();
  const shouldTrace = isUiLocationQuery(normalized);

  if (!shouldTrace) return null;
  const trace = await traceUiEntryFromPage(
    rootPath,
    "src/app/page.tsx",
    5,
    uiContext,
  );
  return {
    ...trace,
    suggestedReadOrder: rankSuggestedReadOrder(trace.nodes, query, uiContext),
  };
}
