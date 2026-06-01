"use client";

import type { AgentChangeChip } from "@/lib/agent-turn-feed";

type AgentChangeStripProps = {
  chips: AgentChangeChip[];
  onFocusApproval?: (approvalId: string) => void;
};

function chipClass(tone: AgentChangeChip["tone"]): string {
  if (tone === "pending") {
    return "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100";
  }
  if (tone === "applied") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
}

export function AgentChangeStrip({
  chips,
  onFocusApproval,
}: AgentChangeStripProps) {
  if (chips.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        变更
      </p>
      <ul className="space-y-1">
        {chips.map((chip) => (
          <li key={chip.id}>
            <button
              type="button"
              disabled={!chip.approvalId || !onFocusApproval}
              onClick={() => chip.approvalId && onFocusApproval?.(chip.approvalId)}
              className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11px] transition ${chipClass(chip.tone)} ${
                chip.approvalId && onFocusApproval
                  ? "hover:ring-1 hover:ring-blue-400/60"
                  : ""
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-mono" title={chip.path}>
                {chip.path}
              </span>
              <span className="shrink-0 text-[10px] opacity-80">{chip.label}</span>
              {chip.approvalId && onFocusApproval && (
                <span className="shrink-0 text-[10px] text-blue-600 dark:text-blue-400">
                  审查
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
