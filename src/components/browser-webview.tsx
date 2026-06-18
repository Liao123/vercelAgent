"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type RefObject,
} from "react";
import type { BrowserConsoleMessage } from "@/agent/browser/browser-snapshot";
import type { BrowserQueryMatch } from "@/agent/browser/browser-query";
import {
  captureBrowserScreenshotCdp,
  fetchBrowserNetworkCdp,
  registerBrowserGuest,
} from "@/lib/desktop-bridge";
import { isIgnorableWebviewLoadError } from "@/lib/browser-webview-errors";
import {
  BROWSER_DOM_OUTLINE_SCRIPT,
  BROWSER_HAR_COLLECT_SCRIPT,
  BROWSER_PROBE_INJECT,
  BROWSER_PROBE_READ_ERRORS,
  buildBrowserQueryScript,
  mapWebviewConsoleLevel,
} from "@/lib/browser-webview-probe";
import { captureWebviewScreenshot } from "@/lib/browser-webview-screenshot";

export type BrowserWebviewHandle = {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
};

type BrowserWebviewProps = {
  url: string;
  version: number;
  embedded?: boolean;
  onSnapshot?: (meta?: { cdp: boolean }) => void;
  onFail?: (reason?: string) => void;
  onNavigate?: (url: string) => void;
  onNavStateChange?: (state: {
    canGoBack: boolean;
    canGoForward: boolean;
  }) => void;
};

type WebviewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
  getURL?: () => string;
  getWebContentsId?: () => number;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  capturePage?: () => Promise<{
    getSize: () => { width: number; height: number };
    toJPEG: (quality: number) => Uint8Array | Buffer;
  }>;
};

type ConsoleMessageEvent = Event & {
  message?: string;
  level?: number;
  line?: number;
  sourceId?: string;
};

type FailLoadEvent = Event & {
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
};

const QUERY_POLL_MS = 2500;

async function reportSnapshot(payload: {
  url: string;
  title: string | null;
  textPreview: string | null;
  consoleMessages?: BrowserConsoleMessage[];
  domOutline?: string | null;
  pageErrors?: string[];
  loadError?: string | null;
  harEntries?: unknown[];
  screenshotJpegBase64?: string | null;
  screenshotWidth?: number;
  screenshotHeight?: number;
}) {
  const res = await fetch("/api/agent/browser/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      source: "webview",
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "保存浏览器快照失败。");
  }
}

async function fetchPendingQuery(): Promise<{
  selector: string;
  maxResults: number;
} | null> {
  try {
    const res = await fetch("/api/agent/browser/query");
    if (!res.ok) return null;
    const data = (await res.json()) as {
      pending?: { selector: string; maxResults: number } | null;
    };
    if (!data.pending?.selector) return null;
    return data.pending;
  } catch {
    return null;
  }
}

async function runPendingQuery(wv: WebviewElement, fallbackUrl: string) {
  if (typeof wv.executeJavaScript !== "function") return;

  const pending = await fetchPendingQuery();
  if (!pending) return;

  await wv.executeJavaScript(BROWSER_PROBE_INJECT);
  const matches = (await wv.executeJavaScript(
    buildBrowserQueryScript(pending.selector, pending.maxResults),
  )) as BrowserQueryMatch[];
  const currentUrl =
    typeof wv.getURL === "function"
      ? (() => {
          try {
            return wv.getURL() ?? fallbackUrl;
          } catch {
            return fallbackUrl;
          }
        })()
      : fallbackUrl;

  await fetch("/api/agent/browser/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selector: pending.selector,
      url: currentUrl,
      matches: Array.isArray(matches) ? matches : [],
    }),
  });
}

function guestIdFromWebview(wv: WebviewElement): number | null {
  if (typeof wv.getWebContentsId !== "function") return null;
  try {
    const id = wv.getWebContentsId();
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function safeWebviewNav(
  wv: WebviewElement | null,
  domReady: boolean,
): { canGoBack: boolean; canGoForward: boolean } {
  if (!wv || !domReady) {
    return { canGoBack: false, canGoForward: false };
  }
  try {
    return {
      canGoBack: Boolean(wv.canGoBack?.()),
      canGoForward: Boolean(wv.canGoForward?.()),
    };
  } catch {
    return { canGoBack: false, canGoForward: false };
  }
}

function safeWebviewAction(
  wv: WebviewElement | null,
  domReady: boolean,
  action: (wv: WebviewElement) => void,
) {
  if (!wv || !domReady) return;
  try {
    action(wv);
  } catch {
    /* dom-ready 前 Electron WebView API 会抛错 */
  }
}

export const BrowserWebview = forwardRef<BrowserWebviewHandle, BrowserWebviewProps>(
  function BrowserWebview(
    {
      url,
      version,
      embedded = false,
      onSnapshot,
      onFail,
      onNavigate,
      onNavStateChange,
    },
    ref,
  ) {
    const webviewRef = useRef<HTMLElement>(null);
    const domReadyRef = useRef(false);
    const consoleBufferRef = useRef<BrowserConsoleMessage[]>([]);
    const loadErrorRef = useRef<string | null>(null);
    const captureInFlightRef = useRef(false);

    const notifyNavState = () => {
      const wv = webviewRef.current as WebviewElement | null;
      onNavStateChange?.(safeWebviewNav(wv, domReadyRef.current));
    };

    useImperativeHandle(ref, () => ({
      goBack: () => {
        const wv = webviewRef.current as WebviewElement | null;
        safeWebviewAction(wv, domReadyRef.current, (el) => el.goBack?.());
      },
      goForward: () => {
        const wv = webviewRef.current as WebviewElement | null;
        safeWebviewAction(wv, domReadyRef.current, (el) => el.goForward?.());
      },
      reload: () => {
        const wv = webviewRef.current as WebviewElement | null;
        safeWebviewAction(wv, domReadyRef.current, (el) => el.reload?.());
      },
      canGoBack: () => {
        const wv = webviewRef.current as WebviewElement | null;
        return safeWebviewNav(wv, domReadyRef.current).canGoBack;
      },
      canGoForward: () => {
        const wv = webviewRef.current as WebviewElement | null;
        return safeWebviewNav(wv, domReadyRef.current).canGoForward;
      },
    }));

    useEffect(() => {
      domReadyRef.current = false;
      consoleBufferRef.current = [];
      loadErrorRef.current = null;
      captureInFlightRef.current = false;
    }, [url, version]);

    useEffect(() => {
      const node = webviewRef.current;
      if (!node) return;

      const capture = async () => {
        const wv = node as WebviewElement;
        if (typeof wv.executeJavaScript !== "function") return;
        if (captureInFlightRef.current) return;

        captureInFlightRef.current = true;
        let usedCdp = false;
        try {
          const guestId = guestIdFromWebview(wv);
          if (guestId != null) {
            await registerBrowserGuest(guestId);
            void fetch("/api/agent/browser/cdp/guest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                guestWebContentsId: guestId,
                browserVersion: version,
              }),
            });
          }

          await wv.executeJavaScript(BROWSER_PROBE_INJECT);
          const currentUrl =
            typeof wv.getURL === "function"
              ? (() => {
                  try {
                    return wv.getURL() ?? url;
                  } catch {
                    return url;
                  }
                })()
              : url;
          onNavigate?.(currentUrl);
          notifyNavState();

          const title = (await wv.executeJavaScript(
            "document.title || ''",
          )) as string;
          const textPreview = (await wv.executeJavaScript(
            "(document.body && document.body.innerText) ? document.body.innerText.slice(0, 2000) : ''",
          )) as string;
          const domOutline = (await wv.executeJavaScript(
            BROWSER_DOM_OUTLINE_SCRIPT,
          )) as string;
          const pageErrors = (await wv.executeJavaScript(
            BROWSER_PROBE_READ_ERRORS,
          )) as string[];
          const injectedHar = (await wv.executeJavaScript(
            BROWSER_HAR_COLLECT_SCRIPT,
          )) as unknown[];

          let screenshotJpegBase64: string | null = null;
          let screenshotWidth: number | undefined;
          let screenshotHeight: number | undefined;

          if (guestId != null) {
            const cdpJpeg = await captureBrowserScreenshotCdp(guestId);
            if (cdpJpeg) {
              usedCdp = true;
              screenshotJpegBase64 = cdpJpeg;
            }
          }

          if (!screenshotJpegBase64) {
            const shot = await captureWebviewScreenshot(wv);
            screenshotJpegBase64 = shot?.jpegBase64 ?? null;
            screenshotWidth = shot?.width;
            screenshotHeight = shot?.height;
          }

          const cdpNetwork =
            guestId != null ? await fetchBrowserNetworkCdp(guestId) : [];
          const harEntries = [
            ...(Array.isArray(injectedHar) ? injectedHar : []),
            ...cdpNetwork,
          ];

          await reportSnapshot({
            url: currentUrl,
            title: title || null,
            textPreview: textPreview || null,
            consoleMessages: [...consoleBufferRef.current],
            domOutline: domOutline || null,
            pageErrors: Array.isArray(pageErrors) ? pageErrors : [],
            loadError: loadErrorRef.current,
            harEntries,
            screenshotJpegBase64,
            screenshotWidth,
            screenshotHeight,
          });
          loadErrorRef.current = null;
          await runPendingQuery(wv, currentUrl);
          onSnapshot?.({ cdp: usedCdp });
        } catch {
          // 跳转中 executeJavaScript 可能失败，不算整页加载失败
        } finally {
          captureInFlightRef.current = false;
        }
      };

      const onConsoleMessage = (event: Event) => {
        const detail = event as ConsoleMessageEvent;
        if (!detail.message) return;
        consoleBufferRef.current.push({
          level: mapWebviewConsoleLevel(detail.level ?? 1),
          message: detail.message.slice(0, 500),
          line: detail.line,
          sourceId: detail.sourceId,
        });
        if (consoleBufferRef.current.length > 40) {
          consoleBufferRef.current.shift();
        }
      };

      const onDomReady = () => {
        domReadyRef.current = true;
        notifyNavState();
        void capture();
      };

      const onDidStartLoading = () => {
        loadErrorRef.current = null;
        domReadyRef.current = false;
        notifyNavState();
      };

      const onDidNavigate = () => {
        notifyNavState();
      };

      const onDidFailLoad = (event: Event) => {
        const detail = event as FailLoadEvent;
        if (isIgnorableWebviewLoadError(detail.errorCode)) return;

        const reason =
          detail.errorDescription ??
          (detail.errorCode != null
            ? `加载失败 (${detail.errorCode})`
            : "加载失败");
        loadErrorRef.current = reason;
        onFail?.(reason);
      };

      node.addEventListener("dom-ready", onDomReady);
      node.addEventListener("did-start-loading", onDidStartLoading);
      node.addEventListener("did-navigate", onDidNavigate);
      node.addEventListener("did-navigate-in-page", onDidNavigate);
      node.addEventListener("did-fail-load", onDidFailLoad);
      node.addEventListener("console-message", onConsoleMessage as EventListener);

      const queryTimer = window.setInterval(() => {
        const wv = node as WebviewElement;
        void runPendingQuery(wv, url);
      }, QUERY_POLL_MS);

      return () => {
        window.clearInterval(queryTimer);
        node.removeEventListener("dom-ready", onDomReady);
        node.removeEventListener("did-start-loading", onDidStartLoading);
        node.removeEventListener("did-navigate", onDidNavigate);
        node.removeEventListener("did-navigate-in-page", onDidNavigate);
        node.removeEventListener("did-fail-load", onDidFailLoad);
        node.removeEventListener(
          "console-message",
          onConsoleMessage as EventListener,
        );
      };
    }, [url, version, onSnapshot, onFail, onNavigate, onNavStateChange]);

    return (
      <webview
        key={version}
        ref={webviewRef as RefObject<HTMLElement>}
        src={url}
        allowpopups=""
        className="h-full w-full bg-white"
        style={{ display: "inline-flex", width: "100%", height: "100%" }}
      />
    );
  },
);
