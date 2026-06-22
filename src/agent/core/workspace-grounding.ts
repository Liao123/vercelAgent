/**
 * 判断用户任务是否依赖当前 workspace 事实（边界信号，非句式→工具硬路由）。
 */
import type { TaskReasoning } from "@/agent/core/loop-reasoning";

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
  "agents.md",
  "readme.md",
] as const;

export function reasoningRequiresWorkspaceGather(
  reasoning: TaskReasoning,
): boolean {
  const blob = [
    ...reasoning.evidenceNeeded,
    ...reasoning.planSteps,
    reasoning.plannedNext,
    reasoning.understanding,
  ]
    .join(" ")
    .toLowerCase();
  return WORKSPACE_GATHER_SIGNALS.some((signal) => blob.includes(signal));
}

export function isWorkspaceGroundedUserRequest(userRequest: string): boolean {
  const text = userRequest.trim();
  if (!text) return true;

  const codeSignals =
    /\.(tsx?|jsx?|vue|py|go|rs|md|json)\b/i.test(text) ||
    /src\/|components\/|pages?\//i.test(text) ||
    /@\S+\.\w+/.test(text) ||
    /\b(file\.read|layout\.tsx|package\.json|agent-panel|npm run|npx |git (status|diff|push)|eslint|typescript|组件|路由|改代码|修bug|实现|重构|读文件|工作区里|这个项目里|本仓库|vec-next|网站标题|页面标题)\b/i.test(
      text,
    );
  if (codeSignals) return true;

  const advisorySignals =
    /产品设计|商业计划|商业方案|运营方案|创业|PRD|需求文档|团购|海鲜|水产|私域|获客|盈利|融资|市场分析|用户画像|落地方案|商业模式|同城配送|微信社群|小程序运营/i.test(
      text,
    );
  if (advisorySignals) return false;

  if (
    /设计.{0,12}(产品|方案|计划|商业|运营)/.test(text) &&
    !/界面|页面|组件|ui|代码/i.test(text)
  ) {
    return false;
  }

  if (text.length > 180 && !codeSignals) return false;

  return true;
}
