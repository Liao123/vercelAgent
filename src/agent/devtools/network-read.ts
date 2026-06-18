/**
 * Agent 读网络：优先 CDP，失败则 HAR-lite / 快照降级。
 */
import {
  getPersistedBrowserHarLog,
  getPersistedBrowserPageSnapshot,
} from "@/agent/browser";
import { isCdpBridgeAvailable } from "@/agent/devtools/cdp-bridge-config";
import { cdpNetworkRequests } from "@/agent/devtools/cdp-client";

export async function readBrowserNetworkForAgent(): Promise<{
  ok: boolean;
  source: "cdp" | "har-lite" | "none";
  entryCount: number;
  entries: unknown[];
  requests?: unknown[];
  harLog?: unknown;
  snapshotUrl?: string | null;
  hint?: string;
}> {
  if (await isCdpBridgeAvailable()) {
    try {
      const { entries, requests } = await cdpNetworkRequests();
      if (entries.length > 0 || requests.length > 0) {
        return {
          ok: true,
          source: "cdp",
          entryCount: entries.length,
          entries,
          requests,
        };
      }
    } catch {
      /* fallback below */
    }
  }

  const harLog = await getPersistedBrowserHarLog();
  const entries = harLog?.entries ?? [];
  if (entries.length > 0) {
    return {
      ok: true,
      source: "har-lite",
      entryCount: entries.length,
      entries,
      harLog,
      hint: "CDP 未就绪，已返回 HAR-lite。完整 CDP 请 npm run dev:desktop 并等待浏览器加载。",
    };
  }

  const snapshot = await getPersistedBrowserPageSnapshot();
  return {
    ok: Boolean(snapshot),
    source: "none",
    entryCount: 0,
    entries: [],
    snapshotUrl: snapshot?.url ?? null,
    hint: snapshot
      ? "暂无网络记录。请先 browser.open，等待右栏浏览器加载后重试，或改用 browser.inspect。"
      : "请先 browser.open 并在右栏浏览器 Tab 等待页面加载。",
  };
}
