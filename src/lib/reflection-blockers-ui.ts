import { formatModelErrorMessage } from "@/lib/model-error-message";

/** 任务仍在跑时用「待处理/上轮问题」，结束后才用「阻塞」。 */
export function reflectionBlockersLabel(input: {
  taskStillRunning: boolean;
  isLatestStep?: boolean;
}): string {
  if (!input.taskStillRunning) return "阻塞：";
  if (input.isLatestStep === false) return "上轮问题：";
  return "待处理：";
}

export function reflectionBlockersToneClass(taskStillRunning: boolean): string {
  return taskStillRunning
    ? "text-amber-700 dark:text-amber-400"
    : "text-red-600 dark:text-red-400";
}

export function formatReflectionBlockersLine(
  blockers: string[],
  input: {
    taskStillRunning: boolean;
    isLatestStep?: boolean;
  },
): string {
  if (blockers.length === 0) return "";
  if (input.taskStillRunning) {
    return input.isLatestStep === false
      ? "上轮问题：已记录上轮问题，正在换策略继续。"
      : "待处理：遇到问题，正在换策略。";
  }
  const label = reflectionBlockersLabel(input);
  const body = blockers.map((item) => formatModelErrorMessage(item)).join("；");
  return `${label}${body}`;
}
