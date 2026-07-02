"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BrowserChromeIconButton,
  BrowserExpandIcon,
  BrowserGlobeIcon,
  BrowserPlusIcon,
} from "@/components/browser-chrome-icons";
import { BrowserPanel } from "@/components/browser-panel";
import { WorkspaceFileTree } from "@/components/workspace-file-tree";
import { TripleRightPanelToggleIcon } from "@/components/triple-right-panel-toggle-icon";
import type { GitStatusSnapshot } from "@/lib/git-status";

export type AgentRightRailSurface = "review" | "files" | "browser" | "terminal";
export type AgentRightRailTab = AgentRightRailSurface | "launcher";

export type AgentRightRailContextSummary = {
  workspaceLabel?: string | null;
  workspacePath?: string | null;
  git?: GitStatusSnapshot | null;
  reviewSource?: "approval" | "git" | "direct";
  changedFileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  running: boolean;
};

type AgentRightRailProps = {
  workspaceEnabled: boolean;
  onSelectFilePath: (path: string) => void;
  treeHighlightPath?: string | null;
  reviewPanel: ReactNode;
  terminalPanel: ReactNode;
  pendingReviewCount?: number;
  contextSummary?: AgentRightRailContextSummary | null;
  tab: AgentRightRailTab;
  onTabChange: (tab: AgentRightRailTab) => void;
  onOpenReview?: () => void;
  onHideRightPanel?: () => void;
};

/** Electron webview 是原生层，非浏览器 Tab 时必须离屏保活，避免挡住文件树点击。 */
const OFFSCREEN_BROWSER_CLASS =
  "pointer-events-none fixed -left-[12000px] top-0 z-[-1] h-[600px] w-[800px] min-h-0 overflow-hidden opacity-0";

const SURFACES: {
  id: AgentRightRailSurface;
  fallbackLabel: string;
  shortcut?: string;
  icon: ReactNode;
}[] = [
  { id: "terminal", fallbackLabel: "终端", icon: <TerminalIcon /> },
  {
    id: "browser",
    fallbackLabel: "新选项卡",
    icon: <BrowserGlobeIcon className="h-4 w-4" />,
  },
  { id: "review", fallbackLabel: "审查", icon: <ReviewIcon /> },
  { id: "files", fallbackLabel: "文件", icon: <FilesIcon /> },
];

const LAUNCHER_ITEMS: {
  id: AgentRightRailSurface | "side-chat";
  label: string;
  shortcut?: string;
  icon: ReactNode;
  disabled?: boolean;
}[] = [
  { id: "review", label: "审查", shortcut: "Ctrl+Shift+G", icon: <ReviewIcon /> },
  { id: "terminal", label: "终端", icon: <TerminalIcon /> },
  {
    id: "browser",
    label: "浏览器",
    shortcut: "Ctrl+T",
    icon: <BrowserGlobeIcon className="h-4 w-4" />,
  },
  { id: "files", label: "文件", shortcut: "Ctrl+P", icon: <FilesIcon /> },
  {
    id: "side-chat",
    label: "侧边聊天",
    shortcut: "Ctrl+Alt+S",
    icon: <SideChatIcon />,
    disabled: true,
  },
];

function basename(path?: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function formatSigned(value: number, sign: "+" | "-"): string {
  return `${sign}${Math.max(0, value)}`;
}

function branchLabel(git?: GitStatusSnapshot | null): string {
  if (!git) return "未检测";
  if (git.detached) return "HEAD detached";
  return git.branch ?? "unknown branch";
}

function syncLabel(git?: GitStatusSnapshot | null): string | null {
  if (!git) return null;
  const parts: string[] = [];
  if (git.ahead != null && git.ahead > 0) parts.push(`↑${git.ahead}`);
  if (git.behind != null && git.behind > 0) parts.push(`↓${git.behind}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

function tabLabelFor(
  item: { id: AgentRightRailSurface; fallbackLabel: string },
  summary?: AgentRightRailContextSummary | null,
): string {
  if (item.id === "terminal") {
    return basename(summary?.workspacePath) ?? item.fallbackLabel;
  }
  return item.fallbackLabel;
}

function surfaceFor(id: AgentRightRailSurface) {
  return SURFACES.find((item) => item.id === id) ?? SURFACES[0]!;
}

function CodexEnvironmentPopover({
  summary,
  onOpenReview,
}: {
  summary: AgentRightRailContextSummary;
  onOpenReview: () => void;
}) {
  const workspaceLabel =
    summary.workspaceLabel ?? basename(summary.workspacePath) ?? "未选择工作区";
  const changed = summary.changedFileCount > 0;
  const sync = syncLabel(summary.git);

  return (
    <div className="absolute right-0 top-10 z-30 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl shadow-zinc-950/10 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/40">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
          环境信息
        </p>
        <span className="text-zinc-400 dark:text-zinc-500">＋</span>
      </div>

      <div className="space-y-2 text-[14px]">
        <button
          type="button"
          disabled={!changed}
          onClick={onOpenReview}
          className={`flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left transition ${
            changed
              ? "hover:bg-zinc-100 dark:hover:bg-zinc-900"
              : "cursor-default opacity-80"
          }`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <ChangeIcon />
            <span className="text-zinc-800 dark:text-zinc-100">变更</span>
          </span>
          <span className="shrink-0 font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
            {summary.changedFileCount} 个文件{" "}
            <span className="text-emerald-600 dark:text-emerald-400">
              {formatSigned(summary.totalAdditions, "+")}
            </span>
            <span className="mx-1 text-zinc-300 dark:text-zinc-700">/</span>
            <span className="text-red-600 dark:text-red-400">
              {formatSigned(summary.totalDeletions, "-")}
            </span>
          </span>
        </button>

        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <span className="flex min-w-0 items-center gap-3">
            <LocalIcon />
            <span className="text-zinc-800 dark:text-zinc-100">本地</span>
          </span>
          <span
            className="min-w-0 truncate font-mono text-[13px] text-zinc-600 dark:text-zinc-300"
            title={summary.workspacePath ?? workspaceLabel}
          >
            {workspaceLabel}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <span className="flex min-w-0 items-center gap-3">
            <BranchIcon />
            <span className="text-zinc-800 dark:text-zinc-100">分支</span>
          </span>
          <span className="min-w-0 truncate font-mono text-[13px] text-zinc-600 dark:text-zinc-300">
            {branchLabel(summary.git)}
            {sync ? <span className="ml-1 text-zinc-400">{sync}</span> : null}
          </span>
        </div>

        <div className="flex items-center gap-3 rounded-lg px-1 py-1 text-zinc-500 dark:text-zinc-500">
          <CommitIcon />
          <span>提交或推送</span>
        </div>

        <div className="flex items-center gap-3 rounded-lg px-1 py-1 text-zinc-500 dark:text-zinc-500">
          <GithubIcon />
          <span>GitHub CLI 不可用</span>
        </div>
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <p className="mb-3 text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
          来源
        </p>
        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-500">
          <BrowserGlobeIcon className="h-4 w-4" />
          <span className="sr-only">来源</span>
        </div>
      </div>
    </div>
  );
}

function SurfaceLauncherList({
  onOpenSurface,
  compact = false,
}: {
  onOpenSurface: (surface: AgentRightRailSurface) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-1" : "w-full max-w-xl space-y-2"}>
      {LAUNCHER_ITEMS.map((item) => {
        const disabled = item.disabled === true;
        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!disabled && item.id !== "side-chat") {
                onOpenSurface(item.id);
              }
            }}
            title={disabled ? "侧边聊天稍后接入" : item.label}
            className={`flex w-full items-center justify-between gap-4 rounded-lg px-4 py-3 text-left transition ${
              compact ? "py-2.5" : ""
            } ${
              disabled
                ? "cursor-not-allowed bg-zinc-50 text-zinc-400 dark:bg-zinc-900/60 dark:text-zinc-600"
                : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200/75 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                {item.icon}
              </span>
              <span className="truncate text-[15px]">{item.label}</span>
            </span>
            {item.shortcut ? (
              <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[12px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {item.shortcut}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SurfaceLauncherPopover({
  onOpenSurface,
}: {
  onOpenSurface: (surface: AgentRightRailSurface) => void;
}) {
  return (
    <div className="absolute left-0 top-10 z-30 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl shadow-zinc-950/10 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/40">
      <SurfaceLauncherList onOpenSurface={onOpenSurface} compact />
    </div>
  );
}

function SurfaceLauncherView({
  onOpenSurface,
}: {
  onOpenSurface: (surface: AgentRightRailSurface) => void;
}) {
  return (
    <div className="flex h-full min-h-0 items-end justify-center px-6 pb-24">
      <SurfaceLauncherList onOpenSurface={onOpenSurface} />
    </div>
  );
}

function EnvironmentIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden
    >
      <path d="M3 4.5h6.5M12 4.5h1" strokeLinecap="round" />
      <path d="M3 8h1M6.5 8H13" strokeLinecap="round" />
      <path d="M3 11.5h5M10.5 11.5H13" strokeLinecap="round" />
      <circle cx="10.7" cy="4.5" r="1.1" />
      <circle cx="5.3" cy="8" r="1.1" />
      <circle cx="9.3" cy="11.5" r="1.1" />
    </svg>
  );
}

function SideChatIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden
    >
      <path
        d="M3 4.2h10v6.1H7.2L4 12.6v-2.3H3z"
        strokeLinejoin="round"
      />
      <path d="M5.4 6.5h5.2M5.4 8.3h3.4" strokeLinecap="round" />
    </svg>
  );
}

/** 右侧栏：Codex 风格顶部 Tab Strip + 内容面板。 */
export function AgentRightRail({
  workspaceEnabled,
  onSelectFilePath,
  treeHighlightPath = null,
  reviewPanel,
  terminalPanel,
  pendingReviewCount = 0,
  contextSummary = null,
  tab,
  onTabChange,
  onOpenReview,
  onHideRightPanel,
}: AgentRightRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [surfaceMenuOpen, setSurfaceMenuOpen] = useState(false);
  const [openedTabs, setOpenedTabs] = useState<AgentRightRailSurface[]>([]);

  useEffect(() => {
    if (tab === "launcher") return;
    setOpenedTabs((current) =>
      current.includes(tab) ? current : [...current, tab],
    );
  }, [tab]);

  function handleExpandRail() {
    const node = railRef.current;
    if (node && typeof node.requestFullscreen === "function") {
      void node.requestFullscreen();
    }
  }

  function openSurface(surface: AgentRightRailSurface) {
    setOpenedTabs((current) =>
      current.includes(surface) ? current : [...current, surface],
    );
    setSurfaceMenuOpen(false);
    setEnvironmentOpen(false);
    if (surface === "review" && onOpenReview) {
      onOpenReview();
    } else {
      onTabChange(surface);
    }
  }

  function closeSurface(surface: AgentRightRailSurface) {
    const nextTabs = openedTabs.filter((item) => item !== surface);
    setOpenedTabs(nextTabs);
    setSurfaceMenuOpen(false);
    setEnvironmentOpen(false);

    if (tab !== surface) return;
    const closedIndex = openedTabs.indexOf(surface);
    const nextActive =
      nextTabs[closedIndex] ?? nextTabs[closedIndex - 1] ?? "launcher";
    onTabChange(nextActive);
  }

  return (
    <div
      ref={railRef}
      className="flex h-full min-h-0 flex-col bg-white dark:bg-zinc-950"
    >
      <div
        className="relative flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-2 py-2 dark:border-zinc-800 dark:bg-zinc-950"
        role="tablist"
        aria-label="右侧面板"
      >
        <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {openedTabs.map((surface) => {
            const item = surfaceFor(surface);
            const active = tab === surface;
            const label = tabLabelFor(item, contextSummary);
            const showBadge =
              item.id === "review" && pendingReviewCount > 0 && !active;

            return (
              <div
                key={item.id}
                className={`group/tab relative inline-flex h-8 max-w-[12rem] shrink-0 items-center rounded-xl text-[13px] transition ${
                  active
                    ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={label}
                  title={label}
                  onClick={() => {
                    setEnvironmentOpen(false);
                    setSurfaceMenuOpen(false);
                    if (surface === "review" && onOpenReview) {
                      onOpenReview();
                    } else {
                      onTabChange(surface);
                    }
                  }}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-xl py-0 pl-3 pr-1"
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="min-w-0 truncate">{label}</span>
                </button>
                <button
                  type="button"
                  aria-label={`关闭 ${label}`}
                  title={`关闭 ${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeSurface(surface);
                  }}
                  className={`mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[13px] leading-none transition ${
                    active
                      ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-950 dark:hover:bg-zinc-400"
                      : "text-zinc-400 opacity-70 hover:bg-zinc-200 hover:text-zinc-800 group-hover/tab:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                  }`}
                >
                  ×
                </button>
                {showBadge && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[8px] font-bold leading-none text-white">
                    {pendingReviewCount > 9 ? "+" : pendingReviewCount}
                  </span>
                )}
              </div>
            );
          })}

          <div className="relative shrink-0">
            <BrowserChromeIconButton
              title="打开面板"
              active={surfaceMenuOpen}
              onClick={() => {
                setEnvironmentOpen(false);
                setSurfaceMenuOpen((value) => !value);
              }}
            >
              <BrowserPlusIcon className="h-4 w-4" />
            </BrowserChromeIconButton>
            {surfaceMenuOpen ? (
              <SurfaceLauncherPopover onOpenSurface={openSurface} />
            ) : null}
          </div>
        </div>

        <div className="relative">
          <BrowserChromeIconButton
            title="环境信息"
            active={environmentOpen}
            disabled={!contextSummary}
            onClick={() => {
              setSurfaceMenuOpen(false);
              setEnvironmentOpen((value) => !value);
            }}
          >
            <EnvironmentIcon />
          </BrowserChromeIconButton>
          {environmentOpen && contextSummary ? (
            <CodexEnvironmentPopover
              summary={contextSummary}
              onOpenReview={() => {
                openSurface("review");
              }}
            />
          ) : null}
        </div>

        <BrowserChromeIconButton title="展开视图" onClick={handleExpandRail}>
          <BrowserExpandIcon className="h-4 w-4" />
        </BrowserChromeIconButton>

        {onHideRightPanel ? (
          <BrowserChromeIconButton
            title="隐藏右侧面板"
            onClick={onHideRightPanel}
          >
            <TripleRightPanelToggleIcon />
          </BrowserChromeIconButton>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden" role="tabpanel">
        {tab === "launcher" && (
          <SurfaceLauncherView onOpenSurface={openSurface} />
        )}

        {tab === "review" && (
          <div className="relative z-0 flex h-full min-h-0 flex-col">
            {reviewPanel}
          </div>
        )}

        {tab === "files" && (
          <div className="relative z-0 flex h-full min-h-0 flex-col overflow-hidden">
            {!workspaceEnabled ? (
              <p className="flex h-full items-center justify-center px-4 text-center text-[12px] leading-relaxed text-zinc-500">
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

        <div
          className={
            tab === "browser"
              ? "relative z-0 flex h-full min-h-0 flex-col overflow-hidden"
              : OFFSCREEN_BROWSER_CLASS
          }
          aria-hidden={tab !== "browser"}
        >
          <BrowserPanel
            embedded
            chromeVisible={tab === "browser"}
            showTabStrip={false}
          />
        </div>
      </div>
    </div>
  );
}

function TerminalIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden
    >
      <path
        d="M3.5 4.5 6.5 8l-3 3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 11.5h4.5" strokeLinecap="round" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden
    >
      <rect x="3.2" y="2.7" width="9.6" height="10.6" rx="1.7" />
      <path d="M5.6 6h4.8M5.6 8.4h4.8M5.6 10.8h2.2" strokeLinecap="round" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden
    >
      <path
        d="M2.8 5.2h4l1.1 1.4h5.3v6.1H2.8z"
        strokeLinejoin="round"
      />
      <path d="M2.8 5.2V3.8h4.1l1.1 1.4" strokeLinejoin="round" />
    </svg>
  );
}

function ChangeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
      <rect
        x="3.2"
        y="2.6"
        width="9.6"
        height="10.8"
        rx="1.8"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path d="M8 5.2v5.6M5.2 8h5.6" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

function LocalIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M3 11.5h10M4.2 4h7.6a.9.9 0 0 1 .9.9v5.2H3.3V4.9a.9.9 0 0 1 .9-.9Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M5 3.5v6.2a2.8 2.8 0 0 0 2.8 2.8H11M11 4v3.2A2.8 2.8 0 0 1 8.2 10H5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="5" cy="3.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="4" r="1.4" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="12.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CommitIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
      <path d="M2.5 8h11" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M8 1.8A6.1 6.1 0 0 0 6.1 13.7c.3.1.4-.1.4-.3v-1.1c-1.7.4-2.1-.7-2.1-.7-.3-.7-.7-.9-.7-.9-.6-.4 0-.4 0-.4.6 0 1 .7 1 .7.6 1 1.5.7 1.8.5.1-.4.2-.7.4-.9-1.4-.2-2.8-.7-2.8-3a2.4 2.4 0 0 1 .6-1.6 2.2 2.2 0 0 1 .1-1.6s.5-.2 1.7.6a5.8 5.8 0 0 1 3.1 0c1.2-.8 1.7-.6 1.7-.6.3.8.1 1.4.1 1.6a2.4 2.4 0 0 1 .6 1.6c0 2.3-1.4 2.8-2.8 3 .2.2.4.6.4 1.2v1.7c0 .2.1.4.4.3A6.1 6.1 0 0 0 8 1.8Z" />
    </svg>
  );
}
