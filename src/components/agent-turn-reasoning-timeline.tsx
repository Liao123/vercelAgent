"use client";

import { useEffect, useMemo, useState } from "react";
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
import { formatPatchToolResultSummary } from "@/lib/patch-summary";
import { agentToolFileName, agentToolIcon } from "@/lib/agent-tool-icons";

const TOOL_LABELS: Record<string, string> = {
  "workspace.inspect": "检查工作区",
  "project.index": "索引项目",
  "file.locate": "定位文件",
  "ui.trace_from_page": "追踪页面组件树",
  "file.list": "列出目录",
  "file.read": "读取文件",
  "file.search": "搜索文件",
  "jsx.find_text": "查找 JSX 文案",
  "symbol.find_references": "查找符号引用",
  "git.status": "Git 状态",
  "git.diff": "Git diff",
  "browser.open": "打开浏览器",
  "browser.inspect": "读取浏览器快照",
  "browser.wait_and_inspect": "等待并读取页面",
  "browser.query": "查询页面元素",
  "devtools.get_screenshot": "CDP 截图",
  "devtools.get_dom_snapshot": "DOM 快照",
  "devtools.get_accessibility_tree": "无障碍树",
  "devtools.get_console_errors": "Console",
  "devtools.get_network_requests": "Network",
  "devtools.click": "页面点击",
  "devtools.type": "页面输入",
  "devtools.get_box_model": "盒模型",
  "devtools.get_computed_style": "计算样式",
  "devtools.inspect_element_at": "坐标探测",
  "file.mutation.prepare": "准备文件变更",
  "file.replace.prepare": "准备文本替换",
  "git.mutation.prepare": "准备 Git 操作",
  "shell.command.prepare": "准备验证脚本",
  "shell.run.prepare": "准备终端命令",
  "patch.prepare": "准备 Patch",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronIcon expanded={open} className="h-4 w-4 text-zinc-400" />
  );
}

function summarizeToolTarget(
  toolName: string,
  args: unknown,
  result: unknown,
): string | null {
  const patchHint = formatPatchToolResultSummary(result);
  if (patchHint) return patchHint;

  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    if (typeof record.path === "string") return record.path;
    if (typeof record.query === "string") return `"${record.query}"`;
    if (typeof record.pattern === "string") return record.pattern;
  }

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.path === "string") return record.path;
    if (typeof record.summary === "string") return record.summary;
    if (Array.isArray(record.candidates)) {
      return `${record.candidates.length} 个候选`;
    }
    if (record.approval && typeof record.approval === "object") {
      const approval = record.approval as { title?: string };
      return approval.title ?? "已创建审批";
    }
  }

  return null;
}

function ActionChip({
  event,
  running,
}: {
  event: AgentEvent;
  running: boolean;
}) {
  if (event.type !== "tool.started" && event.type !== "tool.completed") {
    return null;
  }

  const { toolCall } = event;
  const result = event.type === "tool.completed" ? event.result : null;
  const target = summarizeToolTarget(toolCall.toolName, toolCall.args, result);
  const error = event.type === "tool.completed" ? toolCall.error : undefined;
  const fileName = agentToolFileName(toolCall.toolName, toolCall.args, result);

  return (
    <div
      className={`flex items-start gap-2 py-0.5 text-[11px] leading-snug ${
        error
          ? "text-red-600 dark:text-red-400"
          : "text-zinc-500 dark:text-zinc-400"
      }`}
    >
      <span className="mt-[0.1rem] shrink-0">{agentToolIcon(toolCall.toolName)}</span>
      <span className="min-w-0 flex-1">
        {toolCall.rationale && (
          <span className="block text-[12px] leading-[1.55] text-zinc-600 dark:text-zinc-400">
            {toolCall.rationale}
          </span>
        )}
        <span className={toolCall.rationale ? "mt-0.5 block" : undefined}>
          {running ? "正在" : "已"}
          {toolLabel(toolCall.toolName)}
          {target && (
            <span className="text-zinc-400 dark:text-zinc-500">
              {" "}
              · {target}
            </span>
          )}
          {!target && fileName && (
            <span className="font-medium text-zinc-600 dark:text-zinc-400">
              {" "}
              · {fileName}
            </span>
          )}
          {running && "…"}
          {error && ` · ${error}`}
        </span>
      </span>
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
  const hasActions = step.actions.length > 0;

  return (
    <div className="space-y-1.5">
      {thinking && (
        <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          思考中
          <span className="ml-1.5 inline-block h-1 w-1 animate-pulse rounded-full bg-blue-500 align-middle" />
        </p>
      )}
      <div className="space-y-1 text-[12px] leading-[1.65] text-zinc-500 dark:text-zinc-400">
        <p>{step.reflection.understanding}</p>
        {step.reflection.blockers.length > 0 && (
          <p className="text-red-600 dark:text-red-400">
            阻塞：{step.reflection.blockers.join("；")}
          </p>
        )}
        <p>
          <span className="text-zinc-400 dark:text-zinc-500">打算：</span>
          {step.reflection.plannedNext}
        </p>
      </div>
      {hasActions && (
        <div className="space-y-0.5 pt-0.5">
          {step.actions.map((action, index) => (
            <ActionChip
              key={`${action.event.type}-${index}`}
              event={action.event}
              running={action.running}
            />
          ))}
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
  const [tick, setTick] = useState(0);

  const steps = useMemo(
    () => groupNarrativeIntoSteps(narrativeEvents, turnEndedAt, turnStartedAt),
    [narrativeEvents, turnEndedAt, turnStartedAt],
  );

  useEffect(() => {
    if (turnCompleted) {
      setOpen(false);
      return;
    }
    if (isActiveTurn) setOpen(true);
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

  const headerLabel = formatTimelineHeaderLabel(
    summary,
    isActiveTurn,
    turnCompleted,
  );
  const headerMeta = formatTimelineHeaderMeta(
    summary,
    playbook?.title && playbook.totalSteps > 0
      ? `${playbook.completedCount}/${playbook.totalSteps} 路径`
      : null,
  );
  const working = isActiveTurn && !turnCompleted;

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
          {playbook && (
            <TurnPlaybookStrip
              playbook={playbook}
              active={isActiveTurn && !turnCompleted}
            />
          )}
          {steps.map((step, index) => (
            <div key={step.id}>
              {steps.length > 1 && (
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  第 {index + 1} 轮
                </p>
              )}
              <ReasoningStepContent
                step={step}
                isLatestStep={index === steps.length - 1 && !liveThinking}
                isActiveTurn={isActiveTurn}
                turnCompleted={turnCompleted}
              />
            </div>
          ))}

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
