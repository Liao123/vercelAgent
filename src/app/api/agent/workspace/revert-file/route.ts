import { revertWorkspaceFile } from "@/lib/workspace-revert-file";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { path?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const filePath = typeof body.path === "string" ? body.path.trim() : "";
  if (!filePath) {
    return Response.json({ error: "path is required." }, { status: 400 });
  }

  try {
    const workspace = await getCurrentWorkspace();
    const result = await revertWorkspaceFile(workspace.rootPath, filePath);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to revert file.",
      },
      { status: 400 },
    );
  }
}
