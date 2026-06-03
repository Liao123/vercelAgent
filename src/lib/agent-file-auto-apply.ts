import {
  isCommandLikeApproval,
  isFileLikeApproval,
} from "@/lib/approval-kind";
import type { ApprovalRequest } from "@/agent/types";

export const AUTO_APPLY_FILE_CHANGES_KEY = "vec.agent.autoApplyFileChanges";

export function readAutoApplyFileChanges(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(AUTO_APPLY_FILE_CHANGES_KEY);
  if (stored === null) return true;
  return stored === "1";
}

export function writeAutoApplyFileChanges(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_APPLY_FILE_CHANGES_KEY, enabled ? "1" : "0");
}

/** A093：实验项，仅低/中风险文件类审批可自动批准并执行。 */
export function canAutoApplyFileApproval(
  approval: Pick<ApprovalRequest, "details" | "risk"> & {
    status?: string;
  },
  autoApplyEnabled: boolean,
): boolean {
  if (!autoApplyEnabled) return false;
  if (approval.status && approval.status !== "pending") return false;
  if (!approval.details) return false;
  if (isCommandLikeApproval(approval)) return false;
  if (!isFileLikeApproval(approval)) return false;
  if (approval.risk === "high") return false;
  return true;
}
