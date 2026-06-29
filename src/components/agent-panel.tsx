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
import { formatCompactionCheckpoint } from "@/lib/compaction-labels";
import { AgentEventTimeline } from "@/components/agent-event-timeline";
import { AgentReviewPanel } from "@/components/agent-review-panel";
import { AgentRunStatusStrip } from "@/components/agent-run-status-strip";
import { AgentComposer } from "@/components/agent-composer";
import { AgentTerminalPanel } from "@/components/agent-terminal-panel";
import {
  useAgentWorkspaceBridge,
  type TraceRestorePayload,
} from "@/components/agent-workspace-bridge";
import { DiffView } from "@/components/diff-view";
import { PrepareEvidenceView } from "@/components/prepare-evidence-view";
import { snapshotDiffHint } from "@/lib/snapshot-diff-text";
import { GitStatusView } from "@/components/git-status-view";
import {
  AgentRightRail,
  type AgentRightRailTab,
} from "@/components/agent-right-rail";
import {
  buildLintFixLoopRequest,
  readAutoReloopOnLintFail,
  shouldOfferLintReloop,
} from "@/lib/agent-lint-reloop";
import {
  isCommandLikeApproval,
  isFileLikeApproval,
} from "@/lib/approval-kind";
import {
  AgentSessionSidebar,
  type AgentProjectSidebarItem,
} from "@/components/agent-session-sidebar";
import { AgentNewChatHero } from "@/components/agent-new-chat-hero";
import { PatchFilesDiffView } from "@/components/patch-files-diff";
import { resolveThreadIdFromEvents } from "@/lib/agent-feed";
import { approvalAnchorId } from "@/lib/approval-anchor";
import {
  collectReviewDisplay,
  extractFileChangesFromApproval,
} from "@/lib/approval-file-changes";
import type { KernelBootstrapReviewHint } from "@/lib/kernel-file-hint";
import { normalizeRepoPath } from "@/lib/git-tree-decoration";
import { workspaceRelativePath } from "@/lib/workspace-tree-paths";
import { workspaceIdsEqual } from "@/lib/workspace-path";
import { extractPostExecuteVerification } from "@/lib/post-execute-verification";
import { PostExecuteVerificationView } from "@/components/post-execute-verification-view";
import { readReviewDiffLayout } from "@/lib/agent-review-diff-prefs";
import {
  pickWorkspaceFolder,
  subscribeWorkspaceFolderFromMenu,
} from "@/lib/desktop-bridge";
import {
  buildApprovalLoopContinuationRequest,
  findUserRequestForTask,
  shouldResumeLoopAfterApprovalExecute,
} from "@/lib/approval-loop-continuation";
import { appendApprovalExecutionEvents, buildCommandResultNotice, appendCommandApprovalRejectedEvents } from "@/lib/approval-chat-events";
import { appendKernelBootstrapRestartAfterValidate } from "@/lib/kernel-bootstrap-restart";
import {
  collectPendingCommandApprovals,
  extractShellVerificationResult,
  isAwaitingCommandExecution,
} from "@/lib/command-approval-state";
import { summarizeShellFailureOutput } from "@/agent/tools/shell-output";
import {
  createTerminalLogEntry,
  type TerminalLogEntry,
} from "@/lib/terminal-session-log";
import { useDesktopApp } from "@/lib/use-desktop-app";
import { extractAtMentionPaths } from "@/lib/composer-at-mention";
import type { EditorSelectionContext } from "@/agent/core/attached-files";
import {
  formatMentionLineRange,
  type ReviewEditorSelection,
} from "@/lib/review-editor-selection";
import {
  readTripleLayoutPrefs,
  TRIPLE_LEFT_DEFAULT,
  TRIPLE_LEFT_MAX,
  TRIPLE_LEFT_MIN,
  TRIPLE_RIGHT_DEFAULT,
  TRIPLE_RIGHT_MAX,
  TRIPLE_RIGHT_MIN,
  writeTripleLayoutPrefs,
} from "@/lib/triple-layout-prefs";
import { TripleLayoutResizeHandle } from "@/components/triple-layout-resize-handle";
import { TripleRightPanelToggleIcon } from "@/components/triple-right-panel-toggle-icon";
import {
  buildOpenEditorUiContext,
  mergeBrowserTabIntoUiContext,
} from "@/agent/indexer/ui-layout-boost";
import {
  canAutoApplyFileApproval,
  readAutoApplyFileChanges,
} from "@/lib/agent-file-auto-apply";
import {
  canAutoApproveShellCommand,
  readAutoApproveShellCommands,
} from "@/lib/agent-shell-auto-approve";
import {
  approvalDetailsPayloadBytes,
  needsApprovalDetailsHydration,
} from "@/agent/approval/approval-list-summary";
import type { GitStatusSnapshot } from "@/lib/git-status";
import type { PostExecuteVerification } from "@/agent/verification/post-execute-verify";
import type {
  AgentEvent,
  ApprovalContentSnapshot,
  ApprovalDetails,
  ApprovalFileMutationPreview,
  ApprovalGitMutationOperation,
  ApprovalRequest,
  VerificationResult,
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
  git?: GitStatusSnapshot | null;
  staleConfiguredPath?: string | null;
};

function workspaceStatusFromPayload(workspace: WorkspaceInfoView): string {
  if (workspace.staleConfiguredPath) {
    return `已配置的工作区不存在：${workspace.staleConfiguredPath}。已临时使用 ${workspace.rootPath}，请重新选择文件夹。`;
  }
  return "已读取当前 Workspace。";
}

type EventBucket = {
  plans: AgentEvent[];
  reflections: AgentEvent[];
  tools: AgentEvent[];
  approvals: AgentEvent[];
  verifications: AgentEvent[];
  finals: AgentEvent[];
  others: AgentEvent[];
};

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
const MAX_ATTACHED_FILES = 8;

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

function approvalProgressRank(approval: ApprovalRecordView): number {
  if (approval.execution?.status === "succeeded") return 40;
  if (approval.execution?.status === "failed") return 35;
  if (approval.status === "approved") return 30;
  if (approval.status === "rejected") return 20;
  return 10;
}

function mergeApprovalDetails(
  existing?: ApprovalDetails,
  incoming?: ApprovalDetails,
): ApprovalDetails | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return approvalDetailsPayloadBytes(existing) >=
    approvalDetailsPayloadBytes(incoming)
    ? existing
    : incoming;
}

function mergeApprovalRecord(
  existing: ApprovalRecordView,
  incoming: ApprovalRecordView,
): ApprovalRecordView {
  const existingRank = approvalProgressRank(existing);
  const incomingRank = approvalProgressRank(incoming);
  const primary =
    incomingRank > existingRank
      ? incoming
      : existingRank > incomingRank
        ? existing
        : incoming;
  const secondary = primary === incoming ? existing : incoming;
  return normalizeApprovalView({
    ...secondary,
    ...primary,
    details: mergeApprovalDetails(primary.details, secondary.details),
    execution: primary.execution ?? secondary.execution,
    status: primary.status,
    decidedAt: primary.decidedAt ?? secondary.decidedAt,
  });
}

function mergeApprovalLists(
  ...lists: Array<ApprovalRecordView[] | ApprovalEventView[]>
): ApprovalRecordView[] {
  const merged = new Map<string, ApprovalRecordView>();
  for (const list of lists) {
    for (const item of list) {
      const next = normalizeApprovalView(item);
      const existing = merged.get(next.id);
      merged.set(
        next.id,
        existing ? mergeApprovalRecord(existing, next) : next,
      );
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
    } else if (
      event.type === "task.completed" ||
      event.type === "task.failed" ||
      event.type === "task.cancelled"
    ) {
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
  const hint = snapshotDiffHint(before, after);
  return (
    <div className="space-y-1">
      {label && (
        <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      )}
      {hint && (
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
      <DiffView
        before={before}
        after={after}
        changesOnly
        defaultLayout={readReviewDiffLayout()}
      />
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
      {workspace.branch && !workspace.statusSnapshot && (
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
          当前分支：<span className="font-mono">{workspace.branch}</span>
        </p>
      )}
      {workspace.remoteUrl && (
        <p className="break-all text-[11px] text-zinc-600 dark:text-zinc-400">
          Remote：<span className="font-mono">{workspace.remoteUrl}</span>
        </p>
      )}
      {workspace.statusSnapshot ? (
        <GitStatusView snapshot={workspace.statusSnapshot} compact />
      ) : (
        <ContentSnapshotBlock label="git status" snapshot={workspace.status} />
      )}
      <ContentSnapshotBlock label="git diff" snapshot={workspace.diff} />
    </div>
  );
}

function ApprovalDetailsView({
  details,
  postExecuteVerification,
  onFixLint,
}: {
  details?: ApprovalDetails;
  postExecuteVerification?: PostExecuteVerification;
  onFixLint?: () => void;
}) {
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
        {details.evidence && (
          <PrepareEvidenceView evidence={details.evidence} />
        )}
        {postExecuteVerification && (
          <PostExecuteVerificationView
            verification={postExecuteVerification}
            onFixLint={onFixLint}
          />
        )}
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
  const [refreshingApprovalList, setRefreshingApprovalList] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [approvalStatusTone, setApprovalStatusTone] = useState<
    "success" | "error" | "neutral"
  >("neutral");
  const [taskSummary, setTaskSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushConfirmId, setPushConfirmId] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [reviewEditorSelection, setReviewEditorSelection] =
    useState<ReviewEditorSelection | null>(null);
  const [recentAttachedPaths, setRecentAttachedPaths] = useState<string[]>([]);
  const [tripleLeftWidth, setTripleLeftWidth] = useState(TRIPLE_LEFT_DEFAULT);
  const [tripleRightWidth, setTripleRightWidth] = useState(TRIPLE_RIGHT_DEFAULT);
  const [tripleRightCollapsed, setTripleRightCollapsed] = useState(false);
  const tripleWidthsRef = useRef({
    leftWidth: TRIPLE_LEFT_DEFAULT,
    rightWidth: TRIPLE_RIGHT_DEFAULT,
  });
  const tripleResizeStartRef = useRef<{
    leftWidth: number;
    rightWidth: number;
  } | null>(null);
  /** 与 running 同步，避免 approve 回调闭包读到 stale running */
  const runningRef = useRef(false);
  /** A165：中止当前 Loop 流式请求 */
  const loopAbortRef = useRef<AbortController | null>(null);
  /** Loop 仍在跑时用户已批准命令，待本轮结束后自动续跑 */
  const pendingApprovalContinuationRef = useRef<{
    request: string;
    shellResume?: { approvalId: string; result: VerificationResult };
  } | null>(null);
  /** A166：task.awaiting_approval 时记录，用于 shellResume 而非 Phase A 续跑 */
  const shellAwaitingRef = useRef<{
    threadId: string;
    approvalId: string;
  } | null>(null);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [continueThreadMemory, setContinueThreadMemory] = useState(true);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [recentProjects, setRecentProjects] = useState<
    { workspaceId: string; name: string }[]
  >([]);
  const desktopShell = useDesktopApp();
  const [rightRailTab, setRightRailTab] = useState<AgentRightRailTab>("files");
  const [terminalLogs, setTerminalLogs] = useState<TerminalLogEntry[]>([]);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    tripleWidthsRef.current = {
      leftWidth: tripleLeftWidth,
      rightWidth: tripleRightWidth,
    };
  }, [tripleLeftWidth, tripleRightWidth]);

  useEffect(() => {
    if (layout !== "triple") return;
    const prefs = readTripleLayoutPrefs();
    setTripleLeftWidth(prefs.leftWidth);
    setTripleRightWidth(prefs.rightWidth);
    setTripleRightCollapsed(prefs.rightCollapsed === true);
  }, [layout]);

  function persistTripleLayoutPrefs(
    patch: Partial<{
      leftWidth: number;
      rightWidth: number;
      rightCollapsed: boolean;
    }> = {},
  ) {
    writeTripleLayoutPrefs({
      leftWidth: patch.leftWidth ?? tripleLeftWidth,
      rightWidth: patch.rightWidth ?? tripleRightWidth,
      rightCollapsed: patch.rightCollapsed ?? tripleRightCollapsed,
    });
  }

  function hideTripleRightPanel() {
    setTripleRightCollapsed(true);
    persistTripleLayoutPrefs({ rightCollapsed: true });
  }

  function showTripleRightPanel() {
    setTripleRightCollapsed(false);
    persistTripleLayoutPrefs({ rightCollapsed: false });
  }

  function beginTripleColumnResize() {
    tripleResizeStartRef.current = { ...tripleWidthsRef.current };
  }

  function resizeTripleLeftColumn(deltaX: number) {
    const start = tripleResizeStartRef.current;
    if (!start) return;
    setTripleLeftWidth(
      Math.min(TRIPLE_LEFT_MAX, Math.max(TRIPLE_LEFT_MIN, start.leftWidth + deltaX)),
    );
  }

  function resizeTripleRightColumn(deltaX: number) {
    const start = tripleResizeStartRef.current;
    if (!start) return;
    setTripleRightWidth(
      Math.min(TRIPLE_RIGHT_MAX, Math.max(TRIPLE_RIGHT_MIN, start.rightWidth - deltaX)),
    );
  }

  function endTripleColumnResize() {
    persistTripleLayoutPrefs();
    tripleResizeStartRef.current = null;
  }

  const referenceFileRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const focusApprovalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [focusedApprovalId, setFocusedApprovalId] = useState<string | null>(
    null,
  );
  const [reviewFileKey, setReviewFileKey] = useState<string | null>(null);
  const [revertingFilePath, setRevertingFilePath] = useState<string | null>(
    null,
  );

  const focusApproval = useCallback(
    (approvalId: string, filePath?: string) => {
      if (layout === "triple") {
        setRightRailTab("review");
      }
      if (focusApprovalTimerRef.current) {
        clearTimeout(focusApprovalTimerRef.current);
      }
      setFocusedApprovalId(approvalId);
      const approval = approvals.find((item) => item.id === approvalId);
      if (approval) {
        const files = extractFileChangesFromApproval(approval);
        if (filePath) {
          const match = files.find(
            (file) =>
              file.path === filePath ||
              file.path.endsWith(filePath) ||
              filePath.endsWith(file.path),
          );
          if (match) setReviewFileKey(match.fileKey);
        }
      }
      requestAnimationFrame(() => {
        document
          .getElementById(approvalAnchorId(approvalId))
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      focusApprovalTimerRef.current = setTimeout(() => {
        setFocusedApprovalId(null);
      }, 2800);
    },
    [approvals, layout],
  );

  useEffect(() => {
    return () => {
      if (focusApprovalTimerRef.current) {
        clearTimeout(focusApprovalTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!focusedApprovalId) return;
    const approval = approvals.find((item) => item.id === focusedApprovalId);
    if (!approval || !needsApprovalDetailsHydration(approval.details)) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/agent/approvals/${focusedApprovalId}`);
        const data = await res.json();
        if (!res.ok || cancelled || !data.approval) return;
        setApprovals((current) =>
          sortApprovals(
            mergeApprovalLists(current, [
              data.approval as ApprovalRecordView,
            ]),
          ),
        );
      } catch {
        // Review diff stays empty until the user refreshes.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusedApprovalId, approvals]);

  useEffect(() => {
    if (!running || layout !== "triple") return;
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [events, running, layout]);
  const bucket = useMemo(() => bucketEvents(events), [events]);
  const filteredApprovals = useMemo(
    () => filterApprovals(approvals, approvalFilters, currentTaskId),
    [approvals, approvalFilters, currentTaskId],
  );
  const workspaceBusy = running || loadingWorkspace;

  const restoreFromTrace = useCallback((payload: TraceRestorePayload) => {
    setEvents(payload.events);
    setCurrentTaskId(payload.taskId);
    setRunning(false);
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

    void (async () => {
      try {
        const res = await fetch("/api/agent/approvals");
        const data = await res.json();
        const serverApprovals = Array.isArray(data.approvals)
          ? (data.approvals as ApprovalRecordView[])
          : [];
        setApprovals(
          sortApprovals(mergeApprovalLists(traceApprovals, serverApprovals)),
        );
      } catch {
        setApprovals((current) =>
          sortApprovals(mergeApprovalLists(current, traceApprovals)),
        );
      }
    })();

    setApprovalStatus("已从历史 Trace 恢复活动流；右侧已筛选「仅本次任务」审批。");
    if (layout === "triple") {
      setReviewFileKey(null);
      setFocusedApprovalId(null);
      queueMicrotask(() => void loadWorkspace(true));
    }
  }, [layout]);

  const startNewSession = useCallback(() => {
    if (running) return;
    setCurrentThreadId(null);
    setContinueThreadMemory(false);
    setEvents([]);
    setCurrentTaskId(null);
    setTaskSummary(null);
    setRequest("");
    setAttachedFiles([]);
    setError(null);
    setApprovalStatus("已开始新会话，输入任务后点击运行。");
    setApprovalFilters({
      pendingOnly: true,
      currentTaskOnly: false,
    });
    setSidebarRefreshKey((key) => key + 1);
  }, [running]);

  useEffect(() => {
    if (!bridge) return;
    bridge.registerPanel({ restoreFromTrace });
    return () => bridge.registerPanel(null);
  }, [bridge, restoreFromTrace]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialWorkspace() {
      setLoadingWorkspace(true);
      try {
        const res = await fetch("/api/agent/workspace");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        setWorkspace(data.workspace);
        setWorkspacePath(data.workspace.rootPath);
        setWorkspaceStatus(workspaceStatusFromPayload(data.workspace));
      } catch {
        // 手动「读取」按钮会展示失败原因。
      } finally {
        if (!cancelled) setLoadingWorkspace(false);
      }
    }

    void loadInitialWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    return subscribeWorkspaceFolderFromMenu((folderPath) => {
      setWorkspacePath(folderPath);
      void applyWorkspaceRootPath(folderPath);
    });
  }, []);

  async function loadWorkspace(force = false) {
    if (!force && workspaceBusy) return;

    setError(null);
    if (!force) setWorkspaceStatus(null);
    setLoadingWorkspace(true);

    try {
      const res = await fetch("/api/agent/workspace");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load workspace.");
      setWorkspace(data.workspace);
      setWorkspacePath(data.workspace.rootPath);
      if (!force) {
        setWorkspaceStatus(workspaceStatusFromPayload(data.workspace));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 Workspace 失败。");
    } finally {
      setLoadingWorkspace(false);
    }
  }

  async function applyWorkspaceRootPath(rootPath: string) {
    const trimmed = rootPath.trim();
    if (workspaceBusy || !trimmed) return false;

    setError(null);
    setWorkspaceStatus(null);
    setLoadingWorkspace(true);
    try {
      const res = await fetch("/api/agent/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to set workspace.");
      setWorkspace(data.workspace);
      setWorkspacePath(data.workspace.rootPath);
      setWorkspaceStatus(
        desktopShell
          ? "已通过桌面选择器设置 Workspace。"
          : "Workspace 已设置。",
      );
      setApprovals([]);
      setReviewFileKey(null);
      setFocusedApprovalId(null);
      setSidebarRefreshKey((key) => key + 1);
      void loadApprovals();
      queueMicrotask(() => void loadWorkspace(true));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set workspace.");
      return false;
    } finally {
      setLoadingWorkspace(false);
    }
  }

  async function handleWorkspaceSubmit(e: FormEvent) {
    e.preventDefault();
    if (!workspacePath.trim()) {
      setError("请先输入本机项目的绝对路径。");
      return;
    }
    await applyWorkspaceRootPath(workspacePath);
  }

  async function handlePickWorkspaceFolder() {
    const folderPath = await pickWorkspaceFolder();
    if (!folderPath) return;
    setWorkspacePath(folderPath);
    await applyWorkspaceRootPath(folderPath);
  }

  function startNewAgent() {
    startNewSession();
    setApprovalStatus("新建 Agent：请先确认工作区，再输入任务。");
  }

  async function activateProjectWorkspace(
    project: AgentProjectSidebarItem,
  ): Promise<boolean> {
    if (workspaceBusy) return false;
    if (
      workspace != null &&
      workspaceIdsEqual(workspace.rootPath, project.workspaceId)
    ) {
      return true;
    }
    setWorkspacePath(project.workspaceId);
    return applyWorkspaceRootPath(project.workspaceId);
  }

  async function startNewSessionInProject(
    project: AgentProjectSidebarItem,
  ): Promise<void> {
    const ok = await activateProjectWorkspace(project);
    if (!ok) return;
    startNewSession();
    setApprovalStatus(`已在「${project.name}」下新建会话。`);
  }

  useEffect(() => {
    if (layout !== "triple") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agent/threads?grouped=projects");
        const data = await res.json();
        if (cancelled || !res.ok || !Array.isArray(data.projects)) return;
        setRecentProjects(
          (data.projects as AgentProjectSidebarItem[]).map((p) => ({
            workspaceId: p.workspaceId,
            name: p.name,
          })),
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [layout, sidebarRefreshKey]);

  useEffect(() => {
    if (layout !== "triple") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (!running) startNewAgent();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [layout, running, startNewSession]);

  const showNewChatHero =
    layout === "triple" && events.length === 0 && !running;

  const workspaceDisplayName = workspace
    ? (workspace.packageName ??
      workspace.rootPath.split(/[/\\]/).pop() ??
      null)
    : null;

  const workspacePickerProps =
    layout === "triple"
      ? {
          currentName: workspaceDisplayName,
          projects: recentProjects,
          busy: workspaceBusy,
          onSelect: (workspaceId: string) => {
            setWorkspacePath(workspaceId);
            void applyWorkspaceRootPath(workspaceId);
          },
          onOpenFolder: handlePickWorkspaceFolder,
        }
      : undefined;

  async function loadApprovals() {
    if (refreshingApprovalList) return;

    setRefreshingApprovalList(true);
    setError(null);

    try {
      const res = await fetch("/api/agent/approvals?full=1");
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
      setRefreshingApprovalList(false);
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
      const resolved = data.approval as ApprovalRecordView;
      setApprovals((current) => upsertApproval(current, resolved));
      if (status === "rejected" && isCommandLikeApproval(resolved)) {
        const taskId = resolved.taskId ?? currentTaskId ?? "shell_manual";
        setEvents((current) =>
          appendCommandApprovalRejectedEvents(current, {
            taskId,
            approval: resolved,
          }),
        );
        setApprovalStatus("命令已拒绝。");
        setApprovalStatusTone("neutral");
      } else {
        setApprovalStatus(
          status === "approved"
            ? "已批准。请点击本条右侧的「执行」才会真正修改磁盘上的代码。"
            : "已拒绝。",
        );
        setApprovalStatusTone("neutral");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理审批失败。");
    } finally {
      setLoadingApprovals(false);
    }
  }

  function applyPostExecuteVerificationFeedback(
    verification: PostExecuteVerification | undefined,
    taskId: string | null,
  ): string | undefined {
    if (!verification?.triggered) return undefined;
    if (taskId) {
      setEvents((current) => [
        ...current,
        ...verification.results.map((result) => ({
          type: "verification.completed" as const,
          taskId,
          result,
        })),
      ]);
    }
    return verification.summary;
  }

  function handlePostExecuteOutcome(
    verification: PostExecuteVerification | undefined,
    baseStatus: string,
  ) {
    if (!shouldOfferLintReloop(verification)) {
      setApprovalStatus(baseStatus);
      return;
    }
    if (readAutoReloopOnLintFail()) {
      setApprovalStatus(`${baseStatus} lint 未通过，正在自动再修一轮…`);
      startLintFixLoop(verification);
      return;
    }
    const fixRequest = buildLintFixLoopRequest(verification);
    setRequest(fixRequest);
    setApprovalStatus(
      `${baseStatus} 可点变更卡「根据 lint 再修一轮」，或在输入框编辑后发送。`,
    );
  }

  function startLintFixLoop(verification: PostExecuteVerification) {
    const fixRequest = buildLintFixLoopRequest(verification);
    if (running) {
      setRequest(fixRequest);
      setApprovalStatus("lint 未通过：已填入修复说明，发送后将再修一轮。");
      return;
    }
    setRequest(fixRequest);
    void runLoopWithRequest(fixRequest);
  }

  function cancelRunningLoop() {
    const controller = loopAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    setApprovalStatus("正在停止…");
  }

  async function sendGuidance(text: string) {
    if (!running || !currentThreadId) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    setApprovalStatus("正在发送引导…");
    setApprovalStatusTone("neutral");
    try {
      const res = await fetch("/api/agent/guidance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: currentThreadId, text: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        at?: string;
      };
      if (!res.ok) {
        setApprovalStatus(data.error ?? "引导发送失败");
        setApprovalStatusTone("error");
        return;
      }

      const guidanceEvent: AgentEvent = {
        type: "guidance.received",
        taskId: currentTaskId ?? "task_pending",
        threadId: currentThreadId,
        id: data.id ?? `guidance_local_${Date.now()}`,
        text: trimmed,
        at: data.at ?? new Date().toISOString(),
        applied: false,
      };
      setEvents((prev) => [...prev, guidanceEvent]);
      setRequest("");
      setApprovalStatus("引导已发送，将在下一轮迭代生效");
      setApprovalStatusTone("neutral");
    } catch {
      setApprovalStatus("引导发送失败");
      setApprovalStatusTone("error");
    }
  }

  async function runLoopWithRequest(
    loopUserRequest: string,
    options?: {
      referenceImages?: string[];
      attachedPaths?: string[];
      /** 在同一会话 Thread 内续跑时保留历史事件 */
      appendSession?: boolean;
      /** A151：shell 批准后同 Loop 上下文续跑 */
      shellResume?: { approvalId: string; result: VerificationResult };
    },
  ) {
    const trimmed = loopUserRequest.trim();
    if ((!trimmed && !options?.shellResume) || running) return;

    const imagesForLoop = options?.referenceImages;
    const fromRequest = extractAtMentionPaths(trimmed);
    const mergedPaths = [
      ...new Set([
        ...fromRequest,
        ...(options?.attachedPaths ?? attachedFiles),
      ]),
    ];
    const pathsForLoop = mergedPaths.length > 0 ? mergedPaths : undefined;
    const attachedSelections = buildAttachedSelections(pathsForLoop);

    const continuingSession =
      options?.appendSession === true ||
      (options?.appendSession !== false &&
        continueThreadMemory &&
        currentThreadId != null);

    if (!continuingSession) {
      setEvents([]);
      setCurrentTaskId(null);
      setApprovalFilters({
        pendingOnly: true,
        currentTaskOnly: false,
      });
    }
    setError(null);
    setApprovalStatus(null);
    if (!continuingSession) {
      setTaskSummary(null);
    }
    runningRef.current = true;
    setRunning(true);

    loopAbortRef.current?.abort();
    const loopAbortController = new AbortController();
    loopAbortRef.current = loopAbortController;

    let uiContext = buildOpenEditorUiContext({
      layout,
      attachedPaths: pathsForLoop,
      activeEditorPath: reviewEditorSelection?.path ?? null,
    });
    try {
      const tabRes = await fetch("/api/agent/browser/tabs");
      if (tabRes.ok) {
        const tabData = (await tabRes.json()) as {
          tabs?: Array<{ id: string; url: string | null; title: string | null }>;
          activeTabId?: string | null;
        };
        const activeTab =
          tabData.tabs?.find((tab) => tab.id === tabData.activeTabId) ??
          tabData.tabs?.find((tab) => tab.url);
        if (activeTab?.url) {
          uiContext = mergeBrowserTabIntoUiContext(uiContext, {
            url: activeTab.url,
            title: activeTab.title,
          });
        }
      }
    } catch {
      // 无浏览器面板时跳过
    }

    try {
      const res = await fetch("/api/agent/loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: loopAbortController.signal,
        body: JSON.stringify({
          userRequest: trimmed || "【shell 执行续跑】",
          referenceImages: imagesForLoop,
          maxIterations: 12,
          threadId:
            (continuingSession || continueThreadMemory) && currentThreadId
              ? currentThreadId
              : undefined,
          uiContext,
          attachedPaths: pathsForLoop,
          attachedSelections,
          shellResume: options?.shellResume,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Agent request failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawApprovalThisRun = false;

      while (true) {
        if (loopAbortController.signal.aborted) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }

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
            setContinueThreadMemory(true);
            setSidebarRefreshKey((key) => key + 1);
          }
          if (parsed.type === "task.created") {
            setCurrentTaskId(parsed.taskId);
          }
          if (parsed.type === "trace.linked") {
            bridge?.setSession(parsed.taskId, parsed.traceId);
          }
          if (parsed.type === "approval.required") {
            sawApprovalThisRun = true;
            const nextApproval = approvalFromRequiredEvent(parsed);
            setApprovals((current) => upsertApproval(current, nextApproval));
            setApprovalFilters({
              pendingOnly: false,
              currentTaskOnly: false,
            });
            if (isCommandLikeApproval(nextApproval)) {
              const autoShellEnabled = readAutoApproveShellCommands();
              const autoShell =
                autoShellEnabled &&
                canAutoApproveShellCommand(nextApproval, autoShellEnabled);
              if (autoShell) {
                setApprovalStatus("低风控命令，正在自动运行…");
                void approveAndExecute(nextApproval);
              } else {
                setApprovalStatus(
                  "可在下方或对话中点击「批准并运行」执行命令。",
                );
              }
            } else {
              const autoApply =
                (layout === "triple" || readAutoApplyFileChanges()) &&
                canAutoApplyFileApproval(nextApproval, true);
              if (autoApply) {
                setApprovalStatus("已收到文件变更，正在自动应用…");
                if (layout === "triple") {
                  setRightRailTab("review");
                }
                void approveAndExecute(nextApproval);
              } else {
                setApprovalStatus(
                  layout === "triple"
                    ? "已收到文件变更，请在右侧「审查」查看 diff。"
                    : "已收到文件变更，请在右侧「审查」查看 diff 并点击「应用更改」。",
                );
                if (layout === "triple") {
                  setRightRailTab("review");
                }
                if (layout !== "triple") {
                  queueMicrotask(() => focusApproval(nextApproval.id));
                }
              }
            }
          }
          if (parsed.type === "context.compacted") {
            setApprovalStatus(formatCompactionCheckpoint(parsed).status);
          }
          if (parsed.type === "tool.completed") {
            const toolName = parsed.toolCall?.toolName;
            if (
              layout === "triple" &&
              (toolName === "browser.open" || toolName === "devtools.get_network_requests")
            ) {
              setRightRailTab("browser");
            }
          }
          if (parsed.type === "task.failed") {
            setError(parsed.error);
            setTaskSummary(null);
            shellAwaitingRef.current = null;
          }
          if (parsed.type === "task.cancelled") {
            setApprovalStatus("已停止运行");
            setTaskSummary(null);
            shellAwaitingRef.current = null;
          }
          if (parsed.type === "task.awaiting_approval") {
            sawApprovalThisRun = true;
            shellAwaitingRef.current = {
              threadId: parsed.threadId,
              approvalId: parsed.approvalId,
            };
            setApprovalStatus("等待批准 shell 命令…");
          }
          if (parsed.type === "task.completed") {
            setTaskSummary(parsed.summary);
            shellAwaitingRef.current = null;
            if (!sawApprovalThisRun) {
              setApprovalStatus(
                "任务已结束，但未生成审批。请看事件流或重试。",
              );
            }
          }
          if (parsed.type === "guidance.received") {
            setEvents((prev) => {
              const idx = prev.findIndex(
                (e) =>
                  e.type === "guidance.received" && e.id === parsed.id,
              );
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = parsed;
                return next;
              }
              return [...prev, parsed];
            });
          } else {
            setEvents((prev) => [...prev, parsed]);
          }
        }
      }
    } catch (err) {
      const aborted =
        loopAbortController.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError");
      if (aborted) {
        setApprovalStatus("已停止运行");
      } else {
        setError(err instanceof Error ? err.message : "Unknown agent error.");
      }
    } finally {
      const userCancelled = loopAbortController.signal.aborted;
      loopAbortRef.current = null;
      runningRef.current = false;
      setRunning(false);
      setReferenceImages([]);
      setAttachedFiles([]);
      setSidebarRefreshKey((key) => key + 1);
      void loadApprovals();
      if (!userCancelled) {
        flushPendingApprovalContinuation();
      }
    }
  }

  function flushPendingApprovalContinuation() {
    const pending = pendingApprovalContinuationRef.current;
    if (!pending || runningRef.current) return;
    pendingApprovalContinuationRef.current = null;
    setApprovalStatus("命令已执行，Agent 继续完成原定任务…");
    void runLoopWithRequest(pending.request, {
      appendSession: true,
      shellResume: pending.shellResume,
    });
  }

  function maybeResumeLoopAfterApproval(
    approval: ApprovalRecordView,
    execPayload: Record<string, unknown>,
  ) {
    if (!shouldResumeLoopAfterApprovalExecute(approval)) return;
    const prior = approval.taskId
      ? findUserRequestForTask(approval.taskId, events)
      : null;
    const shellResult = extractShellVerificationResult(execPayload, approval);
    const shellAwaiting = shellAwaitingRef.current;
    const useShellResume = Boolean(
      shellResult &&
        currentThreadId &&
        shellAwaiting?.approvalId === approval.id &&
        shellAwaiting.threadId === currentThreadId,
    );
    shellAwaitingRef.current = null;
    const continuation = useShellResume
      ? "【shell 执行续跑】"
      : buildApprovalLoopContinuationRequest(
          approval,
          execPayload as { result?: unknown; approval?: ApprovalRecordView },
          prior,
        );
    const pendingPayload = {
      request: continuation,
      shellResume: useShellResume
        ? { approvalId: approval.id, result: shellResult! }
        : undefined,
    };
    if (runningRef.current) {
      pendingApprovalContinuationRef.current = pendingPayload;
      setApprovalStatus(
        "命令已执行，当前任务结束后 Agent 将自动继续…",
      );
      return;
    }
    setApprovalStatus("命令已执行，Agent 继续完成原定任务…");
    void runLoopWithRequest(pendingPayload.request, {
      appendSession: true,
      shellResume: pendingPayload.shellResume,
    });
  }

  function pushShellOutputToTerminal(
    approval: ApprovalRecordView,
    execPayload: Record<string, unknown>,
  ) {
    const result = extractShellVerificationResult(execPayload, approval);
    if (!result) return;
    setTerminalLogs((current) => [
      ...current,
      createTerminalLogEntry({
        id: `${approval.id}_${Date.now()}`,
        command: result.command,
        success: result.success,
        output: result.output,
        completedAt: result.completedAt,
      }),
    ]);
    if (layout === "triple") {
      setRightRailTab("terminal");
    }
  }

  function pushShellExecutionToChat(
    approval: ApprovalRecordView,
    execPayload: Record<string, unknown>,
  ) {
    pushShellOutputToTerminal(approval, execPayload);
    if (!isCommandLikeApproval(approval)) return;
    const result = extractShellVerificationResult(execPayload, approval);
    if (!result) return;
    const taskId = approval.taskId ?? currentTaskId ?? "shell_manual";
    const execution = (execPayload.approval as ApprovalRecordView | undefined)
      ?.execution;
    setEvents((current) => {
      const next = appendApprovalExecutionEvents(current, {
        taskId,
        approval: (execPayload.approval as ApprovalRequest) ?? approval,
        result,
        summary: execution?.summary,
      });
      return appendKernelBootstrapRestartAfterValidate(next, {
        taskId,
        command: result.command,
        success: result.success,
      });
    });
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
    setApprovalStatus("正在运行命令…");
    setApprovalStatusTone("neutral");
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
      setApprovals((current) => upsertApproval(current, approved));

      const execRes = await fetch("/api/agent/approvals/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id }),
      });
      const execData = await execRes.json();
      const executedApproval = (execData.approval as ApprovalRecordView | undefined) ?? approval;
      if (!execRes.ok) {
        if (execData.approval) {
          setApprovals((current) =>
            upsertApproval(current, execData.approval as ApprovalRecordView),
          );
        }
        if (isCommandLikeApproval(approval)) {
          const failedResult =
            (execData.result as { result?: VerificationResult } | undefined)?.result ??
            (() => {
              const row = executedApproval.execution?.result as
                | { command?: string; success?: boolean; output?: string }
                | undefined;
              if (!row || typeof row.success !== "boolean") return null;
              return {
                command: row.command ?? approval.title,
                success: row.success,
                output: String(row.output ?? ""),
                completedAt: new Date().toISOString(),
              } satisfies VerificationResult;
            })();
          if (failedResult) {
            const notice = buildCommandResultNotice(failedResult);
            setApprovalStatus(notice.statusLine);
            setApprovalStatusTone(notice.tone);
          }
          pushShellExecutionToChat(executedApproval, execData);
          maybeResumeLoopAfterApproval(executedApproval, execData);
          setError(
            execData.approval?.execution?.error ??
              summarizeShellFailureOutput(
                failedResult?.output ?? String(execData.error ?? "命令执行失败。"),
              ),
          );
          return;
        }
        throw new Error(execData.error ?? "执行失败。");
      }
      setApprovals((current) =>
        upsertApproval(current, execData.approval as ApprovalRecordView),
      );
      const verification = execData.postExecuteVerification as
        | PostExecuteVerification
        | undefined;
      const verifySummary = applyPostExecuteVerificationFeedback(
        verification,
        approval.taskId ?? currentTaskId,
      );
      const commandLike = isCommandLikeApproval(approval);
      const shellResult = (execData.result as { result?: VerificationResult } | undefined)
        ?.result;
      if (commandLike && shellResult) {
        const notice = buildCommandResultNotice(shellResult);
        setApprovalStatus(notice.statusLine);
        setApprovalStatusTone(notice.tone);
      }
      const baseStatus = commandLike
        ? shellResult
          ? buildCommandResultNotice(shellResult).statusLine
          : verifySummary
            ? `命令已批准并运行。${verifySummary}`
            : "命令已批准并运行。"
        : verifySummary
          ? `已批准并已写入代码。${verifySummary}`
          : "已批准并已写入代码。";
      handlePostExecuteOutcome(verification, baseStatus);
      pushShellExecutionToChat(executedApproval, execData);
      maybeResumeLoopAfterApproval(executedApproval, execData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批准并执行失败。");
      void loadApprovals();
    } finally {
      setLoadingApprovals(false);
    }
  }

  function findCommandApproval(approvalId: string): ApprovalRecordView | undefined {
    const fromState = approvals.find((item) => item.id === approvalId);
    if (fromState?.details && isCommandLikeApproval(fromState)) {
      return fromState;
    }
    for (const event of events) {
      if (event.type !== "approval.required") continue;
      if (event.approval.id !== approvalId) continue;
      if (event.approval.details?.kind !== "shell_command") continue;
      return approvalFromRequiredEvent(event);
    }
    return fromState;
  }

  function approveCommandFromTurn(approvalId: string) {
    const approval = findCommandApproval(approvalId);
    if (!approval || !approval.details || !isCommandLikeApproval(approval)) {
      setError("找不到待运行的命令审批，请刷新后重试。");
      return;
    }
    if (
      !isAwaitingCommandExecution(approval, executedCommandApprovalIds)
    ) {
      setError("该命令已处理。");
      return;
    }
    void approveAndExecute(approval);
  }

  function applyApprovalFromTurn(approvalId: string) {
    const approval = findCommandApproval(approvalId) ?? approvals.find((item) => item.id === approvalId);
    if (!approval || approval.status !== "pending" || !approval.details) {
      setError("该变更无法直接应用，请在右侧审查区查看。");
      return;
    }
    if (isCommandLikeApproval(approval)) {
      void approveAndExecute(approval);
      return;
    }
    focusApproval(approvalId);
    void approveAndExecute(approval);
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
          setApprovals((current) =>
            upsertApproval(current, data.approval as ApprovalRecordView),
          );
        }
        throw new Error(data.error ?? "执行审批失败。");
      }
      setApprovals((current) =>
        upsertApproval(current, data.approval as ApprovalRecordView),
      );
      const verification = data.postExecuteVerification as
        | PostExecuteVerification
        | undefined;
      const verifySummary = applyPostExecuteVerificationFeedback(
        verification,
        approval.taskId ?? currentTaskId,
      );
      handlePostExecuteOutcome(
        verification,
        verifySummary ? `执行完成。${verifySummary}` : "执行完成。",
      );
      pushShellExecutionToChat(approval, data);
      maybeResumeLoopAfterApproval(approval, data);
      setPushConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "执行审批失败。");
      void loadApprovals();
    } finally {
      setLoadingApprovals(false);
    }
  }

  async function addReferenceImagesFromFiles(
    files: File[],
    source: "paste" | "drop" | "pick",
  ) {
    const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (remaining <= 0) {
      setError(`最多附加 ${MAX_REFERENCE_IMAGES} 张参考图`);
      return;
    }
    const toAdd = files.slice(0, remaining);
    const overflow = files.length - toAdd.length;
    try {
      const urls = await Promise.all(toAdd.map((file) => readImageFile(file)));
      if (urls.length === 0) return;
      setReferenceImages((prev) =>
        [...prev, ...urls].slice(0, MAX_REFERENCE_IMAGES),
      );
      setError(null);
      const verb =
        source === "paste"
          ? "已粘贴"
          : source === "drop"
            ? "已拖入"
            : "已附加";
      let status = `${verb} ${urls.length} 张截图`;
      if (overflow > 0) {
        status += `（已达上限 ${MAX_REFERENCE_IMAGES} 张）`;
      }
      setApprovalStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片读取失败");
    }
  }

  async function onPasteReferenceImages(files: File[]) {
    await addReferenceImagesFromFiles(files, "paste");
  }

  async function onPickReferenceImages(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const files = e.target.files;
    if (!files?.length) return;
    await addReferenceImagesFromFiles(Array.from(files), "pick");
    e.target.value = "";
  }

  function noteRecentPath(filePath: string) {
    const path = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (!path) return;
    setRecentAttachedPaths((prev) =>
      [path, ...prev.filter((item) => item !== path)].slice(0, 12),
    );
  }

  function buildAttachedSelections(
    paths: string[] | undefined,
  ): EditorSelectionContext[] | undefined {
    if (!paths?.length || !reviewEditorSelection) return undefined;
    const norm = normalizeRepoPath(reviewEditorSelection.path);
    if (!paths.some((path) => normalizeRepoPath(path) === norm)) {
      return undefined;
    }
    return [
      {
        path: reviewEditorSelection.path,
        startLine: reviewEditorSelection.startLine,
        endLine: reviewEditorSelection.endLine,
        selectedText: reviewEditorSelection.selectedText,
      },
    ];
  }

  function mentionTokenForPath(filePath: string): string {
    const path = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (
      reviewEditorSelection &&
      normalizeRepoPath(reviewEditorSelection.path) === normalizeRepoPath(path)
    ) {
      return `@${path}${formatMentionLineRange(
        reviewEditorSelection.startLine,
        reviewEditorSelection.endLine,
      )}`;
    }
    return `@${path}`;
  }

  function rememberPathForMention(filePath: string) {
    const path = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (!path) return;
    noteRecentPath(path);
  }

  /** 将路径写入输入框 @ 提及并纳入下一轮 Loop（需用户主动 @ 或等同操作）。 */
  function attachPathFromTree(
    filePath: string,
    options?: { appendToRequest?: boolean },
  ) {
    if (running || attachedFiles.length >= MAX_ATTACHED_FILES) return;
    const path = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (!path) return;
    noteRecentPath(path);
    if (!options?.appendToRequest) return;
    if (!attachedFiles.includes(path)) {
      setAttachedFiles((prev) => [...prev, path].slice(0, MAX_ATTACHED_FILES));
    }
    setRequest((prev) => {
      const token = mentionTokenForPath(path);
      if (prev.includes(token)) return prev;
      const trimmed = prev.trim();
      return trimmed ? `${trimmed} ${token}` : token;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const userRequest = request.trim();
    if (running) {
      if (userRequest) {
        await sendGuidance(userRequest);
      }
      return;
    }
    if (
      (!userRequest && referenceImages.length === 0 && attachedFiles.length === 0)
    )
      return;

    const loopText =
      userRequest ||
      (referenceImages.length > 0 ? "请根据附图完成开发任务。" : "");
    await runLoopWithRequest(loopText, {
      referenceImages:
        referenceImages.length > 0 ? referenceImages : undefined,
    });
  }

  const canRunTask =
    (request.trim().length > 0 ||
      referenceImages.length > 0 ||
      extractAtMentionPaths(request).length > 0 ||
      attachedFiles.length > 0) &&
    !running;

  const pendingCount = approvals.filter((a) => a.status === "pending").length;
  const pendingCommandApprovals = useMemo(
    () => collectPendingCommandApprovals(events, approvals),
    [events, approvals],
  );
  const pendingCommandApprovalIds = useMemo(
    () => new Set(pendingCommandApprovals.map((approval) => approval.id)),
    [pendingCommandApprovals],
  );
  const executedCommandApprovalIds = useMemo(
    () =>
      new Set(
        events
          .filter(
            (event): event is Extract<AgentEvent, { type: "approval.executed" }> =>
              event.type === "approval.executed",
          )
          .map((event) => event.approvalId),
      ),
    [events],
  );
  const reviewApprovals = useMemo(() => {
    if (layout !== "triple") return approvals;
    return approvals.filter(
      (a) => !isCommandLikeApproval(a) && (isFileLikeApproval(a) || !a.details),
    );
  }, [approvals, layout]);

  const reviewDisplay = useMemo(
    () =>
      collectReviewDisplay(
        reviewApprovals,
        currentTaskId,
        focusedApprovalId,
        workspace?.git?.files,
        layout === "triple" ? { gitOnly: true } : undefined,
      ),
    [
      reviewApprovals,
      currentTaskId,
      focusedApprovalId,
      workspace?.git?.files,
      layout,
    ],
  );

  const kernelBootstrapHint = useMemo((): KernelBootstrapReviewHint | null => {
    let hint: KernelBootstrapReviewHint | null = null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== "kernel.bootstrap.validate") continue;
      if (currentTaskId && event.taskId !== currentTaskId) continue;
      hint = {
        paths: event.paths,
        validateScripts: event.validateScripts,
        validateCommand: event.validateCommand,
        requiresDevRestart: event.requiresDevRestart,
        autoValidatePrepared: event.autoValidatePrepared,
      };
      break;
    }
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== "kernel.bootstrap.restart") continue;
      if (currentTaskId && event.taskId !== currentTaskId) continue;
      return {
        ...(hint ?? {
          paths: [],
          validateScripts: [],
          validateCommand: event.validateCommand ?? null,
          requiresDevRestart: true,
        }),
        restartRecommended: true,
        restartMessage: event.message,
        restartCommand: event.restartCommand ?? null,
      };
    }
    return hint;
  }, [events, currentTaskId]);

  const pendingReviewCount = useMemo(() => {
    if (layout === "triple") {
      return reviewDisplay.files.length;
    }
    const pendingApprovals = reviewApprovals.filter(
      (a) => a.status === "pending",
    ).length;
    if (pendingApprovals > 0) return pendingApprovals;
    return reviewDisplay.source === "git" ? reviewDisplay.files.length : 0;
  }, [layout, reviewApprovals, reviewDisplay]);

  const reviewHighlightPath = useMemo(() => {
    if (layout !== "triple" || !reviewFileKey) return null;
    const path =
      reviewDisplay.files.find((file) => file.fileKey === reviewFileKey)?.path ??
      null;
    if (!path) return null;
    return workspaceRelativePath(path, workspace?.rootPath);
  }, [layout, reviewFileKey, reviewDisplay.files, workspace?.rootPath]);

  const openReviewForPath = useCallback(
    (path: string) => {
      if (layout !== "triple") return false;
      const norm = normalizeRepoPath(path);
      const match = reviewDisplay.files.find(
        (file) => normalizeRepoPath(file.path) === norm,
      );
      if (!match) return false;
      setReviewFileKey(match.fileKey);
      setRightRailTab("review");
      if (reviewDisplay.approvalId) {
        setFocusedApprovalId(reviewDisplay.approvalId);
      }
      return true;
    },
    [layout, reviewDisplay],
  );

  const handleTreeSelectPath = useCallback(
    (path: string) => {
      rememberPathForMention(path);
      if (layout !== "triple" || reviewDisplay.files.length === 0) return;
      openReviewForPath(path);
    },
    [layout, reviewDisplay.files.length, openReviewForPath],
  );

  useEffect(() => {
    if (layout !== "triple" || pendingReviewCount === 0) return;
    setRightRailTab("review");
  }, [layout, pendingReviewCount]);

  useEffect(() => {
    if (layout !== "triple" || rightRailTab !== "review") return;
    void loadWorkspace(true);
    const id = window.setInterval(() => void loadWorkspace(true), 8000);
    return () => window.clearInterval(id);
  }, [layout, rightRailTab, workspace?.rootPath]);

  useEffect(() => {
    if (layout !== "triple" || !workspace?.rootPath) return;
    setReviewFileKey(null);
    setFocusedApprovalId(null);
  }, [layout, workspace?.rootPath]);

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
          disabled={refreshingApprovalList}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {refreshingApprovalList ? "刷新中" : "刷新"}
        </button>
      </div>
          {!reviewCompact && (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          确认 diff 后在审查 Tab 点「应用更改」。
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
          filteredApprovals.map((approval) => {
            const postExecuteVerification = extractPostExecuteVerification(
              approval.execution?.result,
            );
            return (
            <article
              key={approval.id}
              id={approvalAnchorId(approval.id)}
              className={`space-y-2 rounded-md border bg-white p-2 text-xs transition dark:bg-zinc-950 ${
                approval.status === "pending"
                  ? "border-blue-300 shadow-sm dark:border-blue-800"
                  : "border-zinc-200 dark:border-zinc-800"
              } ${
                focusedApprovalId === approval.id
                  ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950"
                  : ""
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
              <ApprovalDetailsView
                details={approval.details}
                postExecuteVerification={postExecuteVerification}
                onFixLint={
                  shouldOfferLintReloop(postExecuteVerification)
                    ? () => startLintFixLoop(postExecuteVerification)
                    : undefined
                }
              />
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
                        接受
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
            );
          })
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

  const reviewPendingApproval = useMemo(() => {
    if (reviewDisplay.source !== "approval" || !reviewDisplay.approvalId) {
      return null;
    }
    const approval = reviewApprovals.find(
      (item) => item.id === reviewDisplay.approvalId,
    );
    if (
      !approval ||
      approval.status !== "pending" ||
      !approval.details ||
      isCommandLikeApproval(approval)
    ) {
      return null;
    }
    return approval;
  }, [reviewDisplay, reviewApprovals]);

  async function revertReviewFile(path: string) {
    if (revertingFilePath) return;

    setRevertingFilePath(path);
    setError(null);
    try {
      const res = await fetch("/api/agent/workspace/revert-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "撤销文件更改失败。");
      await loadWorkspace();
      setReviewFileKey((current) => {
        const norm = normalizeRepoPath(path);
        const revertedKey = `git:${norm}`;
        if (current === revertedKey) return null;
        return current;
      });
      setApprovalStatus(`已撤销 ${path} 的更改。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤销文件更改失败。");
    } finally {
      setRevertingFilePath(null);
    }
  }

  const reviewPanel = (
    <AgentReviewPanel
      key={workspace?.rootPath ?? "no-workspace"}
      embedded={layout === "triple"}
      defaultAcceptMode={layout === "triple"}
      approvals={reviewApprovals}
      currentTaskId={currentTaskId}
      focusedApprovalId={focusedApprovalId}
      gitFiles={workspace?.git?.files}
      selectedFileKey={reviewFileKey}
      onSelectFile={setReviewFileKey}
      autoApplyEnabled={
        layout === "triple" || readAutoApplyFileChanges()
      }
      onRevertFile={
        layout === "triple" ? (path) => void revertReviewFile(path) : undefined
      }
      revertingFilePath={revertingFilePath}
      kernelBootstrapHint={kernelBootstrapHint}
      reviewActions={
        layout === "triple"
          ? null
          : reviewPendingApproval
            ? {
                approvalId: reviewPendingApproval.id,
                busy: loadingApprovals,
                onAccept: (id) => applyApprovalFromTurn(id),
                onReject: (id) => void resolveApproval(id, "rejected"),
              }
            : null
      }
      onRevealInTree={(path) => {
        const rel = workspaceRelativePath(path, workspace?.rootPath);
        const norm = normalizeRepoPath(rel);
        const match = reviewDisplay.files.find(
          (file) => normalizeRepoPath(file.path) === norm,
        );
        if (match) setReviewFileKey(match.fileKey);
        rememberPathForMention(rel);
        setRightRailTab("files");
      }}
      onEditorSelectionChange={setReviewEditorSelection}
    />
  );

  if (layout === "triple") {
    return (
      <div className={shellClass}>
        <aside
          className="flex shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/90 dark:border-zinc-800 dark:bg-zinc-900/60"
          style={{ width: tripleLeftWidth }}
        >
          <AgentSessionSidebar
            currentTaskId={currentTaskId}
            currentThreadId={currentThreadId}
            refreshKey={sidebarRefreshKey}
            activeWorkspaceId={workspace?.rootPath ?? null}
            onSelectThread={(threadId) => {
              setCurrentThreadId(threadId);
              if (threadId) setContinueThreadMemory(true);
            }}
            onNewAgent={startNewAgent}
            onActivateProject={(project) => {
              void activateProjectWorkspace(project);
            }}
            onNewSessionInProject={(project) => {
              void startNewSessionInProject(project);
            }}
            onThreadDeleted={() => {
              startNewSession();
            }}
            onSessionsChanged={() =>
              setSidebarRefreshKey((key) => key + 1)
            }
          />
        </aside>

        <TripleLayoutResizeHandle
          side="left"
          onResizeStart={beginTripleColumnResize}
          onResize={resizeTripleLeftColumn}
          onResizeEnd={endTripleColumnResize}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-zinc-950">
          <div
            ref={chatScrollRef}
            className="scrollbar-hide min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6"
          >
            <div className="mx-auto w-full max-w-3xl">
            {error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </p>
            )}
            {showNewChatHero ? (
              <AgentNewChatHero workspaceName={workspaceDisplayName} />
            ) : (
              <AgentEventTimeline
                events={events}
                running={running}
                chatMode
                showRestoreHint
                excludeEventTypes={["plan.updated"]}
                onFocusApproval={focusApproval}
                onApplyApproval={applyApprovalFromTurn}
                onRejectApproval={(id) => void resolveApproval(id, "rejected")}
                applyApprovalBusy={loadingApprovals}
                pendingCommandApprovalIds={pendingCommandApprovalIds}
                executedCommandApprovalIds={executedCommandApprovalIds}
                onApproveCommand={approveCommandFromTurn}
                onRejectCommand={(id) => void resolveApproval(id, "rejected")}
                commandApprovalBusy={loadingApprovals}
                showInlineFileChangeActions={false}
                onFixLintAfterWrite={(verification) =>
                  startLintFixLoop(verification)
                }
              />
            )}
            </div>
          </div>

          <input
            ref={referenceFileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => void onPickReferenceImages(e)}
          />
          <AgentRunStatusStrip events={events} running={running} />
          <AgentComposer
            request={request}
            onRequestChange={setRequest}
            onSubmit={handleSubmit}
            running={running}
            canRun={canRunTask}
            continueThreadMemory={continueThreadMemory}
            onContinueThreadMemoryChange={setContinueThreadMemory}
            currentThreadId={currentThreadId}
            workspacePicker={workspacePickerProps}
            referenceImages={referenceImages}
            onPickImages={() => referenceFileRef.current?.click()}
            onPasteReferenceImages={onPasteReferenceImages}
            onDropReferenceImages={(files) =>
              addReferenceImagesFromFiles(files, "drop")
            }
            onRemoveImage={(index) =>
              setReferenceImages((prev) => prev.filter((_, i) => i !== index))
            }
            maxReferenceImages={MAX_REFERENCE_IMAGES}
            attachedFiles={attachedFiles}
            onRemoveAttachedFile={(index) =>
              setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
            }
            maxAttachedFiles={MAX_ATTACHED_FILES}
            approvalStatus={approvalStatus}
            approvalStatusTone={approvalStatusTone}
            workspaceAtEnabled={Boolean(workspace?.rootPath)}
            recentAttachedPaths={recentAttachedPaths}
            reviewEditorSelection={reviewEditorSelection}
            onAgentPrefsChange={() => {
              setApprovalStatus(null);
            }}
            onCancel={cancelRunningLoop}
            onSendGuidance={sendGuidance}
          />
        </main>

        {tripleRightCollapsed ? (
          <div className="flex w-9 shrink-0 flex-col items-center border-l border-zinc-200 bg-zinc-50/50 pt-2 dark:border-zinc-800 dark:bg-zinc-900/40">
            <button
              type="button"
              onClick={showTripleRightPanel}
              title="显示右侧面板"
              aria-label="显示右侧面板"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-300"
            >
              <TripleRightPanelToggleIcon />
            </button>
          </div>
        ) : (
          <>
            <TripleLayoutResizeHandle
              side="right"
              onResizeStart={beginTripleColumnResize}
              onResize={resizeTripleRightColumn}
              onResizeEnd={endTripleColumnResize}
            />

            <aside
              className="flex shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40"
              style={{ width: tripleRightWidth }}
            >
              <AgentRightRail
                workspaceEnabled={Boolean(workspace?.rootPath)}
                onSelectFilePath={handleTreeSelectPath}
                treeHighlightPath={reviewHighlightPath}
                reviewPanel={reviewPanel}
                terminalPanel={
                  <AgentTerminalPanel
                    entries={terminalLogs}
                    visible={rightRailTab === "terminal"}
                    workspaceLabel={workspace?.rootPath ?? null}
                    interactiveEnabled={Boolean(workspace?.rootPath)}
                    onClear={() => setTerminalLogs([])}
                  />
                }
                pendingReviewCount={pendingReviewCount}
                tab={rightRailTab}
                onTabChange={setRightRailTab}
                onHideRightPanel={hideTripleRightPanel}
              />
            </aside>
          </>
        )}
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
        <div className="flex gap-2">
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder={
              running
                ? "运行中可追加引导…"
                : "描述要做的改动…"
            }
            disabled={false}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {running && (
            <button
              type="button"
              onClick={cancelRunningLoop}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              停止
            </button>
          )}
          <button
            type="submit"
            disabled={
              running
                ? !request.trim() || !currentThreadId
                : !canRunTask
            }
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          >
            {running ? "发送引导" : "运行"}
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
          <AgentEventTimeline
            events={events}
            running={running}
            onFocusApproval={focusApproval}
            onApplyApproval={applyApprovalFromTurn}
            onRejectApproval={(id) => void resolveApproval(id, "rejected")}
            applyApprovalBusy={loadingApprovals}
          />
          <aside className="flex min-h-[280px] min-w-0 flex-col lg:min-h-0">
            {approvalsPanel}
          </aside>
        </div>
      ) : (
        <>
          {approvalsPanel}
          <div className="min-h-0 flex-1 space-y-4 overflow-auto">
            <AgentEventTimeline
              events={events}
              running={running}
              onFocusApproval={focusApproval}
              onApplyApproval={applyApprovalFromTurn}
              onRejectApproval={(id) => void resolveApproval(id, "rejected")}
              applyApprovalBusy={loadingApprovals}
            />
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
