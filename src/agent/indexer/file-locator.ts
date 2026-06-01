/**
 * 中文需求定位文件。
 *
 * 基于轻量项目索引做候选文件打分。当前是规则/关键词版本：
 * 路径、route、summary、业务关键词、exports/imports 命中越多，分数越高。
 */
import type { ProjectFileIndex, ProjectIndex } from "@/agent/indexer/types";
import type { AgentUiContext } from "@/agent/types";
import { layoutCandidateBoost } from "@/agent/indexer/ui-layout-boost";

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

/** 用户改「首页 / 界面 / 按钮」类需求时，优先路由页与 components，降权 agent 运行时。 */
function applyUiIntentAdjustments(
  query: string,
  candidates: FileCandidate[],
  uiContext?: AgentUiContext,
): FileCandidate[] {
  const normalized = normalizeText(query);
  const homepageIntent = /首页|主页|homepage|landing/.test(normalized);
  const uiChangeIntent =
    /去掉|删除|移除|隐藏|显示|按钮|选择|切换|左边|左侧|右边|右侧|界面|组件|样式|布局|tab|菜单/.test(
      normalized,
    );

  if (!homepageIntent && !uiChangeIntent && !uiContext?.layout) return candidates;

  return candidates
    .map((candidate) => {
      const filePath = normalizeText(candidate.file.filePath);
      let bonus = layoutCandidateBoost(filePath, uiContext);

      if (homepageIntent && filePath === "src/app/page.tsx") bonus += 35;
      if (homepageIntent && filePath.includes("agent-workspace")) bonus += 18;
      if (uiChangeIntent && filePath.startsWith("src/components/")) bonus += 16;
      if (uiChangeIntent && filePath.startsWith("src/app/")) bonus += 10;
      if (filePath.startsWith("src/agent/core/")) bonus -= 30;
      if (filePath.includes("agent-loop")) bonus -= 25;
      if (filePath.startsWith("src/agent/") && !filePath.startsWith("src/agent/README")) {
        bonus -= 12;
      }

      if (bonus === 0) return candidate;
      return {
        ...candidate,
        score: candidate.score + bonus,
        reasons: [
          ...candidate.reasons,
          {
            label: uiContext?.layout
              ? `ui/layout intent (${uiContext.layout})`
              : "ui/homepage intent adjustment",
            score: bonus,
          },
        ],
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.filePath.localeCompare(b.file.filePath);
    });
}

export function locateFilesForRequest(
  index: ProjectIndex,
  query: string,
  limit = 12,
  uiContext?: AgentUiContext,
): LocateFilesResult {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return { query, candidates: [] };
  }

  const candidates = applyUiIntentAdjustments(
    query,
    index.files
      .map((file) => scoreFile(file, tokens))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.file.filePath.localeCompare(b.file.filePath);
      }),
    uiContext,
  ).slice(0, limit);

  return { query, candidates };
}
