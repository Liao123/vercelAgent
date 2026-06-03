/**
 * Web 阶段的内置浏览器面板。
 *
 * 这里用 iframe 做最小可用预览；Electron 阶段再替换成真实 WebView/CDP。
 */
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { BrowserWebview } from "@/components/browser-webview";
import { useDesktopApp } from "@/lib/use-desktop-app";

type BrowserTargetView = {
  url: string;
  requestedBy: "user" | "agent" | "system";
  openedAt: string;
  updatedAt: string;
  version: number;
};

function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function BrowserPanel({ embedded = false }: { embedded?: boolean }) {
  const [urlInput, setUrlInput] = useState("http://localhost:3000");
  const [target, setTarget] = useState<BrowserTargetView | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSeenVersion = useRef<number | null>(null);
  const desktopBrowser = useDesktopApp();

  useEffect(() => {
    let cancelled = false;

    async function refreshTarget() {
      const res = await fetch("/api/agent/browser");
      if (!res.ok) return;

      const data = (await res.json()) as { target: BrowserTargetView | null };
      if (cancelled || !data.target) return;
      if (lastSeenVersion.current === data.target.version) return;

      lastSeenVersion.current = data.target.version;
      setTarget(data.target);
      setUrlInput(data.target.url);
      setFrameFailed(false);
      if (data.target.requestedBy === "agent") {
        setMessage("智能体已打开 URL。");
      }
    }

    void refreshTarget();
    const timer = window.setInterval(() => void refreshTarget(), 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function openUrl(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    const url = normalizeUrlInput(urlInput);
    if (!url) {
      setError("请输入要打开的 URL。");
      return;
    }

    setLoading(true);
    setFrameFailed(false);
    setMessage(null);
    setError(null);

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
      setMessage("已打开。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开 URL 失败。");
    } finally {
      setLoading(false);
    }
  }

  const shellClass = embedded
    ? "flex min-h-0 flex-col gap-2"
    : "flex h-full min-h-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";

  return (
    <section className={shellClass}>
      {!embedded && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            内置浏览器
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {desktopBrowser
              ? "桌面 WebView 预览（可绕过 iframe 限制）"
              : "Web iframe 预览；桌面版使用 WebView。"}
          </p>
        </div>
      )}

      <form onSubmit={openUrl} className="flex gap-2">
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="http://localhost:3000"
          disabled={loading}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
        >
          {loading ? "打开中" : "打开"}
        </button>
      </form>

      {(message || error) && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            error
              ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
        >
          {error ?? message}
        </p>
      )}

      <div
        className={`min-h-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 ${embedded ? "flex-1" : "flex-1"}`}
      >
        {target ? (
          desktopBrowser ? (
            <BrowserWebview
              url={target.url}
              version={target.version}
              embedded={embedded}
              onSnapshot={() => {
                setFrameFailed(false);
                setMessage("已捕获页面快照（可供 browser.inspect）。");
              }}
              onFail={() => setFrameFailed(true)}
            />
          ) : (
            <iframe
              key={target.version}
              src={target.url}
              title="内置浏览器预览"
              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
              className={`h-full w-full bg-white ${embedded ? "min-h-[200px]" : "min-h-[420px]"}`}
              onLoad={() => setFrameFailed(false)}
              onError={() => setFrameFailed(true)}
            />
          )
        ) : (
          <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-sm text-zinc-500">
            输入 URL 后在这里预览页面。
          </div>
        )}
      </div>

      {target && (
        <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
          <span className="min-w-0 truncate">{target.url}</span>
          <a
            href={target.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 underline underline-offset-2"
          >
            新标签打开
          </a>
        </div>
      )}
      {frameFailed && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {desktopBrowser
            ? "WebView 加载失败，请检查 URL 或网络。"
            : "页面可能拒绝被 iframe 嵌入；请用桌面版或新标签打开。"}
        </p>
      )}
    </section>
  );
}
