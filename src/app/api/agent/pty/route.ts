/**
 * A168：交互式 PTY API（spawn / write / resize / kill）。
 * 阶段 B：AGENT_SERVER_URL 时代理到长驻 agent-server，shell 会话跨 Next 热重载保留。
 */
import { getCurrentWorkspace } from "@/agent/workspace";
import {
  executePtyAction,
  ptyStatusPayload,
  type PtyActionBody,
} from "@/agent/terminal/pty-actions";
import {
  isRemotePtyEnabled,
  proxyPtyGet,
  proxyPtyPost,
} from "@/agent-server/remote-pty";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isRemotePtyEnabled()) {
    return proxyPtyGet();
  }
  return Response.json(ptyStatusPayload());
}

export async function POST(request: Request) {
  let body: PtyActionBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (isRemotePtyEnabled()) {
    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (action === "spawn") {
      try {
        const workspace = await getCurrentWorkspace();
        body = { ...body, workspaceRoot: workspace.rootPath };
      } catch {
        /* agent-server falls back to its own workspace */
      }
    }
    return proxyPtyPost(request, body as Record<string, unknown>);
  }

  try {
    const workspace = await getCurrentWorkspace();
    const result = executePtyAction(body, workspace.rootPath);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "PTY request failed.",
      },
      { status: 400 },
    );
  }
}
