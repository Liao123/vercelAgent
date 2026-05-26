/**
 * 中文需求定位文件。
 *
 * 基于轻量项目索引做候选文件打分。当前是规则/关键词版本：
 * 路径、route、summary、业务关键词、exports/imports 命中越多，分数越高。
 */
import type { ProjectFileIndex, ProjectIndex } from "@/agent/indexer/types";

export type FileCandidateReason = {
  label: string;
  score: number;
};

export type FileCandidate = {
  file: ProjectFileIndex;
  score: number;
  reasons: FileCandidateReason[];
};

export type LocateFilesResult = {
  query: string;
  candidates: FileCandidate[];
};

const KIND_WEIGHTS: Record<string, number> = {
  page: 8,
  component: 5,
  api_route: 5,
  layout: 3,
  source: 2,
  agent: 1,
};

function normalizeText(text: string): string {
  return text.toLowerCase().replaceAll("\\", "/");
}

function tokenizeQuery(query: string): string[] {
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

function scoreContains(
  haystack: string,
  needle: string,
  label: string,
  weight: number,
): FileCandidateReason | null {
  if (!needle || !haystack.includes(needle)) return null;
  return { label, score: weight };
}

function scoreFile(file: ProjectFileIndex, tokens: string[]): FileCandidate {
  const reasons: FileCandidateReason[] = [];
  const normalizedPath = normalizeText(file.filePath);
  const normalizedRoute = normalizeText(file.route ?? "");
  const normalizedSummary = normalizeText(file.summary);
  const normalizedKeywords = file.businessKeywords.map(normalizeText);
  const normalizedExports = file.exports.map(normalizeText);
  const normalizedImports = file.imports.map(normalizeText);

  for (const token of tokens) {
    const pathHit = scoreContains(normalizedPath, token, `path matches "${token}"`, 12);
    if (pathHit) reasons.push(pathHit);

    const routeHit = scoreContains(
      normalizedRoute,
      token,
      `route matches "${token}"`,
      14,
    );
    if (routeHit) reasons.push(routeHit);

    const summaryHit = scoreContains(
      normalizedSummary,
      token,
      `summary matches "${token}"`,
      6,
    );
    if (summaryHit) reasons.push(summaryHit);

    if (normalizedKeywords.some((keyword) => keyword.includes(token))) {
      reasons.push({ label: `keyword matches "${token}"`, score: 10 });
    }

    if (normalizedExports.some((item) => item.includes(token))) {
      reasons.push({ label: `export matches "${token}"`, score: 4 });
    }

    if (normalizedImports.some((item) => item.includes(token))) {
      reasons.push({ label: `import matches "${token}"`, score: 2 });
    }
  }

  if (reasons.length > 0) {
    reasons.push({
      label: `kind weight ${file.kind}`,
      score: KIND_WEIGHTS[file.kind] ?? 0,
    });
  }

  const score = reasons.reduce((total, reason) => total + reason.score, 0);
  return { file, score, reasons };
}

export function locateFilesForRequest(
  index: ProjectIndex,
  query: string,
  limit = 12,
): LocateFilesResult {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return { query, candidates: [] };
  }

  const candidates = index.files
    .map((file) => scoreFile(file, tokens))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.filePath.localeCompare(b.file.filePath);
    })
    .slice(0, limit);

  return { query, candidates };
}
