"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useAgentWorkspaceBridge } from "@/components/agent-workspace-bridge";
import type { AgentEvent } from "@/agent/types";
import { resolveThreadIdFromEvents } from "@/lib/agent-feed";
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

type AgentProjectSidebarItem = {
  workspaceId: string;
  name: string;
  updatedAt: string;
  threadCount: number;
  threads: AgentThreadListItem[];
};

export type ContinueThreadPayload = {
  threadId: string;
  title: string;
  lastUserRequest: string | null;
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
  onContinueThread?: (payload: ContinueThreadPayload) => void;
  onNewSession?: () => void;
  onThreadDeleted?: (threadId: string) => void;
  onSessionsChanged?: () => void;
};

export function AgentSessionSidebar({
  currentTaskId,
  currentThreadId,
  refreshKey = 0,
  onSelectThread,
  onContinueThread,
  onNewSession,
  onThreadDeleted,
  onSessionsChanged,
}: AgentSessionSidebarProps) {
  const bridge = useAgentWorkspaceBridge();
  const [projects, setProjects] = useState<AgentProjectSidebarItem[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
    null,
  );
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenWorkspaceIds, setHiddenWorkspaceIds] = useState<string[]>([]);
  const [showHiddenProjects, setShowHiddenProjects] = useState(false);

  async function reloadLists() {
    setLoading(true);
    try {
      const [projectsRes, tracesRes, hiddenRes] = await Promise.all([
        fetch("/api/agent/threads?grouped=projects"),
        fetch("/api/agent/traces"),
        fetch("/api/agent/workspace?sidebar=hidden"),
      ]);
      const projectsData = await projectsRes.json();
      const tracesData = await tracesRes.json();
      const hiddenData = await hiddenRes.json();
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
      setHiddenWorkspaceIds(
        hiddenRes.ok && Array.isArray(hiddenData.hiddenWorkspaceIds)
          ? hiddenData.hiddenWorkspaceIds
          : [],
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
        const [projectsRes, tracesRes, hiddenRes] = await Promise.all([
          fetch("/api/agent/threads?grouped=projects"),
          fetch("/api/agent/traces"),
          fetch("/api/agent/workspace?sidebar=hidden"),
        ]);
        const projectsData = await projectsRes.json();
        const tracesData = await tracesRes.json();
        const hiddenData = await hiddenRes.json();
        if (cancelled) return;
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
        setHiddenWorkspaceIds(
          hiddenRes.ok && Array.isArray(hiddenData.hiddenWorkspaceIds)
            ? hiddenData.hiddenWorkspaceIds
            : [],
        );
        const wsId = projectsData.currentWorkspaceId as string | undefined;
        setExpandedProjects(() => {
          const next = new Set<string>();
          if (wsId) next.add(wsId);
          else if (nextProjects[0]) next.add(nextProjects[0].workspaceId);
          return next;
        });
      } finally {
        if (!cancelled) setLoading(false);
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
      (item) => item.task?.workspaceId === project.workspaceId,
    );
    const latest = threadTraces[0];
    if (latest) {
      void restoreTrace(latest.id);
    }
  }

  function handleContinueThread(
    thread: AgentThreadListItem,
    e: MouseEvent,
  ) {
    e.stopPropagation();
    setActionError(null);
    onSelectThread(thread.threadId);
    onContinueThread?.({
      threadId: thread.threadId,
      title: thread.title,
      lastUserRequest: thread.lastUserRequest,
    });
  }

  function startRenameThread(thread: AgentThreadListItem, e: MouseEvent) {
    e.stopPropagation();
    setRenamingThreadId(thread.threadId);
    setRenameDraft(thread.title);
  }

  async function submitRenameThread(threadId: string) {
    const title = renameDraft.trim();
    if (!title) {
      setRenamingThreadId(null);
      return;
    }

    setBusyThreadId(threadId);
    setActionError(null);
    try {
      const res = await fetch("/api/agent/threads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "重命名失败");
      setRenamingThreadId(null);
      await reloadLists();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setBusyThreadId(null);
    }
  }

  async function deleteThread(
    project: AgentProjectSidebarItem,
    thread: AgentThreadListItem,
    e: MouseEvent,
  ) {
    e.stopPropagation();
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

  function workspaceDisplayName(workspaceId: string): string {
    const normalized = workspaceId.replace(/\\/g, "/").replace(/\/+$/, "");
    const base = normalized.split("/").pop();
    return base && base.length > 0 ? base : workspaceId;
  }

  async function removeProject(
    project: AgentProjectSidebarItem,
    e: MouseEvent,
  ) {
    e.stopPropagation();
    const confirmed = window.confirm(
      `从左侧移除项目「${project.name}」？\n\n不会删除磁盘上的文件夹，也不会删除 Trace；之后仍可在上方「工作区」输入路径打开该项目。`,
    );
    if (!confirmed) return;

    setActionError(null);
    try {
      const params = new URLSearchParams({ workspaceId: project.workspaceId });
      const res = await fetch(`/api/agent/workspace?${params}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "移除失败");
      await reloadLists();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "移除失败");
    }
  }

  async function restoreHiddenProject(workspaceId: string) {
    setActionError(null);
    try {
      const res = await fetch("/api/agent/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "show" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "恢复失败");
      await reloadLists();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "恢复失败");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          项目
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {onNewSession && (
            <button
              type="button"
              onClick={onNewSession}
              className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-blue-700"
              title="开始新会话（不延续当前会话记忆）"
            >
              新会话
            </button>
          )}
          <button
            type="button"
            onClick={() => void reloadLists()}
            className="text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
          >
            刷新
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
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
            运行任务后，会按项目显示最近会话
          </p>
        )}

        {projects.map((project) => {
          const isExpanded = expandedProjects.has(project.workspaceId);
          const isCurrentWorkspace =
            currentWorkspaceId === project.workspaceId;
          const hiddenCount = Math.max(
            0,
            project.threadCount - project.threads.length,
          );

          return (
            <div key={project.workspaceId} className="group/project relative mb-1">
              <button
                type="button"
                onClick={() => toggleProject(project.workspaceId)}
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 pr-10 text-left transition ${
                  isCurrentWorkspace
                    ? "bg-zinc-100 dark:bg-zinc-800/80"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                }`}
              >
                <span
                  className={`shrink-0 text-[10px] text-zinc-400 transition ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                  aria-hidden
                >
                  ▶
                </span>
                <span className="text-[11px]" aria-hidden>
                  📁
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
                  {project.name}
                </span>
                {isCurrentWorkspace && (
                  <span className="shrink-0 rounded bg-blue-100 px-1 py-0.5 text-[9px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    当前
                  </span>
                )}
              </button>
              <button
                type="button"
                title="从左侧项目列表移除"
                onClick={(e) => void removeProject(project, e)}
                className="absolute right-1 top-1 hidden rounded bg-red-600 px-1.5 py-0.5 text-[9px] text-white hover:bg-red-700 group-hover/project:inline-flex"
              >
                移除
              </button>

              {isExpanded && (
                <div className="ml-3 border-l border-zinc-200 pl-1 dark:border-zinc-700">
                  {project.threads.length === 0 && (
                    <p className="px-2 py-1.5 text-[10px] text-zinc-500">
                      暂无会话
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
                        className={`group relative mb-0.5 rounded-md ${
                          isActive
                            ? "bg-blue-100/80 dark:bg-blue-950/40"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                        }`}
                      >
                        {renamingThreadId === thread.threadId ? (
                          <form
                            className="px-2 py-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void submitRenameThread(thread.threadId);
                            }}
                          >
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setRenamingThreadId(null);
                                }
                              }}
                              className="w-full rounded border border-blue-400 bg-white px-1.5 py-0.5 text-[11px] dark:border-blue-600 dark:bg-zinc-950"
                            />
                            <div className="mt-1 flex gap-1">
                              <button
                                type="submit"
                                className="rounded bg-blue-600 px-1.5 py-0.5 text-[9px] text-white"
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingThreadId(null)}
                                className="rounded bg-zinc-200 px-1.5 py-0.5 text-[9px] dark:bg-zinc-700"
                              >
                                取消
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy || restoringId != null}
                            onClick={() => handleSelectSession(project, thread)}
                            className="flex w-full items-start justify-between gap-2 px-2 py-1.5 pr-1 text-left"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-[11px] text-zinc-800 dark:text-zinc-200">
                                {thread.title}
                              </span>
                            </span>
                            <span className="shrink-0 text-[10px] text-zinc-500">
                              {formatRelativeTime(thread.updatedAt)}
                            </span>
                          </button>
                        )}

                        {renamingThreadId !== thread.threadId && (
                          <div className="absolute right-0 top-0.5 hidden flex-col gap-0.5 group-hover:flex">
                            <button
                              type="button"
                              title="在此会话继续"
                              disabled={isBusy}
                              onClick={(e) => handleContinueThread(thread, e)}
                              className="rounded bg-blue-600 px-1 py-0.5 text-[9px] text-white"
                            >
                              继续
                            </button>
                            <button
                              type="button"
                              title="重命名"
                              disabled={isBusy}
                              onClick={(e) => startRenameThread(thread, e)}
                              className="rounded bg-zinc-200 px-1 py-0.5 text-[9px] dark:bg-zinc-700"
                            >
                              命名
                            </button>
                            <button
                              type="button"
                              title="从侧栏删除会话（清除滚动记忆）"
                              disabled={isBusy}
                              onClick={(e) => void deleteThread(project, thread, e)}
                              className="rounded bg-red-600 px-1 py-0.5 text-[9px] text-white hover:bg-red-700"
                            >
                              删除
                            </button>
                          </div>
                        )}

                        {isCurrentTask && (
                          <p className="px-2 pb-1 text-[9px] text-emerald-600 dark:text-emerald-400">
                            当前任务
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <p className="px-2 py-1 text-[10px] text-zinc-400">
                      另有 {hiddenCount} 个会话未显示
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {hiddenWorkspaceIds.length > 0 && (
          <div className="mt-2 border-t border-zinc-200 px-2 pt-2 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setShowHiddenProjects((value) => !value)}
              className="text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            >
              {showHiddenProjects ? "收起" : "显示"}已隐藏项目（
              {hiddenWorkspaceIds.length}）
            </button>
            {showHiddenProjects && (
              <ul className="mt-1 space-y-1">
                {hiddenWorkspaceIds.map((workspaceId) => (
                  <li
                    key={workspaceId}
                    className="flex items-center justify-between gap-2 rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800/80"
                  >
                    <span className="min-w-0 truncate text-[10px] text-zinc-600 dark:text-zinc-400">
                      {workspaceDisplayName(workspaceId)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void restoreHiddenProject(workspaceId)}
                      className="shrink-0 text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                    >
                      恢复
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
