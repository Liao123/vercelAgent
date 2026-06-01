"use client";

import { useMemo, useState } from "react";
import type { AgentEvent } from "@/agent/types";
import { getLatestCompactedMemoryContent } from "@/lib/agent-feed";
import { formatCompactMethod } from "@/lib/compaction-labels";
import {
  buildThreadMemoryMarkdown,
  copyTextToClipboard,
  downloadTextFile,
} from "@/lib/export-thread-memory";
import { AGENT_COMPACTED_MEMORY_PANEL_ID } from "@/lib/approval-anchor";

type AgentCompactedMemoryPanelProps = {
  events: AgentEvent[];
  /** 直接传入完整记忆（Trace API / thread-memory API） */
  memoryContent?: string | null;
  compact?: boolean;
  highlighted?: boolean;
};

export function AgentCompactedMemoryPanel({
  events,
  memoryContent: memoryContentProp,
  compact = false,
  highlighted = false,
}: AgentCompactedMemoryPanelProps) {
  const [expanded, setExpanded] = useState(!compact);
  const [exportHint, setExportHint] = useState<string | null>(null);
  const fromEvents = useMemo(
    () => getLatestCompactedMemoryContent(events),
    [events],
  );
  const memoryContent = memoryContentProp ?? fromEvents?.memoryContent ?? null;
  const meta = fromEvents;

  if (!memoryContent) return null;

  return (
    <section
      id={AGENT_COMPACTED_MEMORY_PANEL_ID}
      className={`shrink-0 rounded-lg border border-blue-200/90 bg-blue-50/50 dark:border-blue-900/60 dark:bg-blue-950/25 ${
        compact ? "px-2 py-1.5" : "px-3 py-2"
      } ${
        highlighted
          ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-blue-900 dark:text-blue-200">
            滚动任务记忆
            {meta?.round != null ? ` · 第 ${meta.round} 轮` : ""}
            {meta?.method ? ` · ${formatCompactMethod(meta.method)}` : ""}
          </p>
          {!expanded && meta?.summaryPreview && (
            <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[10px] text-blue-900/80 dark:text-blue-200/70">
              {meta.summaryPreview}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void copyTextToClipboard(memoryContent).then(() => {
              setExportHint("已复制");
              setTimeout(() => setExportHint(null), 2000);
            })}
            className="text-[10px] font-medium text-blue-700 hover:underline dark:text-blue-300"
          >
            复制
          </button>
          <button
            type="button"
            onClick={() => {
              const md = buildThreadMemoryMarkdown("task-memory", memoryContent, {
                threadId: meta?.threadId,
                round: meta?.round ?? undefined,
                method: meta?.method,
              });
              downloadTextFile(
                `agent-memory-${meta?.threadId?.slice(0, 8) ?? "export"}.md`,
                md,
              );
              setExportHint("已下载 .md");
              setTimeout(() => setExportHint(null), 2000);
            }}
            className="text-[10px] font-medium text-blue-700 hover:underline dark:text-blue-300"
          >
            导出
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[10px] font-medium text-blue-700 hover:underline dark:text-blue-300"
          >
            {expanded ? "收起" : "展开"}
          </button>
        </div>
      </div>
      {exportHint && (
        <p className="text-[10px] text-blue-700 dark:text-blue-300">{exportHint}</p>
      )}
      {expanded && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-blue-100/80 bg-white/80 p-2 font-mono text-[10px] leading-relaxed text-zinc-800 dark:border-blue-900/40 dark:bg-zinc-950/60 dark:text-zinc-200">
          {memoryContent}
        </pre>
      )}
    </section>
  );
}
