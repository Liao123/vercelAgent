/**
 * 改码任务收尾策略（更接近 Cursor：末轮仍允许写盘，空工作区推 scaffold）。
 */
import {
  isExplicitReadOnlyRequest,
  type AgentLoopRunState,
} from "@/agent/core/agent-loop-state";
import { isEditTaskSatisfied } from "@/agent/core/loop-direct-apply";
import type { WorkspaceStructureFacts } from "@/agent/workspace/workspace-structure-facts";

export const EDIT_WRITE_TAIL_ITERATIONS = 2;

const WRITE_TOOL_NAMES = new Set([
  "file.mutation",
  "file.replace",
  "patch.apply",
  "file.mutation.prepare",
  "file.replace.prepare",
  "patch.prepare",
]);

export function isEditWriteTaskPending(runState: AgentLoopRunState): boolean {
  return (
    runState.likelyEditRequest &&
    !isExplicitReadOnlyRequest(runState.userRequest) &&
    !isEditTaskSatisfied(runState)
  );
}

export function hasAttemptedDiskWrite(runState: AgentLoopRunState): boolean {
  if (isEditTaskSatisfied(runState)) return true;
  return runState.toolsCalled.some((tool) => WRITE_TOOL_NAMES.has(tool));
}

export function computeLoopIterationCap(
  maxIterations: number,
  runState: AgentLoopRunState,
): number {
  return isEditWriteTaskPending(runState)
    ? maxIterations + EDIT_WRITE_TAIL_ITERATIONS
    : maxIterations;
}

/** 本轮是否应禁用 tools（仅总结）。改码未完成时延长保留工具轮次。 */
export function shouldForceFinalIteration(
  iteration: number,
  maxIterations: number,
  runState: AgentLoopRunState,
): boolean {
  const cap = computeLoopIterationCap(maxIterations, runState);
  if (iteration >= cap) return true;
  if (iteration >= maxIterations && !isEditWriteTaskPending(runState)) return true;
  return false;
}

/** 主循环是否应在当前轮次结束后退出。 */
export function shouldStopLoopAfterIteration(
  iteration: number,
  maxIterations: number,
  runState: AgentLoopRunState,
): boolean {
  const cap = computeLoopIterationCap(maxIterations, runState);
  if (iteration >= cap) return true;
  if (iteration >= maxIterations && !isEditWriteTaskPending(runState)) return true;
  return false;
}

export function buildWorkspaceScaffoldNudge(
  facts: WorkspaceStructureFacts,
): string | null {
  const needsScaffold =
    !facts.hasPackageJson &&
    !facts.hasSrcApp &&
    !facts.hasAppDir &&
    !facts.hasPagesDir;
  if (!needsScaffold) return null;
  return [
    "【规划提示】WORKSPACE_STRUCTURE 显示当前目录尚无 Web 工程入口。",
    "用户若要「写到当前项目」，请自行推导并执行前置步骤：",
    "· shell.run.prepare 初始化工程（需用户批准），或",
    "· file.mutation 直接创建 index.html / package.json / 样式文件。",
    "不要反复 file.read 不存在的 src/app/page.tsx。",
    "目标页样式请用已打开的 browser / design spec / .agent-state 中的快照证据。",
  ].join("\n");
}

export function buildEditWritePressureNudge(
  runState: AgentLoopRunState,
  iteration: number,
  maxIterations: number,
): string | null {
  if (!isEditWriteTaskPending(runState)) return null;
  if (hasAttemptedDiskWrite(runState)) return null;
  if (iteration < maxIterations) return null;
  return [
    "【写盘收尾】改码任务尚未落盘。",
    "本轮请优先 file.mutation（新建）或 file.replace / patch.apply；",
    "若仍无工程骨架，先 shell.run.prepare 或 file.mutation 建入口。",
    "不要继续只读 gather 或输出纯文字 final。",
  ].join("\n");
}

export function buildEditWriteTailNudge(
  iteration: number,
  maxIterations: number,
): string {
  return [
    `【写盘延长期 ${iteration - maxIterations}/${EDIT_WRITE_TAIL_ITERATIONS}】`,
    "主轮次已用尽但文件尚未写入。",
    "仅允许调用写盘或 shell 类工具完成落盘，然后再中文总结。",
  ].join("\n");
}

export function shouldSkipTextOnlyGracefulFinal(
  runState: AgentLoopRunState,
): boolean {
  return isEditWriteTaskPending(runState);
}

/** 改码未完成时拒绝纯文字 final，迫使继续写盘工具轮次。 */
export function shouldRejectTextOnlyFinal(
  runState: AgentLoopRunState,
  iteration: number,
  maxIterations: number,
): boolean {
  if (!isEditWriteTaskPending(runState)) return false;
  if (hasAttemptedDiskWrite(runState)) return false;
  return iteration >= maxIterations - 1;
}

export function buildEditIncompleteGracefulHint(): string {
  return [
    "改码任务未能在本轮落盘。",
    "请新开任务并说明：空目录可先 file.mutation 或批准 shell.run.prepare 初始化，再复刻页面。",
    "勿在长会话里继续只读 gather。",
  ].join("");
}
