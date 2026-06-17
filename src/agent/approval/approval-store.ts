/**
 * Approval Store 雏形。
 *
 * 当前使用内存 Map + 本地 JSON 保存审批请求。高风险操作不能只靠模型自己决定，
 * 必须先创建 approval，再由用户批准后才能执行。
 */
import fs from "node:fs";
import path from "node:path";
import { summarizeApprovalForList } from "@/agent/approval/approval-list-summary";
import {
  newId,
  nowIso,
  type ApprovalDetails,
  type ApprovalExecution,
  type ApprovalRequest,
  type ApprovalRisk,
} from "@/agent/types";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalRecord = ApprovalRequest & {
  status: ApprovalStatus;
  decidedAt?: string;
};

const approvals = new Map<string, ApprovalRecord>();
const STATE_DIR = ".agent-state";
const STATE_FILE = "approvals.json";

function approvalsPath(): string {
  return path.join(process.cwd(), STATE_DIR, STATE_FILE);
}

function loadApprovalsFromDisk(): void {
  try {
    const raw = fs.readFileSync(approvalsPath(), "utf8");
    const parsed = JSON.parse(raw) as ApprovalRecord[];
    approvals.clear();
    for (const approval of parsed) {
      approvals.set(approval.id, approval);
    }
  } catch {
    // Missing approval state is expected before the first approval is created.
  }
}

function persistApprovalsToDisk(): void {
  fs.mkdirSync(path.dirname(approvalsPath()), { recursive: true });
  fs.writeFileSync(
    approvalsPath(),
    JSON.stringify([...approvals.values()], null, 2),
    "utf8",
  );
}

export function createApprovalRequest(input: {
  taskId: string;
  title: string;
  reason: string;
  risk: ApprovalRisk;
  action: string;
  details?: ApprovalDetails;
}): ApprovalRecord {
  loadApprovalsFromDisk();
  const approval: ApprovalRecord = {
    id: newId("approval"),
    taskId: input.taskId,
    title: input.title,
    reason: input.reason,
    risk: input.risk,
    action: input.action,
    createdAt: nowIso(),
    details: input.details,
    status: "pending",
  };
  approvals.set(approval.id, approval);
  persistApprovalsToDisk();
  return approval;
}

export function resolveApproval(
  approvalId: string,
  status: Exclude<ApprovalStatus, "pending">,
): ApprovalRecord {
  loadApprovalsFromDisk();
  const approval = approvals.get(approvalId);
  if (!approval) {
    throw new Error(`Approval not found: ${approvalId}`);
  }
  if (approval.status !== "pending") {
    throw new Error(`Approval already resolved: ${approvalId}`);
  }

  const resolved: ApprovalRecord = {
    ...approval,
    status,
    decidedAt: nowIso(),
  };
  approvals.set(approvalId, resolved);
  persistApprovalsToDisk();
  return resolved;
}

export function requireApprovedApproval(approvalId: string): ApprovalRecord {
  loadApprovalsFromDisk();
  const approval = approvals.get(approvalId);
  if (!approval) {
    throw new Error(`Approval not found: ${approvalId}`);
  }
  if (approval.status !== "approved") {
    throw new Error(`Approval is not approved: ${approvalId}`);
  }
  return approval;
}

export function recordApprovalExecution(
  approvalId: string,
  execution: Omit<ApprovalExecution, "attemptedAt">,
): ApprovalRecord {
  loadApprovalsFromDisk();
  const approval = approvals.get(approvalId);
  if (!approval) {
    throw new Error(`Approval not found: ${approvalId}`);
  }

  const updated: ApprovalRecord = {
    ...approval,
    execution: {
      ...execution,
      attemptedAt: nowIso(),
    },
  };
  approvals.set(approvalId, updated);
  persistApprovalsToDisk();
  return updated;
}

export function getApprovalById(
  approvalId: string,
): ApprovalRecord | undefined {
  loadApprovalsFromDisk();
  return approvals.get(approvalId);
}

export function listApprovals(options?: {
  full?: boolean;
  limit?: number;
}): ApprovalRecord[] {
  loadApprovalsFromDisk();
  let list = [...approvals.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  if (options?.limit != null && options.limit > 0) {
    list = list.slice(0, options.limit);
  }
  if (options?.full) {
    return list;
  }
  return list.map((approval) =>
    summarizeApprovalForList(approval) as ApprovalRecord,
  );
}
