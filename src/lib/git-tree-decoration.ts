import {
  type GitFileChangeStatus,
  type GitStatusFileEntry,
  gitStatusBadgeLabel,
} from "@/lib/git-status";

export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** 相对路径 → Git 状态（含 rename 的旧路径）。 */
export function buildGitStatusPathMap(
  files: GitStatusFileEntry[],
): Map<string, GitStatusFileEntry> {
  const map = new Map<string, GitStatusFileEntry>();
  for (const file of files) {
    map.set(normalizeRepoPath(file.path), file);
    if (file.previousPath) {
      map.set(normalizeRepoPath(file.previousPath), file);
    }
  }
  return map;
}

export function gitTreeNameClass(status: GitFileChangeStatus): string {
  switch (status) {
    case "modified":
      return "text-amber-700 dark:text-[#c9a86a]";
    case "added":
      return "text-emerald-700 dark:text-emerald-400";
    case "deleted":
      return "text-red-600/90 line-through dark:text-red-400";
    case "renamed":
    case "copied":
      return "text-sky-700 dark:text-sky-400";
    case "untracked":
      return "text-zinc-600 dark:text-zinc-400";
    case "conflicted":
      return "text-red-700 dark:text-red-300";
    default:
      return "text-zinc-800 dark:text-zinc-200";
  }
}

export function gitTreeBadgeClass(status: GitFileChangeStatus): string {
  const base = "shrink-0 font-mono text-[10px] font-medium tabular-nums";
  switch (status) {
    case "modified":
      return `${base} text-amber-700 dark:text-[#c9a86a]`;
    case "added":
      return `${base} text-emerald-700 dark:text-emerald-400`;
    case "deleted":
      return `${base} text-red-600 dark:text-red-400`;
    case "renamed":
    case "copied":
      return `${base} text-sky-700 dark:text-sky-400`;
    case "untracked":
      return `${base} text-zinc-500 dark:text-zinc-500`;
    case "conflicted":
      return `${base} text-red-700 dark:text-red-300`;
    default:
      return `${base} text-zinc-500`;
  }
}

export function gitTreeBadgeText(status: GitFileChangeStatus): string {
  return gitStatusBadgeLabel(status);
}
