"use client";

import { useMemo } from "react";
import { BrowserPanel } from "@/components/browser-panel";
import type { AgentEvent, AgentPlanStepStatus } from "@/agent/types";
import { getLatestCompactedMemory, getLatestPlan } from "@/lib/agent-feed";

const STEP_STATUS_LABEL: Record<AgentPlanStepStatus, string> = {
  todo: "待办",
  doing: "进行",
  blocked: "阻塞",
  done: "完成",
  skipped: "跳过",
};

function stepDotClass(status: AgentPlanStepStatus): string {
  if (status === "done") return "bg-emerald-500";
  if (status === "doing") return "bg-blue-500 animate-pulse";
  if (status === "blocked") return "bg-red-500";
  if (status === "skipped") return "bg-zinc-400";
  return "bg-zinc-300 dark:bg-zinc-600";
}

type AgentRightRailProps = {
  events: AgentEvent[];
  running: boolean;
  taskSummary: string | null;
  error: string | null;
  browserOpen: boolean;
  onToggleBrowser: () => void;
};

export function AgentRightRail({
  events,
  running,
  taskSummary,
  error,
  browserOpen,
  onToggleBrowser,
}: AgentRightRailProps) {
  const plan = useMemo(() => getLatestPlan(events), [events]);
  const compactMemory = useMemo(() => getLatestCompactedMemory(events), [events]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
          任务规划
        </p>
        {running && (
          <p className="mt-0.5 text-[10px] text-blue-600 dark:text-blue-400">
            Agent 运行中…
          </p>
        )}
        {!running && error && (
          <p className="mt-0.5 line-clamp-2 text-[10px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {!running && !error && taskSummary && (
          <p className="mt-0.5 line-clamp-3 text-[10px] text-zinc-600 dark:text-zinc-400">
            {taskSummary}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {!plan && (
          <p className="px-1 py-4 text-center text-[11px] text-zinc-500">
            运行任务后显示计划步骤
          </p>
        )}
        {compactMemory && (
          <div className="mb-3 rounded-md border border-blue-200/80 bg-blue-50/60 px-2 py-1.5 dark:border-blue-900/50 dark:bg-blue-950/30">
            <p className="text-[10px] font-medium text-blue-800 dark:text-blue-300">
              任务记忆
              {compactMemory.round != null
                ? ` · 第 ${compactMemory.round} 轮`
                : ""}
            </p>
            <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[10px] leading-snug text-blue-900/90 dark:text-blue-200/80">
              {compactMemory.summaryPreview ?? "已压缩历史步骤"}
            </p>
            {(compactMemory.pinnedApprovalCount ?? 0) > 0 && (
              <p className="mt-0.5 text-[10px] text-blue-700/80 dark:text-blue-300/70">
                钉住 {compactMemory.pinnedApprovalCount} 个审批 ID
              </p>
            )}
          </div>
        )}
        {plan && (
          <div className="space-y-2">
            <p className="px-1 text-[11px] leading-snug text-zinc-700 dark:text-zinc-300">
              {plan.goal}
            </p>
            <ol className="space-y-1">
              {plan.steps.map((step) => (
                <li
                  key={step.id}
                  className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-zinc-100/80 dark:hover:bg-zinc-800/50"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${stepDotClass(step.status)}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-zinc-800 dark:text-zinc-200">
                      {step.title}
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      {STEP_STATUS_LABEL[step.status]}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={onToggleBrowser}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <span>内置浏览器</span>
          <span className="text-[10px] text-zinc-500">
            {browserOpen ? "隐藏" : "显示"}
          </span>
        </button>
        {browserOpen && (
          <div className="max-h-[min(40vh,320px)] overflow-auto border-t border-zinc-200 p-2 dark:border-zinc-800">
            <BrowserPanel embedded />
          </div>
        )}
      </div>
    </aside>
  );
}
