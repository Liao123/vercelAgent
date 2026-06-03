"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApprovalDetails } from "@/agent/types";
import {
  collectReviewDisplay,
  fileBasename,
  type FileChangeEntry,
} from "@/lib/approval-file-changes";
import type { GitStatusFileEntry } from "@/lib/git-status";
import { approvalAnchorId } from "@/lib/approval-anchor";
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
  /** 双击文件行：在右侧「文件」树中定位 */
  onRevealInTree?: (path: string) => void;
  /** 选中文件时同步文件树高亮（不切换 Tab） */
  onFileHighlight?: (path: string) => void;
  /** 仅当审批仍为 pending（未自动写盘 / 高风险）时显示；对齐 Cursor 直接改，无按文件接受 */
  reviewActions?: {
    approvalId: string;
    busy?: boolean;
    onAccept: (approvalId: string) => void;
    onReject: (approvalId: string) => void;
  } | null;
  embedded?: boolean;
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
          ? `${file.path}\n双击在文件树中定位`
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
      {dir && (
        <span className="sr-only">{dir}</span>
      )}
    </button>
  );
}

function GitReviewDiffPane({ path }: { path: string }) {
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
    <ReviewEditorDiff before={before} after={after} filePath={path} />
  );
}

function ReviewDiffPane({ file }: { file: FileChangeEntry }) {
  if (file.fileKey.startsWith("git:")) {
    return <GitReviewDiffPane path={file.path} />;
  }
  if (file.patchFile) {
    return (
      <ReviewEditorDiff
        before={file.patchFile.oldContent}
        after={file.patchFile.newContent}
        filePath={file.path}
        additions={file.additions}
        deletions={file.deletions}
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
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
      <p className="text-[10px] text-zinc-500">
        {fileCount} 个文件待确认
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] text-zinc-600 transition hover:bg-white disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          拒绝
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "写入中…" : "接受"}
        </button>
      </div>
    </div>
  );
}

function reviewEmptyHint(gitFiles?: GitStatusFileEntry[]): string {
  if (gitFiles && gitFiles.length > 0) {
    return "未找到可展示的 diff，请在「文件」Tab 中查看该路径。";
  }
  return "暂无待审查内容。Agent 文件变更默认会自动写入（可在输入框 ⚙ 关闭）；此处用于预览 diff。手动编辑需 Git 仓库且有未提交改动。";
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
  reviewActions = null,
  embedded = false,
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

  const selectedFile = useMemo(() => {
    if (!selectedFileKey) return null;
    return review.files.find((f) => f.fileKey === selectedFileKey) ?? null;
  }, [review.files, selectedFileKey]);

  useEffect(() => {
    if (!selectedFileKey) return;
    if (review.files.length === 0) {
      onSelectFile(null);
      return;
    }
    const exists = review.files.some((f) => f.fileKey === selectedFileKey);
    if (!exists) onSelectFile(null);
  }, [review.files, selectedFileKey, onSelectFile]);

  const highlighted = Boolean(
    focusedApprovalId && focusedApprovalId === review.approvalId,
  );

  const anchorId = review.approvalId
    ? approvalAnchorId(review.approvalId)
    : undefined;

  return (
    <section
      id={anchorId}
      className={`flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950 ${
        highlighted ? "ring-2 ring-inset ring-blue-500/50" : ""
      }`}
    >
      {!embedded && review.files.length > 0 && (
        <div className="shrink-0 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
          <p className="text-[10px] text-zinc-500">
            {review.source === "git" ? "工作区 " : ""}
            {review.files.length} 个文件
            {review.source === "git" && (
              <span className="ml-1 text-zinc-400">（Git，只读）</span>
            )}
            {(review.totalAdditions > 0 || review.totalDeletions > 0) && (
              <span className="ml-2 font-mono">
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
      )}

      {review.files.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[11px] leading-relaxed text-zinc-500">
          {reviewEmptyHint(gitFiles)}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-zinc-100 px-2 py-2 dark:border-zinc-800">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {review.files.map((file) => {
                const isSelected = selectedFile?.fileKey === file.fileKey;
                return (
                  <FileChip
                    key={file.fileKey}
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
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {selectedFile ? (
              <ReviewDiffPane file={selectedFile} />
            ) : (
              <p className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-zinc-500">
                点击上方文件查看 diff
              </p>
            )}
          </div>
          {review.source === "approval" &&
            reviewActions &&
            reviewActions.approvalId === review.approvalId && (
              <ReviewActionBar
                fileCount={review.files.length}
                busy={reviewActions.busy}
                onAccept={() => reviewActions.onAccept(reviewActions.approvalId)}
                onReject={() => reviewActions.onReject(reviewActions.approvalId)}
              />
            )}
        </div>
      )}
    </section>
  );
}
