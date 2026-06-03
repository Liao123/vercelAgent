"use client";

import { useCallback, useState } from "react";
import type { ApprovalContentSnapshot } from "@/agent/types";
import { DiffView, type DiffLayout } from "@/components/diff-view";
import {
  readReviewDiffChangesOnly,
  readReviewDiffLayout,
  writeReviewDiffChangesOnly,
  writeReviewDiffLayout,
} from "@/lib/agent-review-diff-prefs";

type ReviewEditorDiffProps = {
  before?: ApprovalContentSnapshot | string;
  after?: ApprovalContentSnapshot | string;
  filePath?: string;
  additions?: number;
  deletions?: number;
  className?: string;
};

/** 审查区全高 diff：布局/仅变更行偏好持久化，更接近 IDE 内嵌预览。 */
export function ReviewEditorDiff({
  before,
  after,
  filePath,
  additions = 0,
  deletions = 0,
  className = "",
}: ReviewEditorDiffProps) {
  const [layout, setLayout] = useState<DiffLayout>(() => readReviewDiffLayout());
  const [changesOnly, setChangesOnly] = useState(() =>
    readReviewDiffChangesOnly(),
  );

  const onLayoutChange = useCallback((next: DiffLayout) => {
    setLayout(next);
    writeReviewDiffLayout(next);
  }, []);

  const onChangesOnlyChange = useCallback((next: boolean) => {
    setChangesOnly(next);
    writeReviewDiffChangesOnly(next);
  }, []);

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50/90 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/80">
        {filePath && (
          <p
            className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-600 dark:text-zinc-400"
            title={filePath}
          >
            {filePath}
          </p>
        )}
        {(additions > 0 || deletions > 0) && (
          <span className="shrink-0 font-mono text-[10px]">
            {additions > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">
                +{additions}
              </span>
            )}
            {additions > 0 && deletions > 0 && " "}
            {deletions > 0 && (
              <span className="text-red-600 dark:text-red-400">-{deletions}</span>
            )}
          </span>
        )}
        <div className="flex shrink-0 flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onChangesOnlyChange(!changesOnly)}
            className={`rounded px-2 py-0.5 text-[10px] ${
              changesOnly
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            仅变更行
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange("split")}
            className={`rounded px-2 py-0.5 text-[10px] ${
              layout === "split"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            左右对照
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange("unified")}
            className={`rounded px-2 py-0.5 text-[10px] ${
              layout === "unified"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            统一 diff
          </button>
        </div>
      </div>
      <DiffView
        before={before}
        after={after}
        changesOnly={changesOnly}
        layout={layout}
        showLayoutToggle={false}
        fillHeight
        className="min-h-0 flex-1"
      />
    </div>
  );
}
