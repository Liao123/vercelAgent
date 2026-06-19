/**
 * 内置浏览器 URL 状态 API。
 *
 * Web 阶段只负责记录和返回要打开的 URL；真正 WebView/Chrome DevTools
 * 控制留给 Electron 或本地 agent-server。
 */
import {
  getPersistedBrowserPageSnapshot,
  getPersistedBrowserTarget,
  openBrowserUrl,
} from "@/agent/browser";
import {
  getBrowserTabsState,
  getActiveBrowserTab,
  tabToBrowserTarget,
} from "@/agent/browser/browser-tabs";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getBrowserTabsState();
  const active = await getActiveBrowserTab();
  return Response.json({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    version: state.version,
    target: active?.url
      ? tabToBrowserTarget(active, state.version)
      : await getPersistedBrowserTarget(),
    snapshot: await getPersistedBrowserPageSnapshot(),
  });
}

export async function POST(request: Request) {
  let body: {
    url?: string;
    requestedBy?: "user" | "agent" | "system";
    newTab?: boolean;
    tabId?: string;
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
    const target = await openBrowserUrl({
      url: body.url,
      requestedBy: body.requestedBy ?? "user",
      newTab: body.newTab,
      tabId: body.tabId,
    });
    const state = await getBrowserTabsState();
    return Response.json({
      target,
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      version: state.version,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to open URL." },
      { status: 400 },
    );
  }
}
