/**
 * 判断任务是否依赖当前 workspace 取证（A164：主靠推理字段，用户句仅硬信号兜底）。
 */
import type { TaskReasoning } from "@/agent/core/loop-reasoning";

export type TaskGrounding = "workspace" | "none" | "unknown";

/** 推理计划里出现即视为需要 workspace / 浏览器 gather（不含 understanding 散文）。 */
const WORKSPACE_GATHER_SIGNALS = [
  "file.read",
  "file.locate",
  "file.list",
  "file.search",
  "project.index",
  "workspace.inspect",
  "browser.inspect",
  "browser.open",
  "browser.wait",
  "git.status",
  "git.diff",
  "jsx.find",
  "symbol.find",
  "ui.trace",
  "package.json",
  "layout.tsx",
  "layout.jsx",
  "layout metadata",
  "page title",
  "package name",
  "agents.md",
  "readme.md",
] as const;

function gatherPlanBlob(reasoning: TaskReasoning): string {
  return [
    ...reasoning.evidenceNeeded,
    ...reasoning.planSteps,
    reasoning.plannedNext,
  ]
    .join(" ")
    .toLowerCase();
}

export function reasoningRequiresWorkspaceGather(
  reasoning: TaskReasoning,
): boolean {
  const blob = gatherPlanBlob(reasoning);
  return WORKSPACE_GATHER_SIGNALS.some((signal) => blob.includes(signal));
}

/** 用户句中的硬信号：路径、扩展名、显式工具/仓库词（无领域负向词表）。 */
export function hasHardWorkspaceSignalsInRequest(
  userRequest: string,
): boolean {
  const text = userRequest.trim();
  if (!text) return false;
  return (
    /\.(tsx?|jsx?|vue|py|go|rs|md|json)\b/i.test(text) ||
    /src\/|components\/|pages?\//i.test(text) ||
    /@\S+\.\w+/.test(text) ||
    /\b(file\.read|layout\.tsx|package\.json|npm run|npx |git (status|diff|push)|eslint|typescript)\b/i.test(
      text,
    ) ||
    /网站标题|页面标题|工作区里|这个项目里|本仓库/.test(text)
  );
}

/**
 * @deprecated A164 后用 `requiresFactualWorkspaceGather`；保留别名供 playbook 等只问「句子里有没有硬信号」。
 */
export function isWorkspaceGroundedUserRequest(
  userRequest: string,
): boolean {
  return hasHardWorkspaceSignalsInRequest(userRequest);
}

/** 只读 final gate：本轮是否必须先 workspace gather（主路径 = 推理 plan + grounding 字段）。 */
export function requiresFactualWorkspaceGather(
  reasoning: TaskReasoning,
  userRequest?: string,
): boolean {
  if (reasoning.grounding === "none") return false;
  if (reasoning.grounding === "workspace") return true;

  if (reasoningRequiresWorkspaceGather(reasoning)) return true;

  if (reasoning.evidenceNeeded.length === 0) return false;

  if (userRequest && hasHardWorkspaceSignalsInRequest(userRequest)) {
    return true;
  }

  return false;
}

export function parseTaskGrounding(value: unknown): TaskGrounding {
  if (value === "workspace" || value === "none") return value;
  return "unknown";
}

export function inferTaskGrounding(
  reasoning: TaskReasoning,
  userRequest?: string,
): TaskGrounding {
  if (reasoning.grounding && reasoning.grounding !== "unknown") {
    return reasoning.grounding;
  }
  if (requiresFactualWorkspaceGather(reasoning, userRequest)) return "workspace";
  if (
    reasoning.evidenceNeeded.length === 0 &&
    !reasoningRequiresWorkspaceGather(reasoning)
  ) {
    return "none";
  }
  return "unknown";
}
