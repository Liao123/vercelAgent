"use client";

import { BrowserPanel } from "@/components/browser-panel";

type AgentRightRailProps = {
  browserOpen: boolean;
  onToggleBrowser: () => void;
};

/** 右侧栏：仅保留内置浏览器，推理步骤改在中间主区域展示。 */
export function AgentRightRail({
  browserOpen,
  onToggleBrowser,
}: AgentRightRailProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <p className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">
          工具
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Agent 的推理与每一步打算，会在中间对话区按时间顺序展示。
        </p>
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
