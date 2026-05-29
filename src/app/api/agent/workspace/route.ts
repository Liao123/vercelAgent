/**
 * Agent workspace inspection API.
 *
 * 只读接口：返回当前 workspace、Git 状态、包管理器、框架和项目规则摘要。
 */
import { getCurrentWorkspace } from "@/agent/workspace";
import { setConfiguredWorkspacePath } from "@/agent/workspace";
import {
  hideWorkspaceInSidebar,
  listHiddenWorkspaceIds,
  showWorkspaceInSidebar,
} from "@/agent/workspace/workspace-sidebar-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("sidebar") === "hidden") {
    return Response.json({ hiddenWorkspaceIds: listHiddenWorkspaceIds() });
  }

  const workspace = await getCurrentWorkspace();
  return Response.json({ workspace });
}

export async function POST(request: Request) {
  let body: { rootPath?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.rootPath?.trim()) {
    return Response.json({ error: "rootPath is required." }, { status: 400 });
  }

  try {
    const config = await setConfiguredWorkspacePath(body.rootPath);
    const workspace = await getCurrentWorkspace();
    return Response.json({ config, workspace });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to set workspace.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const workspaceId = new URL(request.url).searchParams
    .get("workspaceId")
    ?.trim();
  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required." }, { status: 400 });
  }

  hideWorkspaceInSidebar(workspaceId);
  return Response.json({
    ok: true,
    workspaceId,
    note: "Project hidden from sidebar. Disk files and traces are unchanged.",
  });
}

export async function PATCH(request: Request) {
  let body: { workspaceId?: string; action?: "show" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId || body.action !== "show") {
    return Response.json(
      { error: "workspaceId and action=show are required." },
      { status: 400 },
    );
  }

  showWorkspaceInSidebar(workspaceId);
  return Response.json({ ok: true, workspaceId });
}
