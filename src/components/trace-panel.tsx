"use client";

import { useEffect, useMemo, useState } from "react";
import { AgentCompactedMemoryPanel } from "@/components/agent-compacted-memory-panel";
import { AgentEventTimeline } from "@/components/agent-event-timeline";
import { useAgentWorkspaceBridge } from "@/components/agent-workspace-bridge";
import type { AgentEvent } from "@/agent/types";

type TraceListItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  task?: {
    id: string;
    userRequest?: string;
    status?: string;
  };
  thread?: {
    title?: string;
  };
};

type TraceDetail = {
  id: string;
  createdAt: string;
  updatedAt: string;
  events: AgentEvent[];
  task?: TraceListItem["task"];
  thread?: TraceListItem["thread"];
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function traceTitle(item: TraceListItem): string {
  const request = item.task?.userRequest?.trim();
  if (request) {
    return request.length > 72 ? `${request.slice(0, 72)}…` : request;
  }
  return item.id;
}

function resolveTaskIdFromDetail(detail: TraceDetail): string {
  if (detail.task?.id) return detail.task.id;
  for (const event of detail.events) {
    if (event.type === "trace.linked") return event.taskId;
    if (event.type === "task.created") return event.taskId;
  }
  return "";
}

function resolveTaskSummary(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "task.completed") return event.summary;
  }
  return null;
}

export function TracePanel() {
  const bridge = useAgentWorkspaceBridge();
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [restoreHint, setRestoreHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/agent/traces");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "读取 Trace 列表失败。");
        const list = Array.isArray(data.traces) ? data.traces : [];
        setTraces(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "读取 Trace 列表失败。");
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listVersion]);

  const focusResolvedId = useMemo(() => {
    const focus = bridge?.historyFocus;
    if (!focus || traces.length === 0) return null;
    if (focus.traceId) return focus.traceId;
    if (focus.taskId) {
      return traces.find((item) => item.task?.id === focus.taskId)?.id ?? null;
    }
    return null;
  }, [bridge?.historyFocus, traces]);

  const activeSelectedId = focusResolvedId ?? selectedId;

  useEffect(() => {
    if (!activeSelectedId) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/agent/traces?id=${encodeURIComponent(activeSelectedId)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "读取 Trace 详情失败。");
        setDetail(data.trace as TraceDetail);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "读取 Trace 详情失败。");
          setDetail(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSelectedId]);

  function refreshList() {
    setLoadingList(true);
    setListVersion((v) => v + 1);
  }

  function restoreToWorkspace() {
    if (!detail || !bridge) return;

    const taskId = resolveTaskIdFromDetail(detail);
    if (!taskId) {
      setRestoreHint("无法解析任务 ID，请选另一条 Trace。");
      return;
    }

    bridge.restoreToPanel({
      traceId: detail.id,
      taskId,
      events: detail.events,
      userRequest: detail.task?.userRequest,
      taskSummary: resolveTaskSummary(detail.events),
    });
    setRestoreHint("已恢复到主工作区活动流，历史面板将自动收起。");
  }

  const activeTaskId = bridge?.currentTaskId ?? null;

  return (
    <div className="flex h-[min(50vh,480px)] min-h-[320px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          本地任务记录（`.agent-traces/`）。可恢复到主工作区活动流，并筛选对应审批。
        </p>
        <div className="flex flex-wrap gap-2">
          {bridge && detail?.id === activeSelectedId && (
            <button
              type="button"
              onClick={restoreToWorkspace}
              className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              恢复到主工作区
            </button>
          )}
          <button
            type="button"
            onClick={refreshList}
            disabled={loadingList}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {loadingList ? "刷新中" : "刷新列表"}
          </button>
        </div>
      </div>

      {restoreHint && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {restoreHint}
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(200px,280px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <p className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            任务列表 ({traces.length})
          </p>
          <div className="min-h-0 flex-1 overflow-auto">
            {traces.length === 0 && !loadingList && (
              <p className="p-4 text-center text-xs text-zinc-500">
                暂无 Trace。运行 Agent 任务后会自动记录。
              </p>
            )}
            {traces.map((item) => {
              const isCurrentTask =
                activeTaskId != null && item.task?.id === activeTaskId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id);
                    setDetail(null);
                    setRestoreHint(null);
                    bridge?.clearHistoryFocus();
                  }}
                  className={`block w-full border-b border-zinc-100 px-3 py-2 text-left text-xs transition last:border-0 dark:border-zinc-800 ${
                    activeSelectedId === item.id
                      ? "bg-blue-50 dark:bg-blue-950/40"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {traceTitle(item)}
                    </p>
                    {isCurrentTask && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        当前任务
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-zinc-500">
                    {item.id}
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    {item.eventCount} 事件 · {item.task?.status ?? "—"} ·{" "}
                    {formatTime(item.updatedAt)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <p className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            {activeSelectedId ? `事件 · ${activeSelectedId}` : "选择左侧任务"}
            {activeSelectedId && detail?.id !== activeSelectedId && "（加载中）"}
          </p>
          <div className="min-h-0 flex-1 p-2">
            {!activeSelectedId && (
              <p className="py-8 text-center text-xs text-zinc-500">
                从左侧选择一条任务记录。
              </p>
            )}
            {activeSelectedId && detail?.id !== activeSelectedId && (
              <p className="py-8 text-center text-xs text-zinc-500">
                正在加载事件…
              </p>
            )}
            {activeSelectedId && detail?.id === activeSelectedId && (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <AgentCompactedMemoryPanel
                  events={detail.events}
                  compact
                />
                <div className="min-h-0 flex-1 overflow-auto">
                  <AgentEventTimeline events={detail.events} running={false} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
