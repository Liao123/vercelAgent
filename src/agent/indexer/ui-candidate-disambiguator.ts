/**
 * UI 文案多文件命中时的消歧：打分、强制 read 列表、推荐路径与选型理由。
 */
import { searchText, type SearchMatch } from "@/agent/tools/file-tools";
import { layoutCandidateBoost } from "@/agent/indexer/ui-layout-boost";
import { isUiLocationQuery } from "@/agent/core/prepare-gate";
import type { AgentUiContext } from "@/agent/types";

export type LabelLineMatch = {
  line: number;
  text: string;
};

export type LabelMatchCandidate = {
  filePath: string;
  score: number;
  reasons: string[];
  matches: LabelLineMatch[];
};

export type UiLabelDisambiguation = {
  label: string;
  candidates: LabelMatchCandidate[];
  recommendedPath: string;
  selectionRationale: string;
  mustReadPaths: string[];
};

export type UiDisambiguationResult = {
  hasAmbiguity: boolean;
  primaryLabel?: string;
  groups: UiLabelDisambiguation[];
  mustReadPaths: string[];
  recommendedPath?: string;
  selectionRationale?: string;
  summary: string;
};

const UI_SURFACE_PREFIXES = ["src/components/", "src/app/"];

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function isUiSurfacePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return UI_SURFACE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** 从需求中提取可能在 JSX 中出现的可见 label 字面量。 */
export function extractUiLabelTokens(query: string): string[] {
  const tokens = new Set<string>();

  for (const match of query.matchAll(/["'""'']([^"'""''\s]{1,24})["'""'']/g)) {
    const value = match[1]?.trim();
    if (value && value.length >= 2) tokens.add(value);
  }

  if (/闭环/.test(query)) tokens.add("闭环");
  if (/\bloop\b/i.test(query) || /Loop/.test(query)) tokens.add("loop");

  return [...tokens].filter((token) => token.length >= 2);
}

function groupMatchesByPath(matches: SearchMatch[]): Map<string, LabelLineMatch[]> {
  const grouped = new Map<string, LabelLineMatch[]>();

  for (const match of matches) {
    const filePath = normalizePath(match.path);
    const existing = grouped.get(filePath) ?? [];
    existing.push({ line: match.line, text: match.text.trim() });
    grouped.set(filePath, existing);
  }

  return grouped;
}

function scoreUiCandidate(input: {
  filePath: string;
  label: string;
  matches: LabelLineMatch[];
  uiContext?: AgentUiContext;
  traceSuggestedOrder?: string[];
}): { score: number; reasons: string[] } {
  const { filePath, matches, uiContext, traceSuggestedOrder } = input;
  const reasons: string[] = [];
  let score = 0;

  const layoutBonus = layoutCandidateBoost(filePath, uiContext);
  if (layoutBonus !== 0) {
    score += layoutBonus;
    reasons.push(`layout boost ${layoutBonus}`);
  }

  if (traceSuggestedOrder) {
    const index = traceSuggestedOrder.indexOf(filePath);
    if (index >= 0) {
      const traceBonus = 28 - index * 2;
      score += traceBonus;
      reasons.push(`import tree rank #${index + 1}`);
    }
  }

  if (filePath.startsWith("src/components/")) {
    score += 14;
    reasons.push("component file");
  } else if (filePath.startsWith("src/app/")) {
    score += 8;
    reasons.push("app route file");
  }

  if (filePath.startsWith("src/agent/core/")) {
    score -= 45;
    reasons.push("agent runtime (penalty)");
  } else if (filePath.startsWith("src/agent/")) {
    score -= 18;
    reasons.push("agent source (penalty)");
  }

  for (const match of matches) {
    const line = match.text;
    if (/<(?:button|select|input|option|label)/i.test(line)) {
      score += 10;
      reasons.push(`control markup near label (L${match.line})`);
      break;
    }
    if (/runMode|RunMode|onRunModeChange|value=\{?"loop"/i.test(line)) {
      score += 14;
      reasons.push(`RunMode control (L${match.line})`);
      break;
    }
  }

  return { score, reasons: [...new Set(reasons)] };
}

function buildSelectionRationale(
  group: UiLabelDisambiguation,
  uiContext?: AgentUiContext,
): string {
  const top = group.candidates[0];
  const second = group.candidates[1];
  if (!top || !second) return "";

  const layout = uiContext?.layout ?? "unknown";
  const parts = [
    `「${group.label}」在 ${group.candidates.length} 个 UI 文件中命中。`,
    `推荐 ${top.filePath}（${top.reasons.slice(0, 2).join("；")}）`,
    `而非 ${second.filePath}（${second.reasons.slice(0, 2).join("；")}）。`,
  ];

  if (layout === "triple") {
    parts.push("当前 layout=triple，RunMode 控件在中栏 agent-composer，不是 default 布局的 agent-panel。");
  }

  return parts.join(" ");
}

function disambiguateLabelGroup(
  label: string,
  matches: SearchMatch[],
  uiContext?: AgentUiContext,
  traceSuggestedOrder?: string[],
): UiLabelDisambiguation | null {
  const grouped = groupMatchesByPath(matches);
  const surfaceCandidates: LabelMatchCandidate[] = [];

  for (const [filePath, lineMatches] of grouped) {
    if (!isUiSurfacePath(filePath)) continue;

    const { score, reasons } = scoreUiCandidate({
      filePath,
      label,
      matches: lineMatches,
      uiContext,
      traceSuggestedOrder,
    });

    surfaceCandidates.push({
      filePath,
      score,
      reasons,
      matches: lineMatches.slice(0, 4),
    });
  }

  if (surfaceCandidates.length < 2) return null;

  surfaceCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.filePath.localeCompare(b.filePath);
  });

  const mustReadPaths = surfaceCandidates.map((c) => c.filePath);
  const group: UiLabelDisambiguation = {
    label,
    candidates: surfaceCandidates,
    recommendedPath: surfaceCandidates[0]!.filePath,
    mustReadPaths,
    selectionRationale: "",
  };
  group.selectionRationale = buildSelectionRationale(group, uiContext);

  return group;
}

export async function disambiguateUiLabels(input: {
  rootPath: string;
  query: string;
  uiContext?: AgentUiContext;
  traceSuggestedOrder?: string[];
}): Promise<UiDisambiguationResult> {
  if (!isUiLocationQuery(input.query)) {
    return {
      hasAmbiguity: false,
      groups: [],
      mustReadPaths: [],
      summary: "非 UI/首页改动需求，跳过 label 消歧。",
    };
  }

  const labels = extractUiLabelTokens(input.query);
  if (labels.length === 0) {
    return {
      hasAmbiguity: false,
      groups: [],
      mustReadPaths: [],
      summary: "未能从需求提取可见 label 字面量，跳过消歧。",
    };
  }

  const groups: UiLabelDisambiguation[] = [];

  for (const label of labels) {
    const matches = await searchText(input.rootPath, label, 80, {
      scopeRelativeDirs: ["src/components", "src/app"],
    });
    const group = disambiguateLabelGroup(
      label,
      matches,
      input.uiContext,
      input.traceSuggestedOrder,
    );
    if (group) groups.push(group);
  }

  if (groups.length === 0) {
    return {
      hasAmbiguity: false,
      groups: [],
      mustReadPaths: [],
      summary: "各 label 仅命中单一 UI 文件或未在 components/app 中重复，无需消歧。",
    };
  }

  groups.sort(
    (a, b) => b.candidates.length - a.candidates.length || b.candidates[0]!.score - a.candidates[0]!.score,
  );

  const primary = groups[0]!;
  const mustReadSet = new Set<string>();
  for (const group of groups) {
    for (const path of group.mustReadPaths) {
      mustReadSet.add(path);
    }
  }

  return {
    hasAmbiguity: true,
    primaryLabel: primary.label,
    groups,
    mustReadPaths: [...mustReadSet],
    recommendedPath: primary.recommendedPath,
    selectionRationale: primary.selectionRationale,
    summary: primary.selectionRationale,
  };
}

/** 将消歧结果写入 runState 的精简形态。 */
export type RunStateDisambiguation = {
  label: string;
  mustReadPaths: string[];
  recommendedPath: string;
  selectionRationale: string;
};

export function disambiguationForRunState(
  result: UiDisambiguationResult,
): RunStateDisambiguation | undefined {
  if (!result.hasAmbiguity || !result.primaryLabel || !result.recommendedPath) {
    return undefined;
  }

  return {
    label: result.primaryLabel,
    mustReadPaths: result.mustReadPaths,
    recommendedPath: result.recommendedPath,
    selectionRationale: result.selectionRationale ?? result.summary,
  };
}
