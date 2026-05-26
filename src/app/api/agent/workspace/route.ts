/**
 * Agent workspace inspection API.
 *
 * 只读接口：返回当前 workspace、Git 状态、包管理器、框架和项目规则摘要。
 */
import { getCurrentWorkspace } from "@/agent/workspace";
import { setConfiguredWorkspacePath } from "@/agent/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
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
