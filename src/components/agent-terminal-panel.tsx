"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatTerminalLogBlock,
  type TerminalLogEntry,
} from "@/lib/terminal-session-log";

type AgentTerminalPanelProps = {
  entries: TerminalLogEntry[];
  visible: boolean;
  workspaceLabel?: string | null;
  /** 有 workspace 时启用交互 PTY */
  interactiveEnabled?: boolean;
  showHeader?: boolean;
  onClear?: () => void;
};

type PtySessionView = {
  id: string;
  shell: string;
};

async function postPty(body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/agent/pty", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function AgentTerminalPanel({
  entries,
  visible,
  workspaceLabel,
  interactiveEnabled = false,
  showHeader = true,
  onClear,
}: AgentTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedLogCountRef = useRef(0);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const sessionRef = useRef<PtySessionView | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const interactiveStartedRef = useRef(false);
  const [ptySession, setPtySession] = useState<PtySessionView | null>(null);
  const [ptyError, setPtyError] = useState<string | null>(null);
  const [ptyEnabled, setPtyEnabled] = useState<boolean | null>(null);
  const [termReady, setTermReady] = useState(false);

  const syncTerminalSize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const session = sessionRef.current;
    if (!term || !fit || !session) return;
    fit.fit();
    void postPty({
      action: "resize",
      sessionId: session.id,
      cols: term.cols,
      rows: term.rows,
    });
  }, []);

  const stopInteractiveSession = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    interactiveStartedRef.current = false;
    setPtySession(null);
    if (session) {
      void postPty({ action: "kill", sessionId: session.id });
    }
  }, []);

  const startInteractiveSession = useCallback(async () => {
    if (!interactiveEnabled || interactiveStartedRef.current) return;
    interactiveStartedRef.current = true;

    const statusRes = await fetch("/api/agent/pty");
    const status = (await statusRes.json()) as { enabled?: boolean };
    setPtyEnabled(status.enabled !== false);
    if (status.enabled === false) {
      setPtyError("服务端已关闭交互 PTY（AGENT_PTY_ENABLED=0）");
      return;
    }

    const term = termRef.current;
    if (term) {
      term.writeln("\r\n\x1b[90m── 交互式 shell ──\x1b[0m");
    }

    const res = await postPty({ action: "spawn" });
    const data = (await res.json()) as {
      session?: PtySessionView;
      error?: string;
    };
    if (!res.ok || !data.session) {
      setPtyError(data.error ?? "无法启动 PTY");
      interactiveStartedRef.current = false;
      return;
    }

    sessionRef.current = data.session;
    setPtySession(data.session);
    setPtyError(null);

    if (term) {
      term.options.disableStdin = false;
      term.options.cursorBlink = true;
      term.focus();
      syncTerminalSize();
    }

    const source = new EventSource(
      `/api/agent/pty/${encodeURIComponent(data.session.id)}/stream`,
    );
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          data?: string;
          exitCode?: number | null;
        };
        const activeTerm = termRef.current;
        if (!activeTerm) return;
        if (payload.type === "output" && typeof payload.data === "string") {
          activeTerm.write(payload.data);
        }
        if (payload.type === "exit") {
          activeTerm.writeln(
            `\r\n\x1b[90m[shell exited${payload.exitCode != null ? ` code ${payload.exitCode}` : ""}]\x1b[0m`,
          );
          stopInteractiveSession();
        }
      } catch {
        /* ignore */
      }
    };

    source.onerror = () => {
      setPtyError("PTY 连接已断开");
      stopInteractiveSession();
    };
  }, [interactiveEnabled, stopInteractiveSession, syncTerminalSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let dataDisposable: { dispose: () => void } | null = null;

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.35,
        theme: {
          background: "#18181b",
          foreground: "#e4e4e7",
          cursor: "#a1a1aa",
          selectionBackground: "#3f3f46",
        },
        scrollback: 8000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      fit.fit();

      term.writeln("\x1b[90m终端 · Agent 批准命令日志 + 交互 shell\x1b[0m");
      if (workspaceLabel?.trim()) {
        term.writeln(`\x1b[90mworkspace: ${workspaceLabel.trim()}\x1b[0m`);
      }

      for (const entry of entries) {
        term.writeln(formatTerminalLogBlock(entry));
      }
      renderedLogCountRef.current = entries.length;

      dataDisposable = term.onData((data) => {
        const session = sessionRef.current;
        if (!session) return;
        void postPty({ action: "write", sessionId: session.id, data });
      });

      termRef.current = term;
      fitRef.current = fit;
      setTermReady(true);
    })();

    return () => {
      disposed = true;
      setTermReady(false);
      dataDisposable?.dispose();
      stopInteractiveSession();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      renderedLogCountRef.current = 0;
    };
  }, [workspaceLabel, stopInteractiveSession]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    for (let index = renderedLogCountRef.current; index < entries.length; index += 1) {
      term.writeln(formatTerminalLogBlock(entries[index]!));
    }
    renderedLogCountRef.current = entries.length;
  }, [entries]);

  useEffect(() => {
    if (!visible || !interactiveEnabled || !termReady) return;
    void startInteractiveSession();
  }, [visible, interactiveEnabled, termReady, startInteractiveSession]);

  useEffect(() => {
    if (!visible) return;
    syncTerminalSize();
    const timer = window.setTimeout(syncTerminalSize, 50);
    return () => window.clearTimeout(timer);
  }, [visible, entries.length, ptySession, syncTerminalSize]);

  useEffect(() => {
    if (!visible) return;
    const onResize = () => syncTerminalSize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [visible, syncTerminalSize]);

  function handleClear() {
    termRef.current?.clear();
    renderedLogCountRef.current = 0;
    onClear?.();
  }

  function handleRestartShell() {
    stopInteractiveSession();
    void startInteractiveSession();
  }

  const subtitle = ptySession
    ? `交互 shell · ${ptySession.shell}`
    : ptyError
      ? ptyError
      : interactiveEnabled
        ? ptyEnabled === false
          ? "只读日志（PTY 已禁用）"
          : "连接交互 shell…"
        : "批准命令日志（只读）";

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      {showHeader ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-zinc-100">
              终端
            </p>
            <p className="truncate text-[10px] text-zinc-500">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {interactiveEnabled && ptySession ? (
              <button
                type="button"
                onClick={handleRestartShell}
                className="rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                新 shell
              </button>
            ) : null}
            {onClear ? (
              <button
                type="button"
                onClick={handleClear}
                className="rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                清空
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 p-1"
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}
