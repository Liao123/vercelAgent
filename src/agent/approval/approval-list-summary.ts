import type {
  ApprovalContentSnapshot,
  ApprovalDetails,
  ApprovalFileMutationOperation,
  ApprovalFileMutationPreview,
  ApprovalGitWorkspaceSnapshot,
  ApprovalPatchFilePreview,
  ApprovalRequest,
} from "@/agent/types";

type SummarizableApproval = ApprovalRequest & {
  status: string;
  decidedAt?: string;
};

const EMPTY_SNAPSHOT: ApprovalContentSnapshot = {
  text: "",
  length: 0,
  lineCount: 0,
  truncated: true,
};

function omitContentSnapshot(): undefined {
  return undefined;
}

function summarizeFileMutationOperation(
  operation: ApprovalFileMutationOperation,
): ApprovalFileMutationOperation {
  if (operation.type === "create" || operation.type === "write") {
    return {
      ...operation,
      content: "",
    };
  }
  return operation;
}

function summarizeFileMutationPreview(
  preview: ApprovalFileMutationPreview,
): ApprovalFileMutationPreview {
  return {
    ...preview,
    oldContent: omitContentSnapshot(),
    newContent: omitContentSnapshot(),
  };
}

function summarizePatchFilePreview(
  file: ApprovalPatchFilePreview,
): ApprovalPatchFilePreview {
  return {
    ...file,
    oldContent: omitContentSnapshot(),
    newContent: omitContentSnapshot(),
  };
}

function summarizeGitWorkspace(
  workspace?: ApprovalGitWorkspaceSnapshot,
): ApprovalGitWorkspaceSnapshot | undefined {
  if (!workspace) return undefined;
  return {
    branch: workspace.branch,
    remoteUrl: workspace.remoteUrl,
    statusSnapshot: workspace.statusSnapshot,
    status: workspace.status
      ? {
          ...workspace.status,
          text: "",
          length: workspace.status.length,
          truncated: true,
        }
      : undefined,
    diff: workspace.diff
      ? {
          ...workspace.diff,
          text: "",
          length: workspace.diff.length,
          truncated: true,
        }
      : undefined,
  };
}

export function summarizeApprovalDetails(
  details: ApprovalDetails,
): ApprovalDetails {
  switch (details.kind) {
    case "file_mutation":
      return {
        ...details,
        operation: summarizeFileMutationOperation(details.operation),
        preview: summarizeFileMutationPreview(details.preview),
      };
    case "patch_apply":
      return {
        ...details,
        patch: "",
        preview: {
          ...details.preview,
          files: details.preview.files.map(summarizePatchFilePreview),
          patchPreview: details.preview.patchPreview
            ? {
                ...EMPTY_SNAPSHOT,
                lineCount: details.preview.patchPreview.lineCount,
                length: details.preview.patchPreview.length,
              }
            : EMPTY_SNAPSHOT,
        },
      };
    case "git_mutation":
      return {
        ...details,
        preview: {
          ...details.preview,
          workspace: summarizeGitWorkspace(details.preview.workspace),
        },
      };
    case "shell_command":
      return details;
  }
}

export function summarizeApprovalForList(
  approval: SummarizableApproval,
): SummarizableApproval {
  return {
    ...approval,
    details: approval.details
      ? summarizeApprovalDetails(approval.details)
      : undefined,
  };
}

export function approvalDetailsPayloadBytes(details?: ApprovalDetails): number {
  if (!details) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(details), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function needsApprovalDetailsHydration(
  details?: ApprovalDetails,
): boolean {
  if (!details) return false;
  if (details.kind === "file_mutation") {
    return !details.preview.oldContent && !details.preview.newContent;
  }
  if (details.kind === "patch_apply") {
    return !details.patch;
  }
  if (details.kind === "git_mutation") {
    const workspace = details.preview.workspace;
    if (!workspace) return false;
    const statusEmpty =
      !workspace.status || workspace.status.truncated && !workspace.status.text;
    const diffEmpty =
      !workspace.diff || workspace.diff.truncated && !workspace.diff.text;
    return Boolean(workspace.status || workspace.diff) && statusEmpty && diffEmpty;
  }
  return false;
}
