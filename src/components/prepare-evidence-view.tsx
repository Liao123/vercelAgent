"use client";

import type { ApprovalPrepareEvidence } from "@/agent/types";

type PrepareEvidenceViewProps = {
  evidence: ApprovalPrepareEvidence;
  compact?: boolean;
};

export function PrepareEvidenceView({
  evidence,
  compact = false,
}: PrepareEvidenceViewProps) {
  const lineLabel =
    evidence.startLine === evidence.endLine
      ? `L${evidence.startLine}`
      : `L${evidence.startLine}–${evidence.endLine}`;

  return (
    <div
      className={
        compact
          ? "rounded-md border border-amber-200/80 bg-amber-50/80 p-2 dark:border-amber-900/50 dark:bg-amber-950/30"
          : "space-y-1.5 rounded-md border border-amber-200/80 bg-amber-50/80 p-2.5 dark:border-amber-900/50 dark:bg-amber-950/30"
      }
    >
      <p className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
        变更依据 · {evidence.path} · {lineLabel}
      </p>
      {evidence.searchText && (
        <p className="text-[10px] text-amber-800/90 dark:text-amber-300/90">
          exact search:{" "}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono dark:bg-black/30">
            {evidence.searchText.length > 120
              ? `${evidence.searchText.slice(0, 120)}…`
              : evidence.searchText}
          </code>
        </p>
      )}
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/80 p-2 font-mono text-[10px] leading-relaxed text-zinc-800 dark:bg-black/25 dark:text-zinc-200">
        {evidence.matchedSnippet}
      </pre>
    </div>
  );
}
