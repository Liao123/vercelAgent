"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useAgentWorkspaceBridge } from "@/components/agent-workspace-bridge";
import type { AgentEvent } from "@/agent/types";
import { resolveThreadIdFromEvents } from "@/lib/agent-feed";
import {
  buildThreadMemoryMarkdown,
  downloadTextFile,
} from "@/lib/export-thread-memory";

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
  };
};

type TraceDetail = {
  id: string;
  events: AgentEvent[];
  task?: TraceListItem["task"];
  thread?: TraceListItem["thread"];
};

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function traceLabel(item: TraceListItem): string {
  const request = item.task?.userRequest?.trim();
  if (!request) return item.id.slice(0, 14);
  return request.length > 44 ? `${request.slice(0, 44)}…` : request;
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
  if (item.thread?.id) return item.thread.id;
  return null;
}

type AgentSessionSidebarProps = {
  currentTaskId: string | null;
  currentThreadId: string | null;
  refreshKey?: number;
  onSelectThread: (threadId: string | null) => void;
  onContinueThread?: (payload: ContinueThreadPayload) => void;
  onSessionsChanged?: () => void;
};

export function AgentSessionSidebar({
  currentTaskId,
  currentThreadId,
  refreshKey = 0,
  onSelectThread,
  onContinueThread,
  onSessionsChanged,
}: AgentSessionSidebarProps) {
  const bridge = useAgentWorkspaceBridge();
  const [threads, setThreads] = useState<AgentThreadListItem[]>([]);
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [filterThreadId, setFilterThreadId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const activeFilterThreadId = filterThreadId ?? currentThreadId;

  async function reloadLists() {
    setLoading(true);
    try {
      const [threadsRes, tracesRes] = await Promise.all([
        fetch("/api/agent/threads"),
        fetch("/api/agent/traces"),
      ]);
      const threadsData = await threadsRes.json();
      const tracesData = await tracesRes.json();
      setThreads(
        threadsRes.ok && Array.isArray(threadsData.threads)
          ? threadsData.threads
          : [],
      );
      setTraces(
        tracesRes.ok && Array.isArray(tracesData.traces) ? tracesData.traces : [],
      );
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
        const [threadsRes, tracesRes] = await Promise.all([
          fetch("/api/agent/threads"),
          fetch("/api/agent/traces"),
        ]);
        const threadsData = await threadsRes.json();
        const tracesData = await tracesRes.json();
        if (cancelled) return;
        setThreads(
          threadsRes.ok && Array.isArray(threadsData.threads)
            ? threadsData.threads
            : [],
        );
        setTraces(
          tracesRes.ok && Array.isArray(tracesData.traces)
            ? tracesData.traces
            : [],
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const focusResolvedTraceId = useMemo(() => {
    const focus = bridge?.historyFocus;
    if (!focus || traces.length === 0) return null;
    if (focus.traceId) return focus.traceId;
    if (focus.taskId) {
      return traces.find((item) => item.task?.id === focus.taskId)?.id ?? null;
    }
    return null;
  }, [bridge?.historyFocus, traces]);

  const filteredTraces = useMemo(() => {
    if (!activeFilterThreadId) return traces;
    return traces.filter((item) => {
      const threadId = resolveThreadIdFromTraceItem(item);
      return threadId === activeFilterThreadId;
    });
  }, [activeFilterThreadId, traces]);

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

  function handleSelectThread(threadId: string) {
    setFilterThreadId(threadId);
    onSelectThread(threadId);
  }

  function handleContinueThread(thread: AgentThreadListItem, e: MouseEvent) {
    e.stopPropagation();
    setActionError(null);
    handleSelectThread(thread.threadId);
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

  async function handleExportMemory(
    thread: AgentThreadListItem,
    e: MouseEvent,
  ) {
    e.stopPropagation();
    if (!thread.hasMemory) return;

    setBusyThreadId(thread.threadId);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/agent/thread-memory?threadId=${encodeURIComponent(thread.threadId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "读取记忆失败");
      const content = data.memory?.memoryContent as string | undefined;
      if (!content) throw new Error("该会话没有可导出的记忆。");
      const md = buildThreadMemoryMarkdown(thread.title, content, {
        threadId: thread.threadId,
        round: thread.round ?? undefined,
        method: thread.method ?? undefined,
      });
      downloadTextFile(`agent-thread-${thread.threadId.slice(0, 8)}.md`, md);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusyThreadId(null);
    }
  }

  async function handleDeleteMemory(
    thread: AgentThreadListItem,
    e: MouseEvent,
  ) {
    e.stopPropagation();
    if (
      !window.confirm(
        `删除会话「${thread.title}」的滚动记忆？\n\nTrace 历史保留；下次运行将不再自动带上压缩摘要（除非再次压缩生成）。`,
      )
    ) {
      return;
    }

    setBusyThreadId(thread.threadId);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/agent/threads?threadId=${encodeURIComponent(thread.threadId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "删除失败");
      await reloadLists();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyThreadId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between px-2 py-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          会话
        </p>
        <button
          type="button"
          onClick={() => void reloadLists()}
          className="text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          刷新
        </button>
      </div>

      <div className="max-h-[38%] min-h-0 shrink-0 overflow-auto px-1 pb-1">
        {actionError && (
          <p className="mb-1 rounded px-2 py-1 text-[10px] text-red-600 dark:text-red-400">
            {actionError}
          </p>
        )}
        {loading && threads.length === 0 && (
          <p className="px-2 py-2 text-center text-[11px] text-zinc-500">加载中…</p>
        )}
        {!loading && threads.length === 0 && (
          <p className="px-2 py-2 text-center text-[11px] text-zinc-500">
            运行后会话出现在这里
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setFilterThreadId(null);
            onSelectThread(null);
          }}
          className={`mb-0.5 w-full rounded-md px-2 py-1 text-left text-[11px] ${
            !activeFilterThreadId
              ? "bg-zinc-200/80 dark:bg-zinc-800"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/80"
          }`}
        >
          全部会话
        </button>
        {threads.map((thread) => {
          const isActive = activeFilterThreadId === thread.threadId;
          const isBusy = busyThreadId === thread.threadId;
          return (
            <div
              key={thread.threadId}
              className={`group relative mb-0.5 rounded-md transition ${
                isActive
                  ? "bg-blue-100 dark:bg-blue-950/50"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
              }`}
            >
              {renamingThreadId === thread.threadId ? (
                <form
                  className="px-2 py-1.5 pr-1"
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
                  disabled={isBusy}
                  onClick={() => handleSelectThread(thread.threadId)}
                  className="w-full px-2 py-1.5 pr-16 text-left"
                >
                  <p className="line-clamp-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
                    {thread.title}
                  </p>
                  {thread.summaryPreview && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-zinc-500">
                      {thread.summaryPreview}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    {thread.traceCount} 任务
                    {thread.round != null ? ` · 记忆 R${thread.round}` : ""}
                    {thread.hasMemory ? " · 有记忆" : ""}
                    {" · "}
                    {formatTime(thread.updatedAt)}
                  </p>
                </button>
              )}
              <div className="absolute right-1 top-1 flex flex-col gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                <button
                  type="button"
                  title="在此会话继续"
                  disabled={isBusy}
                  onClick={(e) => handleContinueThread(thread, e)}
                  className="rounded bg-blue-600 px-1 py-0.5 text-[9px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  继续
                </button>
                <button
                  type="button"
                  title="重命名"
                  disabled={isBusy || renamingThreadId === thread.threadId}
                  onClick={(e) => startRenameThread(thread, e)}
                  className="rounded bg-zinc-200 px-1 py-0.5 text-[9px] text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200"
                >
                  命名
                </button>
                {thread.hasMemory && (
                  <button
                    type="button"
                    title="导出记忆 Markdown"
                    disabled={isBusy}
                    onClick={(e) => void handleExportMemory(thread, e)}
                    className="rounded bg-zinc-200 px-1 py-0.5 text-[9px] text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200"
                  >
                    导出
                  </button>
                )}
                {thread.hasMemory && (
                  <button
                    type="button"
                    title="删除滚动记忆"
                    disabled={isBusy}
                    onClick={(e) => void handleDeleteMemory(thread, e)}
                    className="rounded bg-red-100 px-1 py-0.5 text-[9px] text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-300"
                  >
                    删记忆
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between px-2 py-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            任务
            {activeFilterThreadId ? "（已筛选）" : ""}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
          {filteredTraces.length === 0 && !loading && (
            <p className="px-2 py-4 text-center text-[11px] text-zinc-500">
              {activeFilterThreadId ? "该会话下暂无任务" : "运行任务后会出现在这里"}
            </p>
          )}
          {filteredTraces.map((item) => {
            const isCurrent =
              currentTaskId != null && item.task?.id === currentTaskId;
            const isFocused = focusResolvedTraceId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={restoringId === item.id}
                onClick={() => void restoreTrace(item.id)}
                className={`mb-0.5 w-full rounded-md px-2 py-1.5 text-left transition ${
                  isFocused
                    ? "bg-blue-100 dark:bg-blue-950/50"
                    : isCurrent
                      ? "bg-emerald-50 dark:bg-emerald-950/30"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                }`}
              >
                <p className="line-clamp-2 text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
                  {traceLabel(item)}
                </p>
                {item.thread?.contextSummary && (
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-zinc-500">
                    {item.thread.contextSummary}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  {item.eventCount} 事件 · {formatTime(item.updatedAt)}
                  {isCurrent ? " · 当前" : ""}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
