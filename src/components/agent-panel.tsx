"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readImageFile } from "@/lib/read-image-file";
import { AgentCompactedMemoryPanel } from "@/components/agent-compacted-memory-panel";
import { AgentEventTimeline } from "@/components/agent-event-timeline";
import {
  useAgentWorkspaceBridge,
  type TraceRestorePayload,
} from "@/components/agent-workspace-bridge";
import { DiffView } from "@/components/diff-view";
import { AgentInlineApprovals } from "@/components/agent-inline-approvals";
import { AgentRightRail } from "@/components/agent-right-rail";
import { AgentRunModeHint } from "@/components/agent-run-mode-hint";
import { AgentSessionSidebar } from "@/components/agent-session-sidebar";
import { AgentTouchedFiles } from "@/components/agent-touched-files";
import { PatchFilesDiffView } from "@/components/patch-files-diff";
import {
  collectTouchedFiles,
  resolveThreadIdFromEvents,
} from "@/lib/agent-feed";
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
  reflections: AgentEvent[];
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

const MAX_REFERENCE_IMAGES = 4;

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

function mergeApprovalLists(
  ...lists: Array<ApprovalRecordView[] | ApprovalEventView[]>
): ApprovalRecordView[] {
  const merged = new Map<string, ApprovalRecordView>();
  for (const list of lists) {
    for (const item of list) {
      const next = normalizeApprovalView(item);
      merged.set(next.id, next);
    }
  }
  return sortApprovals([...merged.values()]);
}

function approvalFromRequiredEvent(
  event: Extract<AgentEvent, { type: "approval.required" }>,
): ApprovalRecordView {
  return normalizeApprovalView({
    ...event.approval,
    taskId: event.approval.taskId ?? event.taskId,
  });
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
    reflections: [],
    tools: [],
    approvals: [],
    verifications: [],
    finals: [],
    others: [],
  };

  for (const event of events) {
    if (event.type === "plan.updated") bucket.plans.push(event);
    else if (event.type === "reflection.updated") bucket.reflections.push(event);
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
  defaultExpanded = true,
}: {
  label: string;
  snapshot?: ApprovalContentSnapshot;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!snapshot) return null;

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-zinc-500">
          {label} · {snapshot.lineCount} 行 · {snapshot.length} 字符
          {snapshot.truncated ? " · 已截断" : ""}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
        >
          {expanded ? "收起" : "展开原文"}
        </button>
      </div>
      {expanded && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-950 p-2 text-[11px] leading-relaxed text-zinc-100">
          {snapshot.text || "(empty)"}
        </pre>
      )}
    </div>
  );
}

function FileDiffBlock({
  label,
  before,
  after,
}: {
  label?: string;
  before?: ApprovalContentSnapshot;
  after?: ApprovalContentSnapshot;
}) {
  if (!before && !after) return null;
  return (
    <div className="space-y-1">
      {label && (
        <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      )}
      <DiffView before={before} after={after} changesOnly layout="split" />
    </div>
  );
}

function GitRiskBanner({
  operation,
}: {
  operation: ApprovalGitMutationOperation;
}) {
  if (operation.type === "branch") return null;
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
      {operation.type === "push"
        ? "高风险：push 会把本地提交推送到远程。执行需二次确认，并请先查看下方 status/diff。"
        : "高风险：commit 会写入版本历史，执行前请确认下方 status/diff。"}
    </p>
  );
}

function GitWorkspaceSnapshotView({
  workspace,
}: {
  workspace?: import("@/agent/types").ApprovalGitWorkspaceSnapshot;
}) {
  if (!workspace) return null;
  return (
    <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-950">
      {workspace.branch && (
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
          当前分支：<span className="font-mono">{workspace.branch}</span>
        </p>
      )}
      {workspace.remoteUrl && (
        <p className="break-all text-[11px] text-zinc-600 dark:text-zinc-400">
          Remote：<span className="font-mono">{workspace.remoteUrl}</span>
        </p>
      )}
      <ContentSnapshotBlock label="git status" snapshot={workspace.status} />
      <ContentSnapshotBlock label="git diff" snapshot={workspace.diff} />
    </div>
  );
}

function ApprovalDetailsView({ details }: { details?: ApprovalDetails }) {
  if (!details) return null;

  if (details.kind === "patch_apply") {
    return (
      <div className="space-y-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900/80">
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
          Patch · {details.preview.changedCount} / {details.preview.fileCount}{" "}
          个文件有变化
        </p>
        <PatchFilesDiffView files={details.preview.files} />
        <ContentSnapshotBlock
          label="Patch 原文"
          snapshot={details.preview.patchPreview}
          defaultExpanded={false}
        />
      </div>
    );
  }

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
        <FileDiffBlock
          label="Diff"
          before={preview.oldContent}
          after={preview.newContent}
        />
      </div>
    );
  }

  if (details.kind === "shell_command") {
    return (
      <div className="space-y-2 rounded-md bg-zinc-50 p-2 text-[11px] text-zinc-600 dark:bg-zinc-900/80 dark:text-zinc-400">
        <p className="font-mono text-zinc-800 dark:text-zinc-200">
          {details.preview.command}
        </p>
        {!details.preview.available && (
          <p className="text-amber-700 dark:text-amber-300">
            package.json 中不存在该 script，无法创建可执行审批。
          </p>
        )}
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

  return (
    <div className="space-y-2 rounded-md bg-zinc-50 p-2 text-[11px] text-zinc-600 dark:bg-zinc-900/80 dark:text-zinc-400">
      <GitRiskBanner operation={details.operation} />
      <p>类型：Git {details.operation.type}</p>
      <p className="break-all">目标：{gitOperationTarget(details.operation)}</p>
      <p className="break-all font-mono text-zinc-800 dark:text-zinc-200">
        {details.preview.command}
      </p>
      <GitWorkspaceSnapshotView workspace={details.preview.workspace} />
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
  const result =
    execution.result && typeof execution.result === "object"
      ? (execution.result as Record<string, unknown>)
      : null;

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
      {typeof result?.stdout === "string" && result.stdout.length > 0 && (
        <pre className="mt-2 max-h-24 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-100">
          {result.stdout}
        </pre>
      )}
      {typeof result?.stderr === "string" && result.stderr.length > 0 && (
        <pre className="mt-2 max-h-24 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-red-200">
          {result.stderr}
        </pre>
      )}
      {Array.isArray(result?.files) && (
        <p className="mt-1 font-mono text-[10px]">
          {(result.files as string[]).join(", ")}
        </p>
      )}
    </div>
  );
}

type AgentPanelProps = {
  layout?: "default" | "workspace" | "triple";
};

export function AgentPanel({ layout = "workspace" }: AgentPanelProps) {
  const bridge = useAgentWorkspaceBridge();
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
  const [taskSummary, setTaskSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushConfirmId, setPushConfirmId] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [continueThreadMemory, setContinueThreadMemory] = useState(true);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const referenceFileRef = useRef<HTMLInputElement>(null);
  const bucket = useMemo(() => bucketEvents(events), [events]);
  const touchedFiles = useMemo(() => collectTouchedFiles(events), [events]);
  const filteredApprovals = useMemo(
    () => filterApprovals(approvals, approvalFilters, currentTaskId),
    [approvals, approvalFilters, currentTaskId],
  );
  const workspaceBusy = running || loadingWorkspace;

  const restoreFromTrace = useCallback((payload: TraceRestorePayload) => {
    setEvents(payload.events);
    setCurrentTaskId(payload.taskId);
    setRunning(false);
    setRequest(payload.userRequest ?? "");
    setTaskSummary(payload.taskSummary ?? null);
    setCurrentThreadId(resolveThreadIdFromEvents(payload.events));
    setError(null);
    setApprovalFilters({
      pendingOnly: false,
      currentTaskOnly: true,
    });
    const traceApprovals = payload.events
      .filter(
        (event): event is Extract<AgentEvent, { type: "approval.required" }> =>
          event.type === "approval.required",
      )
      .map((event) => approvalFromRequiredEvent(event));
    setApprovals((current) =>
      sortApprovals(mergeApprovalLists(current, traceApprovals)),
    );
    setApprovalStatus("已从历史 Trace 恢复活动流；右侧已筛选「仅本次任务」审批。");
  }, []);

  useEffect(() => {
    if (layout !== "workspace" || !bridge) return;
    bridge.registerPanel({ restoreFromTrace });
    return () => bridge.registerPanel(null);
  }, [bridge, layout, restoreFromTrace]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialApprovals() {
      try {
        const res = await fetch("/api/agent/approvals");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        setApprovals((current) =>
          mergeApprovalLists(
            current,
            Array.isArray(data.approvals) ? data.approvals : [],
          ),
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
      setApprovals((current) =>
        mergeApprovalLists(
          current,
          Array.isArray(data.approvals) ? data.approvals : [],
        ),
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
      setApprovalStatus(
        status === "approved"
          ? "已批准。请点击本条右侧的「执行」才会真正修改磁盘上的代码。"
          : "已拒绝。",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理审批失败。");
    } finally {
      setLoadingApprovals(false);
    }
  }

  async function approveAndExecute(approval: ApprovalRecordView) {
    if (!approval.details) {
      setError("该审批缺少可执行详情，无法一键执行。请重新发起任务。");
      return;
    }
    if (loadingApprovals) return;
    if (
      needsPushSecondConfirm(approval) &&
      pushConfirmId !== approval.id
    ) {
      setError("Push 需先批准，再点两次「执行」→「确认 Push」。请分步操作。");
      return;
    }

    setLoadingApprovals(true);
    setApprovalStatus(null);
    setError(null);

    try {
      const patchRes = await fetch("/api/agent/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, status: "approved" }),
      });
      const patchData = await patchRes.json();
      if (!patchRes.ok) {
        throw new Error(patchData.error ?? "批准失败。");
      }
      const approved = patchData.approval as ApprovalRecordView;
      setApprovals((current) => {
        const next = current.map((item) =>
          item.id === approval.id ? approved : item,
        );
        return sortApprovals(next);
      });

      const execRes = await fetch("/api/agent/approvals/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id }),
      });
      const execData = await execRes.json();
      if (!execRes.ok) {
        if (execData.approval) {
          setApprovals((current) => {
            const next = current.map((item) =>
              item.id === approval.id ? execData.approval : item,
            );
            return sortApprovals(next);
          });
        }
        throw new Error(execData.error ?? "执行失败。");
      }
      setApprovals((current) => {
        const next = current.map((item) =>
          item.id === approval.id ? execData.approval : item,
        );
        return sortApprovals(next);
      });
      setApprovalStatus("已批准并已写入代码。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "批准并执行失败。");
      void loadApprovals();
    } finally {
      setLoadingApprovals(false);
    }
  }

  function needsPushSecondConfirm(approval: ApprovalRecordView): boolean {
    return (
      approval.details?.kind === "git_mutation" &&
      approval.details.operation.type === "push"
    );
  }

  async function executeApproval(approval: ApprovalRecordView) {
    if (loadingApprovals) return;
    if (
      needsPushSecondConfirm(approval) &&
      pushConfirmId !== approval.id
    ) {
      setPushConfirmId(approval.id);
      setApprovalStatus("Push 为高风险操作，请再次点击「确认 Push」。");
      return;
    }

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
      setPushConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "执行审批失败。");
      void loadApprovals();
    } finally {
      setLoadingApprovals(false);
    }
  }

  async function onPickReferenceImages(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const files = e.target.files;
    if (!files?.length) return;
    const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
    const toAdd = Array.from(files).slice(0, remaining);
    try {
      const urls = await Promise.all(toAdd.map((file) => readImageFile(file)));
      setReferenceImages((prev) =>
        [...prev, ...urls].slice(0, MAX_REFERENCE_IMAGES),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片读取失败");
    } finally {
      e.target.value = "";
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const userRequest = request.trim();
    if ((!userRequest && referenceImages.length === 0) || running) return;

    const imagesForLoop =
      runMode === "loop" && referenceImages.length > 0
        ? referenceImages
        : undefined;

    setEvents([]);
    setError(null);
    setApprovalStatus(null);
    setTaskSummary(null);
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
            userRequest:
              userRequest ||
              (imagesForLoop?.length ? "请根据附图完成开发任务。" : ""),
            referenceImages: imagesForLoop,
            maxIterations: 12,
            verify: false,
            threadId:
              runMode === "loop" &&
              continueThreadMemory &&
              currentThreadId
                ? currentThreadId
                : undefined,
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
      let sawApprovalThisRun = false;

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

          let parsed: AgentEvent;
          try {
            parsed = JSON.parse(dataLine.slice("data: ".length)) as AgentEvent;
          } catch {
            continue;
          }
          if (parsed.type === "thread.created") {
            setCurrentThreadId(parsed.threadId);
          }
          if (parsed.type === "task.created") {
            setCurrentTaskId(parsed.taskId);
          }
          if (parsed.type === "trace.linked") {
            bridge?.setSession(parsed.taskId, parsed.traceId);
          }
          if (parsed.type === "approval.required") {
            sawApprovalThisRun = true;
            setApprovals((current) =>
              upsertApproval(current, approvalFromRequiredEvent(parsed)),
            );
            setApprovalFilters({
              pendingOnly: false,
              currentTaskOnly: false,
            });
            setApprovalStatus("已收到新的审批请求，请点「批准并执行」写入代码。");
          }
          if (parsed.type === "task.failed") {
            setError(parsed.error);
            setTaskSummary(null);
          }
          if (parsed.type === "task.completed") {
            setTaskSummary(parsed.summary);
            if (!sawApprovalThisRun) {
              setApprovalStatus(
                "任务已结束，但未生成审批。请看下方「结果」或错误提示；常见原因是模型未调用改文件工具，或要删的字在页面里不存在。",
              );
            }
          }
          setEvents((prev) => [...prev, parsed]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown agent error.");
    } finally {
      setRunning(false);
      setReferenceImages([]);
      setSidebarRefreshKey((key) => key + 1);
      void loadApprovals();
    }
  }

  const canRunTask =
    (request.trim().length > 0 || referenceImages.length > 0) && !running;

  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  const reviewCompact = layout === "triple";

  const approvalsPanel = (
    <section
      className={
        reviewCompact
          ? "flex min-h-0 flex-1 flex-col gap-1.5 bg-white dark:bg-zinc-950"
          : "flex min-h-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
      }
    >
      <div
        className={
          reviewCompact
            ? "flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800"
            : "flex items-center justify-between gap-2"
        }
      >
        <div>
          <h3 className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
            变更审查
            {pendingCount > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {pendingCount}
              </span>
            )}
          </h3>
          {!reviewCompact && pendingCount > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {pendingCount} 项待你确认
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadApprovals()}
          disabled={loadingApprovals}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {loadingApprovals ? "刷新中" : "刷新"}
        </button>
      </div>
      {!reviewCompact && (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          批准 ≠ 执行。确认 diff 后点「批准并执行」或先批准再点「执行」。
        </p>
      )}
      <div
        className={
          reviewCompact
            ? "flex flex-wrap items-center gap-1.5 px-3"
            : "flex flex-wrap items-center gap-2"
        }
      >
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
        <p className="text-xs text-zinc-500">
          {filteredApprovals.length} / {approvals.length}
        </p>
      </div>
      {approvalStatus && (
        <p
          className={
            reviewCompact
              ? "px-3 text-[11px] text-emerald-600 dark:text-emerald-400"
              : "text-xs text-emerald-600 dark:text-emerald-400"
          }
        >
          {approvalStatus}
        </p>
      )}
      <div
        className={
          reviewCompact
            ? "min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-3"
            : "min-h-0 flex-1 space-y-2 overflow-auto"
        }
      >
        {approvals.length === 0 ? (
          <p className="rounded-md bg-white px-3 py-6 text-center text-xs text-zinc-500 dark:bg-zinc-950">
            暂无待审查变更
          </p>
        ) : filteredApprovals.length === 0 ? (
          <p className="rounded-md bg-white px-3 py-6 text-center text-xs text-zinc-500 dark:bg-zinc-950">
            当前筛选无结果
          </p>
        ) : (
          filteredApprovals.map((approval) => (
            <article
              key={approval.id}
              className={`space-y-2 rounded-md border bg-white p-2 text-xs dark:bg-zinc-950 ${
                approval.status === "pending"
                  ? "border-blue-300 shadow-sm dark:border-blue-800"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">
                    {approval.title}
                  </p>
                  <p className="mt-1 break-words text-zinc-500">
                    {approval.reason}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {approval.taskId === currentTaskId && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      本次
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 ${riskClassName(
                      approval.risk,
                    )}`}
                  >
                    {APPROVAL_RISK_LABELS[approval.risk]}
                  </span>
                </div>
              </div>
              <ApprovalDetailsView details={approval.details} />
              {approval.status === "approved" && !approval.details && (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  旧审批缺少可执行详情，请重新发起任务。
                </p>
              )}
              <ExecutionResultView execution={approval.execution} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-500">
                  {APPROVAL_STATUS_LABELS[approval.status]}
                </span>
                {approval.status === "pending" && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void resolveApproval(approval.id, "rejected")
                      }
                      disabled={loadingApprovals}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      拒绝
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void resolveApproval(approval.id, "approved")
                      }
                      disabled={loadingApprovals}
                      className="rounded-md bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
                    >
                      批准
                    </button>
                    {approval.details && (
                      <button
                        type="button"
                        onClick={() => void approveAndExecute(approval)}
                        disabled={loadingApprovals}
                        className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        批准并执行
                      </button>
                    )}
                  </div>
                )}
                  {approval.status === "approved" &&
                    approval.execution?.status !== "succeeded" && (
                      <button
                        type="button"
                        onClick={() => void executeApproval(approval)}
                        disabled={loadingApprovals || !approval.details}
                        className={`rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-50 ${
                          needsPushSecondConfirm(approval) &&
                          pushConfirmId === approval.id
                            ? "bg-red-600 hover:bg-red-500"
                            : "bg-blue-600"
                        }`}
                      >
                        {needsPushSecondConfirm(approval) &&
                        pushConfirmId === approval.id
                          ? "确认 Push"
                          : "执行"}
                      </button>
                    )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );

  const shellClass =
    layout === "triple"
      ? "flex h-full min-h-0 w-full"
      : layout === "workspace"
        ? "flex h-full min-h-0 w-full flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        : "flex h-full min-h-0 w-full flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";

  const workspaceSidebar = (
    <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 p-2 dark:border-zinc-800">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        项目
      </p>
      <form onSubmit={handleWorkspaceSubmit} className="space-y-1.5">
        <input
          value={workspacePath}
          onChange={(e) => setWorkspacePath(e.target.value)}
          placeholder="Workspace 路径"
          disabled={workspaceBusy}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex gap-1">
          <button
            type="submit"
            disabled={workspaceBusy}
            className="flex-1 rounded-md border border-zinc-300 py-1 text-[10px] dark:border-zinc-700"
          >
            设置
          </button>
          <button
            type="button"
            onClick={() => void loadWorkspace()}
            disabled={workspaceBusy}
            className="flex-1 rounded-md border border-zinc-300 py-1 text-[10px] dark:border-zinc-700"
          >
            读取
          </button>
        </div>
      </form>
      {workspace && (
        <p className="truncate text-[10px] text-zinc-500">
          {workspace.packageName ?? "项目"} · {workspace.framework ?? "—"}
        </p>
      )}
      <div className="flex rounded-md border border-zinc-300 p-0.5 text-[10px] dark:border-zinc-700">
        <button
          type="button"
          onClick={() => setRunMode("loop")}
          disabled={running}
          className={`flex-1 rounded py-1 ${
            runMode === "loop"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
              : "text-zinc-600"
          }`}
        >
          Loop
        </button>
        <button
          type="button"
          onClick={() => setRunMode("develop")}
          disabled={running}
          className={`flex-1 rounded py-1 ${
            runMode === "develop"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
              : "text-zinc-600"
          }`}
        >
          闭环
        </button>
      </div>
      <AgentRunModeHint mode={runMode} />
    </div>
  );

  const centerApprovals = useMemo(
    () =>
      filterApprovals(
        approvals,
        { pendingOnly: false, currentTaskOnly: Boolean(currentTaskId) },
        currentTaskId,
      ).filter(
        (a) =>
          a.status === "pending" ||
          (a.status === "approved" && a.execution?.status !== "succeeded"),
      ),
    [approvals, currentTaskId],
  );

  if (layout === "triple") {
    return (
      <div className={shellClass}>
        <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
          {workspaceSidebar}
          <AgentSessionSidebar
            currentTaskId={currentTaskId}
            currentThreadId={currentThreadId}
            refreshKey={sidebarRefreshKey}
            onSelectThread={(threadId) => {
              setCurrentThreadId(threadId);
              if (threadId) setContinueThreadMemory(true);
            }}
            onContinueThread={({ threadId, lastUserRequest }) => {
              setCurrentThreadId(threadId);
              setContinueThreadMemory(true);
              if (lastUserRequest?.trim()) {
                setRequest(lastUserRequest.trim());
              }
              setApprovalStatus("已载入会话记忆，可修改需求后点击运行。");
            }}
            onSessionsChanged={() =>
              setSidebarRefreshKey((key) => key + 1)
            }
          />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-zinc-950">
          <div className="min-h-0 flex-1 overflow-auto px-3 pt-3">
            {error && (
              <p className="mb-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            )}
            <AgentTouchedFiles files={touchedFiles} />
            <AgentCompactedMemoryPanel events={events} compact />
            <AgentEventTimeline
              events={events}
              running={running}
              density="compact"
              excludeEventTypes={["plan.updated", "approval.required"]}
            />
            <AgentInlineApprovals
              approvals={centerApprovals}
              loading={loadingApprovals}
              pushConfirmId={pushConfirmId}
              onReject={(id) => void resolveApproval(id, "rejected")}
              onApprove={(id) => void resolveApproval(id, "approved")}
              onApproveAndExecute={(a) => void approveAndExecute(a)}
              onExecute={(a) => void executeApproval(a)}
              needsPushSecondConfirm={needsPushSecondConfirm}
            />
          </div>

          <footer className="shrink-0 border-t border-zinc-200 bg-zinc-50/80 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
            {runMode === "loop" && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-600 dark:text-zinc-400">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={continueThreadMemory}
                    onChange={(e) => setContinueThreadMemory(e.target.checked)}
                    disabled={running}
                    className="rounded border-zinc-300"
                  />
                  延续会话记忆
                </label>
                {currentThreadId && continueThreadMemory && (
                  <span className="font-mono text-zinc-500">
                    thread:{currentThreadId.slice(0, 12)}…
                  </span>
                )}
                {currentThreadId && (
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => setCurrentThreadId(null)}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    新会话
                  </button>
                )}
              </div>
            )}
            {referenceImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {referenceImages.map((src, index) => (
                  <div key={`${index}-${src.slice(0, 24)}`} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt=""
                      className="h-14 w-14 rounded-md border border-zinc-200 object-cover dark:border-zinc-700"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setReferenceImages((prev) =>
                          prev.filter((_, i) => i !== index),
                        )
                      }
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[10px] text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={referenceFileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(e) => void onPickReferenceImages(e)}
              />
              <button
                type="button"
                disabled={running || referenceImages.length >= MAX_REFERENCE_IMAGES}
                onClick={() => referenceFileRef.current?.click()}
                className="shrink-0 rounded-xl border border-zinc-300 px-2.5 py-2.5 text-xs text-zinc-600 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400"
                title="附加参考图（走 vision 模型）"
              >
                图
              </button>
              <input
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="描述任务，可附图…"
                disabled={running}
                className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="submit"
                disabled={!canRunTask}
                className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
              >
                {running ? "运行中" : "运行"}
              </button>
            </form>
            <AgentRunModeHint mode={runMode} />
            {runMode === "develop" && referenceImages.length > 0 && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                开发闭环暂不支持附图，请切换到 Agent Loop。
              </p>
            )}
            {approvalStatus && (
              <p className="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                {approvalStatus}
              </p>
            )}
          </footer>
        </main>

        <AgentRightRail
          events={events}
          running={running}
          taskSummary={taskSummary}
          error={error}
          browserOpen={browserOpen}
          onToggleBrowser={() => setBrowserOpen((v) => !v)}
        />
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {layout === "default" && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            开发智能体
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            通用编程循环：理解 → 读盘取证 → 准备改动 → 反思，再决定下一步。
          </p>
        </div>
      )}

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
      {(taskSummary || bridge?.currentTraceId) && !error && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {taskSummary && <p className="min-w-0 flex-1">{taskSummary}</p>}
          {layout === "workspace" && bridge?.currentTraceId && (
            <button
              type="button"
              onClick={() =>
                bridge.openHistory({
                  traceId: bridge.currentTraceId ?? undefined,
                  taskId: bridge.currentTaskId ?? undefined,
                })
              }
              className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-white dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              在历史 Trace 中查看
            </button>
          )}
        </div>
      )}

      {layout === "workspace" ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <AgentEventTimeline events={events} running={running} />
          <aside className="flex min-h-[280px] min-w-0 flex-col lg:min-h-0">
            {approvalsPanel}
          </aside>
        </div>
      ) : (
        <>
          {approvalsPanel}
          <div className="min-h-0 flex-1 space-y-4 overflow-auto">
            <AgentEventTimeline events={events} running={running} />
            <Section title="计划" events={bucket.plans} />
            <Section title="反思" events={bucket.reflections} />
            <Section title="工具调用" events={bucket.tools} />
            <Section title="审批" events={bucket.approvals} />
            <Section title="验证" events={bucket.verifications} />
            <Section title="结果" events={bucket.finals} />
            <Section title="其他事件" events={bucket.others} />
          </div>
        </>
      )}
    </div>
  );
}
