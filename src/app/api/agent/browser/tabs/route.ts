/**
 * 浏览器多标签 API（A133）。
 */
import {
  closeBrowserTab,
  createBrowserTab,
  getBrowserTabsState,
  switchBrowserTab,
  tabToBrowserTarget,
} from "@/agent/browser/browser-tabs";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getBrowserTabsState();
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  return Response.json({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    version: state.version,
    target: active?.url ? tabToBrowserTarget(active, state.version) : null,
  });
}

export async function POST(request: Request) {
  let body: {
    action?: "new" | "switch" | "close";
    tabId?: string;
    url?: string;
    requestedBy?: "user" | "agent" | "system";
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    if (body.action === "switch") {
      if (!body.tabId) {
        return Response.json({ error: "tabId is required." }, { status: 400 });
      }
      const state = await switchBrowserTab(body.tabId);
      const active = state.tabs.find((tab) => tab.id === state.activeTabId);
      return Response.json({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        version: state.version,
        target: active?.url ? tabToBrowserTarget(active, state.version) : null,
      });
    }

    if (body.action === "close") {
      if (!body.tabId) {
        return Response.json({ error: "tabId is required." }, { status: 400 });
      }
      const state = await closeBrowserTab(body.tabId);
      const active = state.tabs.find((tab) => tab.id === state.activeTabId);
      return Response.json({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        version: state.version,
        target: active?.url ? tabToBrowserTarget(active, state.version) : null,
      });
    }

    const state = await createBrowserTab({
      url: body.url,
      requestedBy: body.requestedBy ?? "user",
    });
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    return Response.json({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      version: state.version,
      target: active?.url ? tabToBrowserTarget(active, state.version) : null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Tab action failed." },
      { status: 400 },
    );
  }
}
