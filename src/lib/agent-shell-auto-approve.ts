import { isCommandLikeApproval } from "@/lib/approval-kind";
import { validateShellCommand } from "@/agent/tools/shell-command-policy";
import type { ApprovalRequest } from "@/agent/types";

export const AUTO_APPROVE_SHELL_COMMANDS_KEY = "vec.agent.autoApproveShellCommands";

export function readAutoApproveShellCommands(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTO_APPROVE_SHELL_COMMANDS_KEY) === "1";
}

export function writeAutoApproveShellCommands(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_APPROVE_SHELL_COMMANDS_KEY, enabled ? "1" : "0");
}

function shellCommandFromApproval(
  approval: Pick<ApprovalRequest, "details" | "title">,
): string | null {
  const preview = approval.details?.kind === "shell_command" ? approval.details.preview : null;
  if (!preview) return null;
  if (typeof preview.command === "string" && preview.command.trim()) {
    return preview.command.trim();
  }
  return approval.title.trim() || null;
}

/** 低风控只读 shell（validate/lint/test/git status 等）可在用户开启偏好时自动批准执行。 */
export function canAutoApproveShellCommand(
  approval: Pick<ApprovalRequest, "details" | "risk" | "title"> & {
    status?: string;
  },
  autoApproveEnabled: boolean,
): boolean {
  if (!autoApproveEnabled) return false;
  if (approval.status && approval.status !== "pending") return false;
  if (!isCommandLikeApproval(approval)) return false;
  if (approval.details?.kind !== "shell_command") return false;
  if (approval.details.preview.available === false) return false;
  if (approval.risk !== "low") return false;

  const command = shellCommandFromApproval(approval);
  if (!command) return false;

  const validation = validateShellCommand(command);
  return validation.allowed && validation.risk === "low";
}
