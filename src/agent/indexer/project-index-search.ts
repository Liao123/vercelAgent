/**
 * 按 query 从已有 project index 抽取 scoped 结果（文件候选 + 路由/API 命中）。
 */
import { locateFilesForRequest } from "@/agent/indexer/file-locator";
import type { ProjectFileIndex, ProjectIndex } from "@/agent/indexer/types";

export type ScopedProjectIndexResult = {
  query: string;
  generatedAt: string;
  candidateCount: number;
  candidates: Array<{
    filePath: string;
    kind: string;
    route?: string;
    score: number;
    summary: string;
    reasons: Array<{ label: string; score: number }>;
  }>;
  matchingRoutes: Array<{
    filePath: string;
    route?: string;
    summary: string;
  }>;
  matchingApiRoutes: Array<{
    filePath: string;
    route?: string;
    methods: string[];
    summary: string;
  }>;
};

function normalizeText(text: string): string {
  return text.toLowerCase().replaceAll("\\", "/");
}

function queryTokens(query: string): string[] {
  const normalized = normalizeText(query);
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    tokens.add(match[0]);
  }

  for (const part of normalized.split(/[^a-z0-9_\-\u4e00-\u9fff]+/)) {
    if (part.length >= 2) tokens.add(part);
  }

  return [...tokens];
}

function fileMatchesTokens(file: ProjectFileIndex, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const blob = normalizeText(
    [file.filePath, file.route ?? "", file.summary, ...file.apiMethods].join(" "),
  );
  return tokens.some((token) => blob.includes(token));
}

function mapRouteHit(file: ProjectFileIndex) {
  return {
    filePath: file.filePath,
    route: file.route,
    summary: file.summary,
  };
}

function mapApiHit(file: ProjectFileIndex) {
  return {
    filePath: file.filePath,
    route: file.route,
    methods: file.apiMethods,
    summary: file.summary,
  };
}

export function searchProjectIndex(
  index: ProjectIndex,
  query: string,
  limit = 12,
): ScopedProjectIndexResult {
  const trimmed = query.trim();
  const located = locateFilesForRequest(index, trimmed, limit);
  const tokens = queryTokens(trimmed);

  const matchingRoutes = index.routes
    .filter((file) => fileMatchesTokens(file, tokens))
    .slice(0, 15)
    .map(mapRouteHit);

  const matchingApiRoutes = index.apiRoutes
    .filter((file) => fileMatchesTokens(file, tokens))
    .slice(0, 15)
    .map(mapApiHit);

  return {
    query: trimmed,
    generatedAt: index.generatedAt,
    candidateCount: located.candidates.length,
    candidates: located.candidates.map((candidate) => ({
      filePath: candidate.file.filePath,
      kind: candidate.file.kind,
      route: candidate.file.route,
      score: candidate.score,
      summary: candidate.file.summary,
      reasons: candidate.reasons,
    })),
    matchingRoutes,
    matchingApiRoutes,
  };
}
