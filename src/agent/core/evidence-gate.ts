/**
 * 证据状态同步（runtime 仅设旗标，不拦截工具）。
 */
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import type { TaskReasoning } from "@/agent/core/loop-reasoning";
import { requiresFactualWorkspaceGather } from "@/agent/core/workspace-grounding";
import {
  hasMetadataRoleInPaths,
} from "@/agent/workspace/framework-metadata-catalog";

export type EvidenceGateResult =
  | { allowed: true }
  | {
      allowed: false;
      message: string;
      understanding: string;
      plannedNext: string;
      proceedToFinal?: boolean;
    };

export const GATHER_EVIDENCE_TOOLS = new Set([
  "workspace.inspect",
  "project.index",
  "file.locate",
  "ui.trace_from_page",
  "file.list",
  "file.read",
  "file.search",
  "jsx.find_text",
  "symbol.find_references",
  "git.status",
  "git.diff",
  "browser.inspect",
  "browser.wait_and_inspect",
  "browser.open",
]);

function workspaceFramework(state: AgentLoopRunState): string | null | undefined {
  return state.workspaceFramework;
}

export function hasGatherEvidenceThisTask(state: AgentLoopRunState): boolean {
  return state.toolsCalled.some((tool) => GATHER_EVIDENCE_TOOLS.has(tool));
}

function isFactualReadOnlyReasoning(
  reasoning?: TaskReasoning,
  userRequest?: string,
): boolean {
  if (!reasoning) return false;
  if (!(reasoning.intent === "qa" || reasoning.intent === "analysis")) {
    return false;
  }
  if (reasoning.risk !== "read_only") return false;
  if (!requiresFactualWorkspaceGather(reasoning, userRequest)) return false;
  return true;
}

function isReadOnlyTaskEligibleForEvidenceComplete(
  state: AgentLoopRunState,
): boolean {
  if (state.metaExplainMode || state.likelyEditRequest) return false;
  const reasoning = state.taskReasoning;
  if (!reasoning) return false;
  if (
    reasoning.intent === "code_edit" ||
    reasoning.intent === "meta" ||
    reasoning.intent === "browser" ||
    reasoning.risk === "write" ||
    reasoning.risk === "approval_required"
  ) {
    return false;
  }
  return isFactualReadOnlyReasoning(reasoning, state.userRequest);
}

export function isTaskEvidenceSufficient(state: AgentLoopRunState): boolean {
  if (!isReadOnlyTaskEligibleForEvidenceComplete(state)) return false;
  if (!hasGatherEvidenceThisTask(state)) return false;
  const reasoning = state.taskReasoning;
  if (!reasoning) return false;
  return reasoning.evidenceNeeded.length === 0;
}

export function hasPageTitleMetadataEvidence(
  state: AgentLoopRunState,
): boolean {
  return hasMetadataRoleInPaths(
    state.filesRead,
    "page_title",
    workspaceFramework(state),
  );
}

/** @deprecated 使用 hasPageTitleMetadataEvidence */
export function hasLayoutMetadataEvidence(state: AgentLoopRunState): boolean {
  return hasPageTitleMetadataEvidence(state);
}

export function hasWorkspacePageTitleEvidence(
  state: AgentLoopRunState,
): boolean {
  return hasPageTitleMetadataEvidence(state);
}

export function hasPackageNameEvidence(state: AgentLoopRunState): boolean {
  return hasMetadataRoleInPaths(
    state.filesRead,
    "package_name",
    workspaceFramework(state),
  );
}

export function isNarrowWorkspaceMetadataFromSignals(
  reasoning: TaskReasoning | undefined,
  userRequest: string,
): boolean {
  if (!isFactualReadOnlyReasoning(reasoning, userRequest)) return false;
  if (reasoning?.intent === "browser") return false;
  const blob = [
    reasoning?.understanding ?? "",
    reasoning?.ambiguity ?? "",
    ...(reasoning?.evidenceNeeded ?? []),
    ...(reasoning?.planSteps ?? []),
    userRequest,
  ]
    .join(" ")
    .toLowerCase();
  const factSignal =
    /title|metadata|名称|标题|package\.json|项目名|站点|page title|document title/.test(
      blob,
    );
  const workspaceSignal =
    /workspace|layout|package|repo|web app|网站|项目|工作区|app\//.test(blob);
  return factSignal && workspaceSignal;
}

export function isNarrowWorkspaceMetadataQa(state: AgentLoopRunState): boolean {
  return isNarrowWorkspaceMetadataFromSignals(
    state.taskReasoning,
    state.userRequest,
  );
}

export function isNarrowWorkspaceMetadataEvidenceComplete(
  state: AgentLoopRunState,
): boolean {
  if (!isNarrowWorkspaceMetadataQa(state)) return false;
  return (
    hasPageTitleMetadataEvidence(state) && hasPackageNameEvidence(state)
  );
}

export function syncTaskEvidenceComplete(state: AgentLoopRunState): void {
  if (state.taskEvidenceComplete) return;
  if (
    isTaskEvidenceSufficient(state) ||
    isNarrowWorkspaceMetadataEvidenceComplete(state)
  ) {
    state.taskEvidenceComplete = true;
  }
}

/** 探索类 gather：由 TaskReasoning 结构化信号判定。 */
export function isExplorationGatherIntent(state: AgentLoopRunState): boolean {
  const reasoning = state.taskReasoning;
  if (!reasoning) return false;
  if (reasoning.intent === "analysis") return true;
  const tags = [...reasoning.evidenceNeeded, ...reasoning.planSteps].map((s) =>
    s.toLowerCase(),
  );
  const explorationSignals = [
    "routes",
    "route",
    "api",
    "structure",
    "overview",
    "file tree",
    "module map",
    "architecture",
    "list",
    "enumerate",
  ];
  return tags.some((tag) =>
    explorationSignals.some((signal) => tag.includes(signal)),
  );
}
