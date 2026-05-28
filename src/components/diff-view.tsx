"use client";

import { useMemo, useState } from "react";
import type { ApprovalContentSnapshot } from "@/agent/types";
import {
  capDiffRows,
  capSplitAlignedRows,
  computeLineDiff,
  toSplitAlignedRows,
  type DiffRow,
  type SplitDiffSide,
} from "@/lib/line-diff";

export type DiffLayout = "split" | "unified";

type DiffViewProps = {
  before?: ApprovalContentSnapshot | string;
  after?: ApprovalContentSnapshot | string;
  /** 仅展示有变化的行（隐藏 equal） */
  changesOnly?: boolean;
  maxRows?: number;
  className?: string;
  /** split：左右对照（默认，更接近 Codex/Cursor） */
  layout?: DiffLayout;
  showLayoutToggle?: boolean;
  /** split 模式是否显示行号 */
  showLineNumbers?: boolean;
};

function snapshotText(value?: ApprovalContentSnapshot | string): string {
  if (typeof value === "string") return value;
  return value?.text ?? "";
}

function rowClass(kind: DiffRow["kind"]): string {
  if (kind === "delete") {
    return "bg-red-500/15 text-red-800 dark:text-red-200";
  }
  if (kind === "insert") {
    return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
  }
  return "text-zinc-500 dark:text-zinc-400";
}

function splitSideClass(kind: SplitDiffSide["kind"]): string {
  if (kind === "delete") {
    return "bg-red-500/15 text-red-800 dark:text-red-200";
  }
  if (kind === "insert") {
    return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
  }
  if (kind === "empty") {
    return "bg-zinc-900/40 text-zinc-600";
  }
  return "text-zinc-500 dark:text-zinc-400";
}

function rowPrefix(kind: DiffRow["kind"]): string {
  if (kind === "delete") return "-";
  if (kind === "insert") return "+";
  return " ";
}

function formatLineNum(value: number | null): string {
  if (value == null) return "";
  return String(value);
}

function SplitCell({
  side,
  showLineNumbers,
}: {
  side: SplitDiffSide;
  showLineNumbers: boolean;
}) {
  if (side.kind === "empty") {
    return (
      <div className="grid min-h-[1.35em] grid-cols-[auto_1fr] border-b border-zinc-800/80 bg-zinc-900/40">
        {showLineNumbers && (
          <span className="w-9 shrink-0 border-r border-zinc-800/80 px-1.5 py-0.5 text-right font-mono text-[10px] text-zinc-600" />
        )}
        <div className="min-h-[1.35em]" />
      </div>
    );
  }

  return (
    <div
      className={`grid min-h-[1.35em] grid-cols-[auto_1fr] border-b border-zinc-800/80 font-mono text-[11px] leading-relaxed ${splitSideClass(side.kind)}`}
    >
      {showLineNumbers && (
        <span className="w-9 shrink-0 select-none border-r border-zinc-800/60 px-1.5 py-0.5 text-right text-[10px] text-zinc-500">
          {formatLineNum(side.lineNum)}
        </span>
      )}
      <div className="flex min-w-0 gap-2 px-2 py-0.5">
        <span className="w-3 shrink-0 select-none opacity-60">
          {side.kind === "equal"
            ? " "
            : side.kind === "delete"
              ? "-"
              : "+"}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
          {side.text || " "}
        </span>
      </div>
    </div>
  );
}

export function DiffView({
  before,
  after,
  changesOnly = true,
  maxRows = 120,
  className = "",
  layout: initialLayout = "split",
  showLayoutToggle = true,
  showLineNumbers = true,
}: DiffViewProps) {
  const [layout, setLayout] = useState<DiffLayout>(initialLayout);

  const { rows, splitRows, truncated, meta, hasBothSides } = useMemo(() => {
    const oldText = snapshotText(before);
    const newText = snapshotText(after);
    const diff = computeLineDiff(oldText, newText);
    const filtered = changesOnly
      ? diff.filter((row) => row.kind !== "equal")
      : diff;
    const capped = capDiffRows(filtered, maxRows);
    const aligned = toSplitAlignedRows(capped.rows);
    const cappedSplit = capSplitAlignedRows(aligned, maxRows);
    const beforeSnap =
      typeof before === "object" && before ? before : undefined;
    const afterSnap = typeof after === "object" && after ? after : undefined;
    return {
      rows: capped.rows,
      splitRows: cappedSplit.rows,
      truncated: capped.truncated || cappedSplit.truncated,
      hasBothSides: Boolean(oldText || newText),
      meta: {
        beforeTruncated: beforeSnap?.truncated,
        afterTruncated: afterSnap?.truncated,
      },
    };
  }, [after, before, changesOnly, maxRows]);

  if (!hasBothSides) {
    return (
      <p className={`text-[11px] text-zinc-500 ${className}`}>（无内容可对比）</p>
    );
  }

  if (rows.length === 0) {
    if (meta.beforeTruncated || meta.afterTruncated) {
      return (
        <p className={`text-[11px] text-zinc-500 ${className}`}>
          （快照已截断且未包含变更行；请看上方大小变化或展开原文）
        </p>
      );
    }
    return (
      <p className={`text-[11px] text-zinc-500 ${className}`}>（无行级差异）</p>
    );
  }

  const footer = (truncated || meta.beforeTruncated || meta.afterTruncated) && (
    <p className="border-t border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
      {truncated && "diff 行数已截断 · "}
      {meta.beforeTruncated && "变更前内容已截断 · "}
      {meta.afterTruncated && "变更后内容已截断"}
    </p>
  );

  return (
    <div className={`space-y-1 ${className}`}>
      {showLayoutToggle && (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setLayout("split")}
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
            onClick={() => setLayout("unified")}
            className={`rounded px-2 py-0.5 text-[10px] ${
              layout === "unified"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            统一 diff
          </button>
        </div>
      )}

      {layout === "split" ? (
        <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
          <div
            className={`grid border-b border-zinc-200 bg-zinc-100 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 ${
              showLineNumbers ? "grid-cols-2" : "grid-cols-2"
            }`}
          >
            <span className="border-r border-zinc-200 px-2 py-1 dark:border-zinc-700">
              Before
            </span>
            <span className="px-2 py-1">After</span>
          </div>
          <div className="max-h-64 overflow-auto bg-zinc-950">
            {splitRows.map((row, index) => (
              <div key={`split-${index}`} className="grid grid-cols-2">
                <SplitCell side={row.left} showLineNumbers={showLineNumbers} />
                <SplitCell side={row.right} showLineNumbers={showLineNumbers} />
              </div>
            ))}
          </div>
          {footer}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="max-h-64 overflow-auto bg-zinc-950 font-mono text-[11px] leading-relaxed">
            {rows.map((row, index) => (
              <div
                key={`${row.kind}-${index}`}
                className={`flex gap-2 px-2 py-0.5 ${rowClass(row.kind)}`}
              >
                <span className="w-3 shrink-0 select-none opacity-70">
                  {rowPrefix(row.kind)}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                  {row.line || " "}
                </span>
              </div>
            ))}
          </div>
          {footer}
        </div>
      )}
    </div>
  );
}
