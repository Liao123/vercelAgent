/**
 * Agent approval API.
 *
 * 当前提供审批创建、列表和批准/拒绝接口。后续 UI 应把高风险操作展示给用户确认。
 */
import {
  createApprovalRequest,
  listApprovals,
  resolveApproval,
} from "@/agent/approval";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ approvals: listApprovals() });
}

export async function POST(request: Request) {
  let body: {
    taskId?: string;
    title?: string;
    reason?: string;
    risk?: "low" | "medium" | "high";
    action?: string;
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
  return Response.json({ approval });
}
