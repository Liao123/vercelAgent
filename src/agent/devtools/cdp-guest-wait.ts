/**
 * 等待 WebView CDP guest 就绪（Agent 工具调用前）。
 */
import { getPersistedBrowserCdpGuest } from "@/agent/browser/browser-cdp-guest";
import { getCdpBridgeBaseUrl } from "@/agent/devtools/cdp-bridge-config";

async function guestLiveOnBridge(
  baseUrl: string,
  guestId?: number,
): Promise<boolean> {
  const suffix =
    guestId != null && Number.isFinite(guestId)
      ? `?guestId=${guestId}`
      : "";
  try {
    const res = await fetch(`${baseUrl}/guest${suffix}`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export async function waitForCdpGuest(timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const base = await getCdpBridgeBaseUrl();
    if (!base) return false;

    if (await guestLiveOnBridge(base)) return true;

    const persisted = await getPersistedBrowserCdpGuest();
    if (
      persisted?.guestWebContentsId &&
      (await guestLiveOnBridge(base, persisted.guestWebContentsId))
    ) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  return false;
}

export async function isCdpGuestReady(): Promise<boolean> {
  const base = await getCdpBridgeBaseUrl();
  if (!base) return false;
  return guestLiveOnBridge(base);
}
