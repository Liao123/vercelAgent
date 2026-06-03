"use client";

import { useEffect, useRef, type RefObject } from "react";

type BrowserWebviewProps = {
  url: string;
  version: number;
  embedded?: boolean;
  onSnapshot?: () => void;
  onFail?: () => void;
};

async function reportSnapshot(
  url: string,
  title: string | null,
  textPreview: string | null,
) {
  await fetch("/api/agent/browser/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      title,
      textPreview,
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

  useEffect(() => {
    const node = webviewRef.current;
    if (!node) return;

    const capture = async () => {
      const wv = node as HTMLElement & {
        executeJavaScript?: (code: string) => Promise<unknown>;
        getURL?: () => string;
      };
      if (typeof wv.executeJavaScript !== "function") return;

      try {
        const currentUrl =
          typeof wv.getURL === "function" ? wv.getURL() : url;
        const title = (await wv.executeJavaScript(
          "document.title || ''",
        )) as string;
        const textPreview = (await wv.executeJavaScript(
          "(document.body && document.body.innerText) ? document.body.innerText.slice(0, 2000) : ''",
        )) as string;
        await reportSnapshot(currentUrl, title || null, textPreview || null);
        onSnapshot?.();
      } catch {
        onFail?.();
      }
    };

    const onDomReady = () => {
      void capture();
    };
    const onDidFailLoad = () => {
      onFail?.();
    };

    node.addEventListener("dom-ready", onDomReady);
    node.addEventListener("did-fail-load", onDidFailLoad);

    return () => {
      node.removeEventListener("dom-ready", onDomReady);
      node.removeEventListener("did-fail-load", onDidFailLoad);
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
