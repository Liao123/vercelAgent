/**
 * 内置浏览器 URL 状态 API。
 *
 * Web 阶段只负责记录和返回要打开的 URL；真正 WebView/Chrome DevTools
 * 控制留给 Electron 或本地 agent-server。
 */
import { getPersistedBrowserTarget, openBrowserUrl } from "@/agent/browser";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ target: await getPersistedBrowserTarget() });
}

export async function POST(request: Request) {
  let body: { url?: string; requestedBy?: "user" | "agent" | "system" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.url?.trim()) {
    return Response.json({ error: "url is required." }, { status: 400 });
  }

  try {
    const target = await openBrowserUrl({
      url: body.url,
      requestedBy: body.requestedBy ?? "user",
    });
    return Response.json({ target });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to open URL." },
      { status: 400 },
    );
  }
}
