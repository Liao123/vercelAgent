/**
 * Agent patch API.
 *
 * 默认只预览 patch。真正写入文件时必须传入已批准的 approvalId。
 */
import { applyUnifiedPatch } from "@/agent/tools";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    patch?: string;
    mode?: "preview" | "apply";
    approvalId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.patch) {
    return Response.json({ error: "patch is required." }, { status: 400 });
  }

  const workspace = await getCurrentWorkspace();
  try {
    const result = await applyUnifiedPatch({
      rootPath: workspace.rootPath,
      patch: body.patch,
      mode: body.mode ?? "preview",
      approvalId: body.approvalId,
    });
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Patch failed.",
      },
      { status: 400 },
    );
  }
}
