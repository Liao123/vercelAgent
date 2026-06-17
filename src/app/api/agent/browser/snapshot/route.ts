/**
 * 浏览器预览快照上报（桌面 WebView dom-ready 时由客户端 POST）。
 */
import { saveBrowserPageSnapshot } from "@/agent/browser/browser-snapshot";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    url?: string;
    title?: string | null;
    textPreview?: string | null;
    source?: "webview" | "iframe";
    consoleMessages?: Array<{
      level: "debug" | "info" | "warning" | "error";
      message: string;
      line?: number;
      sourceId?: string;
    }>;
    domOutline?: string | null;
    pageErrors?: string[];
    loadError?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.url?.trim()) {
    return Response.json({ error: "url is required." }, { status: 400 });
  }

  try {
    const snapshot = await saveBrowserPageSnapshot({
      url: body.url.trim(),
      title: body.title ?? null,
      textPreview: body.textPreview ?? null,
      source: body.source === "iframe" ? "iframe" : "webview",
      consoleMessages: body.consoleMessages,
      domOutline: body.domOutline ?? null,
      pageErrors: body.pageErrors,
      loadError: body.loadError ?? null,
    });
    return Response.json({ snapshot });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save snapshot.",
      },
      { status: 400 },
    );
  }
}
