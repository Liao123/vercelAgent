/**
 * 内置浏览器（Codex / Cursor 右栏 Chrome 布局）。
 *
 * - 桌面版：WebView + CDP
 * - 纯网页：可选 iframe 降级
 */
"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BrowserBackIcon,
  BrowserChromeIconButton,
  BrowserExpandIcon,
  BrowserForwardIcon,
  BrowserGlobeIcon,
  BrowserListIcon,
  BrowserMoreIcon,
  BrowserPlusIcon,
  BrowserRefreshIcon,
  BrowserStarIcon,
} from "@/components/browser-chrome-icons";
import {
  BrowserWebview,
  type BrowserWebviewHandle,
} from "@/components/browser-webview";
import { useDesktopApp } from "@/lib/use-desktop-app";

type BrowserTargetView = {
  url: string;
  requestedBy: "user" | "agent" | "system";
  openedAt: string;
  updatedAt: string;
  version: number;
};

type BrowserSnapshotView = {
  title?: string | null;
  url?: string | null;
};

function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function isSameAppPreviewUrl(input: string): boolean {
  try {
    const parsed = new URL(normalizeUrlInput(input));
    if (typeof window === "undefined") return false;
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function tabLabelFrom(
  target: BrowserTargetView | null,
  pageTitle: string | null,
): string {
  if (pageTitle?.trim()) return pageTitle.trim();
  if (!target) return "新标签页";
  try {
    return new URL(target.url).hostname || target.url;
  } catch {
    return target.url;
  }
}

export function BrowserPanel({
  embedded = false,
  chromeVisible = true,
}: {
  embedded?: boolean;
  chromeVisible?: boolean;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [target, setTarget] = useState<BrowserTargetView | null>(null);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [frameFailReason, setFrameFailReason] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iframeFallback, setIframeFallback] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const lastSeenVersion = useRef<number | null>(null);
  const webviewRef = useRef<BrowserWebviewHandle>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const desktopBrowser = useDesktopApp();

  const codexMode = desktopBrowser;
  const browserEnabled = codexMode || iframeFallback;

  const handleNavStateChange = useCallback(
    (state: { canGoBack: boolean; canGoForward: boolean }) => {
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    },
    [],
  );

  useEffect(() => {
    if (!target) {
      setCanGoBack(false);
      setCanGoForward(false);
    }
  }, [target]);

  useEffect(() => {
    let cancelled = false;

    async function refreshTarget() {
      const res = await fetch("/api/agent/browser");
      if (!res.ok) return;

      const data = (await res.json()) as {
        target: BrowserTargetView | null;
        snapshot?: BrowserSnapshotView | null;
      };
      if (cancelled) return;

      if (data.snapshot?.title) {
        setPageTitle(data.snapshot.title);
      }
      if (!data.target) return;
      if (lastSeenVersion.current === data.target.version) return;

      lastSeenVersion.current = data.target.version;
      setTarget(data.target);
      setUrlInput(data.target.url);
      setFrameFailed(false);
      setFrameFailReason(null);
      if (data.target.requestedBy === "agent") {
        setStatusLine("智能体已打开页面。");
      }
    }

    void refreshTarget();
    const timer = window.setInterval(() => void refreshTarget(), 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!sideMenuOpen && !moreMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSideMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sideMenuOpen, moreMenuOpen]);

  async function openUrl(e?: FormEvent) {
    e?.preventDefault();
    if (loading) return;

    const url = normalizeUrlInput(urlInput);
    if (!url) {
      setError("请输入 URL。");
      return;
    }

    if (!browserEnabled) {
      setError("请使用桌面版，或在菜单中开启 iframe 降级。");
      return;
    }

    setLoading(true);
    setFrameFailed(false);
    setFrameFailReason(null);
    setStatusLine(null);
    setError(null);
    setSideMenuOpen(false);
    setMoreMenuOpen(false);

    if (isSameAppPreviewUrl(url)) {
      setError("请勿预览本应用地址（会嵌套界面）。");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/agent/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, requestedBy: "user" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "打开 URL 失败。");

      lastSeenVersion.current = data.target.version;
      setTarget(data.target);
      setUrlInput(data.target.url);
      setPageTitle(null);
      setStatusLine(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开 URL 失败。");
    } finally {
      setLoading(false);
    }
  }

  function handleNewTab() {
    setTarget(null);
    setPageTitle(null);
    setUrlInput("");
    setFrameFailed(false);
    setFrameFailReason(null);
    setStatusLine(null);
    setError(null);
    window.setTimeout(() => urlInputRef.current?.focus(), 0);
  }

  function handleExpand() {
    if (target?.url) {
      window.open(target.url, "_blank", "noopener,noreferrer");
      return;
    }
    const node = viewportRef.current;
    if (node && typeof node.requestFullscreen === "function") {
      void node.requestFullscreen();
    }
  }

  function handleCopyUrl() {
    if (!target?.url) return;
    void navigator.clipboard?.writeText(target.url);
    setStatusLine("已复制链接。");
  }

  const shellClass = embedded
    ? "flex h-full min-h-0 flex-col bg-white dark:bg-zinc-950"
    : "flex h-full min-h-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";

  const tabLabel = tabLabelFrom(target, pageTitle);

  return (
    <section className={shellClass}>
      {!embedded && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            内置浏览器
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            布局对齐 Cursor / Codex 右栏浏览器；桌面版为 WebView + CDP。
          </p>
          <span className="sr-only">Codex 模式</span>
        </div>
      )}

      {/* Tab 条 + 导航（Agent 后台加载时可隐藏 Chrome） */}
      {chromeVisible && (
        <>
      <div
        className="flex shrink-0 items-center border-b border-zinc-200 px-1 dark:border-zinc-800"
        style={{ minHeight: "2rem" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-0.5">
          <BrowserGlobeIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span
            className="min-w-0 truncate text-[12px] text-zinc-700 dark:text-zinc-300"
            title={tabLabel}
          >
            {tabLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pr-0.5">
          <BrowserChromeIconButton title="新标签页" onClick={handleNewTab}>
            <BrowserPlusIcon className="h-4 w-4" />
          </BrowserChromeIconButton>
          <BrowserChromeIconButton
            title={target ? "在新窗口打开" : "全屏"}
            onClick={handleExpand}
          >
            <BrowserExpandIcon className="h-4 w-4" />
          </BrowserChromeIconButton>
        </div>
      </div>

      {/* 导航 + 地址栏 */}
      <div className="relative flex shrink-0 items-center gap-0.5 border-b border-zinc-200 px-1 py-1 dark:border-zinc-800">
        <div className="relative">
          <BrowserChromeIconButton
            title="菜单"
            active={sideMenuOpen}
            onClick={() => {
              setMoreMenuOpen(false);
              setSideMenuOpen((v) => !v);
            }}
          >
            <BrowserListIcon className="h-4 w-4" />
          </BrowserChromeIconButton>
          {sideMenuOpen && (
            <div
              className="absolute left-0 top-full z-20 mt-0.5 min-w-[11rem] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
              role="menu"
            >
              <p className="px-3 py-1.5 text-[10px] text-zinc-500">
                {codexMode ? "Codex 模式 · WebView + CDP" : "网页版"}
              </p>
              {!codexMode && (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left text-[11px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => {
                    setIframeFallback((v) => !v);
                    setSideMenuOpen(false);
                  }}
                >
                  {iframeFallback
                    ? "关闭 iframe 降级"
                    : "开启 iframe 降级预览"}
                </button>
              )}
              {!codexMode && (
                <p className="px-3 py-1.5 text-[10px] leading-relaxed text-zinc-500">
                  完整能力请运行 npm run dev:desktop
                </p>
              )}
              {codexMode && target && (
                <a
                  href="/api/agent/browser/screenshot"
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  className="block px-3 py-1.5 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => setSideMenuOpen(false)}
                >
                  查看最新截图
                </a>
              )}
            </div>
          )}
        </div>

        {codexMode && (
          <>
            <BrowserChromeIconButton
              title="后退"
              disabled={!target || !canGoBack}
              onClick={() => webviewRef.current?.goBack()}
            >
              <BrowserBackIcon className="h-4 w-4" />
            </BrowserChromeIconButton>
            <BrowserChromeIconButton
              title="前进"
              disabled={!target || !canGoForward}
              onClick={() => webviewRef.current?.goForward()}
            >
              <BrowserForwardIcon className="h-4 w-4" />
            </BrowserChromeIconButton>
            <BrowserChromeIconButton
              title="刷新"
              disabled={!target}
              onClick={() => webviewRef.current?.reload()}
            >
              <BrowserRefreshIcon className="h-4 w-4" />
            </BrowserChromeIconButton>
          </>
        )}

        <BrowserChromeIconButton
          title="复制链接"
          disabled={!target?.url}
          onClick={handleCopyUrl}
        >
          <BrowserStarIcon className="h-4 w-4" />
        </BrowserChromeIconButton>

        <form onSubmit={openUrl} className="min-w-0 flex-1">
          <input
            ref={urlInputRef}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Search or enter URL"
            disabled={loading || !browserEnabled}
            className="h-7 w-full rounded-md border border-zinc-200 bg-zinc-50/80 px-2.5 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:bg-zinc-900"
          />
        </form>

        <div className="relative">
          <BrowserChromeIconButton
            title="更多"
            active={moreMenuOpen}
            onClick={() => {
              setSideMenuOpen(false);
              setMoreMenuOpen((v) => !v);
            }}
          >
            <BrowserMoreIcon className="h-4 w-4" />
          </BrowserChromeIconButton>
          {moreMenuOpen && (
            <div
              className="absolute right-0 top-full z-20 mt-0.5 min-w-[10rem] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
              role="menu"
            >
              {target && (
                <a
                  href={target.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  className="block px-3 py-1.5 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => setMoreMenuOpen(false)}
                >
                  新标签打开
                </a>
              )}
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left text-[11px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                onClick={() => {
                  setMoreMenuOpen(false);
                  void openUrl();
                }}
              >
                {loading ? "打开中…" : "前往"}
              </button>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* 视口 */}
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950"
      >
        {target && codexMode ? (
          <BrowserWebview
            ref={webviewRef}
            url={target.url}
            version={target.version}
            embedded={embedded}
            onNavStateChange={handleNavStateChange}
            onNavigate={() => {
              setFrameFailed(false);
              setFrameFailReason(null);
            }}
            onSnapshot={() => {
              void fetch("/api/agent/browser")
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                  if (!data?.snapshot) return;
                  if (data.snapshot.title) {
                    setPageTitle(data.snapshot.title as string);
                  }
                  if (data.snapshot.url) {
                    setUrlInput(data.snapshot.url as string);
                  }
                });
            }}
            onFail={(reason) => {
              setFrameFailed(true);
              setFrameFailReason(reason ?? null);
            }}
          />
        ) : target && iframeFallback ? (
          <iframe
            key={target.version}
            src={target.url}
            title={tabLabel}
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            className="h-full w-full bg-white"
            onLoad={() => setFrameFailed(false)}
            onError={() => setFrameFailed(true)}
          />
        ) : (
          <div className="flex h-full min-h-[120px] items-center justify-center px-6 text-center text-[11px] text-zinc-500">
            {browserEnabled
              ? "在地址栏输入 URL 后按 Enter。"
              : "请启动桌面版，或在菜单中开启 iframe 降级。"}
          </div>
        )}
      </div>

      {/* 状态行 */}
      {(error || statusLine || frameFailed) && (
        <div
          className="shrink-0 border-t border-zinc-100 px-2.5 py-1 dark:border-zinc-800"
        >
          {error && (
            <p className="truncate text-[10px] text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {!error && statusLine && (
            <p className="truncate text-[10px] text-zinc-500">{statusLine}</p>
          )}
          {!error && frameFailed && (
            <p className="truncate text-[10px] text-amber-600 dark:text-amber-400">
              {codexMode
                ? frameFailReason
                  ? `加载失败：${frameFailReason}`
                  : "页面加载失败，请检查 URL 或网络。"
                : "iframe 可能被站点拒绝嵌入；请使用桌面版。"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
