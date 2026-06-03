"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import * as AgentWorkspaceBridge from "@/components/agent-workspace-bridge";
import type { AgentEvent } from "@/agent/types";
import { resolveThreadIdFromEvents } from "@/lib/agent-feed";
import { ChevronIcon } from "@/components/chevron-icon";
import { workspaceIdsEqual } from "@/lib/workspace-path";
type AgentThreadListItem = {
  threadId: string;
  title: string;
  summaryPreview: string | null;
  updatedAt: string;
  round: number | null;
  method: string | null;
  traceCount: number;
  hasMemory: boolean;
  lastUserRequest: string | null;
};

export type AgentProjectSidebarItem = {
  workspaceId: string;
  name: string;
  updatedAt: string;
  threadCount: number;
  threads: AgentThreadListItem[];
};

type TraceListItem = {
  id: string;
  updatedAt: string;
  eventCount: number;
  thread?: { id?: string; title?: string; contextSummary?: string };
  task?: {
    id: string;
    userRequest?: string;
    status?: string;
    workspaceId?: string;
  };
};

type TraceDetail = {
  id: string;
  events: AgentEvent[];
  task?: TraceListItem["task"];
  thread?: TraceListItem["thread"];
};

function formatRelativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60_000) return "刚刚";
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}天前`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}周前`;
    const date = new Date(iso);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  } catch {
    return iso;
  }
}

function resolveTaskSummary(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "task.completed") return event.summary;
  }
  return null;
}

function resolveTaskId(detail: TraceDetail): string {
  if (detail.task?.id) return detail.task.id;
  for (const event of detail.events) {
    if (event.type === "trace.linked") return event.taskId;
    if (event.type === "task.created") return event.taskId;
  }
  return "";
}

function resolveThreadIdFromTraceItem(item: TraceListItem): string | null {
  return item.thread?.id ?? null;
}

type AgentSessionSidebarProps = {
  currentTaskId: string | null;
  currentThreadId: string | null;
  refreshKey?: number;
  onSelectThread: (threadId: string | null) => void;
  /** 顶部「新建 Agent」：空白新聊天 + 可选工作区 */
  onNewAgent?: () => void;
  /** 项目行悬停 ＋：在该工作区下开新会话 */
  onNewSessionInProject?: (project: AgentProjectSidebarItem) => void;
  /** 点击项目名称：切换当前工作区 */
  onActivateProject?: (project: AgentProjectSidebarItem) => void;
  onThreadDeleted?: (threadId: string) => void;
  onSessionsChanged?: () => void;
};

export function AgentSessionSidebar({
  currentTaskId,
  currentThreadId,
  refreshKey = 0,
  onSelectThread,
  onNewAgent,
  onNewSessionInProject,
  onActivateProject,
  onThreadDeleted,
  onSessionsChanged,
}: AgentSessionSidebarProps) {
  const bridge = AgentWorkspaceBridge.useAgentWorkspaceBridge();
  const [projects, setProjects] = useState<AgentProjectSidebarItem[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
    null,
  );
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const [threadContextMenu, setThreadContextMenu] = useState<{
    project: AgentProjectSidebarItem;
    thread: AgentThreadListItem;
    x: number;
    y: number;
  } | null>(null);

  async function reloadLists() {
    setLoading(true);
    try {
      const [projectsRes, tracesRes] = await Promise.all([
        fetch("/api/agent/threads?grouped=projects"),
        fetch("/api/agent/traces"),
      ]);
      const projectsData = await projectsRes.json();
      const tracesData = await tracesRes.json();
      const nextProjects =
        projectsRes.ok && Array.isArray(projectsData.projects)
          ? (projectsData.projects as AgentProjectSidebarItem[])
          : [];
      setProjects(nextProjects);
      setCurrentWorkspaceId(
        typeof projectsData.currentWorkspaceId === "string"
          ? projectsData.currentWorkspaceId
          : null,
      );
      setTraces(
        tracesRes.ok && Array.isArray(tracesData.traces) ? tracesData.traces : [],
      );
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        const wsId = projectsData.currentWorkspaceId as string | undefined;
        if (wsId) next.add(wsId);
        if (next.size === 0 && nextProjects[0]) {
          next.add(nextProjects[0].workspaceId);
        }
        return next;
      });
      onSessionsChanged?.();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [projectsRes, tracesRes] = await Promise.all([
          fetch("/api/agent/threads?grouped=projects"),
          fetch("/api/agent/traces"),
        ]);
        const projectsData = await projectsRes.json();
        const tracesData = await tracesRes.json();
        if (!cancelled) {
          const nextProjects =
            projectsRes.ok && Array.isArray(projectsData.projects)
              ? (projectsData.projects as AgentProjectSidebarItem[])
              : [];
          setProjects(nextProjects);
          setCurrentWorkspaceId(
            typeof projectsData.currentWorkspaceId === "string"
              ? projectsData.currentWorkspaceId
              : null,
          );
          setTraces(
            tracesRes.ok && Array.isArray(tracesData.traces)
              ? tracesData.traces
              : [],
          );
          const wsId = projectsData.currentWorkspaceId as string | undefined;
          setExpandedProjects(() => {
            const next = new Set<string>();
            if (wsId) next.add(wsId);
            else if (nextProjects[0]) next.add(nextProjects[0].workspaceId);
            return next;
          });
        }
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const tracesByThread = useMemo(() => {
    const map = new Map<string, TraceListItem[]>();
    for (const item of traces) {
      const threadId = resolveThreadIdFromTraceItem(item);
      if (!threadId) continue;
      const list = map.get(threadId) ?? [];
      list.push(item);
      map.set(threadId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return map;
  }, [traces]);

  async function restoreTrace(traceId: string) {
    if (!bridge) return;
    setRestoringId(traceId);
    try {
      const res = await fetch(
        `/api/agent/traces?id=${encodeURIComponent(traceId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "读取失败");
      const detail = data.trace as TraceDetail;
      const taskId = resolveTaskId(detail);
      if (!taskId) return;
      const threadId = resolveThreadIdFromEvents(detail.events);
      if (threadId) {
        onSelectThread(threadId);
      }
      bridge.restoreToPanel({
        traceId: detail.id,
        taskId,
        events: detail.events,
        userRequest: detail.task?.userRequest,
        taskSummary: resolveTaskSummary(detail.events),
      });
    } finally {
      setRestoringId(null);
      bridge.clearHistoryFocus();
    }
  }

  function toggleProject(workspaceId: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  }

  function handleSelectSession(
    project: AgentProjectSidebarItem,
    thread: AgentThreadListItem,
  ) {
    setActionError(null);
    onSelectThread(thread.threadId);
    const threadTraces = (tracesByThread.get(thread.threadId) ?? []).filter(
      (item) =>
        item.task?.workspaceId != null &&
        workspaceIdsEqual(item.task.workspaceId, project.workspaceId),
    );
    const latest = threadTraces[0];
    if (latest) {
      void restoreTrace(latest.id);
    }
  }

  useEffect(() => {
    if (!threadContextMenu) return;
    const close = () => setThreadContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [threadContextMenu]);

  async function deleteThread(
    project: AgentProjectSidebarItem,
    thread: AgentThreadListItem,
    e?: MouseEvent,
  ) {
    e?.stopPropagation();
    setThreadContextMenu(null);
    const confirmed = window.confirm(
      `从侧栏删除会话「${thread.title}」？\n\n将清除该会话的滚动记忆，并从左侧列表隐藏。历史 Trace 文件仍保留在本地。`,
    );
    if (!confirmed) return;

    setBusyThreadId(thread.threadId);
    setActionError(null);
    try {
      const params = new URLSearchParams({
        threadId: thread.threadId,
        workspaceId: project.workspaceId,
      });
      const res = await fetch(`/api/agent/threads?${params}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "删除失败");
      if (currentThreadId === thread.threadId) {
        onThreadDeleted?.(thread.threadId);
      }
      await reloadLists();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyThreadId(null);
    }
  }

  function ensureProjectExpanded(workspaceId: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(workspaceId);
      return next;
    });
  }

  function handleActivateProject(
    project: AgentProjectSidebarItem,
    e: MouseEvent,
  ) {
    e.stopPropagation();
    ensureProjectExpanded(project.workspaceId);
    onActivateProject?.(project);
  }

  function handleNewSessionInProject(
    project: AgentProjectSidebarItem,
    e: MouseEvent,
  ) {
    e.stopPropagation();
    ensureProjectExpanded(project.workspaceId);
    onNewSessionInProject?.(project);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onNewAgent && (
        <div className="shrink-0 border-b border-zinc-200 p-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={onNewAgent}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            title="新建 Agent（Ctrl+N）"
          >
            新建 Agent
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-1 px-2 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Workspaces
        </p>
        <button
          type="button"
          onClick={() => void reloadLists()}
          className="text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          刷新
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {actionError && (
          <p className="mb-1 rounded px-2 py-1 text-[10px] text-red-600 dark:text-red-400">
            {actionError}
          </p>
        )}
        {loading && projects.length === 0 && (
          <p className="px-2 py-2 text-center text-[11px] text-zinc-500">
            加载中…
          </p>
        )}
        {!loading && projects.length === 0 && (
          <p className="px-2 py-4 text-center text-[11px] leading-relaxed text-zinc-500">
            点击「新建 Agent」选择工作区；有历史后项目会列在此处
          </p>
        )}

        {projects.map((project) => {
          const isExpanded = expandedProjects.has(project.workspaceId);
          const isCurrentWorkspace =
            currentWorkspaceId != null &&
            workspaceIdsEqual(currentWorkspaceId, project.workspaceId);
          const hiddenCount = Math.max(
            0,
            project.threadCount - project.threads.length,
          );

          return (
            <div key={project.workspaceId} className="group/project mb-1">
              <div
                className={`flex items-center gap-0.5 rounded-lg px-1 py-0.5 transition ${
                  isCurrentWorkspace
                    ? "bg-zinc-200/70 dark:bg-zinc-800"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                }`}
              >
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => toggleProject(project.workspaceId)}
                  className="shrink-0 rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  title={isExpanded ? "收起会话" : "展开会话"}
                >
                  <ChevronIcon expanded={isExpanded} className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleActivateProject(project, e)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pl-0.5 pr-1 text-left"
                  title={
                    isCurrentWorkspace
                      ? "当前工作区"
                      : `切换到 ${project.name}`
                  }
                >
                  <span className="text-[11px] opacity-80" aria-hidden>
                    📁
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
                    {project.name}
                  </span>
                </button>
                {onNewSessionInProject && (
                  <button
                    type="button"
                    onClick={(e) => handleNewSessionInProject(project, e)}
                    className="mr-0.5 shrink-0 rounded-md p-1 text-zinc-500 opacity-0 transition hover:bg-zinc-200/80 hover:text-zinc-800 group-hover/project:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                    title={`在「${project.name}」下新建会话`}
                  >
                    <span className="text-[14px] leading-none" aria-hidden>
                      +
                    </span>
                  </button>
                )}
              </div>

              {isExpanded && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-zinc-200/80 pl-2 dark:border-zinc-700">
                  {project.threads.length === 0 && (
                    <p className="px-1 py-1.5 text-[10px] text-zinc-500">
                      暂无会话 — 点击项目名右侧 ＋ 新建
                    </p>
                  )}
                  {project.threads.map((thread) => {
                    const isActive = currentThreadId === thread.threadId;
                    const isBusy = busyThreadId === thread.threadId;
                    const latestTrace = tracesByThread.get(thread.threadId)?.[0];
                    const isCurrentTask =
                      latestTrace?.task?.id != null &&
                      latestTrace.task.id === currentTaskId;

                    return (
                      <div
                        key={thread.threadId}
                        className={`rounded-md ${
                          isActive
                            ? "bg-zinc-200/90 dark:bg-zinc-800"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                        }`}
                      >
                        <button
                          type="button"
                          disabled={isBusy || restoringId != null}
                          onClick={() => handleSelectSession(project, thread)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setThreadContextMenu({
                              project,
                              thread,
                              x: e.clientX,
                              y: e.clientY,
                            });
                          }}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                        >
                          <span
                            className="h-1 w-1 shrink-0 rounded-full bg-zinc-400"
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-700 dark:text-zinc-300">
                            {thread.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-zinc-400">
                            {formatRelativeTime(thread.updatedAt)}
                          </span>
                        </button>

                        {isCurrentTask && (
                          <p className="px-2 pb-1 text-[9px] text-emerald-600 dark:text-emerald-400">
                            当前任务
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <p className="px-1 py-1 text-[10px] text-zinc-400">
                      另有 {hiddenCount} 个会话
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {threadContextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setThreadContextMenu(null)}
          />
          <div
            className="fixed z-50 min-w-[8rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            style={{
              left: threadContextMenu.x,
              top: threadContextMenu.y,
            }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              disabled={busyThreadId === threadContextMenu.thread.threadId}
              onClick={() =>
                void deleteThread(
                  threadContextMenu.project,
                  threadContextMenu.thread,
                )
              }
              className="block w-full px-3 py-1.5 text-left text-[11px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              删除会话
            </button>
          </div>
        </>
      )}
    </div>
  );
}
