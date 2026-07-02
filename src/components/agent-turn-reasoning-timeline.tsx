"use client";

import { useEffect, useMemo, useState } from "react";
import { formatModelErrorMessage } from "@/lib/model-error-message";
import {
  reflectionBlockersLabel,
  reflectionBlockersToneClass,
} from "@/lib/reflection-blockers-ui";
import type { AgentEvent } from "@/agent/types";
import {
  formatTimelineHeaderLabel,
  formatTimelineHeaderMeta,
  groupNarrativeIntoSteps,
  summarizeReasoningTimeline,
  type ReasoningStep,
} from "@/lib/agent-reasoning-steps";
import { ChevronIcon } from "@/components/chevron-icon";
import { TurnPlaybookStrip } from "@/components/agent-turn-playbook";
import { agentToolIcon } from "@/lib/agent-tool-icons";
import {
  agentToolIssueLabel,
  agentToolLabel,
  formatAgentToolIssueDetail,
  formatAgentToolAction,
} from "@/lib/agent-tool-display";
import { compactReflectionText } from "@/lib/agent-reflection-display";
import {
  extractToolUnlocks,
  type AgentToolUnlock,
} from "@/lib/agent-tool-unlocks";

const LIVE_VISIBLE_STEP_LIMIT = 3;

function Chevron({ open }: { open: boolean }) {
  return <ChevronIcon expanded={open} className="h-4 w-4 text-zinc-400" />;
}

function ToolUnlockList({ unlocks }: { unlocks: AgentToolUnlock[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {unlocks.map((unlock) => {
        const argNames = unlock.args
          ? Object.keys(unlock.args).slice(0, 3)
          : [];
        return (
          <span
            key={unlock.name}
            title={unlock.description}
            className="inline-flex max-w-full items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] leading-tight text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200"
          >
            <span className="truncate">{agentToolLabel(unlock.name)}</span>
            {argNames.length > 0 && (
              <span className="truncate text-blue-500 dark:text-blue-300/80">
                {argNames.join(", ")}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function ActionChip({
  event,
  running,
  recovered,
}: {
  event: AgentEvent;
  running: boolean;
  recovered?: boolean;
}) {
  if (event.type !== "tool.started" && event.type !== "tool.completed") {
    return null;
  }

  const { toolCall } = event;
  const result = event.type === "tool.completed" ? event.result : null;
  const unlocks =
    event.type === "tool.completed" && toolCall.toolName === "tool.search"
      ? extractToolUnlocks(result)
      : [];
  const error = event.type === "tool.completed" ? toolCall.error : undefined;
  const errorDetail = error ? formatAgentToolIssueDetail(error) : null;
  const display = formatAgentToolAction({
    toolName: toolCall.toolName,
    args: toolCall.args,
    result,
    running,
    error,
  });
  const [open, setOpen] = useState(false);
  const rationale = toolCall.rationale?.trim();
  const expandable = unlocks.length > 0 || Boolean(errorDetail) || Boolean(rationale);
  const errorLabel = error
    ? agentToolIssueLabel({ recovered, taskStillRunning: running || !recovered })
    : null;

  return (
    <div
      className={`flex items-start gap-2 py-0.5 text-[11px] leading-snug ${
        error
          ? recovered
            ? "text-zinc-500 dark:text-zinc-400"
            : "text-amber-700 dark:text-amber-400"
          : "text-zinc-500 dark:text-zinc-400"
      }`}
    >
      <span className="mt-[0.1rem] shrink-0">
        {agentToolIcon(toolCall.toolName)}
      </span>
      <span className="min-w-0 flex-1">
        <span>
          {display.action}
          {display.target && (
            <span className="text-zinc-400 dark:text-zinc-500">
              {" "}
              · {display.target}
            </span>
          )}
          {running && "…"}
          {errorLabel && (
            <span className="text-amber-700 dark:text-amber-400">
              {" "}
              · {errorLabel}
            </span>
          )}
        </span>
        {expandable && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="mt-1 inline-flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:border-blue-200 hover:text-blue-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-900 dark:hover:text-blue-300"
          >
            <Chevron open={open} />
            {open ? "收起详情" : "查看细节"}
          </button>
        )}
        {expandable && open && (
          <>
            {rationale && (
              <p className="mt-1.5 rounded-md bg-zinc-50/90 p-2 text-[11px] leading-relaxed text-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-400">
                {rationale}
              </p>
            )}
            {errorDetail && (
              <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50/90 p-2 font-mono text-[10px] leading-relaxed text-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-400">
                {errorDetail}
              </pre>
            )}
            {unlocks.length > 0 && <ToolUnlockList unlocks={unlocks} />}
          </>
        )}
      </span>
    </div>
  );
}

function actionToolName(action: ReasoningStep["actions"][number]): string | null {
  const event = action.event;
  if (event.type !== "tool.started" && event.type !== "tool.completed") {
    return null;
  }
  return event.toolCall.toolName;
}

function ActionGroup({
  actions,
  isLatestStep,
  turnCompleted,
}: {
  actions: ReasoningStep["actions"];
  isLatestStep: boolean;
  turnCompleted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const runningCount = actions.filter((action) => action.running).length;
  const errorCount = actions.filter(
    (action) =>
      action.event.type === "tool.completed" && Boolean(action.event.toolCall.error),
  ).length;
  const names = Array.from(
    new Set(
      actions
        .map(actionToolName)
        .filter((name): name is string => Boolean(name))
        .map(agentToolLabel),
    ),
  );
  const label =
    runningCount > 0
      ? `正在运行 ${runningCount} 条工具`
      : `已运行 ${actions.length} 条工具`;
  const detail = names.slice(0, 3).join("、");
  const recovered = turnCompleted || !isLatestStep;
  const issueLabel = agentToolIssueLabel({
    recovered,
    taskStillRunning: !turnCompleted,
  });

  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/70 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 text-left text-[12px] text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1 truncate">
          {label}
          {detail && (
            <span className="text-zinc-400 dark:text-zinc-500">
              {" "}
              · {detail}
              {names.length > 3 ? " 等" : ""}
            </span>
          )}
          {errorCount > 0 && (
            <span className="text-amber-700 dark:text-amber-400">
              {" "}
              · {recovered ? issueLabel : errorCount > 1 ? `${errorCount} 个问题，正在换策略` : issueLabel}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
          {actions.map((action, index) => (
            <ActionChip
              key={`${action.event.type}-${index}`}
              event={action.event}
              running={action.running}
              recovered={recovered || index < actions.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReasoningStepContent({
  step,
  isLatestStep,
  isActiveTurn,
  turnCompleted,
}: {
  step: ReasoningStep;
  isLatestStep: boolean;
  isActiveTurn: boolean;
  turnCompleted: boolean;
}) {
  const thinking = isLatestStep && isActiveTurn && !turnCompleted;
  const taskStillRunning = isActiveTurn && !turnCompleted;
  const hasActions = step.actions.length > 0;
  const understanding = compactReflectionText(step.reflection.understanding);
  const plannedNext = compactReflectionText(step.reflection.plannedNext, 110);
  const blockers = step.reflection.blockers
    .map((item) => compactReflectionText(formatModelErrorMessage(item), 180))
    .filter(Boolean);
  const showReflectionText =
    !step.synthetic &&
    (understanding.length > 0 ||
      blockers.length > 0 ||
      plannedNext.length > 0);

  return (
    <div className="space-y-1.5">
      {thinking && !step.synthetic && (
        <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          {"\u601d\u8003\u4e2d"}
          <span className="ml-1.5 inline-block h-1 w-1 animate-pulse rounded-full bg-blue-500 align-middle" />
        </p>
      )}
      {showReflectionText && (
        <div className="space-y-1 text-[12px] leading-[1.65] text-zinc-500 dark:text-zinc-400">
          {understanding.length > 0 && <p>{understanding}</p>}
          {blockers.length > 0 && (
            <p className={reflectionBlockersToneClass(taskStillRunning)}>
              {reflectionBlockersLabel({
                taskStillRunning,
                isLatestStep,
              })}
              {taskStillRunning && !isLatestStep
                ? "已记录上轮问题，正在换策略继续。"
                : blockers.join("\uff1b")}
            </p>
          )}
          {plannedNext.length > 0 && (
            <p>
              <span className="text-zinc-400 dark:text-zinc-500">
                {"\u6253\u7b97\uff1a"}
              </span>
              {plannedNext}
            </p>
          )}
        </div>
      )}
      {hasActions && (
        <div className="space-y-0.5 pt-0.5">
          {step.actions.length > 1 ? (
            <ActionGroup
              actions={step.actions}
              isLatestStep={isLatestStep}
              turnCompleted={turnCompleted}
            />
          ) : (
            step.actions.map((action, index) => (
              <ActionChip
                key={`${action.event.type}-${index}`}
                event={action.event}
                running={action.running}
                recovered={
                  turnCompleted ||
                  !isLatestStep ||
                  index < step.actions.length - 1
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

type TurnReasoningTimelineProps = {
  narrativeEvents: AgentEvent[];
  isActiveTurn: boolean;
  turnCompleted: boolean;
  turnStartedAt?: string;
  turnEndedAt?: string;
  liveThinking?: string | null;
  playbook?: import("@/lib/agent-turn-feed").AgentTurnFeed["playbook"];
};

export function TurnReasoningTimeline({
  narrativeEvents,
  isActiveTurn,
  turnCompleted,
  turnStartedAt,
  turnEndedAt,
  liveThinking,
  playbook,
}: TurnReasoningTimelineProps) {
  const [open, setOpen] = useState(isActiveTurn && !turnCompleted);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [tick, setTick] = useState(0);

  const steps = useMemo(
    () => groupNarrativeIntoSteps(narrativeEvents, turnEndedAt, turnStartedAt),
    [narrativeEvents, turnEndedAt, turnStartedAt],
  );

  useEffect(() => {
    if (turnCompleted) {
      setOpen(false);
      setShowAllSteps(false);
      return;
    }
    if (isActiveTurn) {
      setOpen(true);
      setShowAllSteps(false);
    }
  }, [isActiveTurn, turnCompleted]);

  useEffect(() => {
    if (!isActiveTurn || turnCompleted) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActiveTurn, turnCompleted]);

  const summary = useMemo(
    () =>
      summarizeReasoningTimeline(steps, {
        turnStartedAt,
        turnEndedAt,
        liveThinking,
        isActive: isActiveTurn && !turnCompleted,
      }),
    [
      steps,
      turnStartedAt,
      turnEndedAt,
      liveThinking,
      isActiveTurn,
      turnCompleted,
      tick,
    ],
  );

  const hasContent = steps.length > 0 || Boolean(liveThinking);
  if (!hasContent) return null;

  const visiblePlaybook = playbook?.id === "default" ? undefined : playbook;

  const headerLabel = formatTimelineHeaderLabel(
    summary,
    isActiveTurn,
    turnCompleted,
  );
  const headerMeta = formatTimelineHeaderMeta(
    summary,
    visiblePlaybook?.title && visiblePlaybook.totalSteps > 0
      ? `${visiblePlaybook.completedCount}/${visiblePlaybook.totalSteps} 路径`
      : null,
  );
  const working = isActiveTurn && !turnCompleted;
  const hiddenStepCount =
    working && !showAllSteps
      ? Math.max(0, steps.length - LIVE_VISIBLE_STEP_LIMIT)
      : 0;
  const visibleSteps =
    hiddenStepCount > 0 ? steps.slice(-LIVE_VISIBLE_STEP_LIMIT) : steps;

  return (
    <div className="group/timeline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1">
          <span
            className={`text-[13px] font-medium ${
              working
                ? "text-zinc-600 dark:text-zinc-300"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {headerLabel}
            {working && !summary.hasRunningTool && !liveThinking && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 align-middle" />
            )}
          </span>
          {!open && (
            <span className="mt-0.5 block truncate text-[11px] text-zinc-400 dark:text-zinc-500">
              {headerMeta && `${headerMeta} · `}
              {summary.preview}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="ml-5 mt-2 space-y-4 border-l border-zinc-200/90 pl-3 dark:border-zinc-700/80">
          {visiblePlaybook && (
            <TurnPlaybookStrip
              playbook={visiblePlaybook}
              active={isActiveTurn && !turnCompleted}
            />
          )}
          {hiddenStepCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllSteps(true)}
              className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-500 transition hover:border-zinc-300 hover:bg-white hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            >
              前面 {hiddenStepCount} 步已折叠，展开查看
            </button>
          )}
          {visibleSteps.map((step, visibleIndex) => {
            const index = hiddenStepCount + visibleIndex;
            return (
              <div key={step.id}>
                <ReasoningStepContent
                  step={step}
                  isLatestStep={index === steps.length - 1 && !liveThinking}
                  isActiveTurn={isActiveTurn}
                  turnCompleted={turnCompleted}
                />
              </div>
            );
          })}

          {liveThinking && isActiveTurn && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                思考中
                <span className="ml-1.5 inline-block h-1 w-1 animate-pulse rounded-full bg-blue-500 align-middle" />
              </p>
              <p className="text-[12px] leading-[1.65] text-zinc-500 dark:text-zinc-400">
                {liveThinking}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
