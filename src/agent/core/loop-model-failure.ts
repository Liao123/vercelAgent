/**
 * 模型调用失败时的 Cursor 式降级：透传真实错误，继续工具路径，不整任务 pause。
 */
import { formatModelErrorMessage } from "@/lib/model-error-message";

export const MAX_CONSECUTIVE_MODEL_FAILURES = 3;

export function isRuntimeReflectionEnabled(): boolean {
  return process.env.AGENT_RUNTIME_REFLECTION === "1";
}

export function buildModelFailureContinueNudge(input: {
  error: unknown;
  playbookTitle?: string;
  openingPlannedNext?: string;
  userRequest: string;
}): string {
  const detail = formatModelErrorMessage(input.error);
  const lines = [
    "【模型本轮调用未成功 — 请继续用工具推进任务，勿停止】",
    `错误详情：${detail}`,
    `用户目标：${input.userRequest}`,
  ];
  if (input.playbookTitle) {
    lines.push(`任务参考：${input.playbookTitle}`);
  }
  if (input.openingPlannedNext) {
    lines.push(`建议路径（非强制）：${input.openingPlannedNext}`);
  }
  lines.push(
    "直接选择下一步工具（browser.open、devtools.extract_design_spec、file.read、file.mutation 等）。",
    "勿因模型失败而只输出文字总结；交付物未齐前不要 final。",
  );
  return lines.join("\n");
}

export function isTaskDelivered(runState: {
  likelyEditRequest: boolean;
  playbookId?: import("@/agent/core/task-playbooks").TaskPlaybookId;
  userRequest: string;
}, editSatisfied: boolean): boolean {
  if (!runState.likelyEditRequest) return true;
  return editSatisfied;
}
