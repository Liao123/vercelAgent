"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AgentEvent,
  ApprovalContentSnapshot,
  ApprovalDetails,
  ApprovalFileMutationPreview,
  ApprovalGitMutationOperation,
} from "@/agent/types";

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
  details?: ApprovalDetails;
  execution?: {
    status: "succeeded" | "failed";
    attemptedAt: string;
    summary: string;
    error?: string;
    result?: unknown;
  };
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
type ApprovalEventView = Extract<
  AgentEvent,
  { type: "approval.required" }
>["approval"];
type ApprovalFilterState = {
  pendingOnly: boolean;
  currentTaskOnly: boolean;
};

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
const APPROVAL_STATUS_ORDER: Record<ApprovalRecordView["status"], number> = {
  pending: 0,
  approved: 1,
  rejected: 2,
};

function sortApprovals(items: ApprovalRecordView[]): ApprovalRecordView[] {
  return [...items].sort((left, right) => {
    const statusDelta =
      APPROVAL_STATUS_ORDER[left.status] - APPROVAL_STATUS_ORDER[right.status];
    if (statusDelta !== 0) return statusDelta;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function normalizeApprovalView(
  approval: ApprovalRecordView | ApprovalEventView,
): ApprovalRecordView {
  const status =
    "status" in approval &&
    (approval.status === "pending" ||
      approval.status === "approved" ||
      approval.status === "rejected")
      ? approval.status
      : "pending";
  const decidedAt =
    "decidedAt" in approval && typeof approval.decidedAt === "string"
      ? approval.decidedAt
      : undefined;
  const execution =
    "execution" in approval &&
    approval.execution &&
    typeof approval.execution === "object"
      ? approval.execution
      : undefined;

  return {
    ...approval,
    status,
    decidedAt,
    execution,
  };
}

function upsertApproval(
  current: ApprovalRecordView[],
  incoming: ApprovalRecordView | ApprovalEventView,
): ApprovalRecordView[] {
  const next = normalizeApprovalView(incoming);
  const filtered = current.filter((approval) => approval.id !== next.id);
  return sortApprovals([next, ...filtered]);
}

function filterApprovals(
  approvals: ApprovalRecordView[],
  filters: ApprovalFilterState,
  currentTaskId: string | null,
): ApprovalRecordView[] {
  return approvals.filter((approval) => {
    if (filters.pendingOnly && approval.status !== "pending") {
      return false;
    }
    if (filters.currentTaskOnly && approval.taskId !== currentTaskId) {
      return false;
    }
    return true;
  });
}

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

function fileOperationLabel(type: ApprovalFileMutationPreview["type"]): string {
  if (type === "create") return "创建文件";
  if (type === "write") return "写入文件";
  if (type === "delete") return "删除文件";
  return "重命名文件";
}

function gitOperationTarget(operation: ApprovalGitMutationOperation): string {
  if (operation.type === "branch") {
    return operation.checkout === false
      ? `branch ${operation.branchName}`
      : `checkout -b ${operation.branchName}`;
  }
  if (operation.type === "commit") {
    if (operation.all) return "commit -am";
    return operation.paths?.length
      ? `commit paths: ${operation.paths.join(", ")}`
      : "commit staged changes";
  }
  return `${operation.remote ?? "origin"}${operation.branch ? ` ${operation.branch}` : ""}`;
}

function sizeText(value?: number): string {
  return typeof value === "number" ? `${value} bytes` : "-";
}

function ContentSnapshotBlock({
  label,
  snapshot,
}: {
  label: string;
  snapshot?: ApprovalContentSnapshot;
}) {
  if (!snapshot) return null;

  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[11px] font-medium text-zinc-500">
        {label} · {snapshot.lineCount} 行 · {snapshot.length} 字符
        {snapshot.truncated ? " · 已截断" : ""}
      </p>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-950 p-2 text-[11px] leading-relaxed text-zinc-100">
        {snapshot.text || "(empty)"}
      </pre>
    </div>
  );
}

function ApprovalDetailsView({ details }: { details?: ApprovalDetails }) {
  if (!details) return null;

  if (details.kind === "file_mutation") {
    const preview = details.preview;
    return (
      <div className="space-y-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900/80">
        <div className="grid gap-1 text-[11px] text-zinc-600 dark:text-zinc-400">
          <p>
            类型：{fileOperationLabel(preview.type)}
          </p>
          {preview.path && <p className="break-all">路径：{preview.path}</p>}
          {preview.fromPath && (
            <p className="break-all">来源：{preview.fromPath}</p>
          )}
          {preview.toPath && (
            <p className="break-all">目标：{preview.toPath}</p>
          )}
          <p>
            大小：{sizeText(preview.oldSize)} -&gt;{" "}
            {sizeText(preview.newSize)}
            {typeof preview.sizeDelta === "number"
              ? ` (${preview.sizeDelta >= 0 ? "+" : ""}${preview.sizeDelta})`
              : ""}
          </p>
          <p>
            存在：{preview.existsBefore ? "是" : "否"} -&gt;{" "}
            {preview.existsAfter ? "是" : "否"}
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <ContentSnapshotBlock label="Before" snapshot={preview.oldContent} />
          <ContentSnapshotBlock label="After" snapshot={preview.newContent} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md bg-zinc-50 p-2 text-[11px] text-zinc-600 dark:bg-zinc-900/80 dark:text-zinc-400">
      <p>类型：Git {details.operation.type}</p>
      <p className="break-all">目标：{gitOperationTarget(details.operation)}</p>
      <p className="break-all font-mono text-zinc-800 dark:text-zinc-200">
        {details.preview.command}
      </p>
      {details.preview.notes.length > 0 && (
        <ul className="list-inside list-disc space-y-1">
          {details.preview.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExecutionResultView({
  execution,
}: {
  execution?: ApprovalRecordView["execution"];
}) {
  if (!execution) return null;

  const isSuccess = execution.status === "succeeded";

  return (
    <div
      className={`rounded-md px-2 py-1.5 text-[11px] ${
        isSuccess
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
      }`}
    >
      <p className="font-medium">
        {isSuccess ? "执行成功" : "执行失败"} · {execution.attemptedAt}
      </p>
      <p className="mt-1 break-words">{execution.summary}</p>
      {execution.error && (
        <p className="mt-1 break-words font-mono">{execution.error}</p>
      )}
    </div>
  );
}

export function AgentPanel() {
  const [request, setRequest] = useState("");
  const [runMode, setRunMode] = useState<RunMode>("loop");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceInfoView | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecordView[]>([]);
  const [running, setRunning] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [approvalFilters, setApprovalFilters] = useState<ApprovalFilterState>({
    pendingOnly: true,
    currentTaskOnly: false,
  });
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bucket = useMemo(() => bucketEvents(events), [events]);
  const filteredApprovals = useMemo(
    () => filterApprovals(approvals, approvalFilters, currentTaskId),
    [approvals, approvalFilters, currentTaskId],
  );
  const workspaceBusy = running || loadingWorkspace;

  useEffect(() => {
    let cancelled = false;

    async function loadInitialApprovals() {
      try {
        const res = await fetch("/api/agent/approvals");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        setApprovals(
          sortApprovals(Array.isArray(data.approvals) ? data.approvals : []),
        );
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
      setApprovals(
        sortApprovals(Array.isArray(data.approvals) ? data.approvals : []),
      );
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
      setApprovals((current) => {
        const next = current.map((approval) =>
          approval.id === approvalId ? data.approval : approval,
        );
        return sortApprovals(next);
      });
      setApprovalStatus(status === "approved" ? "已批准。" : "已拒绝。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理审批失败。");
    } finally {
      setLoadingApprovals(false);
    }
  }

  async function executeApproval(approval: ApprovalRecordView) {
    if (loadingApprovals) return;

    setLoadingApprovals(true);
    setApprovalStatus(null);
    setError(null);

    try {
      const res = await fetch("/api/agent/approvals/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.approval) {
          setApprovals((current) => {
            const next = current.map((item) =>
              item.id === approval.id ? data.approval : item,
            );
            return sortApprovals(next);
          });
        }
        throw new Error(data.error ?? "执行审批失败。");
      }
      setApprovals((current) => {
        const next = current.map((item) =>
          item.id === approval.id ? data.approval : item,
        );
        return sortApprovals(next);
      });
      setApprovalStatus("执行完成。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "执行审批失败。");
      void loadApprovals();
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
    setApprovalStatus(null);
    setCurrentTaskId(null);
    setApprovalFilters({
      pendingOnly: true,
      currentTaskOnly: false,
    });
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
          if (parsed.type === "task.created") {
            setCurrentTaskId(parsed.taskId);
            setApprovalFilters({
              pendingOnly: true,
              currentTaskOnly: true,
            });
          }
          if (parsed.type === "approval.required") {
            setApprovals((current) => upsertApproval(current, parsed.approval));
            setApprovalStatus("已收到新的审批请求。");
          }
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
          定位文件、准备改动审批；批准后需要再点执行。
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setApprovalFilters((current) => ({
                ...current,
                pendingOnly: !current.pendingOnly,
              }))
            }
            className={`rounded-md px-2 py-1 text-xs transition ${
              approvalFilters.pendingOnly
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            仅待审批
          </button>
          <button
            type="button"
            onClick={() =>
              setApprovalFilters((current) => ({
                ...current,
                currentTaskOnly: !current.currentTaskOnly,
              }))
            }
            disabled={!currentTaskId}
            className={`rounded-md px-2 py-1 text-xs transition disabled:opacity-50 ${
              approvalFilters.currentTaskOnly
                ? "bg-blue-600 text-white dark:bg-blue-500"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            仅本次任务
          </button>
          {(approvalFilters.pendingOnly || approvalFilters.currentTaskOnly) && (
            <button
              type="button"
              onClick={() =>
                setApprovalFilters({
                  pendingOnly: false,
                  currentTaskOnly: false,
                })
              }
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              显示全部
            </button>
          )}
          <p className="text-xs text-zinc-500">
            显示 {filteredApprovals.length} / {approvals.length} 条
          </p>
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
        ) : filteredApprovals.length === 0 ? (
          <p className="rounded-md bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-900">
            当前筛选条件下没有审批。
          </p>
        ) : (
          <div className="max-h-56 space-y-2 overflow-auto">
            {filteredApprovals.map((approval) => (
              <article
                key={approval.id}
                className={`space-y-2 rounded-md border p-2 text-xs ${
                  approval.status === "pending"
                    ? "border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
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
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {approval.taskId === currentTaskId && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        本次任务
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 ${riskClassName(
                        approval.risk,
                      )}`}
                    >
                      风险 {APPROVAL_RISK_LABELS[approval.risk]}
                    </span>
                  </div>
                </div>
                <p className="break-all font-mono text-[11px] text-zinc-500">
                  {approval.action}
                </p>
                <ApprovalDetailsView details={approval.details} />
                {approval.status === "approved" && !approval.details && (
                  <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    旧审批缺少可执行详情，请重新发起任务生成新的审批。
                  </p>
                )}
                <ExecutionResultView execution={approval.execution} />
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
                  {approval.status === "approved" &&
                    approval.execution?.status !== "succeeded" && (
                      <button
                        type="button"
                        onClick={() => void executeApproval(approval)}
                        disabled={loadingApprovals || !approval.details}
                        className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white transition hover:bg-blue-500 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
                      >
                        执行
                      </button>
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
            正在启动智能体...
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
