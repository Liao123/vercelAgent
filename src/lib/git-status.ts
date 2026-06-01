/**
 * 解析 `git status --short --branch`，供 Agent 工具与 UI 共用。
 */

export type GitFileChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted";

export type GitStatusFileEntry = {
  path: string;
  previousPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  status: GitFileChangeStatus;
};

export type GitStatusSnapshot = {
  dirty: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  detached: boolean;
  files: GitStatusFileEntry[];
  /** 单行摘要，供活动流与模型快速理解。 */
  summary: string;
};

const RENAME_ARROW = " -> ";

function parseBranchLine(line: string): Pick<
  GitStatusSnapshot,
  "branch" | "upstream" | "ahead" | "behind" | "detached"
> {
  const body = line.slice(3).trim();
  if (body.startsWith("HEAD (no branch)")) {
    return {
      branch: null,
      upstream: null,
      ahead: null,
      behind: null,
      detached: true,
    };
  }

  const noCommitsMatch = /^No commits yet on (.+)$/.exec(body);
  if (noCommitsMatch) {
    return {
      branch: noCommitsMatch[1]!.trim(),
      upstream: null,
      ahead: null,
      behind: null,
      detached: false,
    };
  }

  const bracketIndex = body.indexOf(" [");
  const branchPart =
    bracketIndex >= 0 ? body.slice(0, bracketIndex) : body;
  const bracketPart =
    bracketIndex >= 0 ? body.slice(bracketIndex + 2, -1) : "";

  const [branch, upstream] = branchPart.includes("...")
    ? (() => {
        const [left, right] = branchPart.split("...");
        return [left?.trim() || null, right?.trim() || null] as const;
      })()
    : [branchPart.trim() || null, null] as const;

  let ahead: number | null = null;
  let behind: number | null = null;
  if (bracketPart) {
    const aheadMatch = /ahead (\d+)/.exec(bracketPart);
    const behindMatch = /behind (\d+)/.exec(bracketPart);
    if (aheadMatch) ahead = Number(aheadMatch[1]);
    if (behindMatch) behind = Number(behindMatch[1]);
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    detached: false,
  };
}

function classifyFileStatus(
  indexStatus: string,
  worktreeStatus: string,
): GitFileChangeStatus {
  if (indexStatus === "?" && worktreeStatus === "?") return "untracked";
  if (indexStatus === "U" || worktreeStatus === "U") return "conflicted";
  if (indexStatus === "R" || worktreeStatus === "R") return "renamed";
  if (indexStatus === "C" || worktreeStatus === "C") return "copied";
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
  if (indexStatus === "A" || worktreeStatus === "A") return "added";
  if (indexStatus === "M" || worktreeStatus === "M") return "modified";
  return "modified";
}

function parseFileLine(line: string): GitStatusFileEntry | null {
  if (line.length < 3) return null;
  const indexStatus = line[0] ?? " ";
  const worktreeStatus = line[1] ?? " ";
  const pathPart = line.slice(3).trim();
  if (!pathPart) return null;

  if (pathPart.includes(RENAME_ARROW)) {
    const [previousPath, path] = pathPart.split(RENAME_ARROW);
    return {
      path: path?.trim() ?? pathPart,
      previousPath: previousPath?.trim(),
      indexStatus,
      worktreeStatus,
      status: classifyFileStatus(indexStatus, worktreeStatus),
    };
  }

  return {
    path: pathPart,
    indexStatus,
    worktreeStatus,
    status: classifyFileStatus(indexStatus, worktreeStatus),
  };
}

function countByStatus(files: GitStatusFileEntry[]): Record<GitFileChangeStatus, number> {
  const counts: Record<GitFileChangeStatus, number> = {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
    conflicted: 0,
  };
  for (const file of files) {
    counts[file.status] += 1;
  }
  return counts;
}

const STATUS_LABELS: Record<GitFileChangeStatus, string> = {
  modified: "modified",
  added: "added",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  untracked: "untracked",
  conflicted: "conflicted",
};

export function buildGitStatusSummary(input: {
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  detached: boolean;
  files: GitStatusFileEntry[];
}): string {
  const counts = countByStatus(input.files);
  const changeParts = (
    Object.entries(counts) as [GitFileChangeStatus, number][]
  )
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${STATUS_LABELS[status]}`);

  const branchLabel = input.detached
    ? "HEAD detached"
    : input.branch ?? "unknown branch";

  const syncParts: string[] = [];
  if (input.ahead != null && input.ahead > 0) {
    syncParts.push(`↑${input.ahead}`);
  }
  if (input.behind != null && input.behind > 0) {
    syncParts.push(`↓${input.behind}`);
  }
  const syncHint =
    syncParts.length > 0 ? ` ${syncParts.join(" ")}` : "";

  if (changeParts.length === 0) {
    return `${branchLabel}${syncHint} · clean`;
  }

  return `${branchLabel}${syncHint} · ${changeParts.join(", ")}`;
}

export function parseGitStatusOutput(stdout: string): GitStatusSnapshot {
  const lines = stdout
    .split(/\r\n|\n|\r/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  let branchMeta: Pick<
    GitStatusSnapshot,
    "branch" | "upstream" | "ahead" | "behind" | "detached"
  > = {
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    detached: false,
  };

  const files: GitStatusFileEntry[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      branchMeta = parseBranchLine(line);
      continue;
    }
    const file = parseFileLine(line);
    if (file) files.push(file);
  }

  const dirty = files.length > 0;
  const summary = buildGitStatusSummary({ ...branchMeta, files });

  return {
    dirty,
    ...branchMeta,
    files,
    summary,
  };
}

export function formatGitStatusFileLine(file: GitStatusFileEntry): string {
  const marker =
    file.indexStatus === "?" && file.worktreeStatus === "?"
      ? "??"
      : `${file.indexStatus}${file.worktreeStatus}`;
  if (file.previousPath) {
    return `${marker} ${file.previousPath}${RENAME_ARROW}${file.path}`;
  }
  return `${marker} ${file.path}`;
}

export function formatGitStatusDetail(snapshot: GitStatusSnapshot, maxFiles = 24): string {
  const lines: string[] = [snapshot.summary];
  const visible = snapshot.files.slice(0, maxFiles);
  for (const file of visible) {
    lines.push(formatGitStatusFileLine(file));
  }
  if (snapshot.files.length > maxFiles) {
    lines.push(`… +${snapshot.files.length - maxFiles} more`);
  }
  return lines.join("\n");
}

export function gitStatusBadgeLabel(status: GitFileChangeStatus): string {
  const labels: Record<GitFileChangeStatus, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "?",
    conflicted: "!",
  };
  return labels[status];
}
