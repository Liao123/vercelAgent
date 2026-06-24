import type { AgentEvent, AgentReflection } from "@/agent/types";

export type ReasoningAction = {
  event: AgentEvent;
  running: boolean;
};

export type ReasoningStep = {
  id: string;
  reflection: AgentReflection;
  reflectionAt: string;
  actions: ReasoningAction[];
  /** 本步结束时间（下一步反思或任务完成） */
  endedAt?: string;
};

function eventTimestamp(event: AgentEvent): string | null {
  if (event.type === "reflection.updated") return event.at ?? null;
  if (event.type === "tool.started" || event.type === "tool.completed") {
    return event.toolCall.completedAt ?? event.toolCall.startedAt;
  }
  return null;
}

/** A155：进度类 runtime 反思不单独占一步，避免时间线刷屏。 */
export function isNoisyRuntimeReflection(reflection: AgentReflection): boolean {
  if (reflection.source !== "runtime") return false;
  const understanding = reflection.understanding.trim();
  if (/^继续执行（第 \d+\/\d+ 轮）/.test(understanding)) return true;
  if (
    reflection.blockers.length === 0 &&
    /^(工具已运行|文件变更已应用|改代码任务)/.test(understanding)
  ) {
    return true;
  }
  return false;
}

function formatStepDurationMs(startAt: string, endAt: string): number | null {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms;
}

export function formatReasoningDuration(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min} 分 ${rem} 秒` : `${min} 分`;
}

/** 将 narrative 事件按「反思 → 工具动作」分组为逐步推理。 */
export function groupNarrativeIntoSteps(
  events: AgentEvent[],
  turnEndedAt?: string,
  turnStartedAt?: string,
): ReasoningStep[] {
  const steps: ReasoningStep[] = [];
  let current: ReasoningStep | null = null;

  const flush = (endedAt?: string) => {
    if (!current) return;
    if (endedAt) current.endedAt = endedAt;
    steps.push(current);
    current = null;
  };

  for (const event of events) {
    if (event.type === "guidance.received") {
      flush(event.at);
      current = {
        id: `guidance-${event.id}`,
        reflection: {
          understanding: `用户追加引导：${event.text}`,
          blockers: [],
          plannedNext:
            event.applied === false
              ? "引导已排队，等待下一轮迭代应用。"
              : "按最新引导调整下一步。",
          source: "runtime",
        },
        reflectionAt: event.at,
        actions: [],
      };
      continue;
    }

    if (event.type === "reflection.updated") {
      if (isNoisyRuntimeReflection(event.reflection)) {
        if (current) {
          if (event.reflection.plannedNext.trim()) {
            current.reflection.plannedNext = event.reflection.plannedNext;
          }
          continue;
        }
        continue;
      }
      const at: string =
        event.at ??
        (current?.actions.length
          ? eventTimestamp(current.actions[current.actions.length - 1]!.event) ??
            undefined
          : undefined) ??
        turnStartedAt ??
        new Date(0).toISOString();
      flush(at);
      current = {
        id: `step-${steps.length}-${at}`,
        reflection: event.reflection,
        reflectionAt: at,
        actions: [],
      };
      continue;
    }

    if (!current) {
      if (event.type === "tool.started" || event.type === "tool.completed") {
        current = {
          id: `step-${steps.length}-orphan`,
          reflection: {
            understanding: "开始执行工具。",
            blockers: [],
            plannedNext: "继续按任务推进。",
            source: "runtime",
          },
          reflectionAt:
            event.toolCall.startedAt ?? new Date(0).toISOString(),
          actions: [],
        };
      } else {
        continue;
      }
    }

    if (event.type === "tool.started") {
      current.actions.push({ event, running: true });
    } else if (event.type === "tool.completed") {
      const last = current.actions[current.actions.length - 1];
      if (
        last?.event.type === "tool.started" &&
        last.event.toolCall.id === event.toolCall.id
      ) {
        current.actions[current.actions.length - 1] = { event, running: false };
      } else {
        current.actions.push({ event, running: false });
      }
    }
  }

  if (current) {
    const lastAction = current.actions[current.actions.length - 1];
    const endFromAction = lastAction
      ? eventTimestamp(lastAction.event)
      : null;
    flush(endFromAction ?? turnEndedAt);
  }

  return steps;
}

export function stepDurationLabel(
  step: ReasoningStep,
  turnEndedAt?: string,
): string | null {
  const endAt = step.endedAt ?? turnEndedAt;
  if (!endAt) return null;
  const ms = formatStepDurationMs(step.reflectionAt, endAt);
  if (ms == null) return null;
  return formatReasoningDuration(ms);
}

export function stepPreviewText(step: ReasoningStep): string {
  const next = step.reflection.plannedNext.trim();
  const understanding = step.reflection.understanding.trim();
  return next || understanding;
}

export type ReasoningTimelineSummary = {
  stepCount: number;
  toolCount: number;
  hasRunningTool: boolean;
  preview: string;
  durationLabel: string | null;
};

export function summarizeReasoningTimeline(
  steps: ReasoningStep[],
  options: {
    turnStartedAt?: string;
    turnEndedAt?: string;
    liveThinking?: string | null;
    isActive: boolean;
  },
): ReasoningTimelineSummary {
  let toolCount = 0;
  let hasRunningTool = false;

  for (const step of steps) {
    for (const action of step.actions) {
      toolCount += 1;
      if (action.running) hasRunningTool = true;
    }
  }

  const lastStep = steps[steps.length - 1];
  const preview =
    options.liveThinking?.trim() ||
    (lastStep ? stepPreviewText(lastStep) : "") ||
    "分析任务并收集证据";

  let durationLabel: string | null = null;
  if (options.turnStartedAt) {
    const endAt = options.turnEndedAt ?? (options.isActive ? new Date().toISOString() : undefined);
    if (endAt) {
      const ms = formatStepDurationMs(options.turnStartedAt, endAt);
      if (ms != null) durationLabel = formatReasoningDuration(ms);
    }
  }

  return {
    stepCount: steps.length,
    toolCount,
    hasRunningTool,
    preview,
    durationLabel,
  };
}

export function formatTimelineHeaderLabel(
  summary: ReasoningTimelineSummary,
  isActive: boolean,
  turnCompleted: boolean,
): string {
  if (isActive && !turnCompleted) {
    if (summary.hasRunningTool) return "执行中…";
    if (summary.durationLabel) return `工作中 · ${summary.durationLabel}`;
    return "工作中…";
  }
  if (summary.durationLabel) return `已执行 ${summary.durationLabel}`;
  return "已完成执行";
}

export function formatTimelineHeaderMeta(
  summary: ReasoningTimelineSummary,
  detailHint?: string | null,
): string {
  const parts: string[] = [];
  if (summary.stepCount > 0) parts.push(`${summary.stepCount} 次思考`);
  if (summary.toolCount > 0) parts.push(`${summary.toolCount} 步工具`);
  if (detailHint) parts.push(detailHint);
  return parts.join(" · ");
}
