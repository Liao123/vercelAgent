"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AgentAgentSettings } from "@/components/agent-agent-settings";
import {
  AgentWorkspacePicker,
  type WorkspacePickerProject,
} from "@/components/agent-workspace-picker";
import { ComposerMentionHighlight } from "@/components/composer-mention-highlight";
import {
  insertAtMention,
  mergePathSuggestions,
  parseActiveAtQuery,
  removeTextRange,
  requestContainsAtPath,
  resolveMentionDeleteRange,
  resolveMentionArrowCursor,
} from "@/lib/composer-at-mention";
import {
  formatMentionLineRange,
  type ReviewEditorSelection,
} from "@/lib/review-editor-selection";
import {
  dataTransferMayHaveImageFiles,
  getImageFilesFromDataTransfer,
} from "@/lib/composer-clipboard-image";

type AgentComposerProps = {
  request: string;
  onRequestChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  running: boolean;
  canRun: boolean;
  continueThreadMemory: boolean;
  onContinueThreadMemoryChange: (value: boolean) => void;
  currentThreadId: string | null;
  workspacePicker?: {
    currentName: string | null;
    projects: WorkspacePickerProject[];
    busy?: boolean;
    onSelect: (workspaceId: string) => void;
    onOpenFolder?: () => void | Promise<void>;
  };
  referenceImages: string[];
  onPickImages: () => void;
  onPasteReferenceImages?: (files: File[]) => void | Promise<void>;
  onDropReferenceImages?: (files: File[]) => void | Promise<void>;
  onRemoveImage: (index: number) => void;
  maxReferenceImages: number;
  attachedFiles: string[];
  onRemoveAttachedFile: (index: number) => void;
  maxAttachedFiles: number;
  approvalStatus: string | null;
  approvalStatusTone?: "success" | "error" | "neutral";
  /** A165：运行中点击停止 */
  onCancel?: () => void;
  workspaceAtEnabled?: boolean;
  recentAttachedPaths?: string[];
  onPickAttachedPath?: (path: string) => void;
  reviewEditorSelection?: ReviewEditorSelection | null;
  onAgentPrefsChange?: () => void;
};

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M8.99992 16V6.41407L5.70696 9.70704C5.31643 10.0976 4.68342 10.0976 4.29289 9.70704C3.90237 9.31652 3.90237 8.6835 4.29289 8.29298L9.29289 3.29298C9.68342 2.90245 10.3164 2.90245 10.707 3.29298L15.707 8.29298C16.0975 8.6835 16.0975 9.31652 15.707 9.70704C15.3164 10.0976 14.6834 10.0976 14.293 9.70704L10.9999 6.41407V16C10.9999 16.5523 10.5522 17 9.99992 17C9.44764 17 8.99992 16.5523 8.99992 16Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
      <rect x="5" y="5" width="10" height="10" rx="1.5" />
    </svg>
  );
}

export function AgentComposer({
  request,
  onRequestChange,
  onSubmit,
  running,
  canRun,
  continueThreadMemory,
  onContinueThreadMemoryChange,
  currentThreadId,
  workspacePicker,
  referenceImages,
  onPickImages,
  onPasteReferenceImages,
  onDropReferenceImages,
  onRemoveImage,
  maxReferenceImages,
  attachedFiles,
  onRemoveAttachedFile,
  maxAttachedFiles,
  approvalStatus,
  approvalStatusTone = "neutral",
  onCancel,
  workspaceAtEnabled = false,
  recentAttachedPaths = [],
  onPickAttachedPath,
  reviewEditorSelection = null,
  onAgentPrefsChange,
}: AgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const imageDragDepthRef = useRef(0);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [atMention, setAtMention] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestIndex, setActiveSuggestIndex] = useState(0);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [atHint, setAtHint] = useState<string | null>(null);

  const onPaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onPasteReferenceImages || running) return;
      const imageFiles = getImageFilesFromDataTransfer(event.clipboardData);
      if (imageFiles.length === 0) return;
      event.preventDefault();
      await onPasteReferenceImages(imageFiles);
    },
    [onPasteReferenceImages, running],
  );

  const onImageDragEnter = useCallback(
    (event: React.DragEvent) => {
      const onDrop = onDropReferenceImages ?? onPasteReferenceImages;
      if (!onDrop || running) return;
      if (!dataTransferMayHaveImageFiles(event.dataTransfer)) return;
      event.preventDefault();
      imageDragDepthRef.current += 1;
      setImageDragActive(true);
    },
    [onDropReferenceImages, onPasteReferenceImages, running],
  );

  const onImageDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1);
    if (imageDragDepthRef.current === 0) {
      setImageDragActive(false);
    }
  }, []);

  const onImageDragOver = useCallback(
    (event: React.DragEvent) => {
      const onDrop = onDropReferenceImages ?? onPasteReferenceImages;
      if (!onDrop || running) return;
      if (!dataTransferMayHaveImageFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [onDropReferenceImages, onPasteReferenceImages, running],
  );

  const onImageDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      imageDragDepthRef.current = 0;
      setImageDragActive(false);
      const onDrop = onDropReferenceImages ?? onPasteReferenceImages;
      if (!onDrop || running) return;
      const imageFiles = getImageFilesFromDataTransfer(event.dataTransfer);
      if (imageFiles.length === 0) return;
      await onDrop(imageFiles);
    },
    [onDropReferenceImages, onPasteReferenceImages, running],
  );

  const resize = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, []);

  const syncHighlightScroll = useCallback(() => {
    const node = textareaRef.current;
    const layer = highlightRef.current;
    if (!node || !layer) return;
    layer.scrollTop = node.scrollTop;
    layer.scrollLeft = node.scrollLeft;
  }, []);

  useEffect(() => {
    resize();
    syncHighlightScroll();
  }, [request, resize, syncHighlightScroll]);

  const fetchPathSuggestions = useCallback(
    async (
      active: { start: number; query: string },
      signal: AbortSignal,
    ): Promise<string[]> => {
      const params = new URLSearchParams();
      if (active.query.trim()) params.set("q", active.query.trim());
      const res = await fetch(`/api/agent/workspace/files?${params}`, {
        signal,
      });
      const data = await res.json();
      const searched = res.ok && Array.isArray(data.paths) ? data.paths : [];
      return mergePathSuggestions(active.query, recentAttachedPaths, searched);
    },
    [recentAttachedPaths],
  );

  const refreshAtSuggestions = useCallback(
    (text: string, cursor: number) => {
      const active = parseActiveAtQuery(text, cursor);
      if (!active) {
        setAtMention(null);
        setSuggestions([]);
        setAtHint(null);
        setLoadingSuggestions(false);
        return;
      }

      if (!workspaceAtEnabled || running) {
        setAtMention(active);
        setSuggestions([]);
        setAtHint(
          !workspaceAtEnabled
            ? "请先在输入框左下角选择工作区"
            : null,
        );
        setLoadingSuggestions(false);
        return;
      }

      setAtHint(null);
      setAtMention(active);
      setActiveSuggestIndex(0);

      const recent = mergePathSuggestions(
        active.query,
        recentAttachedPaths,
        [],
      );
      setSuggestions(recent);

      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      setLoadingSuggestions(true);

      void (async () => {
        try {
          const merged = await fetchPathSuggestions(active, controller.signal);
          if (controller.signal.aborted) return;
          setSuggestions(merged);
        } catch {
          if (!controller.signal.aborted) {
            setSuggestions(recent);
          }
        } finally {
          if (!controller.signal.aborted) {
            setLoadingSuggestions(false);
          }
        }
      })();
    },
    [fetchPathSuggestions, recentAttachedPaths, running, workspaceAtEnabled],
  );

  const syncAtFromTextarea = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    refreshAtSuggestions(node.value, node.selectionStart ?? node.value.length);
  }, [refreshAtSuggestions]);

  function pickSuggestion(filePath: string) {
    const node = textareaRef.current;
    if (!node || !atMention) return;
    let mentionPath = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (
      reviewEditorSelection &&
      reviewEditorSelection.path.replaceAll("\\", "/").replace(/^\.\/+/, "") ===
        mentionPath
    ) {
      mentionPath += formatMentionLineRange(
        reviewEditorSelection.startLine,
        reviewEditorSelection.endLine,
      );
    }
    const { nextText, nextCursor } = insertAtMention(
      request,
      atMention.start,
      node.selectionStart ?? request.length,
      mentionPath,
    );
    onRequestChange(nextText);
    setAtMention(null);
    setSuggestions([]);
    setAtHint(null);
    suggestAbortRef.current?.abort();
    setLoadingSuggestions(false);
    queueMicrotask(() => {
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
      refreshAtSuggestions(nextText, nextCursor);
    });
  }

  const openAtFilePicker = useCallback(() => {
    if (running || attachedFiles.length >= maxAttachedFiles) {
      return;
    }
    const node = textareaRef.current;
    if (!node) return;
    const start = node.selectionStart ?? request.length;
    const end = node.selectionEnd ?? start;
    const next = `${request.slice(0, start)}@${request.slice(end)}`;
    const cursor = start + 1;
    onRequestChange(next);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(cursor, cursor);
      refreshAtSuggestions(next, cursor);
    });
  }, [
    attachedFiles.length,
    maxAttachedFiles,
    onRequestChange,
    refreshAtSuggestions,
    request,
    running,
  ]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const node = event.currentTarget;
    const selStart = node.selectionStart ?? 0;
    const selEnd = node.selectionEnd ?? selStart;

    if (event.key === "Backspace" || event.key === "Delete") {
      const delRange = resolveMentionDeleteRange(
        request,
        selStart,
        selEnd,
        event.key,
      );
      if (delRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(
          request,
          delRange.start,
          delRange.end,
        );
        onRequestChange(nextText);
        setAtMention(null);
        setSuggestions([]);
        setAtHint(null);
        requestAnimationFrame(() => {
          node.focus();
          node.setSelectionRange(nextCursor, nextCursor);
          refreshAtSuggestions(nextText, nextCursor);
        });
        return;
      }
    }

    if (
      selStart === selEnd &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const nextCursor = resolveMentionArrowCursor(
        request,
        selStart,
        event.key === "ArrowLeft" ? "left" : "right",
      );
      if (nextCursor !== null) {
        event.preventDefault();
        requestAnimationFrame(() => {
          node.focus();
          node.setSelectionRange(nextCursor, nextCursor);
          refreshAtSuggestions(request, nextCursor);
        });
        return;
      }
    }

    if (atMention) {
      if (suggestions.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveSuggestIndex((index) =>
            index + 1 >= suggestions.length ? 0 : index + 1,
          );
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveSuggestIndex((index) =>
            index <= 0 ? suggestions.length - 1 : index - 1,
          );
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const path = suggestions[activeSuggestIndex];
          if (path) pickSuggestion(path);
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const path = suggestions[activeSuggestIndex];
          if (path) pickSuggestion(path);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAtMention(null);
        setSuggestions([]);
        setAtHint(null);
        setLoadingSuggestions(false);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canRun) {
        event.currentTarget.form?.requestSubmit();
      }
    }
  };

  const orphanAttachedFiles = attachedFiles.filter(
    (filePath) => !requestContainsAtPath(request, filePath),
  );

  return (
    <footer className="shrink-0 border-t border-zinc-200/80 bg-white/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
        {orphanAttachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachedFiles.map((filePath, index) => {
              if (requestContainsAtPath(request, filePath)) return null;
              return (
                <span
                  key={`attached-${index}-${filePath}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  title={filePath}
                >
                  <span className="truncate">{filePath}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveAttachedFile(index)}
                    className="shrink-0 hover:text-zinc-900 dark:hover:text-zinc-200"
                    aria-label={`移除 ${filePath}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {referenceImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {referenceImages.map((src, index) => (
              <div key={`ref-img-${index}`} className="relative">
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

        {reviewEditorSelection && (
          <p className="mb-2 text-[10px] text-blue-700 dark:text-blue-300">
            审查选区：{reviewEditorSelection.path} L
            {reviewEditorSelection.startLine}
            {reviewEditorSelection.startLine !== reviewEditorSelection.endLine
              ? `–${reviewEditorSelection.endLine}`
              : ""}
            （@ 同路径文件时将附带行号）
          </p>
        )}

        <form onSubmit={onSubmit}>
          <div className="relative">
            {atMention && (
              <ul
                className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-52 overflow-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
                role="listbox"
              >
                {atHint && (
                  <li className="px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    {atHint}
                  </li>
                )}
                {loadingSuggestions && suggestions.length === 0 && !atHint && (
                  <li className="px-3 py-2 text-[11px] text-zinc-500">加载文件列表…</li>
                )}
                {!loadingSuggestions &&
                  suggestions.length === 0 &&
                  !atHint && (
                  <li className="px-3 py-2 text-[11px] text-zinc-500">
                    继续输入路径筛选
                  </li>
                )}
                {suggestions.map((path, index) => (
                  <li key={path}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeSuggestIndex}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickSuggestion(path);
                      }}
                      className={`flex w-full px-3 py-1.5 text-left font-mono text-[11px] ${
                        index === activeSuggestIndex
                          ? "bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100"
                          : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {path}
                    </button>
                  </li>
                ))}
                {loadingSuggestions && suggestions.length > 0 && (
                  <li className="px-3 py-1 text-[10px] text-zinc-400">更新中…</li>
                )}
              </ul>
            )}
            <div
              className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition focus-within:ring-2 dark:bg-zinc-900 ${
                imageDragActive
                  ? "border-sky-400 ring-2 ring-sky-300/80 dark:border-sky-500 dark:ring-sky-800/80"
                  : "border-zinc-200 focus-within:border-zinc-300 focus-within:ring-zinc-200/80 dark:border-zinc-700 dark:focus-within:border-zinc-600 dark:focus-within:ring-zinc-800"
              }`}
              onDragEnter={onImageDragEnter}
              onDragLeave={onImageDragLeave}
              onDragOver={onImageDragOver}
              onDrop={(event) => void onImageDrop(event)}
            >
            <div className="relative max-h-[200px] min-h-[44px] overflow-hidden">
              {request.trim().length > 0 && (
                <div
                  ref={highlightRef}
                  className="absolute inset-0 z-0 max-h-[200px] overflow-auto"
                >
                  <ComposerMentionHighlight text={request} />
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={request}
                onChange={(e) => {
                  onRequestChange(e.target.value);
                  refreshAtSuggestions(
                    e.target.value,
                    e.target.selectionStart ?? e.target.value.length,
                  );
                }}
                onClick={syncAtFromTextarea}
                onKeyUp={syncAtFromTextarea}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onScroll={syncHighlightScroll}
                placeholder="描述要做的改动…（@ 附加文件，Ctrl+V / 拖入截图，Enter 发送）"
                disabled={running}
                rows={1}
                className={`relative z-10 block max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed outline-none caret-zinc-900 selection:bg-sky-200/40 disabled:opacity-60 dark:caret-zinc-100 dark:selection:bg-sky-900/40 ${
                  request.trim().length > 0
                    ? "text-transparent placeholder:text-transparent"
                    : "text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                }`}
              />
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {workspacePicker && (
                  <AgentWorkspacePicker
                    currentName={workspacePicker.currentName}
                    projects={workspacePicker.projects}
                    busy={workspacePicker.busy}
                    onSelect={workspacePicker.onSelect}
                    onOpenFolder={workspacePicker.onOpenFolder}
                  />
                )}
                <button
                  type="button"
                  disabled={running || referenceImages.length >= maxReferenceImages}
                  onClick={onPickImages}
                  className="rounded-lg px-2 py-1 text-[12px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="附加参考图（Ctrl+V 粘贴或拖入截图）"
                >
                  ＋
                </button>
                <button
                  type="button"
                  disabled={
                    running || attachedFiles.length >= maxAttachedFiles
                  }
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openAtFilePicker();
                  }}
                  className="rounded-lg px-2 py-1 text-[12px] font-medium text-sky-600 transition hover:bg-sky-50 hover:text-sky-800 disabled:opacity-40 dark:text-sky-400 dark:hover:bg-sky-950/40"
                  title="附加文件 @（↑↓ 选择，Enter/Tab 确认）"
                >
                  @
                </button>
                <AgentAgentSettings
                  disabled={running}
                  onPrefsChange={onAgentPrefsChange}
                />
              </div>
              <button
                type={running && onCancel ? "button" : "submit"}
                disabled={running ? !onCancel : !canRun}
                onClick={
                  running && onCancel
                    ? (event) => {
                        event.preventDefault();
                        onCancel();
                      }
                    : undefined
                }
                className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                title={running ? "停止运行" : "发送（Enter）"}
              >
                {running ? (
                  onCancel ? (
                    <StopIcon />
                  ) : (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-400/30 dark:border-t-zinc-900" />
                  )
                ) : (
                  <SendIcon />
                )}
              </button>
            </div>
            </div>
          </div>
        </form>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          {approvalStatus && (
            <span
              className={
                approvalStatusTone === "error"
                  ? "text-red-600 dark:text-red-400"
                  : approvalStatusTone === "success"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-500 dark:text-zinc-400"
              }
            >
              {approvalStatus}
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}
