import { getApprovalById } from "@/agent/approval";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  const { approvalId } = await context.params;
  const approval = getApprovalById(approvalId);
  if (!approval) {
    return Response.json({ error: "Approval not found." }, { status: 404 });
  }
  return Response.json({ approval });
}
