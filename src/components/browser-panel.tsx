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
import { subscribeBrowserGuestOpenUrl } from "@/lib/desktop-bridge";

type BrowserTabView = {
  id: string;
  url: string;
  title: string | null;
  version: number;
  requestedBy: "user" | "agent" | "system";
};

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

function tabLabelFromTab(tab: BrowserTabView, pageTitle?: string | null): string {
  if (pageTitle?.trim()) return pageTitle.trim();
  if (!tab.url) return "新标签页";
  try {
    return new URL(tab.url).hostname || tab.url;
  } catch {
    return tab.url;
  }
}

function BrowserEmptyState({
  description = "输入 URL 以打开页面",
}: {
  description?: string;
}) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center px-6 text-center">
      <BrowserGlobeIcon className="h-20 w-20 text-zinc-400 dark:text-zinc-600" />
      <p className="mt-5 text-[16px] font-medium text-zinc-900 dark:text-zinc-100">
        开始浏览
      </p>
      <p className="mt-2 text-[13px] text-zinc-400 dark:text-zinc-500">
        {description}
      </p>
    </div>
  );
}

export function BrowserPanel({
  embedded = false,
  chromeVisible = true,
  showTabStrip = true,
}: {
  embedded?: boolean;
  chromeVisible?: boolean;
  showTabStrip?: boolean;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [tabs, setTabs] = useState<BrowserTabView[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
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

  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ??
    (tabs.length > 0 ? tabs[0] : null);

  const target: BrowserTargetView | null = activeTab?.url
    ? {
        url: activeTab.url,
        requestedBy: activeTab.requestedBy,
        openedAt: "",
        updatedAt: "",
        version: activeTab.version,
      }
    : null;

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
        tabs?: BrowserTabView[];
        activeTabId?: string;
        version?: number;
        target: BrowserTargetView | null;
        snapshot?: BrowserSnapshotView | null;
      };
      if (cancelled) return;

      if (data.snapshot?.title) {
        setPageTitle(data.snapshot.title);
      }

      if (data.tabs?.length) {
        setTabs(data.tabs);
        setActiveTabId(data.activeTabId ?? data.tabs[0]?.id ?? null);
      }

      const version = data.version ?? data.target?.version ?? null;
      if (version != null && lastSeenVersion.current === version) return;

      if (version != null) lastSeenVersion.current = version;

      const active =
        data.tabs?.find((tab) => tab.id === data.activeTabId) ??
        data.tabs?.[0];
      if (active) {
        setUrlInput(active.url);
        setFrameFailed(false);
        setFrameFailReason(null);
        if (active.requestedBy === "agent") {
          setStatusLine("智能体已打开页面。");
        }
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

  async function openUrlInNewTab(
    url: string,
    requestedBy: "user" | "agent" = "user",
  ) {
    const normalized = normalizeUrlInput(url);
    if (!normalized) return;
    if (isSameAppPreviewUrl(normalized)) {
      setError("请勿预览本应用地址（会嵌套界面）。");
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/agent/browser/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "new", url: normalized, requestedBy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "打开 URL 失败。");
      if (data.tabs) setTabs(data.tabs);
      setActiveTabId(data.activeTabId);
      if (data.version != null) lastSeenVersion.current = data.version;
      const active = data.tabs?.find(
        (tab: BrowserTabView) => tab.id === data.activeTabId,
      );
      if (active?.url) setUrlInput(active.url);
      setPageTitle(null);
      setFrameFailed(false);
      setFrameFailReason(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开 URL 失败。");
    }
  }

  const handleWebviewOpenUrlRef = useRef<(url: string) => void>(() => {});

  handleWebviewOpenUrlRef.current = (url: string) => {
    const normalized = normalizeUrlInput(url);
    if (!normalized) return;
    if (isSameAppPreviewUrl(normalized)) {
      setError("请勿预览本应用地址（会嵌套界面）。");
      return;
    }
    // 对齐 Cursor：页面内 target=_blank / window.open → 同级新浏览器 Tab
    void openUrlInNewTab(normalized);
  };

  function handleWebviewOpenUrl(url: string) {
    handleWebviewOpenUrlRef.current(url);
  }

  useEffect(() => {
    return subscribeBrowserGuestOpenUrl((url) => {
      handleWebviewOpenUrlRef.current(url);
    });
  }, []);

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
        body: JSON.stringify({
          url,
          requestedBy: "user",
          tabId: activeTabId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "打开 URL 失败。");

      if (data.tabs) setTabs(data.tabs);
      if (data.activeTabId) setActiveTabId(data.activeTabId);
      if (data.target?.version != null) {
        lastSeenVersion.current = data.target.version;
      }
      if (data.target?.url) setUrlInput(data.target.url);
      setPageTitle(null);
      setStatusLine(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开 URL 失败。");
    } finally {
      setLoading(false);
    }
  }

  async function switchTab(tabId: string) {
    if (tabId === activeTabId) return;
    try {
      const res = await fetch("/api/agent/browser/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", tabId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "切换标签失败。");
      if (data.tabs) setTabs(data.tabs);
      setActiveTabId(data.activeTabId);
      if (data.version != null) lastSeenVersion.current = data.version;
      const active = data.tabs?.find(
        (tab: BrowserTabView) => tab.id === data.activeTabId,
      );
      if (active) setUrlInput(active.url);
      setPageTitle(null);
      setFrameFailed(false);
      setFrameFailReason(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换标签失败。");
    }
  }

  async function closeTab(tabId: string) {
    try {
      const res = await fetch("/api/agent/browser/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", tabId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "关闭标签失败。");
      if (data.tabs) setTabs(data.tabs);
      setActiveTabId(data.activeTabId);
      if (data.version != null) lastSeenVersion.current = data.version;
      const active = data.tabs?.find(
        (tab: BrowserTabView) => tab.id === data.activeTabId,
      );
      setUrlInput(active?.url ?? "");
      setPageTitle(null);
      setFrameFailed(false);
      setFrameFailReason(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "关闭标签失败。");
    }
  }

  async function handleNewTab() {
    setError(null);
    setStatusLine(null);
    try {
      const res = await fetch("/api/agent/browser/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "new" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "新建标签失败。");
      if (data.tabs) setTabs(data.tabs);
      setActiveTabId(data.activeTabId);
      if (data.version != null) lastSeenVersion.current = data.version;
      setUrlInput("");
      setPageTitle(null);
      setFrameFailed(false);
      setFrameFailReason(null);
      window.setTimeout(() => urlInputRef.current?.focus(), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建标签失败。");
    }
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

  const tabLabel = activeTab
    ? tabLabelFromTab(activeTab, pageTitle)
    : "新标签页";

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
      {showTabStrip && (
        <div
          className="flex shrink-0 items-center border-b border-zinc-200 px-1 dark:border-zinc-800"
          style={{ minHeight: "2rem" }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-0.5">
            {tabs.map((tab) => {
              const selected = tab.id === activeTabId;
              const label = tabLabelFromTab(
                tab,
                selected ? pageTitle : tab.title,
              );
              return (
                <div
                  key={tab.id}
                  className={`group/tab inline-flex max-w-[11rem] shrink-0 items-center rounded-md transition ${
                    selected
                      ? "bg-zinc-200/90 dark:bg-zinc-700/90"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                  }`}
                >
                  <button
                    type="button"
                    title={tab.url || label}
                    onClick={() => void switchTab(tab.id)}
                    className={`inline-flex min-w-0 items-center gap-1 rounded-l-md py-0.5 pl-2 pr-1 text-[11px] ${
                      selected
                        ? "text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    <BrowserGlobeIcon className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="truncate">{label}</span>
                  </button>
                  <button
                    type="button"
                    title="关闭标签"
                    aria-label={`关闭 ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void closeTab(tab.id);
                    }}
                    className={`rounded-r-md px-1.5 py-0.5 text-[13px] leading-none opacity-0 transition hover:bg-zinc-300/80 group-hover/tab:opacity-100 dark:hover:bg-zinc-600/80 ${
                      selected ? "opacity-70" : ""
                    } text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {tabs.length === 0 && (
              <span className="px-1.5 text-[12px] text-zinc-500">新标签页</span>
            )}
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
      )}

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
        {codexMode ? (
          activeTab?.url ? (
            <BrowserWebview
              ref={webviewRef}
              tabId={activeTab.id}
              url={activeTab.url}
              version={activeTab.version}
              embedded={embedded}
              interactive={chromeVisible}
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
              onOpenUrl={handleWebviewOpenUrl}
            />
          ) : (
            <BrowserEmptyState />
          )
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
          <BrowserEmptyState
            description={
              browserEnabled
                ? "输入 URL 以打开页面"
                : "请启动桌面版，或在菜单中开启 iframe 降级。"
            }
          />
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
