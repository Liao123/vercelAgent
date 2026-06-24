/**
 * 改码任务收尾边界：写盘延长期 + 拒绝未完成 final（模型驱动，runtime 只拦边界）。
 */
import {
  isExplicitReadOnlyRequest,
  type AgentLoopRunState,
} from "@/agent/core/agent-loop-state";
import { isEditTaskSatisfied } from "@/agent/core/loop-direct-apply";

export const EDIT_WRITE_TAIL_ITERATIONS = 2;

export function isEditWriteTaskPending(runState: AgentLoopRunState): boolean {
  return (
    runState.likelyEditRequest &&
    !isExplicitReadOnlyRequest(runState.userRequest) &&
    !isEditTaskSatisfied(runState)
  );
}

export function hasAttemptedDiskWrite(runState: AgentLoopRunState): boolean {
  return isEditTaskSatisfied(runState, runState.playbookId);
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

export function buildEditWritePressureNudge(
  runState: AgentLoopRunState,
  iteration: number,
  maxIterations: number,
): string | null {
  if (!isEditWriteTaskPending(runState)) return null;
  if (hasAttemptedDiskWrite(runState)) return null;
  if (iteration < maxIterations) return null;
  return [
    "【写盘收尾】改码任务尚未满足交付标准。",
    "请继续 file.mutation / file.replace / patch.apply 直到交付物齐。",
  ].join("\n");
}

export function buildEditWriteTailNudge(
  iteration: number,
  maxIterations: number,
): string {
  return [
    `【写盘延长期 ${iteration - maxIterations}/${EDIT_WRITE_TAIL_ITERATIONS}】`,
    "主轮次已用尽但交付物未齐。",
    "仅允许写盘或 shell 类工具，然后再中文总结。",
  ].join("\n");
}

export function shouldSkipTextOnlyGracefulFinal(
  runState: AgentLoopRunState,
): boolean {
  return isEditWriteTaskPending(runState);
}

/** 改码未完成时拒绝纯文字 final。 */
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
    "改码任务未能在本轮完成交付。",
    "请重开任务或用运行中引导说明还缺哪些文件。",
  ].join("");
}
