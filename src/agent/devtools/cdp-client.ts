/**
 * Agent 侧调用 Electron CDP HTTP 桥（Codex / chrome-devtools-mcp 同级底座）。
 */
import { getPersistedBrowserCdpGuest } from "@/agent/browser/browser-cdp-guest";
import { getCdpBridgeBaseUrl } from "@/agent/devtools/cdp-bridge-config";
import { waitForCdpGuest } from "@/agent/devtools/cdp-guest-wait";

const DESKTOP_HINT =
  "需要桌面版内置浏览器：npm run dev:desktop，并在右栏浏览器 Tab 打开目标 URL。";

type BridgeJson = Record<string, unknown>;

async function bridgePost(
  path: string,
  body?: Record<string, unknown>,
  options?: { waitGuestMs?: number },
): Promise<BridgeJson> {
  const base = await getCdpBridgeBaseUrl();
  if (!base) {
    throw new Error(`${DESKTOP_HINT}（CDP 桥未启动）`);
  }

  const waitMs = options?.waitGuestMs ?? 10_000;
  const guestReady = await waitForCdpGuest(waitMs);
  if (!guestReady) {
    throw new Error(
      `${DESKTOP_HINT} WebView 未挂载：Agent 打开 URL 后请切到右栏「浏览器」Tab 并等待页面加载。`,
    );
  }

  const guest = await getPersistedBrowserCdpGuest();
  const payload = { ...body };
  if (payload.guestId == null && guest?.guestWebContentsId) {
    payload.guestId = guest.guestWebContentsId;
  }

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  const data = (await res.json().catch(() => ({}))) as BridgeJson;
  if (!res.ok || data.ok === false) {
    throw new Error(
      typeof data.error === "string" ? data.error : `CDP 桥调用失败 (${path})`,
    );
  }
  return data;
}

async function bridgeGet(
  path: string,
  options?: { waitGuestMs?: number },
): Promise<BridgeJson> {
  const base = await getCdpBridgeBaseUrl();
  if (!base) {
    throw new Error(`${DESKTOP_HINT}（CDP 桥未启动）`);
  }

  const waitMs = options?.waitGuestMs ?? 10_000;
  if (!(await waitForCdpGuest(waitMs))) {
    throw new Error(
      `${DESKTOP_HINT} WebView 未就绪。请打开右栏「浏览器」Tab 并等待页面加载。`,
    );
  }

  const guest = await getPersistedBrowserCdpGuest();
  const suffix = guest?.guestWebContentsId
    ? `?guestId=${guest.guestWebContentsId}`
    : "";
  const res = await fetch(`${base}${path}${suffix}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as BridgeJson;
  if (!res.ok || data.ok === false) {
    throw new Error(
      typeof data.error === "string" ? data.error : `CDP 桥读取失败 (${path})`,
    );
  }
  return data;
}

export async function cdpActivateGuest(guestId: number): Promise<BridgeJson> {
  return bridgePost("/activate", { guestId });
}

export async function cdpListGuestPages(): Promise<{
  pages: Array<{
    guestId: number;
    active: boolean;
    url: string | null;
    title: string | null;
  }>;
  activeGuestId: number | null;
}> {
  const base = await getCdpBridgeBaseUrl();
  if (!base) {
    throw new Error(`${DESKTOP_HINT}（CDP 桥未启动）`);
  }
  const res = await fetch(`${base}/pages`, {
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as BridgeJson;
  if (!res.ok || data.ok === false) {
    throw new Error(
      typeof data.error === "string" ? data.error : "CDP 桥读取 pages 失败",
    );
  }
  const pages = Array.isArray(data.pages) ? data.pages : [];
  return {
    pages: pages as Array<{
      guestId: number;
      active: boolean;
      url: string | null;
      title: string | null;
    }>,
    activeGuestId:
      typeof data.activeGuestId === "number" ? data.activeGuestId : null,
  };
}

export async function cdpSend(
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const data = await bridgePost("/send", { method, params });
  return data.result;
}

export async function cdpClick(selector: string): Promise<BridgeJson> {
  return bridgePost("/click", { selector });
}

export async function cdpType(selector: string, text: string): Promise<BridgeJson> {
  return bridgePost("/type", { selector, text });
}

export type CdpScreenshotOptions = {
  /** 在隐藏 BrowserWindow（1920×1080）中截图，不受右栏 webview 尺寸限制 */
  useCaptureWindow?: boolean;
  url?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  /** viewport | fullPage | designArtboard — 设计稿站默认 designArtboard */
  shotMode?: "viewport" | "fullPage" | "designArtboard";
  fullPage?: boolean;
  quality?: number;
};

export type CdpScreenshotResult = {
  jpegBase64: string | null;
  captureWindow: boolean;
  mode?: string;
  url?: string;
  viewportWidth?: number;
  viewportHeight?: number;
};

export async function cdpScreenshotJpegBase64(
  options?: CdpScreenshotOptions,
): Promise<CdpScreenshotResult> {
  const body: Record<string, unknown> = {};
  if (options?.useCaptureWindow) {
    body.useCaptureWindow = true;
    if (options.url) body.url = options.url;
    if (options.viewportWidth) body.viewportWidth = options.viewportWidth;
    if (options.viewportHeight) body.viewportHeight = options.viewportHeight;
    if (options.shotMode) body.shotMode = options.shotMode;
    if (options.quality) body.quality = options.quality;
  } else if (options?.fullPage === false) {
    body.fullPage = false;
  }
  const data = await bridgePost("/screenshot", body);
  return {
    jpegBase64:
      typeof data.jpegBase64 === "string" ? data.jpegBase64 : null,
    captureWindow: data.captureWindow === true,
    mode: typeof data.mode === "string" ? data.mode : undefined,
    url: typeof data.url === "string" ? data.url : undefined,
    viewportWidth:
      typeof data.viewportWidth === "number" ? data.viewportWidth : undefined,
    viewportHeight:
      typeof data.viewportHeight === "number" ? data.viewportHeight : undefined,
  };
}

export async function cdpDomSnapshot(): Promise<unknown> {
  const data = await bridgePost("/dom-snapshot", {});
  return data.result;
}

export async function cdpAxTree(): Promise<unknown> {
  const data = await bridgePost("/ax-tree", {});
  return data.result;
}

export async function cdpInspectAt(x: number, y: number): Promise<unknown> {
  const data = await bridgePost("/inspect-at", { x, y });
  return data.result;
}

export async function cdpConsoleAndExceptions(): Promise<{
  console: unknown[];
  exceptions: unknown[];
}> {
  const data = await bridgeGet("/console");
  return {
    console: Array.isArray(data.console) ? data.console : [],
    exceptions: Array.isArray(data.exceptions) ? data.exceptions : [],
  };
}

export async function cdpNetworkRequests(): Promise<{
  entries: unknown[];
  requests: unknown[];
}> {
  const data = await bridgeGet("/network");
  return {
    entries: Array.isArray(data.entries) ? data.entries : [],
    requests: Array.isArray(data.requests) ? data.requests : [],
  };
}

export async function cdpBoxModelForSelector(selector: string): Promise<unknown> {
  const doc = (await cdpSend("DOM.getDocument")) as {
    root?: { nodeId?: number };
  };
  const rootId = doc?.root?.nodeId;
  if (!rootId) throw new Error("DOM.getDocument 无 root。");

  const query = (await cdpSend("DOM.querySelector", {
    nodeId: rootId,
    selector,
  })) as { nodeId?: number };
  if (!query?.nodeId) throw new Error(`selector 未找到：${selector}`);

  return cdpSend("DOM.getBoxModel", { nodeId: query.nodeId });
}

export async function cdpComputedStylesForSelector(
  selector: string,
  properties: string[],
): Promise<unknown> {
  const doc = (await cdpSend("DOM.getDocument")) as {
    root?: { nodeId?: number };
  };
  const rootId = doc?.root?.nodeId;
  if (!rootId) throw new Error("DOM.getDocument 无 root。");

  const query = (await cdpSend("DOM.querySelector", {
    nodeId: rootId,
    selector,
  })) as { nodeId?: number };
  if (!query?.nodeId) throw new Error(`selector 未找到：${selector}`);

  const resolved = (await cdpSend("DOM.resolveNode", {
    nodeId: query.nodeId,
  })) as { object?: { objectId?: string } };
  const objectId = resolved?.object?.objectId;
  if (!objectId) throw new Error("DOM.resolveNode 失败。");

  return cdpSend("CSS.getComputedStyleForNode", {
    nodeId: query.nodeId,
  });
}

export async function cdpEvaluate(expression: string): Promise<unknown> {
  const raw = await cdpSend("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const payload = raw as { result?: { value?: unknown }; value?: unknown };
  if (payload?.result?.value !== undefined) return payload.result.value;
  if (payload?.value !== undefined) return payload.value;
  return raw;
}

export async function cdpPerformanceStartTrace(options?: {
  reload?: boolean;
}): Promise<BridgeJson> {
  return bridgePost("/performance/start", {
    reload: options?.reload === true,
  });
}

export async function cdpPerformanceStopTrace(): Promise<BridgeJson> {
  return bridgePost("/performance/stop", {});
}
