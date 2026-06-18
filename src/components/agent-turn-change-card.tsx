"use client";

import { useState } from "react";
import {
  type TurnFileChangeSummary,
} from "@/lib/approval-file-changes";
import { PostExecuteVerificationView } from "@/components/post-execute-verification-view";
import type { PostExecuteVerification } from "@/agent/verification";
import {
  TURN_CHANGE_APPLY,
  TURN_CHANGE_APPLY_BUSY,
  TURN_CHANGE_DISCARD,
} from "@/lib/review-empty-hint";

const PRIMARY_COUNT = 3;

type AgentTurnChangeCardProps = {
  summary: TurnFileChangeSummary;
  onReview?: (approvalId: string, filePath?: string) => void;
  onApply?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
  applyBusy?: boolean;
  /** 三栏模式：写盘在审查区/自动完成，中栏不重复「接受」按钮（对齐 Cursor 直接改） */
  showInlineActions?: boolean;
  postExecuteVerification?: PostExecuteVerification | null;
  onFixLint?: () => void;
};

function DiffStats({
  additions,
  deletions,
  className = "",
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className={`font-mono text-[11px] tabular-nums ${className}`}>
      {additions > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
      )}
      {additions > 0 && deletions > 0 && " "}
      {deletions > 0 && (
        <span className="text-red-600 dark:text-red-400">-{deletions}</span>
      )}
    </span>
  );
}

function FileRow({
  path,
  additions,
  deletions,
  onClick,
}: {
  path: string;
  additions: number;
  deletions: number;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-300"
        title={path}
      >
        {path}
      </span>
      <DiffStats additions={additions} deletions={deletions} className="shrink-0" />
    </>
  );

  const rowClass =
    "flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${rowClass} hover:bg-zinc-50 dark:hover:bg-zinc-800/50`}
      >
        {content}
        <span className="shrink-0 text-[10px] text-blue-600 dark:text-blue-400">
          在审查中查看
        </span>
      </button>
    );
  }

  return <div className={rowClass}>{content}</div>;
}

export function AgentTurnChangeCard({
  summary,
  onReview,
  onApply,
  onReject,
  applyBusy = false,
  showInlineActions = true,
  postExecuteVerification = null,
  onFixLint,
}: AgentTurnChangeCardProps) {
  const [showAll, setShowAll] = useState(false);
  const { files, totalAdditions, totalDeletions, approvalId, status } = summary;
  if (files.length === 0) return null;

  const primary = files.slice(0, PRIMARY_COUNT);
  const secondary = files.slice(PRIMARY_COUNT);
  const visible = showAll ? files : primary;
  const isPending = status === "pending" && Boolean(approvalId);

  return (
    <article className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900/40">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
            {status === "applied" ? "已写入" : "已编辑"}{" "}
            {files.length} 个文件
            <DiffStats
              additions={totalAdditions}
              deletions={totalDeletions}
              className="ml-2 inline"
            />
          </p>
        </div>
        {isPending && approvalId && !showInlineActions && (
          <p className="shrink-0 text-[11px] text-zinc-500">
            右侧审查 · 应用更改
          </p>
        )}
        {isPending && approvalId && showInlineActions && (
          <div className="flex shrink-0 items-center gap-2">
            {onReject && (
              <button
                type="button"
                disabled={applyBusy}
                onClick={() => onReject(approvalId)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {TURN_CHANGE_DISCARD}
              </button>
            )}
            {onApply && (
              <button
                type="button"
                disabled={applyBusy}
                onClick={() => onApply(approvalId)}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {applyBusy ? TURN_CHANGE_APPLY_BUSY : TURN_CHANGE_APPLY}
              </button>
            )}
          </div>
        )}
      </div>

      <ul className="border-t border-zinc-100 px-1.5 py-1 dark:border-zinc-800">
        {visible.map((file) => (
          <li key={file.fileKey}>
            <FileRow
              path={file.path}
              additions={file.additions}
              deletions={file.deletions}
              onClick={
                approvalId && onReview
                  ? () => onReview(approvalId, file.path)
                  : undefined
              }
            />
          </li>
        ))}
      </ul>

      {secondary.length > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-zinc-100 px-4 py-2 text-left text-[12px] text-zinc-500 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
        >
          再显示 {secondary.length} 个文件
        </button>
      )}
      {showAll && secondary.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="w-full border-t border-zinc-100 px-4 py-2 text-left text-[12px] text-zinc-500 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
        >
          收起
        </button>
      )}

      {postExecuteVerification?.triggered && (
        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <PostExecuteVerificationView
            verification={postExecuteVerification}
            compact
            onFixLint={onFixLint}
          />
        </div>
      )}
    </article>
  );
}
