/**
 * Agent approval API.
 *
 * 当前提供审批创建、列表和批准/拒绝接口。后续 UI 应把高风险操作展示给用户确认。
 */
import {
  createApprovalRequest,
  getApprovalById,
  listApprovals,
  resolveApproval,
} from "@/agent/approval";
import { summarizeApprovalForList } from "@/agent/approval/approval-list-summary";
import type { ApprovalDetails } from "@/agent/types";

export const dynamic = "force-dynamic";

const DEFAULT_LIST_LIMIT = 50;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const full = url.searchParams.get("full") === "1";
  const limitParam = url.searchParams.get("limit");
  const limit =
    limitParam == null
      ? DEFAULT_LIST_LIMIT
      : Math.max(0, Number.parseInt(limitParam, 10) || 0);

  const approvals = listApprovals({
    full,
    limit: limit > 0 ? limit : undefined,
  });

  return Response.json({ approvals, summary: !full, limit: limit || null });
}

export async function POST(request: Request) {
  let body: {
    taskId?: string;
    title?: string;
    reason?: string;
    risk?: "low" | "medium" | "high";
    action?: string;
    details?: ApprovalDetails;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.taskId || !body.title || !body.reason || !body.risk || !body.action) {
    return Response.json(
      { error: "taskId, title, reason, risk, and action are required." },
      { status: 400 },
    );
  }

  const approval = createApprovalRequest({
    taskId: body.taskId,
    title: body.title,
    reason: body.reason,
    risk: body.risk,
    action: body.action,
    details: body.details,
  });

  return Response.json({ approval }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: { approvalId?: string; status?: "approved" | "rejected" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.approvalId || !body.status) {
    return Response.json(
      { error: "approvalId and status are required." },
      { status: 400 },
    );
  }

  const approval = resolveApproval(body.approvalId, body.status);
  return Response.json({ approval: summarizeApprovalForList(approval) });
}
