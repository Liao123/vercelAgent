"use client";

import type { ReactNode } from "react";
import { BrowserPanel } from "@/components/browser-panel";
import { WorkspaceFileTree } from "@/components/workspace-file-tree";
import { TripleRightPanelToggleIcon } from "@/components/triple-right-panel-toggle-icon";

export type AgentRightRailTab = "review" | "files" | "browser" | "terminal";

type AgentRightRailProps = {
  workspaceEnabled: boolean;
  onSelectFilePath: (path: string) => void;
  treeHighlightPath?: string | null;
  reviewPanel: ReactNode;
  terminalPanel: ReactNode;
  pendingReviewCount?: number;
  tab: AgentRightRailTab;
  onTabChange: (tab: AgentRightRailTab) => void;
  onHideRightPanel?: () => void;
};

/** Electron webview 是原生层，不能用 inset-0 铺满右栏（会挡住文件树等点击） */
const OFFSCREEN_BROWSER_CLASS =
  "pointer-events-none fixed -left-[12000px] top-0 z-[-1] h-[600px] w-[800px] min-h-0 overflow-hidden opacity-0";

const TABS: {
  id: AgentRightRailTab;
  label: string;
  icon: ReactNode;
}[] = [
  {
    id: "review",
    label: "审查",
    icon: (
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        aria-hidden
      >
        <path d="M3 4.5h10M3 8h7M3 11.5h5" strokeLinecap="round" />
        <path d="M11.5 7v5.5l2-1.5-2-1.5V7z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "files",
    label: "文件",
    icon: (
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        aria-hidden
      >
        <path
          d="M5.5 2.5h5l2 2v9h-9v-11z"
          strokeLinejoin="round"
        />
        <path d="M5.5 2.5v2h5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "browser",
    label: "浏览器",
    icon: (
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        aria-hidden
      >
        <circle cx="8" cy="8" r="5.5" />
        <path d="M2.5 8h11M8 2.5c1.8 1.6 2.8 3.4 2.8 5.5S9.8 11.4 8 13M8 2.5C6.2 4.1 5.2 5.9 5.2 8s1 3.9 2.8 5.5" />
      </svg>
    ),
  },
  {
    id: "terminal",
    label: "终端",
    icon: (
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        aria-hidden
      >
        <path
          d="M3.5 4.5 6.5 8 3.5 11.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8 11.5h4.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

/** 右侧栏：审查 / 文件树 / 浏览器 同级 Tab（对齐 Cursor 右侧面板）。 */
export function AgentRightRail({
  workspaceEnabled,
  onSelectFilePath,
  treeHighlightPath = null,
  reviewPanel,
  terminalPanel,
  pendingReviewCount = 0,
  tab,
  onTabChange,
  onHideRightPanel,
}: AgentRightRailProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-1.5 py-1 dark:border-zinc-800"
        role="tablist"
        aria-label="右侧面板"
      >
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {TABS.map((item) => {
          const active = tab === item.id;
          const showBadge =
            item.id === "review" && pendingReviewCount > 0 && !active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={item.label}
              title={item.label}
              onClick={() => onTabChange(item.id)}
              className={`relative flex h-7 w-7 items-center justify-center rounded-md transition ${
                active
                  ? "bg-zinc-200/90 text-zinc-900 dark:bg-zinc-700/90 dark:text-zinc-100"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-300"
              }`}
            >
              {item.icon}
              {showBadge && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[8px] font-bold leading-none text-white">
                  {pendingReviewCount > 9 ? "+" : pendingReviewCount}
                </span>
              )}
              {item.id === "review" && pendingReviewCount > 0 && active && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </button>
          );
        })}
        </div>
        {onHideRightPanel ? (
          <button
            type="button"
            onClick={onHideRightPanel}
            title="隐藏右侧面板"
            aria-label="隐藏右侧面板"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-300"
          >
            <TripleRightPanelToggleIcon />
          </button>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden" role="tabpanel">
        {tab === "review" && (
          <div className="relative z-0 flex h-full min-h-0 flex-col">
            {reviewPanel}
          </div>
        )}

        {tab === "files" && (
          <div className="relative z-0 flex h-full min-h-0 flex-col overflow-hidden">
            {!workspaceEnabled ? (
              <p className="px-3 py-6 text-center text-[11px] text-zinc-500">
                设置 Workspace 后可浏览项目文件
              </p>
            ) : (
              <WorkspaceFileTree
                enabled={workspaceEnabled}
                onSelectPath={onSelectFilePath}
                highlightPath={treeHighlightPath}
                variant="panel"
              />
            )}
          </div>
        )}

        {tab === "terminal" && (
          <div className="relative z-0 flex h-full min-h-0 flex-col overflow-hidden">
            {terminalPanel}
          </div>
        )}

        {/* 始终挂载 WebView，供 Agent CDP；非浏览器 Tab 时离屏渲染 */}
        <div
          className={
            tab === "browser"
              ? "relative z-0 flex h-full min-h-0 flex-col overflow-hidden"
              : OFFSCREEN_BROWSER_CLASS
          }
          aria-hidden={tab !== "browser"}
        >
          <BrowserPanel embedded chromeVisible={tab === "browser"} />
        </div>
      </div>
    </div>
  );
}
