"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { BrowserConsoleMessage } from "@/agent/browser/browser-snapshot";
import {
  BROWSER_DOM_OUTLINE_SCRIPT,
  BROWSER_PROBE_INJECT,
  BROWSER_PROBE_READ_ERRORS,
  mapWebviewConsoleLevel,
} from "@/lib/browser-webview-probe";

type BrowserWebviewProps = {
  url: string;
  version: number;
  embedded?: boolean;
  onSnapshot?: () => void;
  onFail?: () => void;
};

type WebviewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
  getURL?: () => string;
};

type ConsoleMessageEvent = Event & {
  message?: string;
  level?: number;
  line?: number;
  sourceId?: string;
};

async function reportSnapshot(payload: {
  url: string;
  title: string | null;
  textPreview: string | null;
  consoleMessages?: BrowserConsoleMessage[];
  domOutline?: string | null;
  pageErrors?: string[];
  loadError?: string | null;
}) {
  await fetch("/api/agent/browser/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      source: "webview",
    }),
  });
}

export function BrowserWebview({
  url,
  version,
  embedded = false,
  onSnapshot,
  onFail,
}: BrowserWebviewProps) {
  const webviewRef = useRef<HTMLElement>(null);
  const consoleBufferRef = useRef<BrowserConsoleMessage[]>([]);
  const loadErrorRef = useRef<string | null>(null);

  useEffect(() => {
    consoleBufferRef.current = [];
    loadErrorRef.current = null;
  }, [url, version]);

  useEffect(() => {
    const node = webviewRef.current;
    if (!node) return;

    const capture = async () => {
      const wv = node as WebviewElement;
      if (typeof wv.executeJavaScript !== "function") return;

      try {
        await wv.executeJavaScript(BROWSER_PROBE_INJECT);
        const currentUrl =
          typeof wv.getURL === "function" ? wv.getURL() : url;
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

        await reportSnapshot({
          url: currentUrl,
          title: title || null,
          textPreview: textPreview || null,
          consoleMessages: [...consoleBufferRef.current],
          domOutline: domOutline || null,
          pageErrors: Array.isArray(pageErrors) ? pageErrors : [],
          loadError: loadErrorRef.current,
        });
        onSnapshot?.();
      } catch {
        onFail?.();
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
      void capture();
    };
    const onDidFailLoad = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
      };
      loadErrorRef.current =
        detail.errorDescription ??
        (detail.errorCode != null ? `Load failed (${detail.errorCode})` : "Load failed");
      onFail?.();
    };

    node.addEventListener("dom-ready", onDomReady);
    node.addEventListener("did-fail-load", onDidFailLoad);
    node.addEventListener("console-message", onConsoleMessage as EventListener);

    return () => {
      node.removeEventListener("dom-ready", onDomReady);
      node.removeEventListener("did-fail-load", onDidFailLoad);
      node.removeEventListener(
        "console-message",
        onConsoleMessage as EventListener,
      );
    };
  }, [url, version, onSnapshot, onFail]);

  return (
    <webview
      key={version}
      ref={webviewRef as RefObject<HTMLElement>}
      src={url}
      allowpopups
      className={`h-full w-full bg-white ${embedded ? "min-h-[200px]" : "min-h-[420px]"}`}
      style={{ display: "inline-flex", width: "100%", height: "100%" }}
    />
  );
}
