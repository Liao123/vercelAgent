import type {
  AgentEvent,
  ApprovalContentSnapshot,
  ApprovalDetails,
  ApprovalPatchFilePreview,
  ApprovalRequest,
} from "@/agent/types";
import { computeLineDiff } from "@/lib/line-diff";
import { isKernelBootstrapPath } from "@/lib/kernel-file-hint";
import { snapshotDiffHint, snapshotDiffText } from "@/lib/snapshot-diff-text";

export type FileChangeEntry = {
  path: string;
  additions: number;
  deletions: number;
  /** 用于右侧 diff 定位 */
  fileKey: string;
  /** Codex-like live write state before the final file.changed event lands. */
  isWriting?: boolean;
  /** 阶段 C：src/agent 内核自举文件 */
  isKernel?: boolean;
  patchFile?: ApprovalPatchFilePreview;
  /** 单文件 mutation 的 diff 快照 */
  singleFileDiff?: {
    before?: ApprovalPatchFilePreview["oldContent"] | string;
    after?: ApprovalPatchFilePreview["newContent"] | string;
  };
  directDiff?: string;
};

export type TurnFileChangeSummary = {
  approvalId?: string;
  status: "pending" | "approved" | "writing" | "applied";
  files: FileChangeEntry[];
  totalAdditions: number;
  totalDeletions: number;
};

function snapshotText(
  snapshot?: ApprovalContentSnapshot | string,
): string {
  if (!snapshot) return "";
  if (typeof snapshot === "string") return snapshot;
  return snapshotDiffText(snapshot).text;
}

export function countLineDiffStats(
  before?: ApprovalContentSnapshot | string,
  after?: ApprovalContentSnapshot | string,
): { additions: number; deletions: number } {
  const left = snapshotText(before);
  const right = snapshotText(after);
  if (!left && right) {
    const lines = right.split(/\r\n|\n|\r/).filter((line, i, arr) =>
      i < arr.length - 1 || line.length > 0,
    );
    return { additions: lines.length, deletions: 0 };
  }
  if (left && !right) {
    const lines = left.split(/\r\n|\n|\r/).filter((line, i, arr) =>
      i < arr.length - 1 || line.length > 0,
    );
    return { additions: 0, deletions: lines.length };
  }
  const rows = computeLineDiff(left, right);
  return {
    additions: rows.filter((row) => row.kind === "insert").length,
    deletions: rows.filter((row) => row.kind === "delete").length,
  };
}

function patchFilePath(file: ApprovalPatchFilePreview): string {
  if (file.kind === "rename") {
    return file.newPath ?? file.filePath ?? file.oldPath ?? "?";
  }
  return file.newPath ?? file.filePath ?? file.oldPath ?? "?";
}

function patchFileKey(file: ApprovalPatchFilePreview): string {
  return `${file.kind ?? "modify"}:${file.oldPath ?? ""}:${file.newPath ?? file.filePath}`;
}

function entryFromPatchFile(file: ApprovalPatchFilePreview): FileChangeEntry {
  const stats = countLineDiffStats(file.oldContent, file.newContent);
  return {
    path: patchFilePath(file),
    additions: stats.additions,
    deletions: stats.deletions,
    fileKey: patchFileKey(file),
    patchFile: file,
    isKernel: isKernelBootstrapPath(patchFilePath(file)),
  };
}

export function extractFileChangesFromDetails(
  details?: ApprovalDetails,
): FileChangeEntry[] {
  if (!details) return [];

  if (details.kind === "patch_apply") {
    return details.preview.files
      .filter((file) => file.changed !== false)
      .map(entryFromPatchFile);
  }

  if (details.kind === "file_mutation") {
    const preview = details.preview;
    const path =
      preview.path ?? preview.toPath ?? preview.fromPath ?? "?";
    const stats = countLineDiffStats(preview.oldContent, preview.newContent);
    if (stats.additions === 0 && stats.deletions === 0 && preview.sizeDelta) {
      const delta = preview.sizeDelta;
      if (delta > 0) return [{ path, additions: delta, deletions: 0, fileKey: path }];
      if (delta < 0) {
        return [{ path, additions: 0, deletions: Math.abs(delta), fileKey: path }];
      }
    }
    return [
      {
        path,
        additions: stats.additions,
        deletions: stats.deletions,
        fileKey: path,
        singleFileDiff: {
          before: preview.oldContent,
          after: preview.newContent,
        },
        isKernel: isKernelBootstrapPath(path),
      },
    ];
  }

  return [];
}

export function extractFileChangesFromApproval(
  approval: Pick<ApprovalRequest, "details">,
): FileChangeEntry[] {
  return extractFileChangesFromDetails(approval.details);
}

function sortByChangeSize(files: FileChangeEntry[]): FileChangeEntry[] {
  return [...files].sort(
    (a, b) =>
      b.additions + b.deletions - (a.additions + a.deletions),
  );
}

export function summarizeFileChanges(
  files: FileChangeEntry[],
): { totalAdditions: number; totalDeletions: number } {
  return files.reduce(
    (acc, file) => ({
      totalAdditions: acc.totalAdditions + file.additions,
      totalDeletions: acc.totalDeletions + file.deletions,
    }),
    { totalAdditions: 0, totalDeletions: 0 },
  );
}

export function countUnifiedDiffStats(
  diff?: string,
): { additions: number; deletions: number } {
  if (!diff) return { additions: 0, deletions: 0 };

  let additions = 0;
  let deletions = 0;

  for (const line of diff.split(/\r\n|\n|\r/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return { additions, deletions };
}

function normalizeChangePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" ? value : null;
}

function cleanDiffPath(raw: string | undefined): string | null {
  if (!raw) return null;
  const token = raw.trim().split(/\s+/)[0] ?? "";
  if (!token || token === "/dev/null") return null;
  return normalizeChangePath(token.replace(/^a\//, "").replace(/^b\//, ""));
}

function entryFromStats(input: {
  path: string;
  additions: number;
  deletions: number;
  fileKey?: string;
  directDiff?: string;
  singleFileDiff?: FileChangeEntry["singleFileDiff"];
  isWriting?: boolean;
}): FileChangeEntry {
  const path = normalizeChangePath(input.path);
  return {
    path,
    additions: input.additions,
    deletions: input.deletions,
    fileKey: input.fileKey ?? path,
    isWriting: input.isWriting,
    isKernel: isKernelBootstrapPath(path),
    directDiff: input.directDiff,
    singleFileDiff: input.singleFileDiff,
  };
}

export function fileChangesFromUnifiedDiff(
  diff: string,
  fallbackPath?: string,
  options?: { isWriting?: boolean; fileKeyPrefix?: string },
): FileChangeEntry[] {
  type PartialDiff = {
    oldPath?: string | null;
    newPath?: string | null;
    diffPath?: string | null;
    additions: number;
    deletions: number;
    lines: string[];
  };

  const entries: FileChangeEntry[] = [];
  let current: PartialDiff | null = null;

  const ensure = () => {
    current ??= {
      additions: 0,
      deletions: 0,
      lines: [],
    };
    return current;
  };

  const flush = () => {
    if (!current) return;
    const path =
      current.newPath ??
      current.oldPath ??
      current.diffPath ??
      (fallbackPath ? normalizeChangePath(fallbackPath) : null);
    if (path) {
      entries.push(
        entryFromStats({
          path,
          additions: current.additions,
          deletions: current.deletions,
          fileKey: `${options?.fileKeyPrefix ?? "diff"}:${path}`,
          directDiff: current.lines.join("\n"),
          isWriting: options?.isWriting,
        }),
      );
    }
    current = null;
  };

  for (const line of diff.split(/\r\n|\n|\r/)) {
    if (line.startsWith("diff --git ")) {
      flush();
      const match = /^diff --git\s+a\/(.+?)\s+b\/(.+)$/.exec(line);
      current = {
        diffPath: match ? normalizeChangePath(match[2] ?? match[1]) : null,
        additions: 0,
        deletions: 0,
        lines: [line],
      };
      continue;
    }

    if (line.startsWith("--- ")) {
      if (
        current &&
        (current.oldPath ||
          current.newPath ||
          current.additions > 0 ||
          current.deletions > 0)
      ) {
        flush();
      }
      const item = ensure();
      item.oldPath = cleanDiffPath(line.slice(4));
      item.lines.push(line);
      continue;
    }

    if (line.startsWith("+++ ")) {
      const item = ensure();
      item.newPath = cleanDiffPath(line.slice(4));
      item.lines.push(line);
      continue;
    }

    const item = ensure();
    item.lines.push(line);
    if (line.startsWith("+")) {
      item.additions += 1;
    } else if (line.startsWith("-")) {
      item.deletions += 1;
    }
  }

  flush();
  return entries.filter(
    (entry) =>
      entry.additions > 0 ||
      entry.deletions > 0 ||
      Boolean(entry.directDiff?.trim()),
  );
}

export function inferWritingFileChangesFromToolEvent(
  event: Extract<AgentEvent, { type: "tool.started" }>,
): FileChangeEntry[] {
  const toolName = event.toolCall.toolName;
  const args = asRecord(event.toolCall.args);
  if (!args) return [];

  if (toolName === "file.mutation") {
    const path = stringArg(args, "path");
    if (!path) return [];
    const content = stringArg(args, "content") ?? "";
    const stats = countLineDiffStats("", content);
    return [
      entryFromStats({
        path,
        additions: stats.additions,
        deletions: stats.deletions,
        fileKey: `writing:${event.toolCall.id}:${normalizeChangePath(path)}`,
        singleFileDiff: { before: "", after: content },
        isWriting: true,
      }),
    ];
  }

  if (toolName === "file.replace") {
    const path = stringArg(args, "path");
    if (!path) return [];
    const search = stringArg(args, "search") ?? "";
    const replace = stringArg(args, "replace") ?? "";
    const stats = countLineDiffStats(search, replace);
    return [
      entryFromStats({
        path,
        additions: stats.additions,
        deletions: stats.deletions,
        fileKey: `writing:${event.toolCall.id}:${normalizeChangePath(path)}`,
        singleFileDiff: { before: search, after: replace },
        isWriting: true,
      }),
    ];
  }

  if (toolName === "patch.apply") {
    const patch = stringArg(args, "patch");
    if (!patch) return [];
    return fileChangesFromUnifiedDiff(patch, undefined, {
      isWriting: true,
      fileKeyPrefix: `writing:${event.toolCall.id}`,
    });
  }

  return [];
}

function singleFileDiffFromChangedEvent(
  event: Extract<AgentEvent, { type: "file.changed" }>,
): FileChangeEntry["singleFileDiff"] | undefined {
  if (
    typeof event.oldContent !== "string" &&
    typeof event.newContent !== "string"
  ) {
    return undefined;
  }
  return {
    before: event.oldContent ?? "",
    after: event.newContent ?? "",
  };
}

export function collectTurnFileChanges(
  events: AgentEvent[],
): TurnFileChangeSummary | null {
  let pending: TurnFileChangeSummary | null = null;
  const writingByPath = new Map<string, FileChangeEntry>();
  const writingPathsByCallId = new Map<string, string[]>();

  const hasCommittedPath = (path: string) =>
    Boolean(
      pending?.files.some(
        (file) => normalizeChangePath(file.path) === normalizeChangePath(path),
      ),
    );

  const rememberWriting = (entries: FileChangeEntry[], callId?: string) => {
    const paths: string[] = [];
    for (const entry of entries) {
      const path = normalizeChangePath(entry.path);
      if (!path || hasCommittedPath(path)) continue;
      writingByPath.set(path, {
        ...entry,
        path,
        isWriting: true,
        fileKey: entry.fileKey || `writing:${path}`,
      });
      paths.push(path);
    }
    if (callId && paths.length > 0) {
      writingPathsByCallId.set(callId, paths);
    }
  };

  const forgetWritingPath = (path: string) => {
    writingByPath.delete(normalizeChangePath(path));
  };

  for (const event of events) {
    if (event.type === "tool.started") {
      rememberWriting(
        inferWritingFileChangesFromToolEvent(event),
        event.toolCall.id,
      );
    }
    if (event.type === "tool.completed" && event.toolCall.error) {
      for (const path of writingPathsByCallId.get(event.toolCall.id) ?? []) {
        writingByPath.delete(path);
      }
      writingPathsByCallId.delete(event.toolCall.id);
    }
    if (event.type === "turn.diff.updated") {
      rememberWriting(
        fileChangesFromUnifiedDiff(event.diff, event.filePath, {
          isWriting: true,
          fileKeyPrefix: "turn-diff",
        }),
      );
    }
    if (event.type === "approval.required") {
      const files = extractFileChangesFromApproval(event.approval);
      if (files.length === 0) continue;
      const totals = summarizeFileChanges(files);
      pending = {
        approvalId: event.approval.id,
        status: "pending",
        files: sortByChangeSize(files),
        ...totals,
      };
    }
    if (event.type === "file.changed") {
      const path = normalizeChangePath(event.filePath);
      forgetWritingPath(path);
      const singleFileDiff = singleFileDiffFromChangedEvent(event);
      const directStats = singleFileDiff
        ? countLineDiffStats(singleFileDiff.before, singleFileDiff.after)
        : countUnifiedDiffStats(event.diff);
      const existing = pending?.files.find(
        (f) => f.path.replace(/\\/g, "/") === path,
      );
      if (existing) {
        const files: FileChangeEntry[] = (pending?.files ?? []).map((file) => {
          if (file.path.replace(/\\/g, "/") !== path) return file;
          const shouldUseDirectStats =
            file.additions === 0 &&
            file.deletions === 0 &&
            (directStats.additions > 0 || directStats.deletions > 0);
          return {
            ...file,
            isWriting: false,
            additions: shouldUseDirectStats
              ? directStats.additions
              : file.additions,
            deletions: shouldUseDirectStats
              ? directStats.deletions
              : file.deletions,
            directDiff: event.diff || file.directDiff,
            singleFileDiff: file.singleFileDiff ?? singleFileDiff,
          };
        });
        const totals = summarizeFileChanges(files);
        pending = {
          ...pending!,
          status: "applied",
          files: sortByChangeSize(files),
          ...totals,
        };
        continue;
      }
      const files: FileChangeEntry[] = sortByChangeSize([
        ...(pending?.files ?? []),
        {
          path,
          additions: directStats.additions,
          deletions: directStats.deletions,
          fileKey: path,
          isWriting: false,
          isKernel: isKernelBootstrapPath(path),
          directDiff: event.diff,
          singleFileDiff,
        },
      ]);
      const totals = summarizeFileChanges(files);
      pending = {
        approvalId: pending?.approvalId,
        status: "applied",
        files,
        ...totals,
      };
    }
    if (
      event.type === "task.completed" ||
      event.type === "task.failed" ||
      event.type === "task.cancelled"
    ) {
      writingByPath.clear();
    }
  }

  if (writingByPath.size > 0) {
    const byPath = new Map<string, FileChangeEntry>();
    for (const file of pending?.files ?? []) {
      byPath.set(normalizeChangePath(file.path), file);
    }
    for (const [path, file] of writingByPath) {
      if (!byPath.has(path)) byPath.set(path, file);
    }
    const files = sortByChangeSize([...byPath.values()]);
    const totals = summarizeFileChanges(files);
    return {
      approvalId: pending?.approvalId,
      status: "writing",
      files,
      ...totals,
    };
  }

  return pending;
}

function isReviewableFileApproval(
  approval: {
    taskId: string;
    status: string;
    execution?: { status: "succeeded" | "failed" };
  },
  currentTaskId?: string | null,
): boolean {
  if (approval.status === "pending") return true;
  if (approval.status === "approved") {
    if (approval.execution?.status === "succeeded") {
      return Boolean(currentTaskId && approval.taskId === currentTaskId);
    }
    return true;
  }
  return false;
}

function listReviewableFileApprovals(
  approvals: Array<{
    id: string;
    taskId: string;
    status: string;
    details?: ApprovalDetails;
    execution?: { status: "succeeded" | "failed" };
  }>,
  currentTaskId?: string | null,
): typeof approvals {
  const withFiles = approvals.filter(
    (a) =>
      isReviewableFileApproval(a, currentTaskId) &&
      extractFileChangesFromDetails(a.details).length > 0,
  );
  if (!currentTaskId) return withFiles;
  const forTask = withFiles.filter((a) => a.taskId === currentTaskId);
  return forTask.length > 0 ? forTask : withFiles;
}

/** 从当前任务待审 approval 合并文件列表（右侧审查用）。 */
export function collectReviewFileChanges(
  approvals: Array<{
    id: string;
    taskId: string;
    status: string;
    details?: ApprovalDetails;
    execution?: { status: "succeeded" | "failed" };
  }>,
  currentTaskId?: string | null,
  focusedApprovalId?: string | null,
): {
  approvalId: string | null;
  files: FileChangeEntry[];
  totalAdditions: number;
  totalDeletions: number;
  source: "approval";
} {
  const candidates = listReviewableFileApprovals(approvals, currentTaskId);

  if (candidates.length === 0) {
    return {
      approvalId: null,
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      source: "approval",
    };
  }

  if (focusedApprovalId) {
    const focused = approvals.find((a) => a.id === focusedApprovalId);
    if (focused && extractFileChangesFromDetails(focused.details).length > 0) {
      const files = sortByChangeSize(
        extractFileChangesFromDetails(focused.details),
      );
      return {
        approvalId: focused.id,
        files,
        ...summarizeFileChanges(files),
        source: "approval",
      };
    }
  }

  const byPath = new Map<string, FileChangeEntry>();
  for (const approval of candidates) {
    for (const file of extractFileChangesFromDetails(approval.details)) {
      const norm = file.path.replaceAll("\\", "/");
      byPath.set(norm, file);
    }
  }
  const files = sortByChangeSize([...byPath.values()]);
  const latest = candidates[candidates.length - 1];
  return {
    approvalId: latest.id,
    files,
    ...summarizeFileChanges(files),
    source: "approval",
  };
}

export type ReviewDisplay = {
  approvalId: string | null;
  files: FileChangeEntry[];
  totalAdditions: number;
  totalDeletions: number;
  source: "approval" | "git" | "direct";
};

export function reviewDisplayFromTurnFileChanges(
  changes?: TurnFileChangeSummary | null,
): ReviewDisplay | null {
  if (!changes || changes.files.length === 0) return null;
  return {
    approvalId: changes.approvalId ?? null,
    files: changes.files,
    totalAdditions: changes.totalAdditions,
    totalDeletions: changes.totalDeletions,
    source: changes.approvalId ? "approval" : "direct",
  };
}

/** 无 Agent 审批时，用 Git 工作区脏文件填充审查列表（只读对比）。 */
function buildGitReviewDisplay(
  gitFiles?: Array<{ path: string; status: string }>,
): ReviewDisplay {
  if (!gitFiles?.length) {
    return {
      approvalId: null,
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      source: "git",
    };
  }

  const files = sortByChangeSize(
    gitFiles.map((file) => {
      const path = file.path.replaceAll("\\", "/");
      const isDelete = file.status === "deleted";
      return {
        path,
        additions: isDelete ? 0 : 1,
        deletions: isDelete ? 1 : 0,
        fileKey: `git:${path}`,
        isKernel: isKernelBootstrapPath(path),
      };
    }),
  );
  return {
    approvalId: null,
    files,
    ...summarizeFileChanges(files),
    source: "git",
  };
}

export function collectReviewDisplay(
  approvals: Parameters<typeof collectReviewFileChanges>[0],
  currentTaskId?: string | null,
  focusedApprovalId?: string | null,
  gitFiles?: Array<{ path: string; status: string }>,
  options?: { preferGit?: boolean; gitOnly?: boolean },
): ReviewDisplay {
  if (options?.gitOnly) {
    return buildGitReviewDisplay(gitFiles);
  }

  if (options?.preferGit && gitFiles?.length) {
    return buildGitReviewDisplay(gitFiles);
  }

  const fromApproval = collectReviewFileChanges(
    approvals,
    currentTaskId,
    focusedApprovalId,
  );
  if (fromApproval.files.length > 0) return fromApproval;

  return buildGitReviewDisplay(gitFiles);
}

export function fileBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function isContentSnapshot(value: unknown): value is ApprovalContentSnapshot {
  return Boolean(value && typeof value === "object" && "text" in value);
}

export function diffHintForEntry(entry: FileChangeEntry): string | null {
  if (entry.patchFile) {
    return snapshotDiffHint(entry.patchFile.oldContent, entry.patchFile.newContent);
  }
  if (entry.singleFileDiff) {
    const before = isContentSnapshot(entry.singleFileDiff.before)
      ? entry.singleFileDiff.before
      : undefined;
    const after = isContentSnapshot(entry.singleFileDiff.after)
      ? entry.singleFileDiff.after
      : undefined;
    return snapshotDiffHint(
      before,
      after,
    );
  }
  return null;
}
