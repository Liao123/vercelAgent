/**
 * 证据门槛：runtime 边界校验（不绑定具体用户句式）。
 */
import { isPrepareToolName } from "@/agent/core/final-prepare-nudge";
import { isDirectMutationToolName } from "@/agent/core/loop-direct-apply";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import type { TaskReasoning } from "@/agent/core/loop-reasoning";
import {
  isWorkspaceGroundedUserRequest,
  reasoningRequiresWorkspaceGather,
} from "@/agent/core/workspace-grounding";
import {
  formatMetadataCatalogHints,
  hasMetadataRoleInPaths,
  pathMatchesMetadataRole,
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

const PATH_ARG_KEYS = ["path", "file", "filePath", "targetPath"] as const;

const BROWSER_GATHER_TOOLS = new Set([
  "browser.inspect",
  "browser.wait_and_inspect",
  "browser.open",
]);

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

const PROCEED_TO_FINAL_GATE_MESSAGE =
  "Evidence sufficient for this read-only task — respond with a plain-text Chinese final now (no more tools).";

function workspaceFramework(state: AgentLoopRunState): string | null | undefined {
  return state.workspaceFramework;
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().replaceAll("\\", "/");
}

function extractPathFromArgs(args: Record<string, unknown>): string | null {
  for (const key of PATH_ARG_KEYS) {
    const path = normalizePath(args[key]);
    if (path) return path;
  }
  return null;
}

function hasReadPath(state: AgentLoopRunState, path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return state.filesRead.some(
    (read) =>
      read.replaceAll("\\", "/") === normalized ||
      normalized.endsWith(read.replaceAll("\\", "/")) ||
      read.replaceAll("\\", "/").endsWith(normalized),
  );
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
  if (userRequest && !isWorkspaceGroundedUserRequest(userRequest)) return false;
  if (!reasoningRequiresWorkspaceGather(reasoning)) return false;
  return true;
}

function isScopedProjectIndexCall(args: Record<string, unknown>): boolean {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  return query.length > 0;
}

/** 探索类 gather：由 TaskReasoning 结构化信号判定，不绑定用户句式。 */
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

export function shouldProceedToFinalGatherBlock(
  state: AgentLoopRunState,
): boolean {
  if (state.taskEvidenceComplete) return true;
  if (isTaskEvidenceSufficient(state)) return true;
  if (isNarrowWorkspaceMetadataEvidenceComplete(state)) return true;
  return false;
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

function buildProceedToFinalGate(
  message: string = PROCEED_TO_FINAL_GATE_MESSAGE,
  understanding: string = "证据已充分，可以作答。",
  plannedNext: string = "直接中文 final，引用本轮已 gather 的证据（文件路径或 browser）。",
): EvidenceGateResult {
  return {
    allowed: false,
    proceedToFinal: true,
    message,
    understanding,
    plannedNext,
  };
}

export function evaluateToolEvidenceGate(
  toolName: string,
  args: Record<string, unknown>,
  state: AgentLoopRunState,
): EvidenceGateResult {
  const path = extractPathFromArgs(args);
  const needsPriorRead =
    isPrepareToolName(toolName) ||
    isDirectMutationToolName(toolName) ||
    toolName === "file.replace" ||
    toolName === "file.mutation" ||
    toolName === "patch.apply";

  if (needsPriorRead && path && !hasReadPath(state, path)) {
    return {
      allowed: false,
      message: `Evidence gate: call file.read on "${path}" before ${toolName}.`,
      understanding: `尚未读取 ${path}，无法安全 ${toolName}。`,
      plannedNext: `先 file.read ${path}，复制 exact 子串后再 ${toolName}。`,
    };
  }

  if (
    toolName === "project.index" &&
    isFactualReadOnlyReasoning(state.taskReasoning, state.userRequest) &&
    !isScopedProjectIndexCall(args) &&
    state.toolsCalled.filter((tool) => tool === "project.index").length >= 1 &&
    !state.toolsCalled.includes("file.read")
  ) {
    const hints = formatMetadataCatalogHints(workspaceFramework(state));
    return {
      allowed: false,
      message:
        "Evidence gate: narrow read-only QA should not repeat full project.index without file.read.",
      understanding: "只读问答应定位后直接 file.read，而非反复全量索引。",
      plannedNext: `file.locate / project.index(query) / file.read 元数据文件。${hints}`,
    };
  }

  if (
    shouldProceedToFinalGatherBlock(state) &&
    GATHER_EVIDENCE_TOOLS.has(toolName)
  ) {
    return buildProceedToFinalGate();
  }

  if (isNarrowWorkspaceMetadataQa(state)) {
    if (
      BROWSER_GATHER_TOOLS.has(toolName) &&
      hasPageTitleMetadataEvidence(state)
    ) {
      return buildProceedToFinalGate(
        "Evidence gate: page metadata already on disk — skip browser.* unless user clearly means embedded browser tab (intent=browser).",
        "工作区页面 metadata 已取证，无需 browser.inspect。",
        "用已读文件中的 metadata 直接中文 final。",
      );
    }

    if (
      toolName === "file.list" &&
      state.toolsCalled.includes("file.locate") &&
      !state.toolsCalled.includes("file.read")
    ) {
      return {
        allowed: false,
        message:
          "Evidence gate: after file.locate for narrow metadata QA, file.read target metadata file (skip file.list).",
        understanding: "窄 metadata 问答应 locate 后直接 read，不必 list 目录。",
        plannedNext: `file.read locate 命中的元数据文件。${formatMetadataCatalogHints(workspaceFramework(state))}`,
      };
    }

    if (
      toolName === "file.read" &&
      path &&
      hasPageTitleMetadataEvidence(state) &&
      hasPackageNameEvidence(state) &&
      !pathMatchesMetadataRole(path, "page_title", workspaceFramework(state)) &&
      !pathMatchesMetadataRole(path, "package_name", workspaceFramework(state))
    ) {
      return buildProceedToFinalGate(
        "Evidence gate: page metadata + package.json already read for narrow metadata QA.",
        "页面元数据与 package.json 已读，证据已齐。",
        "直接中文 final，引用已读路径。",
      );
    }
  }

  return { allowed: true };
}

export function evaluateFinalEvidenceGate(
  state: AgentLoopRunState,
): EvidenceGateResult {
  if (state.metaExplainMode) {
    return { allowed: true };
  }

  const reasoning = state.taskReasoning;
  if (!isFactualReadOnlyReasoning(reasoning, state.userRequest)) {
    return { allowed: true };
  }

  if (hasGatherEvidenceThisTask(state)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message:
      "Evidence gate: factual read-only answer requires gather tools this task (file.read, file.locate, browser.inspect, etc.). Thread memory alone is not enough.",
    understanding: "只读事实类回答需要本轮在磁盘或浏览器上取证，不能仅凭线程记忆作答。",
    plannedNext:
      "先 file.locate / file.read 相关文件，或 browser.inspect，再中文 final。",
  };
}
