"use client";

import type { GitStatusFileEntry, GitStatusSnapshot } from "@/lib/git-status";
import {
  formatGitStatusFileLine,
  gitStatusBadgeLabel,
} from "@/lib/git-status";

function badgeClass(status: GitStatusFileEntry["status"]): string {
  switch (status) {
    case "added":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
    case "deleted":
      return "bg-red-500/15 text-red-800 dark:text-red-200";
    case "modified":
      return "bg-amber-500/15 text-amber-900 dark:text-amber-200";
    case "renamed":
    case "copied":
      return "bg-blue-500/15 text-blue-800 dark:text-blue-200";
    case "untracked":
      return "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";
    case "conflicted":
      return "bg-red-600/20 text-red-900 dark:text-red-100";
    default:
      return "bg-zinc-500/15 text-zinc-700";
  }
}

type GitStatusViewProps = {
  snapshot: GitStatusSnapshot;
  maxFiles?: number;
  compact?: boolean;
  className?: string;
};

/** Cursor/Codex 风格的 Git 状态文件列表。 */
export function GitStatusView({
  snapshot,
  maxFiles = 20,
  compact = false,
  className = "",
}: GitStatusViewProps) {
  const visible = snapshot.files.slice(0, maxFiles);
  const overflow = snapshot.files.length - visible.length;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {snapshot.detached
            ? "detached HEAD"
            : snapshot.branch ?? "—"}
        </span>
        {snapshot.upstream && (
          <span className="text-zinc-500 dark:text-zinc-400">
            → {snapshot.upstream}
          </span>
        )}
        {snapshot.ahead != null && snapshot.ahead > 0 && (
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-800 dark:text-blue-200">
            ↑{snapshot.ahead}
          </span>
        )}
        {snapshot.behind != null && snapshot.behind > 0 && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-900 dark:text-amber-200">
            ↓{snapshot.behind}
          </span>
        )}
        {!snapshot.dirty && (
          <span className="text-emerald-700 dark:text-emerald-300">clean</span>
        )}
      </div>

      {visible.length > 0 && (
        <ul
          className={
            compact
              ? "space-y-0.5 font-mono text-[10px] leading-relaxed text-zinc-700 dark:text-zinc-300"
              : "space-y-1 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300"
          }
        >
          {visible.map((file) => (
            <li key={`${file.path}-${file.previousPath ?? ""}`} className="flex min-w-0 gap-2">
              <span
                className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${badgeClass(file.status)}`}
                title={file.status}
              >
                {gitStatusBadgeLabel(file.status)}
              </span>
              <span className="min-w-0 break-all">{formatGitStatusFileLine(file).slice(3)}</span>
            </li>
          ))}
        </ul>
      )}

      {overflow > 0 && (
        <p className="text-[10px] text-zinc-500">… 还有 {overflow} 个文件</p>
      )}
    </div>
  );
}
