import type {
  AgentEvent,
  ApprovalContentSnapshot,
  ApprovalDetails,
  ApprovalPatchFilePreview,
  ApprovalRequest,
} from "@/agent/types";
import { computeLineDiff } from "@/lib/line-diff";
import { snapshotDiffHint, snapshotDiffText } from "@/lib/snapshot-diff-text";

export type FileChangeEntry = {
  path: string;
  additions: number;
  deletions: number;
  /** 用于右侧 diff 定位 */
  fileKey: string;
  patchFile?: ApprovalPatchFilePreview;
  /** 单文件 mutation 的 diff 快照 */
  singleFileDiff?: {
    before?: ApprovalPatchFilePreview["oldContent"];
    after?: ApprovalPatchFilePreview["newContent"];
  };
};

export type TurnFileChangeSummary = {
  approvalId?: string;
  status: "pending" | "approved" | "applied";
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

export function collectTurnFileChanges(
  events: AgentEvent[],
): TurnFileChangeSummary | null {
  let pending: TurnFileChangeSummary | null = null;

  for (const event of events) {
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
      const path = event.filePath.replace(/\\/g, "/");
      const existing = pending?.files.find((f) => f.path === path);
      if (existing) {
        pending = {
          ...pending!,
          status: "applied",
        };
        continue;
      }
      pending = {
        approvalId: pending?.approvalId,
        status: "applied",
        files: sortByChangeSize([
          ...(pending?.files ?? []),
          { path, additions: 0, deletions: 0, fileKey: path },
        ]),
        totalAdditions: pending?.totalAdditions ?? 0,
        totalDeletions: pending?.totalDeletions ?? 0,
      };
    }
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

  const byKey = new Map<string, FileChangeEntry>();
  for (const approval of candidates) {
    for (const file of extractFileChangesFromDetails(approval.details)) {
      byKey.set(file.fileKey, file);
    }
  }
  const files = sortByChangeSize([...byKey.values()]);
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
  source: "approval" | "git";
};

/** 无 Agent 审批时，用 Git 工作区脏文件填充审查列表（只读对比）。 */
export function collectReviewDisplay(
  approvals: Parameters<typeof collectReviewFileChanges>[0],
  currentTaskId?: string | null,
  focusedApprovalId?: string | null,
  gitFiles?: Array<{ path: string; status: string }>,
): ReviewDisplay {
  const fromApproval = collectReviewFileChanges(
    approvals,
    currentTaskId,
    focusedApprovalId,
  );
  if (fromApproval.files.length > 0) return fromApproval;

  if (!gitFiles?.length) {
    return { ...fromApproval, source: "git" };
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

export function fileBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function diffHintForEntry(entry: FileChangeEntry): string | null {
  if (entry.patchFile) {
    return snapshotDiffHint(entry.patchFile.oldContent, entry.patchFile.newContent);
  }
  if (entry.singleFileDiff) {
    return snapshotDiffHint(
      entry.singleFileDiff.before,
      entry.singleFileDiff.after,
    );
  }
  return null;
}
