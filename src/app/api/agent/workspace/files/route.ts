/**
 * Workspace 内文件路径联想（Composer @）。
 */
import {
  listWorkspaceFileHints,
  suggestFilePaths,
} from "@/agent/tools/file-tools";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  try {
    const workspace = await getCurrentWorkspace();
    const paths = query
      ? await suggestFilePaths(workspace.rootPath, query, 32)
      : await listWorkspaceFileHints(workspace.rootPath, 32);
    return Response.json({ paths });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to suggest files.",
      },
      { status: 400 },
    );
  }
}
