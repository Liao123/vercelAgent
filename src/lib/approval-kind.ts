import type { ApprovalDetails, ApprovalRequest } from "@/agent/types";

export function approvalDetailsKind(
  details: ApprovalDetails | undefined,
): ApprovalDetails["kind"] | undefined {
  return details?.kind;
}

/** Cursor 式：命令/脚本/Git 在对话区内联授权 */
export function isCommandLikeApproval(
  approval: Pick<ApprovalRequest, "details">,
): boolean {
  const kind = approvalDetailsKind(approval.details);
  return kind === "shell_command" || kind === "git_mutation";
}

/** 文件变更仍在右侧审查区 */
export function isFileLikeApproval(
  approval: Pick<ApprovalRequest, "details">,
): boolean {
  const kind = approvalDetailsKind(approval.details);
  return kind === "file_mutation" || kind === "patch_apply";
}
