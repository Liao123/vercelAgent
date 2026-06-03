import { getCurrentWorkspace } from "@/agent/workspace";
import { readWorkspaceFileDiff } from "@/lib/workspace-file-diff";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get("path")?.trim();
  if (!filePath) {
    return Response.json({ error: "path is required." }, { status: 400 });
  }

  try {
    const workspace = await getCurrentWorkspace();
    const diff = await readWorkspaceFileDiff(workspace.rootPath, filePath);
    return Response.json({ path: filePath, ...diff });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to read file diff.",
      },
      { status: 400 },
    );
  }
}
