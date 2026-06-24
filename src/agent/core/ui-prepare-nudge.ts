/**
 * UI 改代码任务：read 推荐文件后提示模型用 exact search 走 file.replace.prepare（A083）。
 */
import { extractUiLabelTokens } from "@/agent/indexer/ui-candidate-disambiguator";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import {
  hasUiLocationEvidence,
  isUiLocationQuery,
} from "@/agent/core/prepare-gate";
import { primaryRunModeComponentPath } from "@/agent/indexer/ui-layout-boost";
import type { AgentUiContext } from "@/agent/types";

export type UiPrepareHint = {
  path: string;
  /** 从磁盘行中提取的可作 search 的 exact 子串（含缩进） */
  suggestedSearchLines: string[];
};

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

/** 从 file.read 内容中提取含可见 label 的 JSX 行，供 prepare 的 search 参数。 */
export function extractUiLabelSearchCandidates(
  content: string,
  labels?: string[],
): string[] {
  const resolvedLabels =
    labels && labels.length > 0 ? labels : [];
  if (resolvedLabels.length === 0) return [];
  const lines = content.split(/\r?\n/);
  const candidates: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    if (/^\s*\+\s*$/.test(trimmed)) {
      candidates.push(trimmed);
      continue;
    }

    // JSX 子节点单独一行：「                    Loop」
    if (/^\s*(?:闭环|Loop)\s*$/.test(trimmed)) {
      candidates.push(trimmed);
      continue;
    }

    if (/onRunModeChange\s*\(/.test(trimmed)) {
      candidates.push(trimmed);
      continue;
    }

    if (/onNewSessionInProject/.test(trimmed) && /<button/i.test(trimmed)) {
      candidates.push(trimmed);
      continue;
    }

    const hasLabel = resolvedLabels.some((label) => trimmed.includes(label));
    if (!hasLabel) continue;
    if (
      /<(?:button|select|input|option|label)|runMode/i.test(trimmed) ||
      />\s*闭环\s*</.test(trimmed) ||
      />\s*Loop\s*</.test(trimmed) ||
      />\s*新建 Agent\s*</.test(trimmed)
    ) {
      candidates.push(trimmed);
    }
  }

  return [...new Set(candidates)].slice(0, 4);
}

export function resolveUiEditTargetPath(
  state: AgentLoopRunState,
  uiContext?: AgentUiContext,
): string | undefined {
  if (state.disambiguation?.recommendedPath) {
    return normalizePath(state.disambiguation.recommendedPath);
  }
  const primary = primaryRunModeComponentPath(uiContext?.layout);
  if (primary && state.filesRead.map(normalizePath).includes(primary)) {
    return primary;
  }
  return undefined;
}

export function listUnreadDisambiguationPaths(
  state: AgentLoopRunState,
): string[] {
  if (!state.disambiguation) return [];
  const read = new Set(state.filesRead.map(normalizePath));
  const mustRead = state.disambiguation.mustReadPaths ?? [];
  return mustRead.filter((path) => !read.has(normalizePath(path)));
}

export function allDisambiguationCandidatesRead(state: AgentLoopRunState): boolean {
  return listUnreadDisambiguationPaths(state).length === 0;
}

/** 多文件消歧：尚有候选未 read 时，禁止出现 prepare 提示，改推先读完。 */
export function buildUiDisambiguationReadNudgeBlock(
  state: AgentLoopRunState,
): string | null {
  if (!state.disambiguation || state.approvalPrepared) return null;
  const unread = listUnreadDisambiguationPaths(state);
  if (unread.length === 0) return null;

  return [
    "=== UI disambiguation (read all candidates first) ===",
    `Label: ${state.disambiguation.label}`,
    `Recommended edit file (after reads): ${state.disambiguation.recommendedPath}`,
    `Rationale: ${state.disambiguation.selectionRationale}`,
    "You MUST file.read every path below before file.replace.prepare:",
    ...unread.map((path) => `- ${path}`),
    "Do not prepare until all paths above appear in Files read.",
  ].join("\n");
}

/** 已 trace/locate + 读完推荐文件 + 有 exact 行候选 → 应走 prepare，不走 recovery。 */
export function isUiPrepareEvidenceReady(
  state: AgentLoopRunState,
  uiContext?: AgentUiContext,
): boolean {
  if (!isUiLocationQuery(state.userRequest)) return false;
  if (!hasUiLocationEvidence(state.toolsCalled)) return false;
  if (!allDisambiguationCandidatesRead(state)) return false;

  const target = resolveUiEditTargetPath(state, uiContext);
  if (!target) return false;
  if (!state.filesRead.map(normalizePath).includes(target)) return false;
  if (!state.prepareHint || state.prepareHint.path !== target) return false;
  return state.prepareHint.suggestedSearchLines.length > 0;
}

/** @deprecated edit.recovery 已移除；保留供 validate 类型兼容。 */
export function shouldSkipEditRecoveryForUiPrepare(
  _state: AgentLoopRunState,
  _uiContext?: AgentUiContext,
): boolean {
  return false;
}

export function captureUiPrepareHintFromFileRead(
  state: AgentLoopRunState,
  filePath: string,
  content: string,
  uiContext?: AgentUiContext,
): void {
  if (!isUiLocationQuery(state.userRequest)) return;
  const target = resolveUiEditTargetPath(state, uiContext);
  if (!target || normalizePath(filePath) !== target) return;

  const suggestedSearchLines = extractUiLabelSearchCandidates(
    content,
    extractUiLabelTokens(state.userRequest),
  );
  if (suggestedSearchLines.length === 0) return;

  state.prepareHint = { path: target, suggestedSearchLines };
}

export function buildUiPrepareNudgeBlock(state: AgentLoopRunState): string | null {
  if (!state.prepareHint || state.approvalPrepared) return null;
  if (!allDisambiguationCandidatesRead(state)) return null;

  const lines = [
    "=== UI prepare hint (exact search from disk) ===",
    `Target file: ${state.prepareHint.path}`,
    "If editing, copy ONE Candidate line verbatim into file.replace search.",
    "",
    ...state.prepareHint.suggestedSearchLines.map(
      (line, index) => `Candidate ${index + 1}: ${JSON.stringify(line)}`,
    ),
  ];

  return lines.join("\n");
}
