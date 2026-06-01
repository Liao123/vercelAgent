"use client";

import { useEffect, useMemo } from "react";
import { DiffView } from "@/components/diff-view";
import type { ApprovalDetails } from "@/agent/types";
import {
  collectReviewFileChanges,
  fileBasename,
  type FileChangeEntry,
} from "@/lib/approval-file-changes";
import { approvalAnchorId } from "@/lib/approval-anchor";

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
  execution?: {
    status: "succeeded" | "failed";
    attemptedAt: string;
    summary: string;
    error?: string;
  };
};

type AgentReviewPanelProps = {
  approvals: ReviewApproval[];
  currentTaskId?: string | null;
  loading: boolean;
  focusedApprovalId?: string | null;
  selectedFileKey: string | null;
  onSelectFile: (fileKey: string) => void;
  onReject: (id: string) => void;
  onApproveAndExecute: (approval: ReviewApproval) => void;
  onExecute: (approval: ReviewApproval) => void;
  pushConfirmId: string | null;
  needsPushSecondConfirm: (approval: ReviewApproval) => boolean;
};

function FileListItem({
  file,
  selected,
  onSelect,
}: {
  file: FileChangeEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
        selected
          ? "bg-blue-50 ring-1 ring-blue-300/80 dark:bg-blue-950/40 dark:ring-blue-800"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
      }`}
    >
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200"
        title={file.path}
      >
        {fileBasename(file.path)}
      </span>
      <span className="shrink-0 font-mono text-[10px]">
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

function ReviewDiff({ file }: { file: FileChangeEntry }) {
  if (file.patchFile) {
    return (
      <DiffView
        before={file.patchFile.oldContent}
        after={file.patchFile.newContent}
        changesOnly
        layout="split"
        className="max-h-[min(50vh,480px)]"
      />
    );
  }
  if (file.singleFileDiff) {
    return (
      <DiffView
        before={file.singleFileDiff.before}
        after={file.singleFileDiff.after}
        changesOnly
        layout="split"
        className="max-h-[min(50vh,480px)]"
      />
    );
  }
  return (
    <p className="px-2 py-4 text-center text-[11px] text-zinc-500">
      此文件暂无 diff 预览
    </p>
  );
}

export function AgentReviewPanel({
  approvals,
  currentTaskId,
  loading,
  focusedApprovalId,
  selectedFileKey,
  onSelectFile,
  onReject,
  onApproveAndExecute,
  onExecute,
  pushConfirmId,
  needsPushSecondConfirm,
}: AgentReviewPanelProps) {
  const review = useMemo(
    () => collectReviewFileChanges(approvals, currentTaskId),
    [approvals, currentTaskId],
  );

  const activeApproval = useMemo(() => {
    if (!review.approvalId) return null;
    return approvals.find((a) => a.id === review.approvalId) ?? null;
  }, [approvals, review.approvalId]);

  const selectedFile = useMemo(
    () => review.files.find((f) => f.fileKey === selectedFileKey) ?? review.files[0],
    [review.files, selectedFileKey],
  );

  useEffect(() => {
    if (review.files.length === 0) return;
    const exists = review.files.some((f) => f.fileKey === selectedFileKey);
    if (!exists && review.files[0]) {
      onSelectFile(review.files[0].fileKey);
    }
  }, [review.files, selectedFileKey, onSelectFile]);

  const highlighted = Boolean(
    focusedApprovalId && focusedApprovalId === review.approvalId,
  );

  return (
    <section
      className={`flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950 ${
        highlighted ? "ring-2 ring-inset ring-blue-500/60" : ""
      }`}
    >
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
            审查
          </h3>
          {review.files.length > 0 && (
            <span className="font-mono text-[10px] text-zinc-500">
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
        </div>
        {activeApproval && (
          <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-500">
            {activeApproval.title}
          </p>
        )}
      </div>

      {review.files.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[11px] text-zinc-500">
          暂无待审查的文件变更
        </p>
      ) : (
        <>
          <div className="shrink-0 max-h-[40%] overflow-auto border-b border-zinc-100 px-2 py-2 dark:border-zinc-800">
            <ul className="space-y-0.5">
              {review.files.map((file) => (
                <li key={file.fileKey}>
                  <FileListItem
                    file={file}
                    selected={selectedFile?.fileKey === file.fileKey}
                    onSelect={() => onSelectFile(file.fileKey)}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            {selectedFile && (
              <>
                <p
                  className="mb-1 truncate font-mono text-[10px] text-zinc-500"
                  title={selectedFile.path}
                >
                  {selectedFile.path}
                </p>
                <ReviewDiff file={selectedFile} />
              </>
            )}
          </div>

          {activeApproval && (
            <div
              id={approvalAnchorId(activeApproval.id)}
              className="shrink-0 flex flex-wrap gap-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              {activeApproval.status === "pending" && (
                <>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onReject(activeApproval.id)}
                    className="rounded-md border border-zinc-300 px-2.5 py-1 text-[11px] disabled:opacity-50 dark:border-zinc-600"
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    disabled={loading || !activeApproval.details}
                    onClick={() => onApproveAndExecute(activeApproval)}
                    className="ml-auto rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    批准并执行
                  </button>
                </>
              )}
              {activeApproval.status === "approved" &&
                activeApproval.execution?.status !== "succeeded" && (
                  <button
                    type="button"
                    disabled={loading || !activeApproval.details}
                    onClick={() => onExecute(activeApproval)}
                    className="ml-auto rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    {needsPushSecondConfirm(activeApproval) &&
                    pushConfirmId === activeApproval.id
                      ? "确认 Push"
                      : "执行"}
                  </button>
                )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
