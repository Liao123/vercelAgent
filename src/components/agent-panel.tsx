"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AgentEvent } from "@/agent/types";

type ApprovalRecordView = {
  id: string;
  taskId: string;
  title: string;
  reason: string;
  risk: "low" | "medium" | "high";
  action: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
};

type WorkspaceInfoView = {
  rootPath: string;
  framework: string | null;
  packageManager: string;
  packageName: string | null;
};

type EventBucket = {
  plans: AgentEvent[];
  tools: AgentEvent[];
  approvals: AgentEvent[];
  verifications: AgentEvent[];
  finals: AgentEvent[];
  others: AgentEvent[];
};

type RunMode = "develop" | "loop";

const APPROVAL_STATUS_LABELS: Record<ApprovalRecordView["status"], string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
};

const APPROVAL_RISK_LABELS: Record<ApprovalRecordView["risk"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

function bucketEvents(events: AgentEvent[]): EventBucket {
  const bucket: EventBucket = {
    plans: [],
    tools: [],
    approvals: [],
    verifications: [],
    finals: [],
    others: [],
  };

  for (const event of events) {
    if (event.type === "plan.updated") bucket.plans.push(event);
    else if (event.type.startsWith("tool.")) bucket.tools.push(event);
    else if (event.type === "approval.required") bucket.approvals.push(event);
    else if (event.type === "verification.completed") {
      bucket.verifications.push(event);
    } else if (event.type === "task.completed" || event.type === "task.failed") {
      bucket.finals.push(event);
    } else {
      bucket.others.push(event);
    }
  }

  return bucket;
}

function EventJson({ event }: { event: AgentEvent }) {
  return (
    <pre className="max-h-48 overflow-auto rounded-md bg-zinc-950 p-2 text-xs text-zinc-100">
      {JSON.stringify(event, null, 2)}
    </pre>
  );
}

function Section({
  title,
  events,
}: {
  title: string;
  events: AgentEvent[];
}) {
  if (events.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      <div className="space-y-2">
        {events.map((event, index) => (
          <EventJson key={`${event.type}-${index}`} event={event} />
        ))}
      </div>
    </section>
  );
}

function riskClassName(risk: ApprovalRecordView["risk"]): string {
  if (risk === "high") {
    return "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300";
  }
  if (risk === "medium") {
    return "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  }
  return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
}

export function AgentPanel() {
  const [request, setRequest] = useState("");
  const [runMode, setRunMode] = useState<RunMode>("develop");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceInfoView | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecordView[]>([]);
  const [running, setRunning] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bucket = useMemo(() => bucketEvents(events), [events]);
  const workspaceBusy = running || loadingWorkspace;

  useEffect(() => {
    let cancelled = false;

    async function loadInitialApprovals() {
      try {
        const res = await fetch("/api/agent/approvals");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        setApprovals(Array.isArray(data.approvals) ? data.approvals : []);
      } catch {
        // The manual refresh button surfaces approval API failures.
      }
    }

    void loadInitialApprovals();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadWorkspace() {
    if (workspaceBusy) return;

    setError(null);
    setWorkspaceStatus(null);
    setLoadingWorkspace(true);

    try {
      const res = await fetch("/api/agent/workspace");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load workspace.");
      setWorkspace(data.workspace);
      setWorkspacePath(data.workspace.rootPath);
      setWorkspaceStatus("已读取当前 Workspace。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 Workspace 失败。");
    } finally {
      setLoadingWorkspace(false);
    }
  }

  async function handleWorkspaceSubmit(e: FormEvent) {
    e.preventDefault();
    const rootPath = workspacePath.trim();
    if (workspaceBusy) return;
    if (!rootPath) {
      setError("请先输入本机项目的绝对路径。");
      return;
    }

    setError(null);
    setWorkspaceStatus(null);
    try {
      const res = await fetch("/api/agent/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to set workspace.");
      setWorkspace(data.workspace);
      setWorkspacePath(data.workspace.rootPath);
      setWorkspaceStatus("Workspace 已设置。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set workspace.");
    }
  }

  async function loadApprovals() {
    if (loadingApprovals) return;

    setLoadingApprovals(true);
    setApprovalStatus(null);
    setError(null);

    try {
      const res = await fetch("/api/agent/approvals");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "读取审批失败。");
      setApprovals(Array.isArray(data.approvals) ? data.approvals : []);
      setApprovalStatus("审批列表已刷新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取审批失败。");
    } finally {
      setLoadingApprovals(false);
    }
  }

  async function resolveApproval(
    approvalId: string,
    status: "approved" | "rejected",
  ) {
    if (loadingApprovals) return;

    setLoadingApprovals(true);
    setApprovalStatus(null);
    setError(null);

    try {
      const res = await fetch("/api/agent/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "处理审批失败。");
      setApprovals((current) =>
        current.map((approval) =>
          approval.id === approvalId ? data.approval : approval,
        ),
      );
      setApprovalStatus(status === "approved" ? "已批准。" : "已拒绝。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理审批失败。");
    } finally {
      setLoadingApprovals(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const userRequest = request.trim();
    if (!userRequest || running) return;

    setEvents([]);
    setError(null);
    setRunning(true);

    try {
      const res = await fetch(
        runMode === "loop" ? "/api/agent/loop" : "/api/agent/develop",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userRequest,
            maxIterations: 6,
            verify: false,
          }),
        },
      );

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Agent request failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const dataLine = chunk
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;

          const parsed = JSON.parse(dataLine.slice("data: ".length)) as AgentEvent;
          setEvents((prev) => [...prev, parsed]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown agent error.");
    } finally {
      setRunning(false);
      void loadApprovals();
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          开发智能体
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          运行最小开发闭环：定位文件、计划、工具事件、审批和总结。
        </p>
      </div>

      <form onSubmit={handleWorkspaceSubmit} className="space-y-2">
        <label className="block text-xs font-medium text-zinc-500">
          Workspace
        </label>
        <div className="flex gap-2">
          <input
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            placeholder="D:\\workspace\\vercelAgent"
            disabled={workspaceBusy}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={workspaceBusy}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            设置
          </button>
          <button
            type="button"
            onClick={() => void loadWorkspace()}
            disabled={workspaceBusy}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {loadingWorkspace ? "读取中" : "读取当前"}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Web 版先粘贴本机绝对路径；系统目录选择器留到桌面端。
        </p>
        {workspaceStatus && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {workspaceStatus}
          </p>
        )}
        {workspace && (
          <p className="truncate text-xs text-zinc-500">
            {workspace.packageName ?? "未命名项目"} ·{" "}
            {workspace.framework ?? "未知框架"} · {workspace.packageManager}
          </p>
        )}
      </form>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex rounded-lg border border-zinc-300 p-1 text-xs dark:border-zinc-700">
          <button
            type="button"
            onClick={() => setRunMode("develop")}
            disabled={running}
            className={`flex-1 rounded-md px-2 py-1.5 transition disabled:opacity-50 ${
              runMode === "develop"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            开发闭环
          </button>
          <button
            type="button"
            onClick={() => setRunMode("loop")}
            disabled={running}
            className={`flex-1 rounded-md px-2 py-1.5 transition disabled:opacity-50 ${
              runMode === "loop"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            Agent Loop
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="例如：用户管理页面增加状态筛选"
            disabled={running}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={!request.trim() || running}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          >
            {running ? "运行中" : "运行"}
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            审批
          </h3>
          <button
            type="button"
            onClick={() => void loadApprovals()}
            disabled={loadingApprovals}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {loadingApprovals ? "刷新中" : "刷新"}
          </button>
        </div>
        {approvalStatus && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {approvalStatus}
          </p>
        )}
        {approvals.length === 0 ? (
          <p className="rounded-md bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-900">
            暂无审批请求。
          </p>
        ) : (
          <div className="max-h-56 space-y-2 overflow-auto">
            {approvals.map((approval) => (
              <article
                key={approval.id}
                className="space-y-2 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {approval.title}
                    </p>
                    <p className="mt-1 break-words text-zinc-500">
                      {approval.reason}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 ${riskClassName(
                      approval.risk,
                    )}`}
                  >
                    风险 {APPROVAL_RISK_LABELS[approval.risk]}
                  </span>
                </div>
                <p className="break-all font-mono text-[11px] text-zinc-500">
                  {approval.action}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-500">
                    {APPROVAL_STATUS_LABELS[approval.status]}
                  </span>
                  {approval.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void resolveApproval(approval.id, "rejected")
                        }
                        disabled={loadingApprovals}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void resolveApproval(approval.id, "approved")
                        }
                        disabled={loadingApprovals}
                        className="rounded-md bg-zinc-900 px-2 py-1 text-xs text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                      >
                        批准
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto">
        {events.length === 0 && !running && (
          <p className="rounded-lg bg-zinc-50 px-3 py-8 text-center text-sm text-zinc-500 dark:bg-zinc-900">
            还没有任务事件。
          </p>
        )}
        {running && events.length === 0 && (
          <p className="rounded-lg bg-zinc-50 px-3 py-8 text-center text-sm text-zinc-500 dark:bg-zinc-900">
            正在启动开发闭环...
          </p>
        )}
        <Section title="计划" events={bucket.plans} />
        <Section title="工具调用" events={bucket.tools} />
        <Section title="审批" events={bucket.approvals} />
        <Section title="验证" events={bucket.verifications} />
        <Section title="结果" events={bucket.finals} />
        <Section title="其他事件" events={bucket.others} />
      </div>
    </div>
  );
}
