"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
} from "react";
import { AgentRunModeHint } from "@/components/agent-run-mode-hint";

type RunMode = "develop" | "loop";

type AgentComposerProps = {
  request: string;
  onRequestChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  running: boolean;
  canRun: boolean;
  runMode: RunMode;
  onRunModeChange: (mode: RunMode) => void;
  continueThreadMemory: boolean;
  onContinueThreadMemoryChange: (value: boolean) => void;
  currentThreadId: string | null;
  onNewSession: () => void;
  referenceImages: string[];
  onPickImages: () => void;
  onRemoveImage: (index: number) => void;
  maxReferenceImages: number;
  approvalStatus: string | null;
  developImageWarning?: boolean;
};

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M8.99992 16V6.41407L5.70696 9.70704C5.31643 10.0976 4.68342 10.0976 4.29289 9.70704C3.90237 9.31652 3.90237 8.6835 4.29289 8.29298L9.29289 3.29298C9.68342 2.90245 10.3164 2.90245 10.707 3.29298L15.707 8.29298C16.0975 8.6835 16.0975 9.31652 15.707 9.70704C15.3164 10.0976 14.6834 10.0976 14.293 9.70704L10.9999 6.41407V16C10.9999 16.5523 10.5522 17 9.99992 17C9.44764 17 8.99992 16.5523 8.99992 16Z" />
    </svg>
  );
}

export function AgentComposer({
  request,
  onRequestChange,
  onSubmit,
  running,
  canRun,
  runMode,
  onRunModeChange,
  continueThreadMemory,
  onContinueThreadMemoryChange,
  currentThreadId,
  onNewSession,
  referenceImages,
  onPickImages,
  onRemoveImage,
  maxReferenceImages,
  approvalStatus,
  developImageWarning = false,
}: AgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [request, resize]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canRun) {
        event.currentTarget.form?.requestSubmit();
      }
    }
  };

  return (
    <footer className="shrink-0 border-t border-zinc-200/80 bg-white/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
        {referenceImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {referenceImages.map((src, index) => (
              <div key={`${index}-${src.slice(0, 24)}`} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  className="h-12 w-12 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
                />
                <button
                  type="button"
                  onClick={() => onRemoveImage(index)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[10px] text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition focus-within:border-zinc-300 focus-within:ring-2 focus-within:ring-zinc-200/80 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-zinc-600 dark:focus-within:ring-zinc-800">
            <textarea
              ref={textareaRef}
              value={request}
              onChange={(e) => onRequestChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="接下来做什么…"
              disabled={running}
              rows={1}
              className="block max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  disabled={running || referenceImages.length >= maxReferenceImages}
                  onClick={onPickImages}
                  className="rounded-lg px-2 py-1 text-[12px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="附加参考图"
                >
                  ＋
                </button>
                {runMode === "loop" && (
                  <label className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <input
                      type="checkbox"
                      checked={continueThreadMemory}
                      onChange={(e) => onContinueThreadMemoryChange(e.target.checked)}
                      disabled={running}
                      className="rounded border-zinc-300"
                    />
                    延续记忆
                  </label>
                )}
                <div className="flex rounded-lg border border-zinc-200 p-0.5 text-[11px] dark:border-zinc-700">
                  <button
                    type="button"
                    onClick={() => onRunModeChange("loop")}
                    disabled={running}
                    className={`rounded-md px-2 py-0.5 ${
                      runMode === "loop"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                        : "text-zinc-500"
                    }`}
                  >
                    Loop
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunModeChange("develop")}
                    disabled={running}
                    className={`rounded-md px-2 py-0.5 ${
                      runMode === "develop"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                        : "text-zinc-500"
                    }`}
                  >
                    闭环
                  </button>
                </div>
                {!running && (
                  <button
                    type="button"
                    onClick={onNewSession}
                    className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    新会话
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!canRun}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                title={running ? "运行中" : "发送（Enter）"}
              >
                {running ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-400/30 dark:border-t-zinc-900" />
                ) : (
                  <SendIcon />
                )}
              </button>
            </div>
          </div>
        </form>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          {runMode === "develop" && <AgentRunModeHint mode={runMode} />}
          {currentThreadId && continueThreadMemory && runMode === "loop" && (
            <span className="font-mono">thread:{currentThreadId.slice(0, 10)}…</span>
          )}
          {developImageWarning && (
            <span className="text-amber-600 dark:text-amber-400">
              闭环暂不支持附图
            </span>
          )}
          {approvalStatus && (
            <span className="text-emerald-600 dark:text-emerald-400">{approvalStatus}</span>
          )}
        </div>
      </div>
    </footer>
  );
}
