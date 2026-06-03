/**
 * 工作区只读目录树（A088）。
 */
import { listDirectory } from "@/agent/tools/file-tools";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const relativePath = url.searchParams.get("path")?.trim() || ".";

  try {
    const workspace = await getCurrentWorkspace();
    const entries = await listDirectory(workspace.rootPath, relativePath);
    return Response.json({
      path: relativePath.replaceAll("\\", "/"),
      entries,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list directory.",
      },
      { status: 400 },
    );
  }
}
