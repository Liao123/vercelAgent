"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApprovalDetails } from "@/agent/types";
import {
  collectReviewDisplay,
  fileBasename,
  type FileChangeEntry,
  type ReviewDisplay,
} from "@/lib/approval-file-changes";
import type { GitStatusFileEntry } from "@/lib/git-status";
import type { ReviewEditorSelection } from "@/lib/review-editor-selection";
import { approvalAnchorId } from "@/lib/approval-anchor";
import {
  buildReviewEmptyHint,
  REVIEW_ACTION_APPLY,
  REVIEW_ACTION_APPLY_BUSY,
  REVIEW_ACTION_DISCARD,
} from "@/lib/review-empty-hint";
import { ReviewEditorDiff } from "@/components/review-editor-diff";

type ReviewApproval = {
  id: string;
  taskId: string;
  title: string;
  reason: string;
  risk: "low" | "medium" | "high";
  action: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  details?: ApprovalDetails;
};

type AgentReviewPanelProps = {
  approvals: ReviewApproval[];
  currentTaskId?: string | null;
  focusedApprovalId?: string | null;
  gitFiles?: GitStatusFileEntry[];
  selectedFileKey: string | null;
  onSelectFile: (fileKey: string | null) => void;
  onRevealInTree?: (path: string) => void;
  onFileHighlight?: (path: string) => void;
  onEditorSelectionChange?: (selection: ReviewEditorSelection | null) => void;
  reviewActions?: {
    approvalId: string;
    busy?: boolean;
    onAccept: (approvalId: string) => void;
    onReject: (approvalId: string) => void;
  } | null;
  embedded?: boolean;
  autoApplyEnabled?: boolean;
};

function fileDirHint(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 1) return null;
  parts.pop();
  const dir = parts.join("/");
  return dir.length > 28 ? `…${dir.slice(-27)}` : dir;
}

function FileChip({
  file,
  selected,
  onSelect,
  onRevealInTree,
}: {
  file: FileChangeEntry;
  selected: boolean;
  onSelect: () => void;
  onRevealInTree?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.preventDefault();
        onRevealInTree?.();
      }}
      title={
        onRevealInTree
          ? `${file.path}\n双击在文件树中定位（未写入磁盘的变更可能无法展开）`
          : file.path
      }
      className={`inline-flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-left transition ${
        selected
          ? "border-zinc-400 bg-zinc-200/90 dark:border-zinc-500 dark:bg-zinc-700/90"
          : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
      }`}
    >
      <span className="min-w-0 truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
        {fileBasename(file.path)}
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums">
        {file.additions > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">
            +{file.additions}
          </span>
        )}
        {file.additions > 0 && file.deletions > 0 && " "}
        {file.deletions > 0 && (
          <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
        )}
      </span>
    </button>
  );
}

function FileListRow({
  file,
  selected,
  onSelect,
  onRevealInTree,
}: {
  file: FileChangeEntry;
  selected: boolean;
  onSelect: () => void;
  onRevealInTree?: () => void;
}) {
  const dir = fileDirHint(file.path);

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.preventDefault();
        onRevealInTree?.();
      }}
      title={
        onRevealInTree
          ? `${file.path}\n双击在文件树中定位（未写入磁盘的变更可能无法展开）`
          : file.path
      }
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition ${
        selected
          ? "bg-blue-500/10 ring-1 ring-inset ring-blue-500/40 dark:bg-blue-500/15"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          selected ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
          {fileBasename(file.path)}
        </span>
        {dir && (
          <span className="block truncate text-[10px] text-zinc-400">{dir}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums">
        {file.additions > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">
            +{file.additions}
          </span>
        )}
        {file.additions > 0 && file.deletions > 0 && " "}
        {file.deletions > 0 && (
          <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
        )}
      </span>
    </button>
  );
}

function ReviewPanelHeader({
  review,
  pendingApprovalCount,
  hasActions,
  fileNav,
}: {
  review: ReviewDisplay;
  pendingApprovalCount: number;
  hasActions: boolean;
  fileNav?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200/90 bg-gradient-to-b from-zinc-50 to-zinc-50/40 px-3 py-2.5 dark:border-zinc-800 dark:from-zinc-900/80 dark:to-zinc-950/40">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-[12px] font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">
            代码审查
          </h3>
          {pendingApprovalCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-200">
              {pendingApprovalCount} 待确认
            </span>
          )}
          {hasActions && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              可应用更改
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-zinc-500">
          {review.source === "git" ? "Git 工作区（只读）" : "Agent 变更"}
          {review.files.length > 0 && ` · ${review.files.length} 个文件`}
          {(review.totalAdditions > 0 || review.totalDeletions > 0) && (
            <span className="ml-1 font-mono">
              {review.totalAdditions > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{review.totalAdditions}
                </span>
              )}
              {review.totalAdditions > 0 && review.totalDeletions > 0 && " "}
              {review.totalDeletions > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  -{review.totalDeletions}
                </span>
              )}
            </span>
          )}
        </p>
      </div>
      {fileNav}
    </div>
  );
}

function ReviewFileNav({
  files,
  selectedFileKey,
  onSelectFile,
  onFileHighlight,
}: {
  files: FileChangeEntry[];
  selectedFileKey: string | null;
  onSelectFile: (fileKey: string | null) => void;
  onFileHighlight?: (path: string) => void;
}) {
  if (files.length <= 1) return null;

  const index = files.findIndex((f) => f.fileKey === selectedFileKey);
  const safeIndex = index >= 0 ? index : 0;

  const go = (nextIndex: number) => {
    const file = files[nextIndex];
    if (!file) return;
    onSelectFile(file.fileKey);
    onFileHighlight?.(file.path);
  };

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-200/80 bg-white/80 px-1 dark:border-zinc-700 dark:bg-zinc-900/80">
      <button
        type="button"
        disabled={safeIndex <= 0}
        onClick={() => go(safeIndex - 1)}
        className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
        aria-label="上一个文件"
      >
        ←
      </button>
      <span className="font-mono text-[10px] tabular-nums text-zinc-400">
        {safeIndex + 1}/{files.length}
      </span>
      <button
        type="button"
        disabled={safeIndex >= files.length - 1}
        onClick={() => go(safeIndex + 1)}
        className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
        aria-label="下一个文件"
      >
        →
      </button>
    </div>
  );
}

function GitReviewDiffPane({
  path,
  onEditorSelectionChange,
}: {
  path: string;
  onEditorSelectionChange?: (selection: ReviewEditorSelection | null) => void;
}) {
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/agent/workspace/file-diff?path=${encodeURIComponent(path)}`,
        );
        const data = (await res.json()) as {
          before?: string;
          after?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "无法加载 diff");
          return;
        }
        setBefore(data.before ?? "");
        setAfter(data.after ?? "");
      } catch {
        if (!cancelled) setError("无法加载 diff");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loading) {
    return (
      <p className="flex flex-1 items-center justify-center px-4 text-[11px] text-zinc-500">
        正在加载 Git diff…
      </p>
    );
  }
  if (error) {
    return (
      <p className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-zinc-500">
        {error}
      </p>
    );
  }
  return (
    <ReviewEditorDiff
      before={before}
      after={after}
      filePath={path}
      onEditorSelectionChange={(sel) => {
        if (!sel) {
          onEditorSelectionChange?.(null);
          return;
        }
        onEditorSelectionChange?.({ path, ...sel });
      }}
    />
  );
}

function ReviewDiffPane({
  file,
  onEditorSelectionChange,
}: {
  file: FileChangeEntry;
  onEditorSelectionChange?: (selection: ReviewEditorSelection | null) => void;
}) {
  if (file.fileKey.startsWith("git:")) {
    return (
      <GitReviewDiffPane
        path={file.path}
        onEditorSelectionChange={onEditorSelectionChange}
      />
    );
  }
  const relay = (sel: ReviewEditorSelection | null) => {
    if (!sel) {
      onEditorSelectionChange?.(null);
      return;
    }
    onEditorSelectionChange?.({ ...sel, path: file.path });
  };
  if (file.patchFile) {
    return (
      <ReviewEditorDiff
        before={file.patchFile.oldContent}
        after={file.patchFile.newContent}
        filePath={file.path}
        additions={file.additions}
        deletions={file.deletions}
        onEditorSelectionChange={(sel) => {
          if (!sel) {
            relay(null);
            return;
          }
          relay({ path: file.path, ...sel });
        }}
      />
    );
  }
  if (file.singleFileDiff) {
    return (
      <ReviewEditorDiff
        before={file.singleFileDiff.before}
        after={file.singleFileDiff.after}
        filePath={file.path}
        additions={file.additions}
        deletions={file.deletions}
        onEditorSelectionChange={(sel) => {
          if (!sel) {
            relay(null);
            return;
          }
          relay({ path: file.path, ...sel });
        }}
      />
    );
  }
  return (
    <p className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-zinc-500">
      此文件暂无 diff 预览
    </p>
  );
}

function ReviewActionBar({
  fileCount,
  busy,
  onAccept,
  onReject,
}: {
  fileCount: number;
  busy?: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-100/95 px-3 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-700 dark:bg-zinc-900/95 dark:shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
      <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
        {fileCount} 个文件 · 确认 diff 后应用
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="rounded-lg border border-zinc-300/90 bg-white px-3.5 py-2 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          {REVIEW_ACTION_DISCARD}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? REVIEW_ACTION_APPLY_BUSY : REVIEW_ACTION_APPLY}
        </button>
      </div>
    </div>
  );
}

export function AgentReviewPanel({
  approvals,
  currentTaskId,
  focusedApprovalId,
  gitFiles,
  selectedFileKey,
  onSelectFile,
  onRevealInTree,
  onFileHighlight,
  onEditorSelectionChange,
  reviewActions = null,
  embedded = false,
  autoApplyEnabled = false,
}: AgentReviewPanelProps) {
  const review = useMemo(
    () =>
      collectReviewDisplay(
        approvals,
        currentTaskId,
        focusedApprovalId,
        gitFiles,
      ),
    [approvals, currentTaskId, focusedApprovalId, gitFiles],
  );

  const pendingApprovalCount = useMemo(
    () => approvals.filter((a) => a.status === "pending").length,
    [approvals],
  );

  const hasReviewActions =
    review.source === "approval" &&
    reviewActions != null &&
    reviewActions.approvalId === review.approvalId;

  const selectedFile = useMemo(() => {
    if (!selectedFileKey) return null;
    return review.files.find((f) => f.fileKey === selectedFileKey) ?? null;
  }, [review.files, selectedFileKey]);

  useEffect(() => {
    if (review.files.length === 0) {
      if (selectedFileKey) onSelectFile(null);
      return;
    }
    const exists =
      selectedFileKey &&
      review.files.some((f) => f.fileKey === selectedFileKey);
    if (!exists) {
      const first = review.files[0]!;
      onSelectFile(first.fileKey);
      onFileHighlight?.(first.path);
    }
  }, [
    review.files,
    review.approvalId,
    review.source,
    selectedFileKey,
    onSelectFile,
    onFileHighlight,
  ]);

  useEffect(() => {
    onEditorSelectionChange?.(null);
  }, [selectedFileKey, onEditorSelectionChange]);

  const highlighted = Boolean(
    focusedApprovalId && focusedApprovalId === review.approvalId,
  );

  const anchorId = review.approvalId
    ? approvalAnchorId(review.approvalId)
    : undefined;

  const fileNav =
    review.files.length > 1 ? (
      <ReviewFileNav
        files={review.files}
        selectedFileKey={selectedFile?.fileKey ?? selectedFileKey}
        onSelectFile={onSelectFile}
        onFileHighlight={onFileHighlight}
      />
    ) : null;

  return (
    <section
      id={anchorId}
      className={`flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950 ${
        highlighted ? "ring-2 ring-inset ring-blue-500/40" : ""
      }`}
    >
      {(embedded || review.files.length > 0) && (
        <ReviewPanelHeader
          review={review}
          pendingApprovalCount={pendingApprovalCount}
          hasActions={hasReviewActions}
          fileNav={fileNav}
        />
      )}

      {review.files.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 py-10 text-center text-[11px] leading-relaxed text-zinc-500">
          {buildReviewEmptyHint({
            pendingApprovalCount,
            gitDirtyCount: gitFiles?.length ?? 0,
            autoApplyEnabled,
          })}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={`shrink-0 border-b border-zinc-100 dark:border-zinc-800 ${
              embedded ? "max-h-[32%] overflow-y-auto px-1.5 py-1.5" : "px-2 py-2"
            }`}
          >
            {embedded ? (
              <ul className="space-y-0.5">
                {review.files.map((file, fileIndex) => {
                  const isSelected = selectedFile?.fileKey === file.fileKey;
                  return (
                    <li key={`${file.fileKey}-${fileIndex}`}>
                      <FileListRow
                        file={file}
                        selected={isSelected}
                        onSelect={() => {
                          onSelectFile(file.fileKey);
                          onFileHighlight?.(file.path);
                        }}
                        onRevealInTree={
                          onRevealInTree
                            ? () => onRevealInTree(file.path)
                            : undefined
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {review.files.map((file, fileIndex) => {
                  const isSelected = selectedFile?.fileKey === file.fileKey;
                  return (
                    <FileChip
                      key={`${file.fileKey}-${fileIndex}`}
                      file={file}
                      selected={isSelected}
                      onSelect={() => {
                        if (isSelected) {
                          onSelectFile(null);
                          return;
                        }
                        onSelectFile(file.fileKey);
                        onFileHighlight?.(file.path);
                      }}
                      onRevealInTree={
                        onRevealInTree
                          ? () => onRevealInTree(file.path)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-zinc-50/50 dark:bg-zinc-900/20">
            {selectedFile ? (
              <ReviewDiffPane
                file={selectedFile}
                onEditorSelectionChange={onEditorSelectionChange}
              />
            ) : (
              <p className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-zinc-500">
                选择左侧文件查看 diff
              </p>
            )}
          </div>

          {hasReviewActions && (
            <ReviewActionBar
              fileCount={review.files.length}
              busy={reviewActions!.busy}
              onAccept={() => reviewActions!.onAccept(reviewActions!.approvalId)}
              onReject={() => reviewActions!.onReject(reviewActions!.approvalId)}
            />
          )}
        </div>
      )}
    </section>
  );
}
